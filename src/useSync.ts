import { useCallback, useEffect, useRef, useState } from 'react';
import { createGoogleDriveProvider } from './drive';
import { decideSync, hashState } from './syncEngine';
import { AuthRequiredError, type RemoteFileMeta } from './driveTypes';
import { pickSharedFiles, pickerAvailable } from './picker';
import { mergeStock, parseState, type StockState } from './store';

const DATA_FILE = 'stock-list-data.json';

const drive = createGoogleDriveProvider({
  appName: 'Stock List',
  fileName: DATA_FILE,
  folderName: 'Stock List',
  keyPrefix: 'stocklist-gdrive',
  redirectPath: '',
});
const provider = drive.provider;
const extras = drive.extras;
export { pickerAvailable };

/** 'choose': signed in, but this account has no list yet - start one or open one shared with it */
export type SyncStatus = 'unconfigured' | 'off' | 'choose' | 'syncing' | 'synced' | 'reconnect' | 'error';

interface SyncMeta {
  syncedHash: string | null;
  syncedRemoteVersion: string | null;
  lastSyncedAt: string | null;
  accountEmail: string | null;
  /** Set by "Start a new list", so the first sync may create the Drive file */
  allowCreate?: boolean;
  /** True when this account owns the list (it can share it) */
  isOwner?: boolean;
}

const META_KEY = 'stocklist-sync-v1';

function readMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as SyncMeta) : null;
  } catch {
    return null;
  }
}

function writeMeta(meta: SyncMeta | null) {
  if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
  else localStorage.removeItem(META_KEY);
}

function updateMeta(patch: Partial<SyncMeta>) {
  const meta = readMeta();
  if (meta) writeMeta({ ...meta, ...patch });
}

export function useSync(state: StockState, setState: (fn: (current: StockState) => StockState) => void) {
  const [status, setStatus] = useState<SyncStatus>(() => (!provider.isConfigured() ? 'unconfigured' : readMeta() ? 'syncing' : 'off'));
  const [accountEmail, setAccountEmail] = useState(() => readMeta()?.accountEmail ?? null);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => readMeta()?.lastSyncedAt ?? null);
  const [error, setError] = useState<string | null>(() => drive.takeSignInError());
  const [isOwner, setIsOwner] = useState(() => readMeta()?.isOwner ?? true);

  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef(false);
  const rerun = useRef<boolean | null>(null);
  const authLapsed = useRef(false);

  const recordSynced = useCallback((hash: string, remote: RemoteFileMeta) => {
    const at = new Date().toISOString();
    updateMeta({ syncedHash: hash, syncedRemoteVersion: remote.version, lastSyncedAt: at });
    setLastSyncedAt(at);
  }, []);

  const sync = useCallback(
    async (onStart = false) => {
      const meta = readMeta();
      if (!meta || (authLapsed.current && !onStart)) return;
      if (running.current) {
        rerun.current = (rerun.current ?? false) || onStart;
        return;
      }
      running.current = true;
      setStatus('syncing');
      try {
        // Renewing an expired sign-in reloads the page, so only when the app has just opened.
        await provider.signIn(false, onStart, meta.accountEmail);
        let email = meta.accountEmail;
        if (!email) {
          email = await provider.getAccountEmail();
          updateMeta({ accountEmail: email });
          setAccountEmail(email);
        }
        const remote = await provider.getMeta();
        if (!remote) {
          if (meta.syncedRemoteVersion !== null)
            throw new Error("Can't find the Stock List data in Google Drive any more - it may have been moved to the bin or unshared. Changes are kept on this device.");
          if (!meta.allowCreate) {
            setStatus('choose');
            return;
          }
        }
        const owner = remote ? Boolean(remote.owner && email && remote.owner.toLowerCase() === email.toLowerCase()) : true;
        if (owner !== meta.isOwner) {
          updateMeta({ isOwner: owner });
          setIsOwner(owner);
        }
        const local = stateRef.current;
        const action = decideSync({
          localHash: hashState(local),
          remoteVersion: remote?.version ?? null,
          syncedHash: meta.syncedHash,
          syncedRemoteVersion: meta.syncedRemoteVersion,
        });
        if (action === 'push') {
          recordSynced(hashState(local), await provider.upload(JSON.stringify(local), remote));
        } else if (action === 'merge' && remote) {
          const remoteState = parseState(await provider.download(remote));
          const before = stateRef.current;
          const merged = mergeStock(before, remoteState);
          const mergedHash = hashState(merged);
          if (mergedHash !== hashState(remoteState)) recordSynced(mergedHash, await provider.upload(JSON.stringify(merged), remote));
          else recordSynced(mergedHash, remote);
          // Anything edited while that ran is newer - merge it in rather than overwrite it.
          if (mergedHash !== hashState(stateRef.current)) setState((current) => (current === before ? merged : mergeStock(current, merged)));
        }
        authLapsed.current = false;
        setError(null);
        setStatus('synced');
      } catch (e) {
        if (e instanceof AuthRequiredError) {
          if (meta.syncedHash === null) {
            writeMeta(null);
            setStatus('off');
          } else {
            authLapsed.current = true;
            setError('The Google sign-in has run out (they last an hour). It renews by itself next time you open the app, or tap Reconnect. Nothing you entered is lost.');
            setStatus('reconnect');
          }
        } else {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      } finally {
        running.current = false;
        if (rerun.current !== null) {
          const again = rerun.current;
          rerun.current = null;
          void sync(again);
        }
      }
    },
    [recordSynced, setState],
  );

  const connect = useCallback(async () => {
    setError(null);
    setStatus('syncing');
    if (!readMeta()) writeMeta({ syncedHash: null, syncedRemoteVersion: null, lastSyncedAt: null, accountEmail: null });
    try {
      await provider.signIn(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  /** "Start a new list" on the choose screen */
  const startNew = useCallback(() => {
    updateMeta({ allowCreate: true });
    void sync();
  }, [sync]);

  /** Opens Google's picker so this account can use a list someone shared with it */
  const openShared = useCallback(async () => {
    const token = extras.accessToken();
    if (!token) {
      setError('Your Google sign-in has run out - tap Reconnect first.');
      return;
    }
    try {
      const picked = await pickSharedFiles(token, 'stock-list');
      if (picked.length === 0) return;
      if (!picked.some((p) => p.name === DATA_FILE)) {
        setError(`Pick the file called ${DATA_FILE}. Try again.`);
        return;
      }
      setError(null);
      await sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sync]);

  /** Shares the list (folder and data file) with another Google account, as Editor */
  const share = useCallback(async (email: string) => {
    await extras.shareWith(email.trim());
  }, []);

  const disconnect = useCallback(async () => {
    await provider.signOut();
    writeMeta(null);
    authLapsed.current = false;
    setAccountEmail(null);
    setLastSyncedAt(null);
    setError(null);
    setStatus('off');
  }, []);

  useEffect(() => {
    if (readMeta()) void sync(true);
  }, [sync]);

  // Upload a couple of seconds after edits stop.
  useEffect(() => {
    if (!readMeta()) return;
    const timer = window.setTimeout(() => void sync(), 2000);
    return () => window.clearTimeout(timer);
  }, [state, sync]);

  // Pull changes from other devices when coming back to the app or back online.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (readMeta()) void sync(hiddenAt > 0 && Date.now() - hiddenAt > 10 * 60_000);
    };
    const onOnline = () => readMeta() && void sync();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && readMeta() && provider.hasToken()) void sync();
    }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [sync]);

  return { status, accountEmail, lastSyncedAt, error, isOwner, connect, disconnect, startNew, openShared, share, syncNow: sync };
}
