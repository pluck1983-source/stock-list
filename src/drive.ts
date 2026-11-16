import { AuthRequiredError, type CloudProvider, type RemoteFileMeta } from './driveTypes';

/**
 * Google Drive backend. Signs in with Google's browser-only OAuth flow (a
 * full-page redirect to Google and back - no server, no popup, so it works
 * on an iPhone home-screen app).
 *
 * Data lives in an ordinary, visible "Stock List" folder: one JSON file.
 * Whoever keeps the list
 * signs in first, which creates the folder in their Drive. Other devices
 * signed in to the same Google account find the file by name.
 *
 * It only asks for drive.file: access to the files this app itself created,
 * never the rest of the person's Drive. (drive.appdata would hide the
 * data from the person, so it isn't used.)
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

/** What differs between apps sharing this backend (same OAuth client, different data). */
export interface DriveConfig {
  /** Name used in messages */
  appName: string;
  /** The data file, found by this name in My Drive and anything shared */
  fileName: string;
  /** Folder made on first upload */
  folderName: string;
  /** Prefix for this app's localStorage/sessionStorage keys */
  keyPrefix: string;
  /** Page Google returns to, relative to the site base (usually ''); must be an authorised redirect URI */
  redirectPath: string;
}

interface StoredToken {
  token: string;
  expiresAt: number;
}

interface DriveFile {
  id: string;
  modifiedTime: string;
  version: string;
  parents?: string[];
  owners?: { emailAddress?: string; displayName?: string }[];
}

/** Drive operations beyond the main data file: sharing, and the picker's token. */
export interface DriveExtras {
  /** The current access token, for Google's file picker; null when signed out or expired */
  accessToken(): string | null;
  /** Gives another Google account edit access to the list's folder and data file */
  shareWith(email: string): Promise<void>;
}

export function createGoogleDriveProvider(config: DriveConfig): { provider: CloudProvider; extras: DriveExtras; takeSignInError: () => string | null } {
  const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
  const { fileName: FILE_NAME, folderName: FOLDER_NAME, appName: APP_NAME } = config;
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const TOKEN_KEY = `${config.keyPrefix}-token`;
  /** CSRF check for the sign-in round trip */
  const STATE_KEY = `${config.keyPrefix}-oauth-state`;
  /** Set when a silent re-sign-in has been tried this session, so it isn't retried in a loop */
  const SILENT_TRIED_KEY = `${config.keyPrefix}-silent-tried`;
  const SIGN_IN_ERROR_KEY = `${config.keyPrefix}-sign-in-error`;
  /** Set when Google refused a silent renewal, so screen changes stop bouncing to Google until a sign-in works */
  const SILENT_FAILED_KEY = `${config.keyPrefix}-silent-failed`;
  /** The screen to come back to after the round trip to Google */
  const RETURN_KEY = `${config.keyPrefix}-return-to`;
  const SILENT_RETRY_MS = 5 * 60_000;
  /** Renew this long before the hour is up, so a busy session never sees it run out */
  const RENEW_BEFORE_MS = 15 * 60_000;
  const SILENT_ERRORS = ['interaction_required', 'login_required', 'consent_required', 'account_selection_required'];

  /** A problem from the last Google sign-in, read once */
    function takeSignInError(): string | null {
    const message = sessionStorage.getItem(SIGN_IN_ERROR_KEY);
    sessionStorage.removeItem(SIGN_IN_ERROR_KEY);
    return message;
  }

  function redirectUri(): string {
    return new URL(import.meta.env.BASE_URL + config.redirectPath, window.location.origin).href;
  }

  function readStoredToken(): StoredToken | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as StoredToken) : null;
    } catch {
      return null;
    }
  }

  function readToken(): StoredToken | null {
    const stored = readStoredToken();
    // Treat tokens as expired a minute early so a request doesn't race expiry.
    return stored && stored.expiresAt - 60_000 > Date.now() ? stored : null;
  }

  function writeToken(token: StoredToken | null) {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    else localStorage.removeItem(TOKEN_KEY);
  }

  /**
   * Picks up the access token Google appends to the URL after a sign-in
   * redirect, then removes it from the address bar. Runs once when this module
   * loads, before the app renders.
   */
  function consumeRedirectResult() {
    if (!window.location.hash.includes('state=')) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const expectedState = localStorage.getItem(STATE_KEY);
    if (!expectedState || params.get('state') !== expectedState) return;
    localStorage.removeItem(STATE_KEY);
    const token = params.get('access_token');
    const error = params.get('error');
    const granted = params.get('scope') ?? '';
    if (error && SILENT_ERRORS.includes(error)) {
      localStorage.setItem(SILENT_FAILED_KEY, '1');
    } else if (error) {
      sessionStorage.setItem(SIGN_IN_ERROR_KEY, error === 'access_denied' ? 'Google sign-in was cancelled or blocked. Check this Google account is added as a test user, then try again.' : `Google sign-in failed (${error}).`);
    } else if (token && granted && !granted.includes('auth/drive.file')) {
      // Google's consent screen lets people untick Drive access - without it nothing can sync.
      sessionStorage.setItem(SIGN_IN_ERROR_KEY, `Google Drive access was not allowed. Sign in again and tick the box to let ${APP_NAME} see and edit your Google Drive files.`);
    } else if (token) {
      writeToken({ token, expiresAt: Date.now() + Number(params.get('expires_in') ?? 3600) * 1000 });
      localStorage.removeItem(SILENT_TRIED_KEY);
      localStorage.removeItem(SILENT_FAILED_KEY);
    }
    // Back to the screen the user was on, rather than the home screen.
    const returnTo = localStorage.getItem(RETURN_KEY) ?? '';
    localStorage.removeItem(RETURN_KEY);
    window.history.replaceState(null, '', window.location.pathname + window.location.search + (returnTo.startsWith('#/') ? returnTo : ''));
  }

  consumeRedirectResult();

  function redirectToGoogle(silent: boolean, loginHint?: string | null): Promise<never> {
    if (!CLIENT_ID) return Promise.reject(new Error('Google Drive sync is not configured for this build'));
    const state = crypto.randomUUID();
    localStorage.setItem(STATE_KEY, state);
    localStorage.setItem(RETURN_KEY, window.location.hash);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      state,
      // "none" bounces straight back if the user is still signed in to Google
      // and has already allowed the app; otherwise it returns an error and we
      // show the Reconnect button instead.
      prompt: silent ? 'none' : 'select_account',
    });
    // Without a hint, a phone signed in to more than one Google account can't
    // renew silently - Google wants to be told which one.
    if (loginHint) params.set('login_hint', loginHint);
    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    // The page is navigating away - nothing after this should run.
    return new Promise<never>(() => {});
  }

  async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const stored = readToken();
    if (!stored) throw new AuthRequiredError();
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${stored.token}` },
    });
    if (response.status === 401) {
      writeToken(null);
      throw new AuthRequiredError();
    }
    if (!response.ok) throw new Error(await driveErrorMessage(response));
    return response;
  }

  /** Turns Google's error body into something the person can act on */
  async function driveErrorMessage(response: Response): Promise<string> {
    let reason = '';
    let detail = '';
    try {
      const body = (await response.json()) as { error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } };
      reason = body.error?.errors?.[0]?.reason ?? body.error?.details?.[0]?.reason ?? '';
      detail = body.error?.message ?? '';
    } catch {
      // Not JSON - fall back to the status code.
    }
    if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(detail))
      return 'The Google Drive API is switched off in the Google Cloud project. Turn it on (APIs & Services → Library → Google Drive API → Enable), wait a few minutes, then tap retry.';
    if (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' || /insufficient/i.test(detail))
      return `Google Drive access was not allowed. Sign out in Settings, sign in again and tick the box to let ${APP_NAME} see and edit your Google Drive files.`;
    if (response.status === 404) return `The ${APP_NAME} data file could not be found in Google Drive - it may have been deleted or un-shared.`;
    return `Google Drive request failed (${response.status}${detail ? `: ${detail}` : ''})`;
  }

  /** Drive query string literal - escapes quotes/backslashes */
  function q(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  async function listFiles(query: string, fields: string, orderBy?: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      q: `${query} and trashed = false`,
      fields: `files(${fields})`,
      // My Drive plus everything shared with this account.
      corpora: 'user',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      pageSize: '10',
    });
    if (orderBy) params.set('orderBy', orderBy);
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    return ((await response.json()) as { files: DriveFile[] }).files;
  }

  async function createFolder(name: string, parentId: string | null): Promise<string> {
    const response = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
    });
    return ((await response.json()) as { id: string }).id;
  }

  /** Folder holding the data file - learned from the data file, or created on first upload */
  let dataFolderId: string | null = null;

  async function ensureDataFolder(): Promise<string> {
    dataFolderId ??= await createFolder(FOLDER_NAME, null);
    return dataFolderId;
  }

  function toMeta(file: DriveFile): RemoteFileMeta {
    const owner = file.owners?.[0];
    return { id: file.id, modifiedTime: file.modifiedTime, version: file.version, owner: owner?.emailAddress ?? owner?.displayName ?? null };
  }

  const FIELDS = 'id,modifiedTime,version,parents,owners(emailAddress,displayName)';

  const provider: CloudProvider = {
    id: 'google-drive',
    label: 'Google Drive',

    isConfigured: () => Boolean(CLIENT_ID),

    hasToken: () => readToken() !== null,

    needsRenewal() {
      const stored = readStoredToken();
      const lastTry = Number(localStorage.getItem(SILENT_TRIED_KEY) ?? 0);
      return (
        stored !== null &&
        stored.expiresAt - RENEW_BEFORE_MS < Date.now() &&
        !localStorage.getItem(SILENT_FAILED_KEY) &&
        Date.now() - lastTry > SILENT_RETRY_MS
      );
    },

    renew(loginHint) {
      localStorage.setItem(SILENT_TRIED_KEY, String(Date.now()));
      return redirectToGoogle(true, loginHint);
    },

    async signIn(interactive, mayRedirect = false, loginHint = null) {
      if (interactive) return redirectToGoogle(false);
      if (readToken()) return;
      // Tokens only last an hour, so a returning visit usually needs a fresh
      // one. The silent round trip reloads the page, so it's only allowed when
      // the app starts (never mid-typing), and at most once every few minutes -
      // remembered in localStorage because iPhone home-screen apps can lose
      // sessionStorage on the way back from Google, which would loop forever.
      const lastTry = Number(localStorage.getItem(SILENT_TRIED_KEY) ?? 0);
      if (mayRedirect && navigator.onLine && Date.now() - lastTry > SILENT_RETRY_MS) {
        localStorage.setItem(SILENT_TRIED_KEY, String(Date.now()));
        return redirectToGoogle(true, loginHint);
      }
      throw new AuthRequiredError();
    },

    async signOut() {
      const stored = readToken();
      writeToken(null);
      dataFolderId = null;
      if (stored) {
        // Best effort - revokes this app's access so a later sign-in asks again.
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(stored.token)}`, {
          method: 'POST',
        }).catch(() => {});
      }
    },

    async getMeta() {
      const files = await listFiles(`name = ${q(FILE_NAME)}`, FIELDS, 'modifiedTime desc');
      const file = files[0];
      if (!file) return null;
      if (file.parents?.[0] && file.parents[0] !== dataFolderId) {
        dataFolderId = file.parents[0];
      }
      return toMeta(file);
    },

    async download(meta) {
      const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${meta.id}?alt=media&supportsAllDrives=true`);
      return response.text();
    },

    async upload(content, existing) {
      if (existing) {
        const response = await driveFetch(
          `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&supportsAllDrives=true&fields=${FIELDS}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content },
        );
        return toMeta((await response.json()) as DriveFile);
      }
      const folderId = await ensureDataFolder();
      const boundary = `stocklist${Date.now()}`;
      const metadata = { name: FILE_NAME, parents: [folderId], mimeType: 'application/json' };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
      const response = await driveFetch(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`,
        { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
      );
      return toMeta((await response.json()) as DriveFile);
    },

    async getAccountEmail() {
      const response = await driveFetch('https://openidconnect.googleapis.com/v1/userinfo');
      const body = (await response.json()) as { email?: string };
      return body.email ?? null;
    },

  };

  const extras: DriveExtras = {
    accessToken: () => readToken()?.token ?? null,

    async shareWith(email) {
      const targets: string[] = [];
      if (dataFolderId) targets.push(dataFolderId);
      const found = await listFiles(`name = ${q(FILE_NAME)}`, 'id', 'modifiedTime desc');
      if (found[0]) targets.push(found[0].id);
      if (targets.length === 0) throw new Error('There is no list in Google Drive to share yet.');
      for (const id of targets) {
        await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?supportsAllDrives=true&sendNotificationEmail=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
        });
      }
    },
  };

  return { provider, extras, takeSignInError };
}
