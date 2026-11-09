# PKMTool · AI Battle Strategist for Pokémon Champions

PKMTool is an AI battle-strategy web app for *Pokémon Champions* (《寶可夢冠軍》). Register your Pokémon builds before battling; during team selection, just paste one Team Preview screenshot and the AI reads both teams and recommends the best picks, lead order, turn-1 actions, and an estimated win rate.

> Pokémon, move, item, ability, nature, and type names are kept in Traditional Chinese, matching the in-game language.

Two battle formats are supported:

| Format | Selection | Leads |
| --- | --- | --- |
| ⚔️ Doubles (VGC) | Bring 6, pick 4 | 2 |
| 🗡️ Singles | Bring 6, pick 3 | 1 |

## Features

- **📋 Team Prep**: store up to 20 builds (name, item, ability, nature, Tera Type, moves)
  - Upload Pokémon summary-page screenshots and the AI fills them in automatically (up to 6 per upload), or add / edit manually
  - Same-name Pokémon count as different builds if any move, ability, nature, item, or Tera Type differs; exact duplicates are rejected
  - 🧪 AI Build Review: checks whether ability, nature, item, Tera Type, and moves are optimal for the Doubles or Singles meta, with scores, suggested changes, recommended sets, and which stats on which Pokémon to prioritize with stat points (review all builds or a single one)
  - Data is stored in browser LocalStorage, with JSON export / import for backups
  - Pokémon and item icons from `assets/pokemon_icons.json`, with autocomplete when typing names
- **⚔️ Battle Analysis**: needs only one 6v6 Team Preview screenshot (opponent's 6 with Tera Types, your 6 with items)
  - The AI matches your Pokémon and items in the screenshot to your saved builds
  - Click to upload, take a photo on mobile, drag & drop, or `Ctrl + V` to paste; optional "Auto-analyze on paste"
- AI report: recognition results, opponent archetype and speed tiers, best picks, lead order, T1 actions and decision branches, win conditions, and estimated win rate (suggests forfeiting when it is too low)
- The Gemini API key lives only in the Cloudflare Worker; it never appears in the frontend or on GitHub
- Passcode protection: the Worker only accepts requests with the correct `X-Access-Passcode`, so only people who know the passcode can use it

## Architecture

```
Browser (GitHub Pages: index.html)
   │  Team Prep: POST { mode: "parse",  images: [summary pages...] }
   │  Review:    POST { mode: "review", presets, format }
   │  Battle:    POST { mode: "battle", images: [Team Preview], presets, format, note }
   │  + Header X-Access-Passcode
   ▼
Cloudflare Worker (worker.js)   ← checks env.CUSTOM_PASSCODE, reads env.GEMINI_API_KEY
   │  generateContent (inline_data)
   ▼
Google Gemini API (gemini-3.5-flash-lite)
```

## Directory Structure

```
PKMTool/
├── index.html              # Frontend (Tailwind CDN + marked.js + DOMPurify)
├── worker.js               # Cloudflare Worker proxy backend
├── wrangler.jsonc          # Worker deployment config
├── package.json            # npm run deploy / dev / build:icons
├── scripts/
│   └── build-icons.mjs     # Generates the icon lookup table
├── assets/
│   ├── README.md           # Icon database notes
│   ├── pokemon_icons.json  # All Pokémon Champions Pokémon / item icons (auto-generated)
│   └── name_overrides.json # Manually corrected Traditional Chinese names
└── README.md
```

---

## 1. Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key and copy it. **Never** paste it into any frontend file or commit it to GitHub.

---

## 2. Deploy the Cloudflare Worker

### Option A: Wrangler CLI (recommended)

Requires Node.js 18+.

```bash
# 1. Log in to Cloudflare
npx wrangler login

# 2. Set the API key and access passcode (stored as encrypted secrets, never written to files)
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CUSTOM_PASSCODE

# 3. Deploy
npm install
npm run deploy
```

After deploying, Wrangler prints the Worker URL. Put it in the `WORKER_URL` constant in `index.html`:

```js
const WORKER_URL = "https://your-worker.example.workers.dev";
```

Opening the URL directly in a browser returns 401 (no passcode), which is expected; use "🔌 Test Connection" on the web page instead.

Local development:

```bash
# Create .dev.vars (already in .gitignore) with two lines:
#   GEMINI_API_KEY=your-key
#   CUSTOM_PASSCODE=your-passcode
npm run dev
```

### Option B: Cloudflare Dashboard (no installation)

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it (e.g. `pkmtool-worker`) → **Deploy**.
3. Click **Edit code**, paste the entire contents of `worker.js`, then click **Deploy**.
4. Back on the Worker page → **Settings** → **Variables and Secrets** → **Add**:
   - Type: **Secret**
   - Name: `GEMINI_API_KEY`
   - Value: your key
5. Add another **Secret** the same way: Name `CUSTOM_PASSCODE`, Value a passcode only you know.
6. (Optional) Add plain variables:
   - `GEMINI_MODEL`: to switch models; defaults to `gemini-3.5-flash-lite`
   - `ALLOWED_ORIGIN`: restricts which sites can call the Worker, e.g. `https://yourname.github.io`; separate multiple origins with commas. Defaults to `*`

### Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | ✅ | Gemini API key; store as a Secret |
| `CUSTOM_PASSCODE` | ✅ | Access passcode; store as a Secret. If unset, the Worker rejects all requests |
| `GEMINI_MODEL` | | Model name; defaults to `gemini-3.5-flash-lite` |
| `ALLOWED_ORIGIN` | | Allowed CORS origins; defaults to `*` |

> Security tip: the Worker URL is public, but requests without the passcode are blocked (401) and consume no Gemini quota. Use a long, hard-to-guess passcode and set a usage cap in Google AI Studio.

---

## 3. Host the Frontend on GitHub Pages

1. Create a new GitHub repository (e.g. `PKMTool`) and push this project:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/PKMTool.git
   git push -u origin main
   ```

2. Open the repository → **Settings** → **Pages**.
3. Under **Source**, choose **Deploy from a branch**, select branch `main` and folder `/ (root)`, then click **Save**.
4. After about a minute, the site is live at `https://<your-username>.github.io/PKMTool/`.

> Keeping `worker.js` and `wrangler.jsonc` in the repo is fine; they contain no secrets.

---

## 4. Usage

1. Open the site, enter the passcode, and click "🔌 Test Connection" (the passcode is remembered in your browser).

### Before battles (one-time setup)

2. Switch to "📋 Team Prep" and upload your Pokémon summary-page screenshots (one Pokémon per image); the AI adds the builds automatically.
3. Check the results and fix mistakes with ✏️, or use "➕ Add Manually".
   - To check whether your builds are optimal, click "🧪 Review All Builds" or 🧪 on a card, then apply suggestions with ✏️.
4. Back up with "⬇️ Export"; restore with "⬆️ Import" after clearing browser data or switching devices.

### Each battle

5. Switch to "⚔️ Battle Analysis" and choose the format: Doubles (pick 4 of 6) or Singles (pick 3 of 6).
6. Screenshot the team-selection screen and paste it with `Ctrl + V` (with "Auto-analyze on paste" enabled, analysis starts immediately), or click to upload.
7. Wait for the report; the final win-rate card recommends playing to win, playing carefully, or forfeiting.

### Screenshot tips

- Clearer screenshots give more accurate recognition. The frontend automatically resizes the long edge to 2048 px and converts to JPEG for faster uploads.
- If one of your Pokémon in the screenshot has no saved build, the AI assumes a common meta set and notes it.

---

## API Reference

Every request must include the header `X-Access-Passcode: <your-passcode>`, otherwise it returns 401.

Images use `{ "mimeType": "image/jpeg", "data": "<Base64 without the data: prefix>" }`. Supported types: `image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`; max 8 MB per image.

### Screenshot recognition: `POST {Worker URL}`

```json
{ "mode": "parse", "images": [ { "mimeType": "image/jpeg", "data": "..." } ] }
```

- `images`: 1–6 Pokémon summary pages, one Pokémon each

Response:

```json
{ "ok": true, "pokemon": [ { "name": "熾焰咆哮虎", "item": "文柚果", "ability": "威嚇", "nature": "慎重", "teraType": "", "moves": ["擊掌奇襲", "閃焰衝鋒", "拋下狠話", "拍落"] } ] }
```

Fields that are not visible are empty strings.

### Build review: `POST {Worker URL}`

```json
{ "mode": "review", "presets": [ { "name": "仆刀將軍", "item": "", "ability": "", "nature": "", "teraType": "", "moves": ["突襲"] } ], "format": "doubles" }
```

- `presets`: 1–20 builds; `format` is the same as in battle analysis

Response: `{ "ok": true, "markdown": "## 🧪 配置健檢總覽 ..." }`

### Battle analysis: `POST {Worker URL}`

```json
{
  "mode": "battle",
  "images": [ { "mimeType": "image/jpeg", "data": "..." } ],
  "presets": [ { "name": "熾焰咆哮虎", "item": "文柚果", "ability": "威嚇", "nature": "慎重", "teraType": "", "moves": ["擊掌奇襲"] } ],
  "format": "doubles",
  "note": "Optional notes"
}
```

- `images`: exactly 1 Team Preview screenshot
- `presets`: saved builds, up to 20; optional (the AI falls back to common meta sets)
- `format`: `doubles` (pick 4 of 6, default) or `singles` (pick 3 of 6)
- `note`: up to 1000 characters

Response:

```json
{ "ok": true, "markdown": "## 📋 0. 辨識結果 ...", "winRate": 42, "model": "gemini-3.5-flash-lite", "usage": { } }
```

`winRate` is the AI's estimated win rate (integer 0–100), or `null` if the AI didn't provide one. It assumes you follow the recommended picks and lead order. The frontend shows: ≥ 55% play to win, 30–54% play carefully, < 30% consider forfeiting.

On error, the Worker returns `{ "ok": false, "error": "<message>" }` with HTTP status 400 / 401 / 405 / 500 / 502.

`GET {Worker URL}` is a health check (also requires the passcode) and returns `{ "ok": true, "service": "PKMTool Worker", "model": "..." }`.

> The AI reports (Markdown) are written in Traditional Chinese.

---

## FAQ

| Problem | Cause and fix |
| --- | --- |
| Test Connection fails / `Failed to fetch` | `WORKER_URL` in `index.html` is wrong, the Worker isn't deployed, or `ALLOWED_ORIGIN` doesn't include the current site |
| `Unauthorized: wrong passcode` | The entered passcode doesn't match the Worker's `CUSTOM_PASSCODE` |
| `Server is missing the GEMINI_API_KEY / CUSTOM_PASSCODE environment variable` | The Worker secret isn't set; see the deployment steps |
| `Gemini API error` | Invalid key, quota exhausted, or wrong model name; check the Worker Logs for details |
| AI misreads a name | Use a clearer screenshot; fix Team Prep builds with ✏️, or write the correct name in the battle notes |
| Saved builds disappeared | LocalStorage lives only in the current browser; clearing site data or switching devices loses it. Back up regularly with "⬇️ Export" |

## License & Disclaimer

This is an unofficial fan tool. Pokémon and all related names and images are trademarks of Nintendo / Creatures Inc. / GAME FREAK inc.
