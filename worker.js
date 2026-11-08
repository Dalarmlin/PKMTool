/**
 * PKMTool — Cloudflare Worker 代理後端
 * ------------------------------------------------------------
 * 兩種模式（POST JSON，以 body.mode 區分）：
 *
 *   1. mode: "parse"  — 賽前備戰：辨識寶可夢詳細資訊截圖，回傳結構化配置
 *      請求：{ mode: "parse", images: [ { mimeType, data }, ... ]（1~6 張，每張 1 隻） }
 *      回應：{ ok: true, pokemon: [ { name, item, ability, nature, teraType, moves: [] }, ... ] }
 *
 *   2. mode: "review" — 賽前備戰：檢查配置的特性、性格、道具、太晶、招式是否最佳化
 *      請求：{ mode: "review", presets: [ ... ]（1~20 筆）, format: "doubles" | "singles" }
 *      回應：{ ok: true, markdown: "...", model, usage }
 *
 *   3. mode: "battle" — 實戰分析：1 張 Team Preview 總覽圖 + 預存配置 → 選角與戰術報告
 *      請求：{ mode: "battle", images: [ { mimeType, data } ]（1 張）,
 *              presets: [ { name, item, ability, nature, teraType, moves } ]（最多 20 筆）,
 *              format: "doubles" | "singles", note: "（選填）" }
 *      回應：{ ok: true, markdown: "...", winRate: 0~100 | null, model, usage }
 *
 *   失敗一律回：{ ok: false, error: "錯誤訊息" }
 *
 * 驗證：所有 GET / POST 請求都必須帶 Header `X-Access-Passcode: <你的密碼>`，否則回 401
 *
 * 環境變數 / Secrets：
 *   GEMINI_API_KEY   （必填，請用 `wrangler secret put GEMINI_API_KEY` 設定）
 *   CUSTOM_PASSCODE  （必填，只有你知道的密碼，請用 `wrangler secret put CUSTOM_PASSCODE` 設定）
 *   GEMINI_MODEL     （選填，預設 gemini-3.5-flash-lite）
 *   ALLOWED_ORIGIN   （選填，預設 "*"；正式上線建議設為你的 GitHub Pages 網址）
 */

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const MAX_PARSE_IMAGES = 6;
const MAX_PRESETS = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 單張解碼後上限 8 MB
const MAX_NOTE_LENGTH = 1000;
const MAX_FIELD_LENGTH = 40;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

const FORMATS = {
  doubles: "VGC 雙打（帶 6 選 4，先發 2 隻）",
  singles: "單打（帶 6 選 3，先發 1 隻）",
};

/* ------------------------------------------------------------------ */
/* Prompt：賽前備戰（截圖辨識）                                         */
/* ------------------------------------------------------------------ */
const PARSE_PROMPT = `
你是《寶可夢冠軍》（Pokémon Champions）的截圖辨識器。
每張圖片是一隻寶可夢的詳細資訊頁（可能含名稱、道具、特性、性格、太晶屬性、4 個招式、能力值）。
請依圖片順序，每張輸出一筆資料：
- 所有名稱使用繁體中文官方譯名；形態要分清楚（例如：九尾（阿羅拉的樣子）、超級噴火龍X）。
- teraType 填屬性中文名（例如：火、妖精）；遊戲未顯示太晶屬性時填空字串。
- 圖中看不到的欄位填空字串，不可捏造。
- moves 依畫面由上到下排列，最多 4 個。
`.trim();

const PARSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    pokemon: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          item: { type: "STRING" },
          ability: { type: "STRING" },
          nature: { type: "STRING" },
          teraType: { type: "STRING" },
          moves: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["name", "item", "ability", "nature", "teraType", "moves"],
      },
    },
  },
  required: ["pokemon"],
};

/* ------------------------------------------------------------------ */
/* Prompt：賽前備戰（配置健檢）                                         */
/* ------------------------------------------------------------------ */
const REVIEW_PROMPT = `
你是一位世界頂尖的《寶可夢冠軍》（Pokémon Champions）對戰教練與配置專家，熟悉當前賽制環境、主流配置、傷害計算與速度線。
使用者會提供自己登錄的寶可夢配置 JSON（名稱、道具、特性、性格、太晶屬性、招式），以及指定的【賽制】。
請逐隻檢查配置是否已最佳化，並給出具體可執行的修改建議。

【檢查原則】
- 以指定賽制的當前環境為準（雙打重視範圍招式、守住、擊掌奇襲、輔助招式；單打重視強化、聯防、換人與先制）。
- 特性：是否選了該寶可夢在此賽制最強或最符合定位的特性。
- 性格：是否符合攻擊方向（物攻／特攻）與速度需求（最速、最慢搭配戲法空間等）。
- 招式：逐招判斷保留或替換，指出缺少的關鍵招式（例如雙打沒帶守住）、打點重複、命中不穩或與性格衝突的招式。
- 道具與太晶屬性：是否與配置定位一致；空白時給出推薦。
- 欄位空白代表使用者未填寫，請直接給推薦，不要當成錯誤。
- 已經是主流最佳配置時，明確說「已最佳化」，不要為了建議而硬改。
- 所有名稱使用繁體中文官方譯名。

【輸出格式】使用 Markdown，依序輸出：

## 🧪 配置健檢總覽
- 一句話總評，並列出最需要修改的 1~3 隻。
- 各隻的能力點數分配統一放在後面的「💪 能力點數分配建議」章節，每隻的章節不用重複。

接著每隻寶可夢一個章節（依輸入順序；同名多筆時以「名稱 #序號」區分）：

## <寶可夢名稱> — 評分 <0~10>/10
| 項目 | 目前 | 評價 | 建議 |
| --- | --- | --- | --- |
| 特性 | ... | ✅ 最佳 / ⚠️ 可改善 / ❌ 建議更換 | ... |
| 性格 | ... | ... | ... |
| 道具 | ... | ... | ... |
| 太晶屬性 | ... | ... | ... |
| 招式 1~4 | 逐招列出 | ... | ... |
- **定位**：這套配置在隊伍中的角色。
- **修改建議**：條列具體改法與理由（例如：把 X 換成 Y，因為…）。
- **推薦最終配置**：特性 / 性格 / 道具 / 太晶 / 4 招式，一行列完。

## 💪 能力點數分配建議
- 依《寶可夢冠軍》的能力點數規則（總點數與單項上限依遊戲規定）給建議；使用者配置未包含目前的點數分配，請視為尚未分配。
- 以表格列出每隻寶可夢的建議分配：寶可夢 / HP / 攻擊 / 防禦 / 特攻 / 特防 / 速度 / 目的。
- 「目的」要具體，例如：超越最速 X、確保承受 Y 的 Z 招式、搭配戲法空間壓低速度。
- **優先順序**：若點數有限，依序列出最值得投資的寶可夢與能力（例如：1. 仆刀將軍 → 攻擊、HP），並說明為何這幾隻的收益最大。

若輸入超過 1 隻，最後加上：

## 🤝 隊伍搭配建議
- 屬性弱點盲區、速度控制、招式打點覆蓋的檢查與補強建議。

請保持專業、具體、可執行，避免空泛建議。
`.trim();

/* ------------------------------------------------------------------ */
/* Prompt：實戰分析                                                     */
/* ------------------------------------------------------------------ */
const BATTLE_PROMPT = `
你是一位世界頂尖的《寶可夢冠軍》（Pokémon Champions）對戰教練，精通 VGC 雙打與單打，熟悉當前賽制環境、常見體系、傷害計算、速度線與心理博弈。

【輸入】
- 1 張對戰開始前的 6v6 Team Preview（隊伍預覽）總覽圖：包含對手 6 隻寶可夢（可能顯示太晶屬性）、我方 6 隻寶可夢與攜帶道具。
- 【我方預存配置】JSON：使用者事先登錄的寶可夢詳細配置（名稱、道具、特性、性格、太晶屬性、招式）。

【配對原則】
- 先從圖中辨識我方 6 隻與其道具，再到預存配置中找出對應的那一筆。
- 同名寶可夢可能有多筆配置：以「圖中顯示的道具」區分；道具也相同時選最合理的一筆，並在辨識結果標註「(多筆相符，假設為 X)」。
- 找不到對應配置的寶可夢，依當前環境最常見的配置推測，並標註「(未登錄，環境常見配置)」。
- 對手的道具、招式、配置無法從截圖得知，依當前環境最常見的配置推測，並標註「(環境常見配置)」。圖中有太晶屬性時務必納入分析。
- 辨識不確定時標註「(推測)」，不可捏造。
- 所有寶可夢、招式、道具、特性名稱使用繁體中文官方譯名。

【輸出格式】請使用 Markdown，嚴格依照以下章節輸出：

## 📋 0. 辨識結果
- 以表格列出我方 6 隻：寶可夢 / 道具 / 特性 / 4 招式（取自預存配置）。
- 以清單列出對手 6 隻（含太晶屬性，若有顯示）。

## 🔍 1. 對手陣容與體系判讀
- 核心軸線（例如：順風、戲法空間、天氣、威嚇輪轉、擊掌奇襲＋強攻等）與最可能的先發組合。
- 速度線分析：列出雙方關鍵寶可夢的速度大小關係（含順風／戲法空間／圍巾等變因下的翻盤情況）。
- 對手的主要威脅點與我方最怕的局面。

## 🏆 2. 最佳選角組合
- 依使用者指定的【賽制】選角（雙打：6 選 4，先發 2 + 後備 2；單打：6 選 3，先發 1 + 後備 2）。
- 明確列出選出的寶可夢，並逐隻說明入選理由（對位優勢、功能定位、互補性）。
- 說明未選入的寶可夢為何被放棄。
- 給出一套「備案選角」以應對對手不按常理先發的情況。

## ⚔️ 3. 先發順序
- 雙打：左位 / 右位 先發；單打：先發 1 隻。並說明 後備 1 / 後備 2 的換入時機。
- 說明此先發如何對抗對手最可能的 2~3 種先發組合。

## 🧠 4. 第一回合（T1）具體動向與心理博弈
- 針對對手最可能的先發，給出 T1 我方每隻在場寶可夢的具體行動（招式 + 目標）。
- 雙打必須分析：擊掌奇襲（Fake Out）的防範與反制、守住（Protect）的時機與讀招、集火目標選擇、順風／戲法空間的爭奪、威嚇輪轉、太晶或其他關鍵機制的使用時機。
- 單打必須分析：先發對位的優劣、留場或換人的判斷、讀換（預判對手換人）與對策、守住／替身的讀招、強化招式的時機、太晶或其他關鍵機制的使用時機、擊掌奇襲等先制招式的影響。
- 給出「如果對手做 X → 我方改做 Y」的分支決策（至少 2 個分支）。

## 📌 5. 總結與勝利條件
- 用 3~5 點條列整場對戰的勝利條件（Win Condition）與必須避免的失誤。

## 📈 6. 預估勝率
- 假設我方照上述選角與戰術執行、雙方操作水準相當，給出一個具體的勝率百分比（整數，0~100）。
- 用 2~3 點說明影響勝率的關鍵因素（陣容相性、速度線、對手關鍵威脅）。
- 給出明確建議，三選一：「✅ 積極應戰」（≥ 55%）、「⚠️ 謹慎應戰」（30%~54%）、「🏳️ 建議投降」（< 30%，陣容被嚴重克制、幾乎沒有勝利路線時才給）。
- 勝率要誠實，不要為了鼓勵使用者而灌水，也不要一律給 50%。

【最後一行】報告的最後一行必須單獨輸出以下格式（機器讀取用，不要加任何其他文字或符號）：
WIN_RATE: <整數>

請保持專業、具體、可執行，避免空泛建議。
`.trim();

/* ------------------------------------------------------------------ */
/* Worker 入口                                                         */
/* ------------------------------------------------------------------ */
export default {
  async fetch(request, env) {
    const cors = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST" && request.method !== "GET") {
      return json({ ok: false, error: "Method Not Allowed，僅接受 POST" }, 405, cors);
    }

    // 密碼驗證：未設定 CUSTOM_PASSCODE 時一律拒絕，避免 Worker 被公開濫用
    if (!env.CUSTOM_PASSCODE) {
      return json({ ok: false, error: "伺服器尚未設定 CUSTOM_PASSCODE 環境變數" }, 500, cors);
    }
    const clientPasscode = request.headers.get("X-Access-Passcode") || "";
    if (!(await passcodeMatches(clientPasscode, env.CUSTOM_PASSCODE))) {
      return json({ ok: false, error: "Unauthorized：密碼錯誤" }, 401, cors);
    }

    // 健康檢查（GET /）— 確認 Worker 已部署且密碼正確
    if (request.method === "GET") {
      return json({ ok: true, service: "PKMTool Worker", model: env.GEMINI_MODEL || DEFAULT_MODEL }, 200, cors);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ ok: false, error: "伺服器尚未設定 GEMINI_API_KEY 環境變數" }, 500, cors);
    }

    try {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "請求內容不是合法的 JSON" }, 400, cors);
      }

      const model = env.GEMINI_MODEL || DEFAULT_MODEL;
      const handlers = { parse: handleParse, review: handleReview, battle: handleBattle };
      const handler = handlers[body?.mode] || handleBattle;
      const result = await handler(body, env, model);

      return json(result.body, result.status, cors);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "unhandled", message: String(err?.message || err) }));
      return json({ ok: false, error: "Worker 內部錯誤，請稍後再試" }, 500, cors);
    }
  },
};

/* ------------------------------------------------------------------ */
/* 模式處理                                                             */
/* ------------------------------------------------------------------ */

async function handleParse(body, env, model) {
  const images = validateImages(body?.images, MAX_PARSE_IMAGES);
  if (images.error) return { status: 400, body: { ok: false, error: images.error } };

  const parts = [];
  images.list.forEach((img, idx) => {
    parts.push({ text: `【第 ${idx + 1} 張】` });
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  });
  parts.push({ text: `共 ${images.list.length} 張，請輸出 ${images.list.length} 筆資料。` });

  const gemini = await callGemini(env, model, {
    system_instruction: { parts: [{ text: PARSE_PROMPT }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: PARSE_SCHEMA,
    },
  });
  if (gemini.error) return { status: 502, body: { ok: false, error: gemini.error } };

  let parsed;
  try {
    parsed = JSON.parse(gemini.text);
  } catch {
    return { status: 502, body: { ok: false, error: "AI 回傳的辨識結果格式錯誤，請再試一次" } };
  }

  const pokemon = (Array.isArray(parsed?.pokemon) ? parsed.pokemon : [])
    .map(sanitizePreset)
    .filter((p) => p.name);

  log("parse_done", { model, imageCount: images.list.length, found: pokemon.length, usage: gemini.usage });
  return { status: 200, body: { ok: true, pokemon, model, usage: gemini.usage } };
}

async function handleReview(body, env, model) {
  if (!Array.isArray(body?.presets)) return { status: 400, body: { ok: false, error: "presets 必須是陣列" } };
  const presets = body.presets.slice(0, MAX_PRESETS).map(sanitizePreset).filter((p) => p.name);
  if (!presets.length) return { status: 400, body: { ok: false, error: "請至少提供 1 筆配置" } };
  const format = FORMATS[body.format] ? body.format : "doubles";

  const gemini = await callGemini(env, model, {
    system_instruction: { parts: [{ text: REVIEW_PROMPT }] },
    contents: [{
      role: "user",
      parts: [{ text: `【賽制】${FORMATS[format]}\n\n【待檢查配置】（共 ${presets.length} 筆）\n${JSON.stringify(presets)}` }],
    }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 16384 },
  });
  if (gemini.error) return { status: 502, body: { ok: false, error: gemini.error } };

  log("review_done", { model, format, presetCount: presets.length, usage: gemini.usage });
  return { status: 200, body: { ok: true, markdown: gemini.text, model, usage: gemini.usage } };
}

async function handleBattle(body, env, model) {
  const images = validateImages(body?.images, 1);
  if (images.error) return { status: 400, body: { ok: false, error: images.error } };

  if (body.presets !== undefined && !Array.isArray(body.presets)) {
    return { status: 400, body: { ok: false, error: "presets 必須是陣列" } };
  }
  const presets = (body.presets || []).slice(0, MAX_PRESETS).map(sanitizePreset).filter((p) => p.name);
  const format = FORMATS[body.format] ? body.format : "doubles";
  const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE_LENGTH).trim() : "";

  const img = images.list[0];
  let instruction = `【賽制】${FORMATS[format]}\n\n【我方預存配置】（共 ${presets.length} 筆）\n`;
  instruction += presets.length ? JSON.stringify(presets) : "（無，請依環境常見配置推測我方配置）";
  if (note) instruction += `\n\n【使用者補充說明】\n${note}`;
  instruction += "\n\n請依照系統指示完成完整的戰術分析。";

  const gemini = await callGemini(env, model, {
    system_instruction: { parts: [{ text: BATTLE_PROMPT }] },
    contents: [{
      role: "user",
      parts: [
        { text: "【Team Preview 總覽圖】" },
        { inline_data: { mime_type: img.mimeType, data: img.data } },
        { text: instruction },
      ],
    }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
  });
  if (gemini.error) return { status: 502, body: { ok: false, error: gemini.error } };

  const { markdown, winRate } = extractWinRate(gemini.text);
  if (!markdown) return { status: 502, body: { ok: false, error: "AI 未回傳任何內容" } };

  log("battle_done", { model, format, presetCount: presets.length, winRate, usage: gemini.usage });
  return { status: 200, body: { ok: true, markdown, winRate, model, usage: gemini.usage } };
}

/* ------------------------------------------------------------------ */
/* 工具函式                                                            */
/* ------------------------------------------------------------------ */

/** 呼叫 Gemini generateContent，回傳 { text, usage } 或 { error } */
async function callGemini(env, model, requestBody) {
  const res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.error?.message || `Gemini API 回應錯誤（HTTP ${res.status}）`;
    console.error(JSON.stringify({ level: "error", event: "gemini_error", status: res.status, message }));
    return { error: message };
  }

  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();

  if (!text) {
    const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || "未知原因";
    return { error: `AI 未回傳任何內容（${reason}）` };
  }
  return { text, usage: data.usageMetadata || null };
}

/** 驗證圖片陣列，回傳 { list } 或 { error } */
function validateImages(raw, max) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "請至少上傳 1 張截圖" };
  if (raw.length > max) return { error: `最多只能上傳 ${max} 張截圖` };

  const list = [];
  for (let i = 0; i < raw.length; i++) {
    let { mimeType, data } = raw[i] || {};
    if (typeof data !== "string" || data.length === 0) return { error: `第 ${i + 1} 張圖片缺少 data` };

    // 容錯：若前端傳來完整 data URL，自動拆出 mimeType 與 Base64
    const match = data.match(/^data:([^;]+);base64,(.*)$/s);
    if (match) {
      mimeType = mimeType || match[1];
      data = match[2];
    }

    mimeType = (mimeType || "").toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) return { error: `第 ${i + 1} 張圖片格式不支援（${mimeType || "未知"}）` };
    if (data.length * 0.75 > MAX_IMAGE_BYTES) {
      return { error: `第 ${i + 1} 張圖片過大（上限 ${MAX_IMAGE_BYTES / 1024 / 1024} MB）` };
    }
    list.push({ mimeType, data });
  }
  return { list };
}

/** 將一筆配置整理成固定欄位、限制長度的物件 */
function sanitizePreset(p) {
  const str = (v) => (typeof v === "string" ? v.trim().slice(0, MAX_FIELD_LENGTH) : "");
  return {
    name: str(p?.name),
    item: str(p?.item),
    ability: str(p?.ability),
    nature: str(p?.nature),
    teraType: str(p?.teraType),
    moves: (Array.isArray(p?.moves) ? p.moves : []).map(str).filter(Boolean).slice(0, 4),
  };
}

/** 取出並移除報告最後的 `WIN_RATE: <整數>` 機器行；找不到時 winRate 為 null */
function extractWinRate(text) {
  const pattern = /^[\s*`_>-]*WIN_RATE\s*[:：]\s*(\d{1,3})\s*%?[\s*`_]*$/gim;
  let winRate = null;
  for (const m of text.matchAll(pattern)) winRate = Math.min(100, Number(m[1]));
  return { markdown: text.replace(pattern, "").trim(), winRate };
}

/** 以固定時間比對密碼（先各自 SHA-256，長度一致才能用 timingSafeEqual） */
async function passcodeMatches(input, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** 建立 CORS 標頭；ALLOWED_ORIGIN 未設定時允許所有來源 (*) */
function buildCorsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || "*").trim();
  let origin = "*";
  if (allowed !== "*") {
    const reqOrigin = request.headers.get("Origin") || "";
    const list = allowed.split(",").map((s) => s.trim());
    origin = list.includes(reqOrigin) ? reqOrigin : list[0];
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Passcode",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function log(event, fields) {
  console.log(JSON.stringify({ level: "info", event, ...fields }));
}

/** 回傳 JSON Response 並附上 CORS 標頭 */
function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
