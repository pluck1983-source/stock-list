# Stock List

A phone-first app for keeping track of stuff: **what you've got, how many
and where it is**.
Everything is saved in your own Google Drive. There's no server: the
browser talks straight to Google.

Add it to your phone's home screen (Safari: Share → Add to Home Screen) and
it runs like an app, including offline.

## What it does

- **Stock** - tap **+ Add**, type what it is, set how many and where it
  is. Locations you've used before appear as one-tap chips.
  **Save & add another** keeps the location, so doing a whole shelf is
  quick. Change counts with − / + straight from the
  list. Under **More details** (optional): brand / manufacturer, pack type
  (tin, carton, packet… or your own) and size of one (g, kg, ml, L…). Search by name, location or notes, or filter by location.
- **Settings** - who's signed in, last sync, sync now, sign out, download
  the stock as CSV, and "Sign out & clear this device".

## Where the data lives

- A **Stock List** folder in your Google Drive holding one file,
  `stock-list-data.json`.
- Each device keeps its own copy, so it works offline (the top label
  says **Offline – saved here**). Edits upload a couple
  of seconds after you stop; opening the app pulls changes from other
  devices. Copies are merged item by item (newest edit wins, deletions
  stick), so two phones can be used at once.
- **Privacy:** the app asks Google only for `drive.file` - access to the
  file it created itself, or that you pick in Google's file picker. It
  cannot see, change or delete anything else in your Drive.
- **Sharing with someone else:** Settings → Sharing → enter their Google
  email → **Share**. Google emails them. They open Stock List, sign in, tap
  **Open a list shared with me**, select `stock-list-data.json` and press
  **Select** (once per Google account). To stop sharing, remove them from the
  **Stock List** folder in Drive.
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
   - **APIs & Services → Library**: Google Drive API and **Google Picker API**
     enabled.
   - **APIs & Services → Credentials → Create credentials → API key** (for
     sharing): restrict it to *Websites* `https://pluck1983-source.github.io/*`
     and to the *Google Picker API*, then put it in `.env` as
     `VITE_GOOGLE_API_KEY`. Everyone who opens a shared list must be a test
     user (or the app published).


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
