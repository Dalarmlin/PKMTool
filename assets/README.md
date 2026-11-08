# 寶可夢與道具縮圖對照資料庫

`assets/pokemon_icons.json` 是 PKMTool 的「名稱 ↔ 縮圖」對照表，用途：

- 將 AI 辨識出的中文名稱對應到標準 ID 與縮圖，未來可在報告中顯示圖示。
- 作為辨識校正依據（例如 AI 輸出「咆哮虎」→ 透過 `aliases` 對應到 `incineroar`）。
- 未來若加入本地辨識（例如以縮圖比對 Team Preview），可直接使用同一套 ID。

目前檔案只放了少量範例條目，完整清單請依下方「建立方式」產生。

---

## 資料來源

| 來源 | 內容 | 網址格式 |
| --- | --- | --- |
| Pokémon Showdown | 寶可夢精靈圖（gen5 動態風格） | `https://play.pokemonshowdown.com/sprites/gen5/{showdownId}.png` |
| Pokémon Showdown | 圖鑑大圖 | `https://play.pokemonshowdown.com/sprites/dex/{showdownId}.png` |
| Pokémon Showdown | 道具圖示（雪碧圖，24×24，每列 16 格） | `https://play.pokemonshowdown.com/sprites/itemicons-sheet.png` |
| Pokémon Showdown | 寶可夢資料（含 ID、圖鑑編號、屬性、形態） | `https://play.pokemonshowdown.com/data/pokedex.json` |
| Pokémon Showdown | 道具資料（含 `spritenum`） | `https://play.pokemonshowdown.com/data/items.js` |
| PokeAPI sprites | 寶可夢單張圖（依圖鑑編號） | `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{dex}.png` |
| PokeAPI sprites | 道具單張圖（kebab-case 名稱） | `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/{pokeapiId}.png` |
| PokeAPI | 多語系名稱（含繁中 `zh-Hant`） | `https://pokeapi.co/api/v2/pokemon-species/{dex}`、`/item/{pokeapiId}` |

> Showdown 的 `showdownId` 規則：英文名轉小寫、移除所有非英數字元。例如 `Urshifu-Rapid-Strike` → `urshifurapidstrike`；道具 `Choice Scarf` → `choicescarf`。

---

## 資料結構

```jsonc
{
  "version": "0.1.0",
  "game": "Pokémon Champions",
  "updated": "YYYY-MM-DD",
  "sources": { /* 各來源的網址樣板 */ },

  "pokemon": [
    {
      "showdownId": "incineroar",        // 主鍵：Showdown ID（唯一）
      "dex": 727,                        // 全國圖鑑編號（地區形態與原型相同）
      "name_zh": "熾焰咆哮虎",            // 繁中官方譯名
      "name_en": "Incineroar",
      "aliases": ["咆哮虎", "猛虎"],       // 俗稱、簡稱、簡體譯名等，用於模糊比對
      "types": ["Fire", "Dark"],
      "icon": "https://play.pokemonshowdown.com/sprites/gen5/incineroar.png",
      "icon_fallback": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/727.png"
    }
  ],

  "items": [
    {
      "showdownId": "sitrusberry",       // 主鍵
      "pokeapiId": "sitrus-berry",       // PokeAPI 圖檔名稱
      "name_zh": "文柚果",
      "name_en": "Sitrus Berry",
      "icon": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/sitrus-berry.png",
      "spritenum": 0                     // 選填：Showdown 雪碧圖索引（見下方）
    }
  ]
}
```

### 欄位規則

- `showdownId` 為唯一主鍵，形態不同視為不同條目（例如 `urshifu` 與 `urshifurapidstrike`）。
- `name_zh` 一律使用繁體中文官方譯名；其他寫法放進 `aliases`。
- `icon` 優先使用 Showdown，`icon_fallback` 使用 PokeAPI，前端載入失敗時切換。
- 只收錄《寶可夢冠軍》可使用的寶可夢與道具；新增賽季時更新 `updated` 與 `version`。

### Showdown 道具雪碧圖座標

`items.js` 中每個道具有 `spritenum`，在 `itemicons-sheet.png` 上的位置為：

```js
const x = (spritenum % 16) * 24;
const y = Math.floor(spritenum / 16) * 24;
// CSS: background: url(itemicons-sheet.png) -${x}px -${y}px; width: 24px; height: 24px;
```

---

## 建立方式

### 1. 自動產生基礎清單（Node.js 18+）

以下腳本從 Showdown 抓取寶可夢與道具資料，再從 PokeAPI 補上繁中名稱。存成 `scripts/build-icons.mjs` 後執行 `node scripts/build-icons.mjs`。

```js
// scripts/build-icons.mjs
import { writeFile } from "node:fs/promises";

// 在這裡列出《寶可夢冠軍》可用的 Showdown ID（依官方公布的名單維護）
const POKEMON_IDS = ["incineroar", "garchomp", "amoonguss"];
const ITEM_IDS = ["sitrusberry", "focussash", "choicescarf", "leftovers"];

const toKebab = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function zhName(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.names?.find((n) => n.language.name === "zh-Hant")?.name ?? null;
}

const dex = await (await fetch("https://play.pokemonshowdown.com/data/pokedex.json")).json();

// items.js 格式為 `exports.BattleItems = {...}`，以 Function 取出物件
const itemsSrc = await (await fetch("https://play.pokemonshowdown.com/data/items.js")).text();
const exportsObj = {};
new Function("exports", itemsSrc)(exportsObj);
const items = exportsObj.BattleItems;

const pokemon = [];
for (const id of POKEMON_IDS) {
  const p = dex[id];
  if (!p) { console.warn("找不到寶可夢", id); continue; }
  pokemon.push({
    showdownId: id,
    dex: p.num,
    name_zh: await zhName(`https://pokeapi.co/api/v2/pokemon-species/${p.num}`),
    name_en: p.name,
    aliases: [],
    types: p.types,
    icon: `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`,
    icon_fallback: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.num}.png`,
  });
}

const itemList = [];
for (const id of ITEM_IDS) {
  const it = items[id];
  if (!it) { console.warn("找不到道具", id); continue; }
  const pokeapiId = toKebab(it.name);
  itemList.push({
    showdownId: id,
    pokeapiId,
    name_zh: await zhName(`https://pokeapi.co/api/v2/item/${pokeapiId}`),
    name_en: it.name,
    icon: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${pokeapiId}.png`,
    spritenum: it.spritenum,
  });
}

const out = {
  version: "0.1.0",
  game: "Pokémon Champions",
  updated: new Date().toISOString().slice(0, 10),
  sources: {
    showdown_pokemon: "https://play.pokemonshowdown.com/sprites/gen5/{showdownId}.png",
    showdown_item_sheet: "https://play.pokemonshowdown.com/sprites/itemicons-sheet.png",
    pokeapi_pokemon: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{dex}.png",
    pokeapi_item: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/{pokeapiId}.png",
  },
  pokemon,
  items: itemList,
};

await writeFile("assets/pokemon_icons.json", JSON.stringify(out, null, 2) + "\n");
console.log(`完成：${pokemon.length} 隻寶可夢、${itemList.length} 個道具`);
```

### 2. 人工校正

- PokeAPI 對新寶可夢、新形態或新道具可能尚無繁中名稱（`name_zh` 為 `null`），請對照遊戲內顯示補上。
- 補上常見俗稱到 `aliases`，提升 AI 輸出與資料庫的比對成功率。
- 形態差異（地區形態、Mega、特殊形態）請在遊戲中確認縮圖是否一致。

### 3. 是否要把圖片存進 repo

預設直接引用外部網址即可。若想離線使用或避免外部連結失效，可將圖片下載到：

```
assets/
├── pokemon/{showdownId}.png
└── items/{showdownId}.png
```

並把 `icon` 改成相對路徑（例如 `assets/pokemon/incineroar.png`）。

---

## 版權聲明

Pokémon 及相關圖像版權屬於 Nintendo / Creatures Inc. / GAME FREAK inc.。本專案為非官方粉絲工具，縮圖僅供辨識對照使用，請遵守 Pokémon Showdown 與 PokeAPI 的使用規範，並避免大量盜連（建議自行快取）。
