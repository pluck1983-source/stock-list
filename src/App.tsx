import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearLocal,
  emptyState,
  loadLocal,
  itemDetails,
  locationsByUse,
  PACK_TYPES,
  UNITS,
  valuesByUse,
  matchesSearch,
  newId,
  now,
  saveLocal,
  sortBuyList,
  stockCsv,
  type BuyItem,
  type StockItem,
  type StockState,
} from './store';
import { pickerAvailable, useSync, type SyncStatus } from './useSync';

const LOCAL_ONLY_KEY = 'stocklist-local-only';
type Tab = 'stock' | 'buy';

function useStockState() {
  const [state, setStateRaw] = useState<StockState>(loadLocal);
  const setState = useCallback((fn: (current: StockState) => StockState) => setStateRaw(fn), []);
  useEffect(() => saveLocal(state), [state]);
  return [state, setState] as const;
}

export default function App() {
  const [state, setState] = useStockState();
  const sync = useSync(state, setState);
  const [localOnly, setLocalOnly] = useState(() => localStorage.getItem(LOCAL_ONLY_KEY) === '1');
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#buy' ? 'buy' : 'stock'));
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    history.replaceState(null, '', tab === 'buy' ? '#buy' : '#stock');
  }, [tab]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // --- Mutations ---
  const upsertItem = useCallback(
    (item: StockItem) => setState((s) => ({ ...s, items: s.items.some((i) => i.id === item.id) ? s.items.map((i) => (i.id === item.id ? item : i)) : [item, ...s.items] })),
    [setState],
  );
  const setQty = useCallback(
    (id: string, qty: number) => setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, qty: Math.max(0, qty), updatedAt: now() } : i)) })),
    [setState],
  );
  const deleteItem = useCallback(
    (item: StockItem) =>
      setState((s) => ({
        ...s,
        items: s.items.filter((i) => i.id !== item.id),
        tombstones: { ...s.tombstones, [item.id]: now() },
      })),
    [setState],
  );
  const addToBuy = useCallback(
    (name: string, stockId: string | null = null) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setState((s) => {
        const open = s.buy.find((b) => !b.done && (stockId ? b.stockId === stockId : b.name.toLowerCase() === trimmed.toLowerCase()));
        if (open) return s;
        const at = now();
        return { ...s, buy: [{ id: newId(), name: trimmed, done: false, stockId, createdAt: at, updatedAt: at }, ...s.buy] };
      });
    },
    [setState],
  );
  const toggleBuy = useCallback((id: string) => setState((s) => ({ ...s, buy: s.buy.map((b) => (b.id === id ? { ...b, done: !b.done, updatedAt: now() } : b)) })), [setState]);
  const removeBuy = useCallback(
    (ids: string[]) =>
      setState((s) => {
        const at = now();
        const tomb = { ...s.tombstones };
        for (const id of ids) tomb[id] = at;
        return { ...s, buy: s.buy.filter((b) => !ids.includes(b.id)), tombstones: tomb };
      }),
    [setState],
  );

  const openBuyCount = state.buy.filter((b) => !b.done).length;
  const needsSignIn = sync.status === 'off' && !localOnly;

  if (needsSignIn)
    return (
      <Welcome
        error={sync.error}
        onSignIn={sync.connect}
        onLocal={() => {
          localStorage.setItem(LOCAL_ONLY_KEY, '1');
          setLocalOnly(true);
        }}
      />
    );

  if (sync.status === 'choose')
    return <ChooseList email={sync.accountEmail} error={sync.error} onNew={sync.startNew} onShared={() => void sync.openShared()} onSignOut={() => void sync.disconnect()} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold tracking-tight">{tab === 'stock' ? 'Stock' : 'Shopping list'}</h1>
        <SyncPill status={sync.status} onClick={() => setShowSettings(true)} />
        <button onClick={() => setShowSettings(true)} aria-label="Settings" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      </header>

      {(sync.status === 'error' || sync.status === 'reconnect') && sync.error && (
        <div className="mx-4 mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {sync.error}
          <div className="mt-2 flex gap-2">
            {sync.status === 'reconnect' ? (
              <button className="btn-secondary" onClick={sync.connect}>Reconnect Google</button>
            ) : (
              <button className="btn-secondary" onClick={() => void sync.syncNow()}>Try again</button>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 px-4 pt-3">
        {tab === 'stock' ? (
          <StockTab state={state} onAdd={() => setEditing('new')} onEdit={setEditing} onQty={setQty} onBuy={(i) => { addToBuy(i.name, i.id); setToast(`Added “${i.name}” to the shopping list`); }} />
        ) : (
          <BuyTab buy={state.buy} items={state.items} onAdd={(n) => addToBuy(n)} onToggle={toggleBuy} onRemove={removeBuy} />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-2xl">
          <TabButton active={tab === 'stock'} onClick={() => setTab('stock')} label="Stock" count={state.items.length} />
          <TabButton active={tab === 'buy'} onClick={() => setTab('buy')} label="Shopping list" count={openBuyCount} highlight={openBuyCount > 0} />
        </div>
      </nav>

      {editing && (
        <ItemEditor
          item={editing === 'new' ? null : editing}
          locations={locationsByUse(state.items)}
          brands={valuesByUse(state.items.map((i) => i.brand))}
          packTypes={[...PACK_TYPES, ...valuesByUse(state.items.map((i) => i.packType)).filter((t) => !PACK_TYPES.some((p) => p.toLowerCase() === t.toLowerCase()))]}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            upsertItem(item);
            setToast(`Saved “${item.name}”`);
          }}
          onDelete={(item) => {
            deleteItem(item);
            setEditing(null);
            setToast(`Deleted “${item.name}”`);
          }}
          onBuy={(item) => {
            addToBuy(item.name, item.id);
            setToast(`Added “${item.name}” to the shopping list`);
          }}
        />
      )}

      {showSettings && (
        <Settings
          sync={sync}
          localOnly={localOnly}
          state={state}
          onClose={() => setShowSettings(false)}
          onSignIn={() => {
            localStorage.removeItem(LOCAL_ONLY_KEY);
            void sync.connect();
          }}
          onClearDevice={async () => {
            if (!window.confirm('Remove all Stock List data from this device? The copy in Google Drive is kept.')) return;
            await sync.disconnect();
            clearLocal();
            localStorage.removeItem(LOCAL_ONLY_KEY);
            setState(() => emptyState());
            setLocalOnly(false);
            setShowSettings(false);
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4">
          <div className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">{toast}</div>
        </div>
      )}
    </div>
  );
}

// --- Stock ------------------------------------------------------------------

function StockTab({ state, onAdd, onEdit, onQty, onBuy }: { state: StockState; onAdd: () => void; onEdit: (i: StockItem) => void; onQty: (id: string, qty: number) => void; onBuy: (i: StockItem) => void }) {
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState<string | null>(null);
  const locations = useMemo(() => locationsByUse(state.items), [state.items]);
  const shown = useMemo(
    () =>
      state.items
        .filter((i) => (!where || i.location.trim().toLowerCase() === where.toLowerCase()) && matchesSearch(i, query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.items, query, where],
  );
  const onBuyList = new Set(state.buy.filter((b) => !b.done && b.stockId).map((b) => b.stockId));

  return (
    <>
      <div className="flex gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stock…" className="input min-w-0 flex-1" />
        <button onClick={onAdd} className="btn-primary shrink-0">+ Add</button>
      </div>
      {locations.length > 0 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={where === null} onClick={() => setWhere(null)}>All</Chip>
          {locations.map((l) => (
            <Chip key={l} active={where?.toLowerCase() === l.toLowerCase()} onClick={() => setWhere(where?.toLowerCase() === l.toLowerCase() ? null : l)}>{l}</Chip>
          ))}
        </div>
      )}
      {state.items.length === 0 ? (
        <Empty title="Nothing in stock yet" body="Tap + Add, say what it is, how many and where it is." />
      ) : shown.length === 0 ? (
        <Empty title="No matches" body="Try a different search or location." />
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {shown.map((item) => (
            <li key={item.id} className="flex gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <button onClick={() => onEdit(item)} className="block w-full text-left">
                  <span className="line-clamp-2 font-medium leading-snug">{item.name}</span>
                  <span className="block truncate text-sm text-slate-500">{item.location || 'No location'}</span>
                  {itemDetails(item) && <span className="block truncate text-xs text-slate-500">{itemDetails(item)}</span>}
                </button>
                <div className="mt-1 flex items-center justify-end gap-2">
                  <button
                    onClick={() => onBuy(item)}
                    aria-label={`Add ${item.name} to shopping list`}
                    className={`mr-auto flex items-center gap-1 rounded-full py-1 text-xs ${onBuyList.has(item.id) ? 'text-teal-600' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <CartIcon filled={onBuyList.has(item.id)} />
                    {onBuyList.has(item.id) ? 'On list' : 'Buy'}
                  </button>
                  <Stepper value={item.qty} onChange={(q) => onQty(item.id, q)} compact />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 0 && (
        <p className="mt-2 text-center text-xs text-slate-500">
          {shown.length} {shown.length === 1 ? 'line' : 'lines'} · {shown.reduce((n, i) => n + i.qty, 0)} in total
        </p>
      )}
    </>
  );
}

function ItemEditor({
  item,
  locations,
  brands,
  packTypes,
  onClose,
  onSave,
  onDelete,
  onBuy,
}: {
  item: StockItem | null;
  locations: string[];
  brands: string[];
  packTypes: string[];
  onClose: () => void;
  onSave: (item: StockItem) => void;
  onDelete: (item: StockItem) => void;
  onBuy: (item: StockItem) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    name: item?.name ?? '',
    qty: item?.qty ?? 1,
    location: item?.location ?? locations[0] ?? '',
    notes: item?.notes ?? '',
    brand: item?.brand ?? '',
    packType: item?.packType ?? '',
    size: item?.size != null ? String(item.size) : '',
    unit: item?.unit ?? 'g',
  }));
  const [moreOpen, setMoreOpen] = useState(() => Boolean(item && itemDetails(item)));
  const nameRef = useRef<HTMLInputElement>(null);
  function save(another: boolean) {
    if (!draft.name.trim()) {
      nameRef.current?.focus();
      return;
    }
    const at = now();
    const saved: StockItem = {
      id: item?.id ?? newId(),
      name: draft.name.trim(),
      qty: Math.max(0, Math.round(draft.qty)),
      location: draft.location.trim(),
      notes: draft.notes.trim(),
      brand: draft.brand.trim(),
      packType: draft.packType.trim(),
      size: parseSize(draft.size),
      unit: draft.unit,
      createdAt: item?.createdAt ?? at,
      updatedAt: at,
    };
    onSave(saved);
    if (another) {
      // Keep the location: boxing up a shelf is the same place over and over.
      setDraft((d) => ({ name: '', qty: 1, location: d.location, notes: '', brand: '', packType: '', size: '', unit: d.unit }));
      nameRef.current?.focus();
    } else onClose();
  }

  const close = onClose;

  return (
    <Sheet title={item ? 'Edit item' : 'Add item'} onClose={close}>
      <label className="label">What is it?</label>
      <input ref={nameRef} autoFocus={!item} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Kitchen roll" className="input w-full" enterKeyHint="done" />

      <label className="label mt-4">How many?</label>
      <Stepper value={draft.qty} onChange={(qty) => setDraft({ ...draft, qty })} />

      <label className="label mt-4">Where is it?</label>
      <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. Garage shelf 2" className="input w-full" list="stock-locations" />
      <datalist id="stock-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
      {locations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {locations.slice(0, 8).map((l) => (
            <Chip key={l} active={draft.location.trim().toLowerCase() === l.toLowerCase()} onClick={() => setDraft({ ...draft, location: l })}>{l}</Chip>
          ))}
        </div>
      )}

      <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} className="mt-4 flex w-full items-center justify-between rounded-lg py-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
        <span>More details <span className="font-normal text-slate-400">(brand, pack, size)</span></span>
        <span aria-hidden>{moreOpen ? '−' : '+'}</span>
      </button>
      {moreOpen && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
          <div>
            <label className="label">Brand / manufacturer</label>
            <input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} placeholder="e.g. Heinz" className="input w-full" list="stock-brands" autoCapitalize="words" />
            <datalist id="stock-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </div>
          <div>
            <label className="label">Pack type</label>
            <div className="flex flex-wrap gap-2">
              {packTypes.map((t) => {
                const active = draft.packType.trim().toLowerCase() === t.toLowerCase();
                return <Chip key={t} active={active} onClick={() => setDraft({ ...draft, packType: active ? '' : t })}>{t}</Chip>;
              })}
            </div>
            <input value={packTypes.some((t) => t.toLowerCase() === draft.packType.trim().toLowerCase()) ? '' : draft.packType} onChange={(e) => setDraft({ ...draft, packType: e.target.value })} placeholder="Or type another…" className="input mt-2 w-full" />
          </div>
          <div>
            <label className="label">Size of one</label>
            <div className="flex gap-2">
              <input value={draft.size} onChange={(e) => setDraft({ ...draft, size: e.target.value })} inputMode="decimal" placeholder="e.g. 400" className="input min-w-0 flex-1" aria-label="Size" />
              <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className="input w-24" aria-label="Unit">
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            {draft.size.trim() !== '' && parseSize(draft.size) === null && <p className="mt-1 text-sm text-red-600">Enter a number, e.g. 400 or 1.5</p>}
          </div>
        </div>
      )}

      <label className="label mt-4">Notes <span className="font-normal text-slate-400">(optional)</span></label>
      <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="input w-full" />

      <div className="mt-5 flex flex-col gap-2">
        <button onClick={() => save(false)} className="btn-primary w-full">Save</button>
        {!item && <button onClick={() => save(true)} className="btn-secondary w-full">Save &amp; add another</button>}
        {item && (
          <div className="flex gap-2">
            <button onClick={() => onBuy(item)} className="btn-secondary flex-1">Add to shopping list</button>
            <button onClick={() => window.confirm(`Delete “${item.name}”?`) && onDelete(item)} className="btn-danger">Delete</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** "400", "1.5" or "1,5" → a positive number; anything else → null */
function parseSize(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

// --- Shopping list -------------------------------------------------------------

function BuyTab({ buy, items, onAdd, onToggle, onRemove }: { buy: BuyItem[]; items: StockItem[]; onAdd: (name: string) => void; onToggle: (id: string) => void; onRemove: (ids: string[]) => void }) {
  // Brand, pack and size of items added from Stock - what to look for in the shop.
  const details = new Map(items.map((i) => [i.id, itemDetails(i)]));
  const [text, setText] = useState('');
  const sorted = sortBuyList(buy);
  const done = buy.filter((b) => b.done);
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(text);
          setText('');
        }}
        className="flex gap-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something to buy…" className="input min-w-0 flex-1" enterKeyHint="enter" autoComplete="off" />
        <button className="btn-primary shrink-0" disabled={!text.trim()}>Add</button>
      </form>
      {buy.length === 0 ? (
        <Empty title="Shopping list is empty" body="Type above, or tap the trolley next to anything in Stock." />
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {sorted.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3">
              <label className="flex flex-1 cursor-pointer items-center gap-3 py-3">
                <input type="checkbox" checked={b.done} onChange={() => onToggle(b.id)} className="size-6 accent-teal-600" />
                <span className="min-w-0">
                  <span className={`block ${b.done ? 'text-slate-400 line-through' : ''}`}>{b.name}</span>
                  {b.stockId && details.get(b.stockId) && <span className="block text-xs text-slate-500">{details.get(b.stockId)}</span>}
                </span>
              </label>
              <button onClick={() => onRemove([b.id])} aria-label={`Remove ${b.name}`} className="p-2 text-slate-400 hover:text-red-600">✕</button>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <button onClick={() => onRemove(done.map((b) => b.id))} className="btn-secondary mt-3 w-full">Clear {done.length} ticked</button>
      )}
    </>
  );
}

// --- Settings & sign-in ---------------------------------------------------------

function Welcome({ error, onSignIn, onLocal }: { error: string | null; onSignIn: () => void; onLocal: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <img src="icons/icon-192.png" alt="" className="size-20 rounded-2xl" />
      <h1 className="text-3xl font-bold tracking-tight">Stock List</h1>
      <p className="text-slate-600 dark:text-slate-300">What you've got, how many and where it is, plus a shopping list. Saved in your Google Drive in a <b>Stock List</b> folder, so every phone and computer you sign in on sees the same list.</p>
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{error}</p>}
      <button onClick={onSignIn} className="btn-primary w-full">Sign in with Google</button>
      <button onClick={onLocal} className="text-sm text-slate-500 underline">Use on this device only</button>
    </div>
  );
}

function Settings({ sync, localOnly, state, onClose, onSignIn, onClearDevice }: { sync: ReturnType<typeof useSync>; localOnly: boolean; state: StockState; onClose: () => void; onSignIn: () => void; onClearDevice: () => void }) {
  function exportCsv() {
    const blob = new Blob([stockCsv(state.items)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stock-list-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const signedIn = sync.status !== 'off' && sync.status !== 'unconfigured';
  return (
    <Sheet title="Settings" onClose={onClose}>
      <section className="space-y-2 text-sm">
        <h3 className="font-semibold">Google Drive</h3>
        {sync.status === 'unconfigured' ? (
          <p className="text-slate-500">This build has no Google sign-in; data stays on this device.</p>
        ) : signedIn ? (
          <>
            <p>Signed in as <b>{sync.accountEmail ?? '…'}</b></p>
            <p className="text-slate-500">
              {sync.status === 'syncing' ? 'Syncing…' : sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}` : 'Not synced yet'}
            </p>
            <p className="text-slate-500">Data is in the <b>Stock List</b> folder in Google Drive. The app can only see files it created there, nothing else in your Drive.</p>
            <div className="flex gap-2">
              <button onClick={() => void sync.syncNow()} className="btn-secondary">Sync now</button>
              <button onClick={() => void sync.disconnect()} className="btn-secondary">Sign out</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-slate-500">{localOnly ? 'Using this device only - nothing is backed up.' : 'Not signed in.'}</p>
            <button onClick={onSignIn} className="btn-primary">Sign in with Google</button>
          </>
        )}
      </section>
      {signedIn && pickerAvailable() && <SharingSection sync={sync} />}
      <section className="mt-6 space-y-2 text-sm">
        <h3 className="font-semibold">Data</h3>
        <button onClick={exportCsv} className="btn-secondary w-full" disabled={state.items.length === 0}>Download stock as CSV</button>
        <button onClick={onClearDevice} className="btn-danger w-full">Sign out &amp; clear this device</button>
      </section>
      <p className="mt-6 text-center text-xs text-slate-400">Built {new Date(__BUILD_TIME__).toLocaleString()}</p>
    </Sheet>
  );
}

function SharingSection({ sync }: { sync: ReturnType<typeof useSync> }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function share() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage('Enter their Google email address.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await sync.share(email);
      setMessage(`Shared with ${email.trim()}. Google emails them a link; they open Stock List, sign in, tap “Open a list shared with me” and select stock-list-data.json.`);
      setEmail('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 space-y-2 text-sm">
      <h3 className="font-semibold">Sharing</h3>
      {sync.isOwner ? (
        <>
          <p className="text-slate-500">Let someone else see and edit this list with their own Google account.</p>
          <div className="flex gap-2">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their.name@gmail.com" className="input min-w-0 flex-1" autoComplete="off" />
            <button onClick={() => void share()} disabled={busy || !email.trim()} className="btn-primary shrink-0">{busy ? 'Sharing…' : 'Share'}</button>
          </div>
          <p className="text-xs text-slate-500">To stop sharing, remove them from the Stock List folder in Google Drive (Share → their name → Remove access).</p>
        </>
      ) : (
        <p className="text-slate-500">This list was shared with you.</p>
      )}
      <button onClick={() => void sync.openShared()} className="btn-secondary w-full">Open a list shared with me</button>
      {message && <p className="text-slate-600 dark:text-slate-300">{message}</p>}
    </section>
  );
}

function ChooseList({ email, error, onNew, onShared, onSignOut }: { email: string | null; error: string | null; onNew: () => void; onShared: () => void; onSignOut: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold tracking-tight">No list in this Google account yet</h1>
      <p className="text-slate-600 dark:text-slate-300">Signed in as <b>{email ?? 'your Google account'}</b>.</p>
      {error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{error}</p>}
      <button onClick={onNew} className="btn-primary w-full">Start a new list</button>
      {pickerAvailable() && (
        <>
          <button onClick={onShared} className="btn-secondary w-full">Open a list shared with me</button>
          <p className="text-sm text-slate-500">Someone shared their list? Tap above, select <b>stock-list-data.json</b> and press Select.</p>
        </>
      )}
      <button onClick={onSignOut} className="text-sm text-slate-500 underline">Use a different Google account</button>
    </div>
  );
}

// --- Small pieces ----------------------------------------------------------

function SyncPill({ status, onClick }: { status: SyncStatus; onClick: () => void }) {
  const map: Record<SyncStatus, [string, string]> = {
    unconfigured: ['Device only', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'],
    choose: ['Choose list', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'],
    off: ['Device only', 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'],
    syncing: ['Syncing…', 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'],
    synced: ['Saved', 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200'],
    reconnect: ['Reconnect', 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'],
    error: ['Sync problem', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'],
  };
  const [label, cls] = map[status];
  return <button onClick={onClick} className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</button>;
}

function TabButton({ active, onClick, label, count, highlight }: { active: boolean; onClick: () => void; label: string; count: number; highlight?: boolean }) {
  return (
    <button onClick={onClick} aria-current={active ? 'page' : undefined} className={`-mt-px flex flex-1 items-center justify-center gap-2 border-t-[3px] py-4 text-sm font-semibold ${active ? 'border-teal-600 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300' : 'border-transparent text-slate-500'}`}>
      {label}
      <span className={`rounded-full px-2 py-0.5 text-xs ${highlight ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{count}</span>
    </button>
  );
}

function Stepper({ value, onChange, compact }: { value: number; onChange: (n: number) => void; compact?: boolean }) {
  const size = compact ? 'size-8 text-lg' : 'size-12 text-2xl';
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label="One fewer" className={`${size} rounded-full bg-slate-100 font-semibold dark:bg-slate-800`}>−</button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        onFocus={(e) => e.target.select()}
        aria-label="Quantity"
        className={`${compact ? 'w-8 text-base' : 'w-16 text-xl'} rounded-md bg-transparent text-center font-semibold tabular-nums ${value === 0 ? 'text-red-600' : ''}`}
      />
      <button type="button" onClick={() => onChange(value + 1)} aria-label="One more" className={`${size} rounded-full bg-slate-100 font-semibold dark:bg-slate-800`}>+</button>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`shrink-0 rounded-full border px-3 py-1 text-sm ${active ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
      {children}
    </button>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-2xl dark:bg-slate-950">
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-10 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  );
}

function CartIcon({ filled }: { filled?: boolean }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3 4h2l2.4 11h10.2L20 8H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></svg>;
}
