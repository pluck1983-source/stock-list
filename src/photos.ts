/**
 * Stock List photos: shrunk on the phone, kept in this app's own IndexedDB
 * database, and synced to Drive as separate JPEGs.
 */

const DB_NAME = 'stocklist-photos';
const STORE = 'photos';

interface PhotoRecord {
  id: string;
  blob: Blob;
  synced: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const urls = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();
let remoteFetcher: ((id: string) => Promise<Blob | null>) | null = null;

export function setRemotePhotoFetcher(fetcher: typeof remoteFetcher) {
  remoteFetcher = fetcher;
}

export async function savePhoto(id: string, blob: Blob, synced: boolean) {
  await tx('readwrite', (s) => s.put({ id, blob, synced } satisfies PhotoRecord));
}

export async function getPhoto(id: string): Promise<Blob | null> {
  return ((await tx('readonly', (s) => s.get(id))) as PhotoRecord | undefined)?.blob ?? null;
}

export async function unsyncedPhotoIds(): Promise<string[]> {
  return ((await tx('readonly', (s) => s.getAll())) as PhotoRecord[]).filter((r) => !r.synced && !r.id.startsWith('t:')).map((r) => r.id);
}

export async function markPhotoSynced(id: string) {
  const record = (await tx('readonly', (s) => s.get(id))) as PhotoRecord | undefined;
  if (record && !record.synced) await tx('readwrite', (s) => s.put({ ...record, synced: true }));
}

export async function deleteLocalPhoto(id: string) {
  await tx('readwrite', (s) => s.delete(id));
  for (const key of [`thumb:${id}`, `full:${id}`]) {
    const url = urls.get(key);
    if (url) URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

export async function clearAllPhotos() {
  await tx('readwrite', (s) => s.clear());
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

// --- Small copies for the shared photo pack ----------------------------------

/** Pack copies are stored beside full photos under this prefix */
const THUMB_PREFIX = 't:';
/** Longest edge of a pack copy: sharp on a phone screen, ~20-40 KB */
export const THUMB_EDGE = 400;

export async function saveThumb(id: string, blob: Blob) {
  await savePhoto(THUMB_PREFIX + id, blob, true);
  for (const key of [`thumb:${id}`, `full:${id}`]) urls.delete(key);
  notify(id);
}

export function getThumb(id: string): Promise<Blob | null> {
  return getPhoto(THUMB_PREFIX + id);
}

export async function deleteThumb(id: string) {
  await deleteLocalPhoto(THUMB_PREFIX + id);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bytes = Uint8Array.from(atob(body ?? ''), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

/** A pack copy from this device's full photo, made if missing. Null if neither is here. */
export async function ensureThumb(id: string): Promise<Blob | null> {
  const existing = await getThumb(id).catch(() => null);
  if (existing) return existing;
  const full = await getPhoto(id).catch(() => null);
  if (!full) return null;
  const thumb = await compressImage(full, THUMB_EDGE, 0.6);
  await saveThumb(id, thumb);
  return thumb;
}

// --- Display ------------------------------------------------------------------

const listeners = new Set<(id: string) => void>();
function notify(id: string) {
  for (const l of listeners) l(id);
}
/** Called when a photo's pack copy arrives, so a placeholder can show it */
export function onPhotoChanged(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Object URL to show a photo. 'thumb' (lists) prefers the small pack copy;
 * 'full' (the editor) prefers the full photo - from this device, then Drive -
 * and falls back to the pack copy when the full one isn't reachable (it was
 * taken by someone the list is shared with).
 */
export function photoUrl(id: string, variant: 'thumb' | 'full' = 'full'): Promise<string | null> {
  const key = `${variant}:${id}`;
  const cached = urls.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const local = () => getPhoto(id).catch(() => null);
    const thumb = () => getThumb(id).catch(() => null);
    const remote = async () => {
      if (!remoteFetcher) return null;
      const blob = await remoteFetcher(id).catch(() => null);
      if (blob) await savePhoto(id, blob, true).catch(() => {});
      return blob;
    };
    const order = variant === 'thumb' ? [thumb, local, remote] : [local, remote, thumb];
    let blob: Blob | null = null;
    for (const source of order) if ((blob = await source())) break;
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    return url;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Longest edge after shrinking - plenty to recognise an item */
const MAX_EDGE = 1200;

/** Shrinks a camera photo to a JPEG no bigger than MAX_EDGE on its longest side. */
export async function compressImage(file: Blob, maxEdge = MAX_EDGE, quality = 0.72): Promise<Blob> {
  // 'from-image' applies the rotation phones store photos with.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the photo on this device');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the photo'))), 'image/jpeg', quality));
}
