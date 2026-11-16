import { mergeList, mergeTombstones } from './syncEngine';

/**
 * Stock List: a general inventory (what you have, how many, where it is)
 * plus a shopping list, kept in a Google Drive folder.
 */

export interface StockItem {
  id: string;
  name: string;
  qty: number;
  location: string;
  notes: string;
  /** Optional details - empty / null when not filled in */
  brand: string;
  /** Tin, carton, packet… (see PACK_TYPES), or anything typed */
  packType: string;
  /** Size of one, e.g. 400 with unit 'g' */
  size: number | null;
  unit: string;
  createdAt: string;
  updatedAt: string;
}

export const PACK_TYPES = ['Tin', 'Carton', 'Packet', 'Bottle', 'Jar', 'Box', 'Bag', 'Tube', 'Tub', 'Pouch', 'Roll'];
export const UNITS = ['g', 'kg', 'ml', 'L', 'cl', 'oz', 'lb', 'each'];

/** "Heinz · Tin · 400 g" - the details that are filled in, in that order */
export function itemDetails(item: Pick<StockItem, 'brand' | 'packType' | 'size' | 'unit'>): string {
  const size = item.size !== null && item.size > 0 ? `${Number(item.size.toFixed(3))}${item.unit === 'each' ? ' each' : ` ${item.unit}`}` : '';
  return [item.brand.trim(), item.packType.trim(), size].filter(Boolean).join(' · ');
}

export interface BuyItem {
  id: string;
  name: string;
  done: boolean;
  /** Set when added from a stock item, so it isn't added twice */
  stockId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockState {
  version: 1;
  items: StockItem[];
  buy: BuyItem[];
  /** id → when it was deleted, so a merge doesn't bring it back */
  tombstones: Record<string, string>;
}

export const emptyState = (): StockState => ({ version: 1, items: [], buy: [], tombstones: {} });

export const now = () => new Date().toISOString();

export const newId = () => crypto.randomUUID();

/** Parses a saved or synced copy, filling anything missing so older/odd files still load. */
export function parseState(text: string): StockState {
  // Older copies had photos (photoId, deletedPhotoIds); those fields are dropped.
  const raw = JSON.parse(text) as Partial<StockState>;
  if (!raw || typeof raw !== 'object') throw new Error('Not a Stock List data file');
  return {
    version: 1,
    items: (raw.items ?? []).map(({ photoId: _photo, ...i }: StockItem & { photoId?: unknown }) => ({
      ...i,
      qty: Number.isFinite(i.qty) ? i.qty : 0,
      location: i.location ?? '',
      notes: i.notes ?? '',
      brand: i.brand ?? '',
      packType: i.packType ?? '',
      size: typeof i.size === 'number' && Number.isFinite(i.size) ? i.size : null,
      unit: i.unit || 'g',
    })),
    buy: (raw.buy ?? []).map((b) => ({ ...b, done: Boolean(b.done), stockId: b.stockId ?? null })),
    tombstones: raw.tombstones ?? {},
  };
}

/** Record-by-record merge: newer edit wins, deletions stick (unless edited after). */
export function mergeStock(local: StockState, remote: StockState): StockState {
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones);
  return {
    version: 1,
    items: mergeList(local.items, remote.items, tombstones),
    buy: mergeList(local.buy, remote.buy, tombstones),
    tombstones,
  };
}

/** Values already used for a text field (brand…), most-used first, ignoring case and blanks. */
export function valuesByUse(values: string[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const value of values) {
    const label = value.trim();
    if (!label) continue;
    const entry = counts.get(label.toLowerCase());
    if (entry) entry.n++;
    else counts.set(label.toLowerCase(), { label, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((e) => e.label);
}

/** Locations in use, most-used first, for quick picking. */
export function locationsByUse(items: StockItem[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const item of items) {
    const label = item.location.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.n++;
    else counts.set(key, { label, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((e) => e.label);
}

/** Matches name, location or notes; every word typed must appear somewhere. */
export function matchesSearch(item: StockItem, query: string): boolean {
  const haystack = `${item.name} ${item.location} ${item.notes} ${item.brand} ${item.packType}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Ticked items sink to the bottom; otherwise newest first. */
export function sortBuyList(buy: BuyItem[]): BuyItem[] {
  return [...buy].sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt));
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function stockCsv(items: StockItem[]): string {
  const rows = [
    ['Name', 'Quantity', 'Location', 'Brand', 'Pack type', 'Size', 'Unit', 'Notes', 'Updated'],
    ...items.map((i) => [i.name, i.qty, i.location, i.brand, i.packType, i.size ?? '', i.size === null ? '' : i.unit, i.notes, i.updatedAt.slice(0, 10)]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

// --- Device copy ------------------------------------------------------------

const STATE_KEY = 'stocklist-data-v1';

export function loadLocal(): StockState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? parseState(raw) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveLocal(state: StockState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked - the Drive copy still syncs while the app is open.
  }
}

export function clearLocal() {
  localStorage.removeItem(STATE_KEY);
}
