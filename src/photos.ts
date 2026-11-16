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
  return ((await tx('readonly', (s) => s.getAll())) as PhotoRecord[]).filter((r) => !r.synced).map((r) => r.id);
}

export async function markPhotoSynced(id: string) {
  const record = (await tx('readonly', (s) => s.get(id))) as PhotoRecord | undefined;
  if (record && !record.synced) await tx('readwrite', (s) => s.put({ ...record, synced: true }));
}

export async function deleteLocalPhoto(id: string) {
  await tx('readwrite', (s) => s.delete(id));
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
}

export async function clearAllPhotos() {
  await tx('readwrite', (s) => s.clear());
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

/** Object URL to show a photo, fetched from Drive if it was taken on another device. */
export function photoUrl(id: string): Promise<string | null> {
  const cached = urls.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(id);
  if (pending) return pending;
  const promise = (async () => {
    let blob = await getPhoto(id).catch(() => null);
    if (!blob && remoteFetcher) {
      blob = await remoteFetcher(id).catch(() => null);
      if (blob) await savePhoto(id, blob, true).catch(() => {});
    }
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, promise);
  return promise;
}

/** Longest edge after shrinking - plenty to recognise an item */
const MAX_EDGE = 1200;

/** Shrinks a camera photo to a JPEG no bigger than MAX_EDGE on its longest side. */
export async function compressImage(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
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
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the photo'))), 'image/jpeg', 0.72));
}
