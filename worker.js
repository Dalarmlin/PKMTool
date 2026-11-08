/**
 * PKMTool — Cloudflare Worker 代理後端
 * ------------------------------------------------------------
 * 職責：
 *   1. 接收前端 POST 的 Base64 圖片陣列（最多 7 張）
 *   2. 從環境變數 env.GEMINI_API_KEY 安全讀取金鑰（金鑰永不暴露給前端）
 *   3. 組裝 VGC 專屬 System Prompt + inline_data，呼叫 Gemini generateContent
 *   4. 將 AI 產生的 Markdown 結果回傳前端，並處理 CORS
 *
 * 驗證：所有 GET / POST 請求都必須帶 Header `X-Access-Passcode: <你的密碼>`，否則回 401
 *
 * 前端請求格式（JSON）：
 *   {
 *     "images": [ { "mimeType": "image/jpeg", "data": "<純 Base64，不含 data: 前綴>" }, ... ],
 *     "format": "doubles" | "singles"（選填，預設 doubles = 6 選 4；singles = 6 選 3）,
 *     "note": "（選填）使用者補充說明，例如對手已知資訊"
 *   }
 *
 * 回應格式（JSON）：
 *   成功：{ "ok": true,  "markdown": "...", "winRate": 0~100 | null, "model": "...", "usage": {...} }
 *   失敗：{ "ok": false, "error": "錯誤訊息" }
 *
 * 環境變數 / Secrets：
 *   GEMINI_API_KEY   （必填，請用 `wrangler secret put GEMINI_API_KEY` 設定）
 *   CUSTOM_PASSCODE  （必填，只有你知道的密碼，請用 `wrangler secret put CUSTOM_PASSCODE` 設定）
 *   GEMINI_MODEL     （選填，預設 gemini-3.5-flash-lite）
 *   ALLOWED_ORIGIN   （選填，預設 "*"；正式上線建議設為你的 GitHub Pages 網址）
 */

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const MAX_IMAGES = 7;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 單張解碼後上限 8 MB
const MAX_NOTE_LENGTH = 1000;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

/* ------------------------------------------------------------------ */
/* VGC 教練 System Prompt                                              */
/* ------------------------------------------------------------------ */
const SYSTEM_PROMPT = `
你是一位世界頂尖的《寶可夢冠軍》（Pokémon Champions）對戰教練，精通 VGC 雙打與單打，熟悉當前賽制環境、常見體系、傷害計算、速度線與心理博弈。
使用者會上傳最多 7 張遊戲截圖，請嚴格依照以下順序理解圖片：

【圖片定義】
- 第 1 張：對戰開始前的 6v6 Team Preview（隊伍預覽）總覽圖。包含「我方 6 隻寶可夢與其攜帶道具」以及「對手 6 隻寶可夢」。
- 第 2 ~ 7 張：我方 6 隻寶可夢各自的詳細資訊頁（招式表，可能含特性、性格、能力值、太晶／屬性等）。
- 若實際張數少於 7 張，請就現有資訊分析，並明確標示「缺少的資訊」與因此做出的合理假設。

【解析原則】
- 先逐張辨識：寶可夢名稱（形態／地區形態要分清楚）、道具、招式、特性、能力值。辨識不確定時標註「(推測)」，不可捏造。
- 對手的道具、招式、配置無法從截圖得知時，依當前環境最常見的配置推測，並標註「(環境常見配置)」。
- 所有寶可夢、招式、道具、特性名稱請使用繁體中文官方譯名，首次出現時以括號附上英文名，例如：熾焰咆哮虎 (Incineroar)。

【輸出格式】請使用 Markdown，嚴格依照以下章節輸出：

## 📋 0. 截圖辨識結果
- 以表格列出我方 6 隻：寶可夢 / 道具 / 特性 / 4 招式。
- 以清單列出對手 6 隻。

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

    // 1) CORS 預檢請求
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST" && request.method !== "GET") {
      return json({ ok: false, error: "Method Not Allowed，僅接受 POST" }, 405, cors);
    }

    // 2) 密碼驗證：未設定 CUSTOM_PASSCODE 時一律拒絕，避免 Worker 被公開濫用
    if (!env.CUSTOM_PASSCODE) {
      return json({ ok: false, error: "伺服器尚未設定 CUSTOM_PASSCODE 環境變數" }, 500, cors);
    }
    const clientPasscode = request.headers.get("X-Access-Passcode") || "";
    if (!(await passcodeMatches(clientPasscode, env.CUSTOM_PASSCODE))) {
      return json({ ok: false, error: "Unauthorized：密碼錯誤" }, 401, cors);
    }

    // 3) 健康檢查（GET /）— 確認 Worker 已部署且密碼正確
    if (request.method === "GET") {
      return json({ ok: true, service: "PKMTool Worker", model: env.GEMINI_MODEL || DEFAULT_MODEL }, 200, cors);
    }

    // 4) 檢查 API Key
    if (!env.GEMINI_API_KEY) {
      return json({ ok: false, error: "伺服器尚未設定 GEMINI_API_KEY 環境變數" }, 500, cors);
    }

    try {
      // 4) 解析與驗證請求內容
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "請求內容不是合法的 JSON" }, 400, cors);
      }

      const validation = validatePayload(body);
      if (validation.error) {
        return json({ ok: false, error: validation.error }, 400, cors);
      }
      const { images, note, format } = validation;

      // 5) 組裝 Gemini 請求
      const model = env.GEMINI_MODEL || DEFAULT_MODEL;
      const geminiBody = buildGeminiRequest(images, note, format);

      // 6) 呼叫 Gemini（金鑰透過 Header 傳遞，不出現在 URL / Log 中）
      const geminiRes = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify(geminiBody),
      });

      const geminiData = await geminiRes.json().catch(() => null);

      if (!geminiRes.ok) {
        const message = geminiData?.error?.message || `Gemini API 回應錯誤（HTTP ${geminiRes.status}）`;
        console.error(JSON.stringify({ level: "error", event: "gemini_error", status: geminiRes.status, message }));
        return json({ ok: false, error: message }, 502, cors);
      }

      // 7) 擷取文字結果（略過 thought 思考片段）
      const candidate = geminiData?.candidates?.[0];
      const rawText = (candidate?.content?.parts || [])
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim();
      const { markdown, winRate } = extractWinRate(rawText);

      if (!markdown) {
        const reason = candidate?.finishReason || geminiData?.promptFeedback?.blockReason || "未知原因";
        return json({ ok: false, error: `AI 未回傳任何內容（${reason}）` }, 502, cors);
      }

      console.log(JSON.stringify({
        level: "info",
        event: "analysis_done",
        model,
        imageCount: images.length,
        format,
        winRate,
        usage: geminiData.usageMetadata || null,
      }));

      return json({ ok: true, markdown, winRate, model, usage: geminiData.usageMetadata || null }, 200, cors);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "unhandled", message: String(err?.message || err) }));
      return json({ ok: false, error: "Worker 內部錯誤，請稍後再試" }, 500, cors);
    }
  },
};

/* ------------------------------------------------------------------ */
/* 工具函式                                                            */
/* ------------------------------------------------------------------ */

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

/** 驗證前端傳入的 payload，回傳 { images, note } 或 { error } */
function validatePayload(body) {
  if (!body || !Array.isArray(body.images)) {
    return { error: "缺少 images 陣列" };
  }
  if (body.images.length === 0) {
    return { error: "請至少上傳 1 張截圖" };
  }
  if (body.images.length > MAX_IMAGES) {
    return { error: `最多只能上傳 ${MAX_IMAGES} 張截圖` };
  }

  const images = [];
  for (let i = 0; i < body.images.length; i++) {
    const img = body.images[i] || {};
    let { mimeType, data } = img;

    if (typeof data !== "string" || data.length === 0) {
      return { error: `第 ${i + 1} 張圖片缺少 data` };
    }

    // 容錯：若前端傳來完整 data URL，自動拆出 mimeType 與 Base64
    const match = data.match(/^data:([^;]+);base64,(.*)$/s);
    if (match) {
      mimeType = mimeType || match[1];
      data = match[2];
    }

    mimeType = (mimeType || "").toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      return { error: `第 ${i + 1} 張圖片格式不支援（${mimeType || "未知"}）` };
    }

    // Base64 長度 * 3/4 ≈ 實際位元組數
    if (data.length * 0.75 > MAX_IMAGE_BYTES) {
      return { error: `第 ${i + 1} 張圖片過大（上限 ${MAX_IMAGE_BYTES / 1024 / 1024} MB）` };
    }

    images.push({ mimeType, data });
  }

  const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE_LENGTH).trim() : "";
  const format = FORMATS[body.format] ? body.format : "doubles";
  return { images, note, format };
}

const FORMATS = {
  doubles: "VGC 雙打（帶 6 選 4，先發 2 隻）",
  singles: "單打（帶 6 選 3，先發 1 隻）",
};

/** 依照 Gemini generateContent 格式組裝請求 */
function buildGeminiRequest(images, note, format) {
  const parts = [];

  images.forEach((img, idx) => {
    const label = idx === 0
      ? "【第 1 張】6v6 Team Preview 總覽圖（雙方陣容 + 我方道具）："
      : `【第 ${idx + 1} 張】我方第 ${idx} 隻寶可夢的詳細招式表：`;
    parts.push({ text: label });
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  });

  let instruction = `以上共 ${images.length} 張截圖。\n【賽制】${FORMATS[format]}\n請依照系統指示完成完整的戰術分析。`;
  if (note) {
    instruction += `\n\n【使用者補充說明】\n${note}`;
  }
  parts.push({ text: instruction });

  return {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
    },
  };
}

/** 回傳 JSON Response 並附上 CORS 標頭 */
function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
