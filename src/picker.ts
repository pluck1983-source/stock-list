/**
 * Google's file picker, used by someone a list was shared with. The app only
 * has access to files it created itself (drive.file), so a shared list has to
 * be opened once through the picker: picking a file is how the person tells
 * Google this app may use it. Needs an API key (VITE_GOOGLE_API_KEY) from the
 * same Google Cloud project as the sign-in client, with the Picker API enabled.
 */

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
/** The picker needs the Cloud project number, which is the start of the client ID */
const APP_ID = CLIENT_ID?.split('-')[0] ?? '';

export function pickerAvailable(): boolean {
  return Boolean(API_KEY && CLIENT_ID);
}

interface PickedDoc {
  id: string;
  name: string;
}

/* Just the parts of Google's picker API used here. */
interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (data: { action: string; docs?: PickedDoc[] }) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}
interface DocsView {
  setMimeTypes(types: string): DocsView;
  setOwnedByMe(owned: boolean): DocsView;
  setIncludeFolders(include: boolean): DocsView;
  setMode(mode: string): DocsView;
  setQuery(query: string): DocsView;
}
interface PickerApi {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => DocsView;
  ViewId: { DOCS: string };
  DocsViewMode: { LIST: string };
  Action: { PICKED: string; CANCEL: string };
}
interface GoogleWindow {
  gapi?: { load(name: string, cb: () => void): void };
  google?: { picker?: PickerApi };
}

let loading: Promise<PickerApi> | null = null;

function loadPicker(): Promise<PickerApi> {
  loading ??= new Promise<PickerApi>((resolve, reject) => {
    const w = window as unknown as GoogleWindow;
    const ready = () => w.gapi!.load('picker', () => (w.google?.picker ? resolve(w.google.picker) : reject(new Error('Google file picker did not load'))));
    if (w.gapi) return ready();
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = ready;
    script.onerror = () => reject(new Error("Couldn't load Google's file picker - check you're online."));
    document.head.appendChild(script);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Opens the picker on files shared with this account; resolves with what was picked (empty if cancelled). */
export async function pickSharedFiles(token: string, searchText: string): Promise<PickedDoc[]> {
  if (!API_KEY) throw new Error('This build has no Google API key, so shared lists cannot be opened.');
  const picker = await loadPicker();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes('application/json').setOwnedByMe(false).setMode(picker.DocsViewMode.LIST).setQuery(searchText);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setTitle('Select stock-list-data.json')
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs ?? []);
        else if (data.action === picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}
