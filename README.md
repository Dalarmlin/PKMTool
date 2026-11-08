# PKMTool · 寶可夢冠軍 AI 戰略分析

PKMTool 是給《寶可夢冠軍》（Pokémon Champions）玩家用的 AI 戰術分析網頁。賽前先登錄自己的寶可夢配置，對戰選角時只要貼上 1 張 Team Preview 截圖，AI 就會判讀雙方陣容，給出最佳選角、先發順序、第一回合行動建議與預估勝率。

支援兩種賽制：

| 賽制 | 選角 | 先發 |
| --- | --- | --- |
| ⚔️ 雙打（VGC） | 帶 6 選 4 | 2 隻 |
| 🗡️ 單打 | 帶 6 選 3 | 1 隻 |

## 功能

- **📋 賽前備戰**：登錄最多 20 筆寶可夢配置（名稱、道具、特性、性格、太晶屬性、招式）
  - 上傳寶可夢詳細資訊頁截圖，AI 自動辨識填入（一次最多 20 張，即剩餘可登錄數），或手動新增 / 編輯
  - 同名寶可夢只要招式、特性、性格、道具或太晶任一不同，就視為不同配置；完全相同會被擋下
  - 資料存在瀏覽器 LocalStorage，可匯出 / 匯入 JSON 備份
  - 從 `assets/pokemon_icons.json` 顯示寶可夢與道具縮圖，輸入名稱時有自動完成
- **⚔️ 實戰分析**：只需 1 張 6v6 Team Preview 總覽圖（對手 6 隻與太晶屬性、我方 6 隻與道具）
  - AI 依截圖中的我方寶可夢與道具，自動配對預存配置
  - 支援點擊選取、手機拍照、拖曳、`Ctrl + V` 貼上；可設定「貼上後自動分析」
- AI 輸出：辨識結果、對手體系與速度線、最佳選角、先發順序、T1 行動與分支決策、勝利條件、預估勝率（太低時建議直接投降）
- Gemini API Key 只存放在 Cloudflare Worker，前端與 GitHub 上都不會出現
- 密碼保護：Worker 只接受帶有正確 `X-Access-Passcode` 的請求，只有知道密碼的人能使用

## 架構

```
瀏覽器 (GitHub Pages: index.html)
   │  賽前：POST { mode: "parse",  images: [詳細資訊頁...] }
   │  實戰：POST { mode: "battle", images: [Team Preview], presets, format, note }
   │  + Header X-Access-Passcode
   ▼
Cloudflare Worker (worker.js)   ← 比對 env.CUSTOM_PASSCODE，讀取 env.GEMINI_API_KEY
   │  generateContent (inline_data)
   ▼
Google Gemini API (gemini-3.5-flash-lite)
```

## 目錄結構

```
PKMTool/
├── index.html              # 前端（Tailwind CDN + marked.js + DOMPurify）
├── worker.js               # Cloudflare Worker 代理後端
├── wrangler.jsonc          # Worker 部署設定
├── package.json            # npm run deploy / dev / build:icons
├── scripts/
│   └── build-icons.mjs     # 產生縮圖對照表
├── assets/
│   ├── README.md           # 縮圖對照資料庫說明
│   ├── pokemon_icons.json  # 《寶可夢冠軍》全寶可夢 / 道具縮圖對照表（自動產生）
│   └── name_overrides.json # 手動修正的繁中名稱
└── README.md
```

---

## 一、取得 Gemini API Key

1. 前往 [Google AI Studio](https://aistudio.google.com/apikey)。
2. 建立 API Key 並複製。**不要**把它貼到任何前端檔案或提交到 GitHub。

---

## 二、部署 Cloudflare Worker

### 方法 A：Wrangler CLI（推薦）

需要 Node.js 18 以上。

```bash
# 1. 登入 Cloudflare
npx wrangler login

# 2. 設定 API Key 與存取密碼（會以加密 Secret 存放，不會寫進任何檔案）
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CUSTOM_PASSCODE

# 3. 部署
npm install
npm run deploy
```

部署完成後會顯示 Worker 網址，請把它填進 `index.html` 的 `WORKER_URL` 常數：

```js
const WORKER_URL = "https://your-worker.example.workers.dev";
```

直接用瀏覽器打開會看到 401（因為沒帶密碼），這是正常的；請改用網頁上的「🔌 測試連線」確認。

本機測試：

```bash
# 建立 .dev.vars（已列入 .gitignore），內容兩行：
#   GEMINI_API_KEY=你的金鑰
#   CUSTOM_PASSCODE=你的密碼
npm run dev
```

### 方法 B：Cloudflare Dashboard（不用安裝任何東西）

1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Create Worker**。
2. 取名（例如 `pkmtool-worker`）→ **Deploy**。
3. 點 **Edit code**，把 `worker.js` 全部內容貼上，按 **Deploy**。
4. 回到 Worker 頁面 → **Settings** → **Variables and Secrets** → **Add**：
   - Type：**Secret**
   - Name：`GEMINI_API_KEY`
   - Value：你的金鑰
5. 同樣方式再新增一個 **Secret**：Name `CUSTOM_PASSCODE`，Value 填只有你知道的密碼。
6. （選填）新增一般變數：
   - `GEMINI_MODEL`：要換模型時使用，預設 `gemini-3.5-flash-lite`
   - `ALLOWED_ORIGIN`：限制可呼叫的網站，例如 `https://yourname.github.io`；多個網址用逗號分隔。預設 `*`

### 環境變數一覽

| 名稱 | 必填 | 說明 |
| --- | --- | --- |
| `GEMINI_API_KEY` | ✅ | Gemini API 金鑰，請用 Secret 存放 |
| `CUSTOM_PASSCODE` | ✅ | 存取密碼，請用 Secret 存放；未設定時 Worker 拒絕所有請求 |
| `GEMINI_MODEL` | | 模型名稱，預設 `gemini-3.5-flash-lite` |
| `ALLOWED_ORIGIN` | | CORS 允許來源，預設 `*` |

> 安全建議：Worker 網址是公開的，但沒有密碼的請求會被擋下（401），不會消耗 Gemini 額度。請設定夠長、不易猜的密碼，並在 Google AI Studio 設定用量上限。

---

## 三、用 GitHub Pages 託管前端

1. 在 GitHub 建立新 repository（例如 `PKMTool`），把本專案推上去：

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/你的帳號/PKMTool.git
   git push -u origin main
   ```

2. 進入 repository → **Settings** → **Pages**。
3. **Source** 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 **Save**。
4. 約 1 分鐘後，網站會出現在 `https://你的帳號.github.io/PKMTool/`。

> `worker.js` 和 `wrangler.jsonc` 一起放在 repo 裡沒有問題，裡面沒有任何金鑰。

---

## 四、使用方式

1. 打開網站，輸入存取密碼，按「🔌 測試連線」確認（密碼會記在瀏覽器裡，下次免輸入）。

### 賽前（一次設定好）

2. 切到「📋 賽前備戰」，上傳你的寶可夢詳細資訊頁截圖（每張 1 隻），AI 會自動新增配置。
3. 檢查辨識結果，有誤按 ✏️ 修改；也可以按「➕ 手動新增」。
4. 建議按「⬇️ 匯出」備份；清除瀏覽器資料或換裝置時用「⬆️ 匯入」還原。

### 實戰（每場對戰）

5. 切到「⚔️ 實戰分析」，選擇賽制：雙打（6 選 4）或單打（6 選 3）。
6. 在選角畫面截圖，直接 `Ctrl + V` 貼上（勾選「貼上後自動分析」會立刻開始），或點擊上傳。
7. 等待報告；最後的勝率卡會建議積極應戰、謹慎應戰或直接投降。

### 截圖建議

- 截圖越清晰，辨識越準。前端會自動把長邊縮到 2048px 並轉成 JPEG 以加快上傳。
- 截圖中的我方寶可夢若沒有預存配置，AI 會以環境常見配置推測並標註。

---

## API 規格

所有請求都必須帶 Header `X-Access-Passcode: <你的密碼>`，否則回傳 401。

圖片格式皆為 `{ "mimeType": "image/jpeg", "data": "<Base64，不含 data: 前綴>" }`，支援 `image/png`、`image/jpeg`、`image/webp`、`image/heic`、`image/heif`，單張上限 8 MB。

### 截圖辨識：`POST {Worker 網址}`

```json
{ "mode": "parse", "images": [ { "mimeType": "image/jpeg", "data": "..." } ] }
```

- `images`：1~6 張寶可夢詳細資訊頁，每張 1 隻

回應：

```json
{ "ok": true, "pokemon": [ { "name": "熾焰咆哮虎", "item": "文柚果", "ability": "威嚇", "nature": "慎重", "teraType": "", "moves": ["擊掌奇襲", "閃焰衝鋒", "拋下狠話", "拍落"] } ] }
```

看不到的欄位為空字串。

### 實戰分析：`POST {Worker 網址}`

```json
{
  "mode": "battle",
  "images": [ { "mimeType": "image/jpeg", "data": "..." } ],
  "presets": [ { "name": "熾焰咆哮虎", "item": "文柚果", "ability": "威嚇", "nature": "慎重", "teraType": "", "moves": ["擊掌奇襲"] } ],
  "format": "doubles",
  "note": "選填補充說明"
}
```

- `images`：剛好 1 張 Team Preview 總覽圖
- `presets`：預存配置，最多 20 筆；可省略（AI 改以環境常見配置推測）
- `format`：`doubles`（6 選 4，預設）或 `singles`（6 選 3）
- `note`：最多 1000 字

回應：

```json
{ "ok": true, "markdown": "## 📋 0. 辨識結果 ...", "winRate": 42, "model": "gemini-3.5-flash-lite", "usage": { } }
```

`winRate` 為 AI 預估勝率（0~100 的整數），AI 未給出時為 `null`。前端依此顯示：≥ 55% 積極應戰、30%~54% 謹慎應戰、< 30% 建議投降。

錯誤時回傳 `{ "ok": false, "error": "錯誤訊息" }`，HTTP 狀態碼為 400 / 401 / 405 / 500 / 502。

`GET {Worker 網址}` 為健康檢查，回傳 `{ "ok": true, "service": "PKMTool Worker", "model": "..." }`。

---

## 常見問題

| 狀況 | 原因與處理 |
| --- | --- |
| 測試連線失敗、`Failed to fetch` | `index.html` 的 `WORKER_URL` 錯誤、Worker 尚未部署，或 `ALLOWED_ORIGIN` 沒有包含目前網站 |
| `密碼錯誤，拒絕存取` | 輸入的密碼和 Worker 的 `CUSTOM_PASSCODE` 不一致 |
| `伺服器尚未設定 GEMINI_API_KEY` / `CUSTOM_PASSCODE` | Worker 沒設定 Secret，見部署步驟 |
| `Gemini API 回應錯誤` | 金鑰無效、額度用完或模型名稱錯誤；可在 Worker 的 Logs 查看詳情 |
| AI 辨識錯名字 | 換更清晰的截圖；賽前配置可按 ✏️ 修改，實戰可在補充說明直接寫出正確名稱 |
| 預存配置不見了 | LocalStorage 只存在目前瀏覽器，清除網站資料或換裝置就會消失，請定期「⬇️ 匯出」備份 |

## 授權與聲明

本專案為非官方粉絲工具。Pokémon 及相關名稱、圖像之權利屬於 Nintendo / Creatures Inc. / GAME FREAK inc.。
