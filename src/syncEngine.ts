/**
 * Pure sync logic, kept free of browser/provider code so it can be tested on
 * its own.
 *
 * Several devices can add records at the same time, so
 * instead of asking which whole copy wins, the two copies are merged record
 * by record: every record carries an updatedAt, the newer edit of a record
 * wins, and deletions leave a tombstone so they aren't undone by a device
 * that still has the old record.
 */

export interface Versioned {
  id: string;
  updatedAt: string;
}

export function mergeList<T extends Versioned>(a: T[], b: T[], tombstones: Record<string, string>): T[] {
  const byId = new Map<string, T>();
  for (const record of [...a, ...b]) {
    const existing = byId.get(record.id);
    if (!existing || record.updatedAt > existing.updatedAt) byId.set(record.id, record);
  }
  // A record edited after it was deleted elsewhere survives (the later action wins).
  const merged = [...byId.values()].filter((r) => !tombstones[r.id] || r.updatedAt > tombstones[r.id]);
  // Keep a stable order: local order first, then anything new from the other copy.
  const order = new Map<string, number>();
  [...a, ...b].forEach((r, i) => {
    if (!order.has(r.id)) order.set(r.id, i);
  });
  return merged.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
}

/** Newest deletion time per id across both copies */
export function mergeTombstones(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const out = { ...b };
  for (const [id, at] of Object.entries(a)) if (!out[id] || at > out[id]) out[id] = at;
  return out;
}

/** JSON with object keys sorted, so the same data always gives the same text whatever order fields were set in */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Fingerprint used to tell whether data changed. Not for security. */
export function hashState(state: object): string {
  const text = stableStringify(state);
  // 53-bit string hash (cyrb53).
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

export type SyncAction = 'none' | 'push' | 'merge';

export interface SyncDecisionInput {
  localHash: string;
  remoteVersion: string | null;
  /** Null when this device has never synced with the current cloud file */
  syncedHash: string | null;
  syncedRemoteVersion: string | null;
}

/**
 * push: only this device changed (or there's no cloud copy yet) - upload.
 * merge: the cloud copy changed since this device last saw it - download,
 *   merge, and upload the result if it differs from the cloud copy.
 */
export function decideSync(input: SyncDecisionInput): SyncAction {
  if (input.remoteVersion === null) return 'push';
  if (input.syncedRemoteVersion === null || input.remoteVersion !== input.syncedRemoteVersion) return 'merge';
  if (input.localHash !== input.syncedHash) return 'push';
  return 'none';
}
