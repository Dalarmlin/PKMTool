# PKMTool · 寶可夢冠軍 AI 戰略分析

PKMTool 是給《寶可夢冠軍》（Pokémon Champions）玩家用的 AI 戰術分析網頁。上傳對戰開始時的截圖，AI 會判讀雙方陣容，給出最佳選角、先發順序與第一回合的行動建議。

支援兩種賽制：

| 賽制 | 選角 | 先發 |
| --- | --- | --- |
| ⚔️ 雙打（VGC） | 帶 6 選 4 | 2 隻 |
| 🗡️ 單打 | 帶 6 選 3 | 1 隻 |

## 功能

- 上傳最多 7 張截圖：
  - 第 1 張：6v6 Team Preview 總覽（雙方陣容與我方道具）
  - 第 2~7 張：我方 6 隻寶可夢各自的招式表
- 點擊選取、手機拍照、拖曳、`Ctrl + V` 貼上
- 縮圖預覽、放大檢視、單張刪除、左右調整順序
- AI 輸出：截圖辨識結果、對手體系與速度線、最佳選角、先發順序、T1 行動與分支決策、勝利條件
- Gemini API Key 只存放在 Cloudflare Worker，前端與 GitHub 上都不會出現
- 密碼保護：Worker 只接受帶有正確 `X-Access-Passcode` 的請求，只有知道密碼的人能使用

## 架構

```
瀏覽器 (GitHub Pages: index.html)
   │  POST { images: [Base64...], format, note }  + Header X-Access-Passcode
   ▼
Cloudflare Worker (worker.js)   ← 比對 env.CUSTOM_PASSCODE，讀取 env.GEMINI_API_KEY
   │  generateContent (inline_data × N)
   ▼
Google Gemini API (gemini-3.5-flash-lite)
```

## 目錄結構

```
PKMTool/
├── index.html              # 前端（Tailwind CDN + marked.js + DOMPurify）
├── worker.js               # Cloudflare Worker 代理後端
├── wrangler.jsonc          # Worker 部署設定
├── package.json            # npm run deploy / npm run dev
├── assets/
│   ├── README.md           # 縮圖對照資料庫說明
│   └── pokemon_icons.json  # 寶可夢 / 道具縮圖對照表（範例）
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
2. 選擇賽制：雙打（6 選 4）或單打（6 選 3）。
3. 依序上傳截圖：第 1 張放 Team Preview 總覽，第 2~7 張放我方 6 隻的招式表。順序錯了可以用縮圖下方的 ◀ ▶ 調整。
4. （選填）在補充說明寫下額外資訊，例如對手上一局的先發。
5. 按「🚀 分析最佳選角與出戰順序」，約 10~60 秒後會顯示報告。

### 截圖建議

- 截圖越清晰，辨識越準。前端會自動把長邊縮到 2048px 並轉成 JPEG 以加快上傳。
- 少於 7 張也能分析，AI 會標示缺少的資訊並以環境常見配置推測。

---

## API 規格

所有請求都必須帶 Header `X-Access-Passcode: <你的密碼>`，否則回傳 401。

`POST {Worker 網址}`

```json
{
  "images": [
    { "mimeType": "image/jpeg", "data": "<Base64，不含 data: 前綴>" }
  ],
  "format": "doubles",
  "note": "選填補充說明"
}
```

- `images`：1~7 張，支援 `image/png`、`image/jpeg`、`image/webp`、`image/heic`、`image/heif`，單張上限 8 MB
- `format`：`doubles`（6 選 4，預設）或 `singles`（6 選 3）
- `note`：最多 1000 字

回應：

```json
{ "ok": true, "markdown": "## 📋 0. 截圖辨識結果 ...", "model": "gemini-3.5-flash-lite", "usage": { } }
```

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
| AI 辨識錯名字 | 換更清晰的截圖，或在補充說明直接寫出正確名稱 |

## 授權與聲明

本專案為非官方粉絲工具。Pokémon 及相關名稱、圖像之權利屬於 Nintendo / Creatures Inc. / GAME FREAK inc.。
