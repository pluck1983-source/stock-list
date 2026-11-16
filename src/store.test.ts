import { describe, expect, it } from 'vitest';
import { decideSync, hashState } from './syncEngine';
import { emptyState, itemDetails, valuesByUse, locationsByUse, matchesSearch, mergeStock, parseState, stockCsv, type StockItem, type StockState } from './store';

const item = (id: string, updatedAt: string, patch: Partial<StockItem> = {}): StockItem => ({
  id, name: id, qty: 1, location: '', notes: '', brand: '', packType: '', size: null, unit: 'g', createdAt: '2026-01-01', updatedAt, ...patch,
});
const withItems = (items: StockItem[], extra: Partial<StockState> = {}): StockState => ({ ...emptyState(), items, ...extra });

describe('mergeStock', () => {
  it('keeps items added on either device', () => {
    const merged = mergeStock(withItems([item('a', '1')]), withItems([item('b', '1')]));
    expect(merged.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('newer quantity wins whichever side it is on', () => {
    const older = withItems([item('a', '2026-01-01', { qty: 3 })]);
    const newer = withItems([item('a', '2026-01-02', { qty: 7 })]);
    expect(mergeStock(older, newer).items[0].qty).toBe(7);
    expect(mergeStock(newer, older).items[0].qty).toBe(7);
  });

  it('a deletion is not undone by a device with the old copy', () => {
    const deleted = withItems([], { tombstones: { a: '2026-01-05' } });
    const stale = withItems([item('a', '2026-01-01')]);
    expect(mergeStock(stale, deleted).items).toEqual([]);
  });

  it('is stable when repeated', () => {
    const a = withItems([item('milk', '1')]);
    const b = withItems([item('eggs', '2')]);
    const once = mergeStock(a, b);
    expect(once.items).toHaveLength(2);
    expect(hashState(mergeStock(once, b))).toBe(hashState(once));
  });
});

describe('parseState', () => {
  it('fills in missing fields', () => {
    const s = parseState(JSON.stringify({ items: [{ id: 'a', name: 'x', createdAt: '1', updatedAt: '1' }] }));
    expect(s.items[0]).toMatchObject({ qty: 0, location: '', notes: '', brand: '', packType: '', size: null, unit: 'g' });
  });
});

describe('helpers', () => {
  it('lists locations by use, ignoring case and blanks', () => {
    const items = [item('a', '1', { location: 'Garage' }), item('b', '1', { location: 'garage ' }), item('c', '1', { location: 'Loft' }), item('d', '1')];
    expect(locationsByUse(items)).toEqual(['Garage', 'Loft']);
  });

  it('search needs every word somewhere', () => {
    const i = item('a', '1', { name: 'Blue paint', location: 'Shed' });
    expect(matchesSearch(i, 'paint shed')).toBe(true);
    expect(matchesSearch(i, 'paint loft')).toBe(false);
  });


  it('quotes CSV cells that need it', () => {
    expect(stockCsv([item('a', '2026-03-04', { name: 'Nails, 40mm', notes: 'say "hi"' })]).split('\n')[1]).toBe('"Nails, 40mm",1,,,,,,"say ""hi""",2026-03-04');
    expect(stockCsv([item('b', '2026-03-04', { brand: 'Heinz', packType: 'Tin', size: 400 })]).split('\n')[1]).toBe('b,1,,Heinz,Tin,400,g,,2026-03-04');
  });
});

describe('decideSync', () => {
  const base = { localHash: 'h1', remoteVersion: 'v1', syncedHash: 'h1', syncedRemoteVersion: 'v1' };
  it('does nothing when nothing changed', () => expect(decideSync(base)).toBe('none'));
  it('pushes local edits', () => expect(decideSync({ ...base, localHash: 'h2' })).toBe('push'));
  it('merges when another device uploaded', () => expect(decideSync({ ...base, remoteVersion: 'v2' })).toBe('merge'));
  it('pushes when there is no cloud copy yet', () => expect(decideSync({ ...base, remoteVersion: null })).toBe('push'));
});

describe('old copies with photos', () => {
  it('drops photo fields', () => {
    const s = parseState(JSON.stringify({ items: [{ id: 'a', name: 'x', qty: 1, photoId: 'p1', createdAt: '1', updatedAt: '1' }], deletedPhotoIds: ['p0'] }));
    expect(s.items[0]).not.toHaveProperty('photoId');
    expect(s).not.toHaveProperty('deletedPhotoIds');
  });
});

describe('item details', () => {
  const base = { brand: '', packType: '', size: null as number | null, unit: 'g' };
  it('joins only what is filled in', () => {
    expect(itemDetails({ ...base, brand: 'Heinz', packType: 'Tin', size: 400 })).toBe('Heinz · Tin · 400 g');
    expect(itemDetails({ ...base, size: 1.5, unit: 'L' })).toBe('1.5 L');
    expect(itemDetails(base)).toBe('');
  });
  it('searches brand and pack type', () => {
    expect(matchesSearch(item('a', '1', { name: 'Beans', brand: 'Heinz', packType: 'Tin' }), 'heinz tin')).toBe(true);
  });
  it('lists used values by use', () => expect(valuesByUse(['Heinz', 'heinz ', 'Napolina', ''])).toEqual(['Heinz', 'Napolina']));
});

describe('old copies with a shopping list', () => {
  it('drops it', () => {
    const s = parseState(JSON.stringify({ items: [], buy: [{ id: 'b', name: 'milk', done: false }] }));
    expect(s).not.toHaveProperty('buy');
  });
});
