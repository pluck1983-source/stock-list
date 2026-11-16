# Stock List

A phone-first app for keeping track of stuff: **what you've got, how many
and where it is**, with a photo of each thing, plus a **shopping list**.
Everything is saved in your own Google Drive. There's no server: the
browser talks straight to Google.

Add it to your phone's home screen (Safari: Share → Add to Home Screen) and
it runs like an app, including offline.

## What it does

- **Stock** - tap **+ Add**, take a photo, type what it is, set how many and
  where it is. Locations you've used before appear as one-tap chips.
  **Save & add another** keeps the location and opens the camera again, so
  doing a whole shelf is quick. Change counts with − / + straight from the
  list. Search by name, location or notes, or filter by location.
- **To buy** - type and press Enter to add; tick things off as you buy them;
  **Clear ticked** removes them. The **Buy** button on a stock item adds it
  to the list (once).
- **Settings** - who's signed in, last sync, sync now, sign out, download
  the stock as CSV, and "Sign out & clear this device".

## Where the data lives

- A **Stock List** folder in your Google Drive: `stock-list-data.json` plus
  a `photos` subfolder with one JPEG per item (shrunk to ~1200 px on the
  phone first).
- Each device keeps its own copy, so it works offline. Edits upload a couple
  of seconds after you stop; opening the app pulls changes from other
  devices. Copies are merged item by item (newest edit wins, deletions
  stick), so two phones can be used at once.
- To let someone else use the same list, share the **Stock List** folder
  with their Gmail as **Editor**. They sign in with their own account and
  press **Cancel** when asked to start a new folder if it isn't shared yet.
- Google sign-ins last an hour; the app renews them by itself when opened.
- **Use on this device only** skips Google entirely (nothing is backed up).

## One-time setup

1. **GitHub**: Settings → Pages → Source: **GitHub Actions** (the deploy
   workflow also tries to turn this on). Every push to `main` deploys to
   `https://<your-user>.github.io/<repo-name>/`.
2. **Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com)),
   on the OAuth client whose ID is in `.env`:
   - **Clients** → the web client → *Authorized redirect URIs*: add the
     app's address exactly, with the trailing slash, e.g.
     `https://pluck1983-source.github.io/stock-list/`.
   - **Data access**: the scope `https://www.googleapis.com/auth/drive`.
   - **Audience → Test users**: the Gmail of everyone who'll sign in.
   - **APIs & Services → Library**: Google Drive API enabled.

   To use a brand-new Google Cloud project instead (so the consent screen
   says "Stock List"), do the above in that project and put its client ID
   in `.env` as `VITE_GOOGLE_CLIENT_ID`.

Expect "Google hasn't verified this app" on sign-in (*Advanced → Go to …*):
full Drive access is a restricted scope, and verification is only needed to
open the app to the public.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run lint
npm run build
```

To test sign-in locally, add `http://localhost:5173/` as an authorised
origin and redirect URI on the OAuth client. An empty
`VITE_GOOGLE_CLIENT_ID` builds a device-only app.
