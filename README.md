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
- **Privacy:** the app asks Google only for `drive.file` - access to the
  files it created itself. It cannot see, change or delete anything else in
  your Drive. Any of your devices signed in to the same Google account see
  the same list. (Sharing the list with *another person's* account doesn't
  work with this permission.)
- Google sign-ins last an hour; the app renews them by itself when opened.
- **Use on this device only** skips Google entirely (nothing is backed up).

## One-time setup

1. **GitHub**: Settings → Pages → Source: **GitHub Actions** (the deploy
   workflow also tries to turn this on). Every push to `main` deploys to
   `https://<your-user>.github.io/<repo-name>/`.
2. **Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com)),
   in the Stock List project, on its OAuth web client (its client ID goes in `.env`):
   - **Clients** → the web client → *Authorized redirect URIs*: add the
     app's address exactly, with the trailing slash, e.g.
     `https://pluck1983-source.github.io/stock-list/`.
   - **Data access**: the scope `https://www.googleapis.com/auth/drive.file`
     only (not `.../auth/drive`).
   - **Audience → Test users**: the Gmail of everyone who'll sign in.
   - **APIs & Services → Library**: Google Drive API enabled.


`drive.file` is a non-sensitive scope, so Google doesn't treat the app as
high-risk. While it's in *Testing*, Google may still show "Google hasn't
verified this app" (*Advanced → Go to Stock List*).

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
