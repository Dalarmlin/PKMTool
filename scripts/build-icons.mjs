/**
 * 產生 assets/pokemon_icons.json
 *
 *   npm run build:icons
 *
 * 資料來源：
 *   - 可用名單：pokemon-showdown 套件的 champions mod（《寶可夢冠軍》合法寶可夢 / 道具）
 *   - 繁中名稱：PokeAPI CSV（language_id 4 = zh-Hant），查無時使用英文名稱
 *   - 縮圖：依序測試 Showdown gen5 → dex → ani → home-centered → PokeAPI，取第一個可用的
 *
 * 手動修正：assets/name_overrides.json 的 name_zh 會覆寫自動結果；
 *           既有 pokemon_icons.json 中的 aliases 會在重新產生時保留。
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Dex } = require("pokemon-showdown");

const OUT_PATH = new URL("../assets/pokemon_icons.json", import.meta.url);
const OVERRIDES_PATH = new URL("../assets/name_overrides.json", import.meta.url);
const POKEAPI_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const SD_SPRITES = "https://play.pokemonshowdown.com/sprites";
const POKEAPI_SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites";
const ZH_HANT = "4";
const CONCURRENCY = 16;

const REGION_ZH = {
  Alola: "阿羅拉的樣子",
  Galar: "伽勒爾的樣子",
  Hisui: "洗翠的樣子",
  Paldea: "帕底亞的樣子",
};

const GENDER_ZH = { M: "♂", F: "♀" };

/* ---------------- 工具 ---------------- */

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function fetchCsv(name) {
  const res = await fetch(`${POKEAPI_CSV}/${name}`);
  if (!res.ok) throw new Error(`下載 ${name} 失敗：HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, "utf8")); } catch { return fallback; }
}

const toKebab = (name) => name.toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function urlExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function firstExisting(urls) {
  for (const url of urls) if (await urlExists(url)) return url;
  return null;
}

async function mapPool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/* ---------------- 名稱 ---------------- */

function speciesZhName(s, speciesZh, formZh) {
  const base = speciesZh.get(String(s.num));
  if (!base) return null;
  if (!s.forme) return base;

  if (s.forme.includes("Mega")) {
    const rest = s.forme.split("-").filter((p) => p !== "Mega");
    const suffix = rest.map((p) => GENDER_ZH[p] ?? p).join("");
    return `超級${base}${suffix}`;
  }
  if (GENDER_ZH[s.forme]) return `${base}${GENDER_ZH[s.forme]}`;

  const region = Object.keys(REGION_ZH).find((r) => s.forme.startsWith(r));
  const kebab = toKebab(s.name);
  const pokeapiForm = formZh.get(kebab) ?? [...formZh.entries()].find(([k]) => k.startsWith(`${kebab}-`))?.[1];

  if (region && s.forme === region) return `${base}（${REGION_ZH[region]}）`;
  if (pokeapiForm) return pokeapiForm.includes(base) ? pokeapiForm : `${base}（${pokeapiForm}）`;
  if (region) return `${base}（${REGION_ZH[region]}・${s.forme.slice(region.length + 1)}）`;
  return `${base}（${s.forme}）`;
}

/* ---------------- 主程式 ---------------- */

const dex = Dex.mod("champions");
const species = dex.species.all().filter((s) => !s.isNonstandard && s.tier !== "Illegal");
const items = dex.items.all().filter((i) => !i.isNonstandard);
console.log(`Champions 可用：${species.length} 隻寶可夢、${items.length} 個道具`);

console.log("下載 PokeAPI 名稱資料…");
const [speciesNames, formNames, forms, itemNames, itemRows] = await Promise.all([
  fetchCsv("pokemon_species_names.csv"),
  fetchCsv("pokemon_form_names.csv"),
  fetchCsv("pokemon_forms.csv"),
  fetchCsv("item_names.csv"),
  fetchCsv("items.csv"),
]);

const speciesZh = new Map(speciesNames.filter((r) => r.local_language_id === ZH_HANT).map((r) => [r.pokemon_species_id, r.name]));
const formIdToIdent = new Map(forms.map((r) => [r.id, r.identifier]));
const formZh = new Map(
  formNames
    .filter((r) => r.local_language_id === ZH_HANT && (r.pokemon_name || r.form_name))
    .map((r) => [formIdToIdent.get(r.pokemon_form_id), r.pokemon_name || r.form_name])
);
const itemIdentToId = new Map(itemRows.map((r) => [r.identifier, r.id]));
const itemZh = new Map(itemNames.filter((r) => r.local_language_id === ZH_HANT).map((r) => [r.item_id, r.name]));

const previous = await readJson(OUT_PATH, { pokemon: [], items: [] });
const prevAliases = new Map([...previous.pokemon, ...previous.items].map((e) => [e.showdownId, e.aliases]));
const overrides = await readJson(OVERRIDES_PATH, { pokemon: {}, items: {} });

const missingZh = [];
const partialZh = [];
const missingIcon = [];

console.log("檢查寶可夢縮圖…");
const pokemon = await mapPool(species, async (s) => {
  const zh = overrides.pokemon?.[s.id] ?? speciesZhName(s, speciesZh, formZh);
  if (!zh) missingZh.push(`pokemon:${s.id}`);
  else if (!overrides.pokemon?.[s.id] && s.forme && zh.includes(`（${s.forme}）`)) partialZh.push(`${s.id} → ${zh}`);

  const icon = await firstExisting([
    `${SD_SPRITES}/gen5/${s.spriteid}.png`,
    `${SD_SPRITES}/dex/${s.spriteid}.png`,
    `${SD_SPRITES}/ani/${s.spriteid}.gif`,
    `${SD_SPRITES}/home-centered/${s.spriteid}.png`,
  ]);
  if (!icon) missingIcon.push(`pokemon:${s.id}`);

  return {
    showdownId: s.id,
    dex: s.num,
    name_zh: zh || s.name,
    name_en: s.name,
    ...(s.forme ? { baseSpecies: s.baseSpecies, forme: s.forme } : {}),
    aliases: prevAliases.get(s.id) ?? [],
    types: s.types,
    icon: icon ?? `${POKEAPI_SPRITES}/pokemon/${s.num}.png`,
    icon_fallback: `${POKEAPI_SPRITES}/pokemon/${s.num}.png`,
  };
});

console.log("檢查道具縮圖…");
const itemList = await mapPool(items, async (it) => {
  const pokeapiId = toKebab(it.name);
  const zh = overrides.items?.[it.id] ?? itemZh.get(itemIdentToId.get(pokeapiId));
  if (!zh) missingZh.push(`item:${it.id}`);

  const pokeapiIcon = `${POKEAPI_SPRITES}/items/${pokeapiId}.png`;
  const hasIcon = await urlExists(pokeapiIcon);
  if (!hasIcon) missingIcon.push(`item:${it.id}`);

  return {
    showdownId: it.id,
    pokeapiId,
    name_zh: zh || it.name,
    name_en: it.name,
    ...(it.megaStone ? { megaStone: Object.values(it.megaStone) } : {}),
    aliases: prevAliases.get(it.id) ?? [],
    icon: hasIcon ? pokeapiIcon : null,
    spritenum: it.spritenum,
  };
});

pokemon.sort((a, b) => a.dex - b.dex || a.showdownId.localeCompare(b.showdownId));
itemList.sort((a, b) => a.showdownId.localeCompare(b.showdownId));

const out = {
  version: "1.0.0",
  game: "Pokémon Champions",
  updated: new Date().toISOString().slice(0, 10),
  generatedBy: "scripts/build-icons.mjs",
  sources: {
    legality: "pokemon-showdown (data/mods/champions)",
    names_zh: `${POKEAPI_CSV}/*_names.csv`,
    showdown_pokemon: `${SD_SPRITES}/gen5/{spriteid}.png`,
    showdown_item_sheet: `${SD_SPRITES}/itemicons-sheet.png`,
    pokeapi_pokemon: `${POKEAPI_SPRITES}/pokemon/{dex}.png`,
    pokeapi_item: `${POKEAPI_SPRITES}/items/{pokeapiId}.png`,
  },
  counts: { pokemon: pokemon.length, items: itemList.length },
  pokemon,
  items: itemList,
};

await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

console.log(`完成：${pokemon.length} 隻寶可夢、${itemList.length} 個道具 → assets/pokemon_icons.json`);
if (missingZh.length) console.log(`查無繁中名稱（已用英文）${missingZh.length} 筆：${missingZh.join(", ")}`);
if (partialZh.length) console.log(`形態名稱保留英文 ${partialZh.length} 筆（可在 name_overrides.json 修正）：\n  ${partialZh.join("\n  ")}`);
if (missingIcon.length) console.log(`主要縮圖缺漏（已用備援）${missingIcon.length} 筆：${missingIcon.join(", ")}`);
