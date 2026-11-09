# Cartridge

A guide to the best games on Nintendo Switch 2, Switch and every classic Nintendo system. Plain HTML, CSS and JavaScript, with no build step.

It ships with 240 hand-picked games. Add free IGDB (or RAWG) keys and it pulls in the full library (thousands of games) without ever exposing the keys to visitors.

## Run it

```bash
python -m http.server 5173
```

Then visit http://localhost:5173. You can also open `index.html` directly.

## Load the full game library

Your keys stay on your computer. A script downloads the games and saves them to `data/library.js`; the website only reads that file.

### Option A: IGDB (recommended)

1. Turn on two-factor authentication on a Twitch account (Twitch requires it to register apps).
2. Go to https://dev.twitch.tv/console and click **Register Your Application**. Name: anything. OAuth Redirect URL: `http://localhost`. Category: Website Integration. Client type: Confidential.
3. Click **Manage** on the new app. Copy the **Client ID**, then click **New Secret** and copy the secret.
4. Copy `.env.example` to `.env` and fill in:
   ```
   IGDB_CLIENT_ID=your-client-id
   IGDB_CLIENT_SECRET=your-secret
   ```

### Option B: RAWG

Get a key at https://rawg.io/apidocs and put `RAWG_API_KEY=your-key` in `.env`. (RAWG has had outages; IGDB is used if both are set.)

### Download

```bash
node scripts/fetch-library.mjs
```

The first run downloads everything. Later runs only fetch new and changed games, so run it again whenever you want new releases. Use `--full` to rebuild from scratch. Refresh the site afterwards.

Optional settings in `.env`:

| Setting | Default | What it does |
| --- | --- | --- |
| `MIN_RATINGS` | 2 | IGDB: skips obscure games with fewer ratings than this (new and upcoming games are always kept). |
| `MIN_ADDED` | 15 | RAWG: skips games fewer than this many RAWG users have added. |
| `MAX_PAGES` | 150 | Safety cap on pages per run. |

### Keep it updated automatically (GitHub)

If the site lives in a GitHub repository, `.github/workflows/refresh-library.yml` refreshes the library every day:

1. Repository **Settings > Secrets and variables > Actions > New repository secret**. Add `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` (or `RAWG_API_KEY`).
2. That's it. It runs daily at 06:00 UTC and commits `data/library.js` when something changed. You can also run it by hand from the **Actions** tab.

Host the site with GitHub Pages (Settings > Pages > Deploy from branch) and new games appear on their own.

### Keeping the key private

- `.env` is listed in `.gitignore`, so git won't upload it.
- If you deploy by dragging the folder onto a host (Netlify Drop and similar), delete `.env` from the copy first.
- The key is never written into `data/library.js` or any file the browser loads.

## Features

- **Systems:** filter by Switch 2, Switch, Wii U, Wii, 3DS, DS, GameCube, N64, GBA, SNES, Game Boy or NES. Your choice is remembered. Switch 2 can include Switch 1 games; Switch can include Switch Online classics.
- **My List:** save games with the bookmark on any card, or mark them "Want to play" / "Played" in the detail view. Saved in your browser.
- **Surprise me:** pick any mix of systems (or a preset like Switch family, Handhelds or Retro) and get a random good game. It can skip games you've played or pick only from your Want to play list.
- **Search:** by title, studio, genre or year. Accents are ignored. Press `/` or `Ctrl/⌘ K`.
- **Browse:** genre chips, a must-play filter, and sorting (recommended, top rated, newest, oldest, A to Z).
- **Detail view:** Wikipedia summary, facts, player rating and modes (from IGDB or RAWG), eShop and trailer links, and similar games.
- **Sharing:** filters live in the URL and each game has its own link (`#/game/<id>`).
- Light, dark and automatic themes. Works on phones.

## Files

| Path | What it is |
| --- | --- |
| `data/games.js` | The hand-picked catalog: title, platforms, year, genres, developer, score, must-play flag, blurb |
| `data/covers.js` | Generated box art URLs (from Wikipedia) |
| `data/library.js` | Generated full library (empty until you run the script) |
| `scripts/fetch-library.mjs` | Downloads the full library from IGDB or RAWG using your keys |
| `scripts/fetch-covers.mjs` | Regenerates `data/covers.js` |
| `assets/styles.css` | All styling |
| `assets/app.js` | Filtering, rendering, My List, Surprise me, detail view |

## Adding a hand-picked game

1. Add an entry to `data/games.js`. If the English Wikipedia article title differs from the game title, set `wiki`.
2. Run `node scripts/fetch-covers.mjs` to fetch its cover.

Hand-picked games take priority over library entries with the same title, so they keep their blurb, box art and must-play flag.

## Notes

Critic scores for hand-picked games are approximate and were compiled by hand. Library scores and covers come from IGDB or RAWG. Cover art and summaries come from Wikipedia. This is a fan project and is not affiliated with Nintendo.
