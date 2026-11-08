# 寶可夢與道具縮圖對照資料庫

`assets/pokemon_icons.json` 是 PKMTool 的「名稱 ↔ 縮圖」對照表，收錄《寶可夢冠軍》所有可用的寶可夢（含 Mega 與地區形態）與道具。用途：

- 將 AI 辨識出的中文名稱對應到標準 ID 與縮圖，未來可在報告中顯示圖示。
- 作為辨識校正依據（例如 AI 輸出「咆哮虎」→ 透過 `aliases` 對應到 `incineroar`）。
- 未來若加入本地辨識（例如以縮圖比對 Team Preview），可直接使用同一套 ID。

| 檔案 | 說明 |
| --- | --- |
| `pokemon_icons.json` | 自動產生的完整對照表，**請勿手動修改名稱**（重新產生會被覆蓋，`aliases` 例外） |
| `name_overrides.json` | 手動修正的繁中名稱，優先於自動結果 |
| `../scripts/build-icons.mjs` | 產生腳本 |

---

## 更新資料庫

需要 Node.js 18 以上。

```bash
npm install          # 安裝 pokemon-showdown 套件
npm run build:icons  # 重新產生 assets/pokemon_icons.json
```

賽季更新、新增寶可夢或道具時，先 `npm update pokemon-showdown` 再重新產生即可。

腳本會：

1. 從 `pokemon-showdown` 套件的 `champions` mod 取出《寶可夢冠軍》合法的寶可夢與道具（依 Showdown 的 `isNonstandard` / `tier` 判斷）。
2. 從 PokeAPI 的 CSV 取繁體中文名稱（`language_id = 4`，zh-Hant）。
3. 形態名稱依規則組合：
   - Mega：`超級` + 本名 + 後綴，例如 `超級噴火龍X`、`超級超能妙喵♀`
   - 地區形態：`本名（阿羅拉／伽勒爾／洗翠／帕底亞的樣子）`
   - 性別：`本名♂`、`本名♀`
   - 其他形態：優先用 PokeAPI 的形態名稱，查無則為 `本名（英文形態名）`
4. 依序測試縮圖網址，取第一個可用的。
5. 保留舊檔中的 `aliases`，並套用 `name_overrides.json`。

執行結束會列出「查無繁中名稱」與「形態名稱保留英文」的項目，方便補到 `name_overrides.json`。

### 手動修正名稱

編輯 `name_overrides.json`，key 為 `showdownId`，再重新執行 `npm run build:icons`：

```json
{
  "pokemon": {
    "taurospaldeacombat": "肯泰羅（帕底亞的樣子・鬥戰種）"
  },
  "items": {
    "roseliberry": "洛玫果"
  }
}
```

### 新增俗稱

`aliases` 直接寫在 `pokemon_icons.json` 對應條目即可，重新產生時會保留。

---

## 資料來源

| 來源 | 內容 | 網址 |
| --- | --- | --- |
| [pokemon-showdown](https://www.npmjs.com/package/pokemon-showdown)（npm） | 《寶可夢冠軍》合法名單、英文名、屬性、形態、`spriteid`、`spritenum` | `data/mods/champions` |
| PokeAPI CSV | 繁中名稱 | `https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/` |
| Pokémon Showdown sprites | 寶可夢縮圖 | `https://play.pokemonshowdown.com/sprites/{gen5,dex,ani,home-centered}/{spriteid}.png` |
| Pokémon Showdown sprites | 道具雪碧圖（24×24，每列 16 格） | `https://play.pokemonshowdown.com/sprites/itemicons-sheet.png` |
| PokeAPI sprites | 寶可夢備援圖、道具單張圖 | `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/{pokemon/{dex},items/{pokeapiId}}.png` |

寶可夢縮圖測試順序：Showdown `gen5` → `dex` → `ani`（gif）→ `home-centered`。新 Mega（例如超級雷丘X）通常只有 `ani`。

---

## 資料結構

```jsonc
{
  "version": "1.0.0",
  "game": "Pokémon Champions",
  "updated": "YYYY-MM-DD",
  "generatedBy": "scripts/build-icons.mjs",
  "sources": { /* 各來源的網址樣板 */ },
  "counts": { "pokemon": 347, "items": 148 },

  "pokemon": [
    {
      "showdownId": "charizardmegax",    // 主鍵：Showdown ID（唯一）
      "dex": 6,                          // 全國圖鑑編號（形態與原型相同）
      "name_zh": "超級噴火龍X",           // 繁中名稱；查無時為英文
      "name_en": "Charizard-Mega-X",
      "baseSpecies": "Charizard",        // 僅形態有此欄位
      "forme": "Mega-X",                 // 僅形態有此欄位
      "aliases": [],                     // 俗稱、簡稱，用於模糊比對（手動維護）
      "types": ["Fire", "Dragon"],
      "icon": "https://play.pokemonshowdown.com/sprites/gen5/charizard-megax.png",
      "icon_fallback": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/6.png"
    }
  ],

  "items": [
    {
      "showdownId": "charizarditex",     // 主鍵
      "pokeapiId": "charizardite-x",     // PokeAPI 識別名稱
      "name_zh": "噴火龍進化石Ｘ",
      "name_en": "Charizardite X",
      "megaStone": ["Charizard-Mega-X"], // 僅 Mega 石有此欄位
      "aliases": [],
      "icon": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/charizardite-x.png",
      "spritenum": 585                   // Showdown 雪碧圖索引
    }
  ]
}
```

### Showdown 道具雪碧圖座標

```js
const x = (spritenum % 16) * 24;
const y = Math.floor(spritenum / 16) * 24;
// CSS: background: url(itemicons-sheet.png) -${x}px -${y}px; width: 24px; height: 24px;
```

---

## 版權聲明

Pokémon 及相關圖像版權屬於 Nintendo / Creatures Inc. / GAME FREAK inc.。本專案為非官方粉絲工具，縮圖僅供辨識對照使用，請遵守 Pokémon Showdown 與 PokeAPI 的使用規範，並避免大量盜連（建議自行快取）。
