// 這份檔案是給「直接在 Cloudflare Dashboard 網頁編輯器貼上」用的整合版本，
// 把 src/index.js、src/googleAuth.js、src/sheets.js、src/auth.js 四個檔案的內容合併成一份。
// 開發時請改 src/ 底下的檔案；這份檔案只在改動後手動同步、貼到 Dashboard。

// ---- 以下對應 src/googleAuth.js ----

// 用 Service Account 憑證換一個短期 Google API access token。
// 全部用 Workers 內建的 Web Crypto API 做 RS256 簽章，不需要額外的 npm 套件。

function base64url(input) {
  let bytes;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJWT(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${base64url(signature)}`;
}

// scope 預設只要求 Sheets 讀寫權限。
async function getAccessToken(serviceAccount, scope = "https://www.googleapis.com/auth/spreadsheets") {
  const jwt = await signJWT(serviceAccount, scope);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`向 Google 換 access token 失敗 (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ---- 以下對應 src/sheets.js ----

// 用 access token 讀 Google Sheets 某個範圍的值。
async function getValues(accessToken, spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`讀取 Google Sheets 失敗 (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.values || [];
}

// 讀一整張表，用第一列當欄位名稱，把每一列轉成物件。
// 傳整個分頁名稱當 range（例如 "Products"）就會讀到該分頁所有已使用的儲存格。
async function getSheetRows(accessToken, spreadsheetId, sheetName) {
  const values = await getValues(accessToken, spreadsheetId, sheetName);
  if (values.length === 0) return [];

  const [header, ...rows] = values;
  return rows
    .filter((row) => row.some((cell) => cell !== "" && cell !== undefined))
    .map((row) => {
      const obj = {};
      header.forEach((key, i) => {
        obj[key] = row[i] !== undefined ? row[i] : "";
      });
      return obj;
    });
}

// 把資料列附加到某張表的最後面。rows 是二維陣列，每個內層陣列的欄位順序
// 要跟該分頁的欄位標題列一致（呼叫端負責對齊順序，這裡不做欄位名稱轉換）。
async function appendRows(accessToken, spreadsheetId, sheetName, rows) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    sheetName
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`寫入 Google Sheets 失敗 (${res.status}): ${text}`);
  }

  return res.json();
}

// 把數字欄位編號轉成 Sheets 的欄位字母（1 -> A、27 -> AA），給 updateRow 組 range 用。
function columnLetter(n) {
  let letter = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

// 覆寫某張表指定列（rowNumber 是 Sheets 上實際的列號，從 1 開始，含標題列）的整列內容。
async function updateRow(accessToken, spreadsheetId, sheetName, rowNumber, values) {
  const range = `${sheetName}!A${rowNumber}:${columnLetter(values.length)}${rowNumber}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    range
  )}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`寫入 Google Sheets 失敗 (${res.status}): ${text}`);
  }

  return res.json();
}

// 在某張表裡找欄位名稱是 keyColumn、值等於 keyValue 的那一列，
// 回傳欄位標題列、該列目前的值、以及它在 Sheets 上的實際列號（給 updateRow 用）。
// 找不到就回傳 null。
async function findRowByKey(accessToken, spreadsheetId, sheetName, keyColumn, keyValue) {
  const values = await getValues(accessToken, spreadsheetId, sheetName);
  if (values.length === 0) return null;

  const [header, ...rows] = values;
  const keyIndex = header.indexOf(keyColumn);
  if (keyIndex === -1) {
    throw new Error(`分頁「${sheetName}」找不到欄位「${keyColumn}」`);
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][keyIndex] === keyValue) {
      return { header, row: rows[i], rowNumber: i + 2 };
    }
  }

  return null;
}

// 跟 getSheetRows 一樣把整張表轉成物件陣列，但每個物件多帶一個 __rowNumber
// （Sheets 上的實際列號），給需要之後刪除/覆寫特定列的呼叫端用（例如替換某檔期的取貨時段）。
async function getRowsWithNumbers(accessToken, spreadsheetId, sheetName) {
  const values = await getValues(accessToken, spreadsheetId, sheetName);
  if (values.length === 0) return [];

  const [header, ...rows] = values;
  return rows
    .map((row, i) => ({ row, rowNumber: i + 2 }))
    .filter(({ row }) => row.some((cell) => cell !== "" && cell !== undefined))
    .map(({ row, rowNumber }) => {
      const obj = { __rowNumber: rowNumber };
      header.forEach((key, i) => {
        obj[key] = row[i] !== undefined ? row[i] : "";
      });
      return obj;
    });
}

// 刪除某張表裡指定的多列（rowNumbers 是 Sheets 上的實際列號，從 1 開始，含標題列）。
// 用 batchUpdate 的 deleteDimension，需要先查該分頁的內部 sheetId（不是分頁名稱）。
// 從最大的列號開始刪，避免同一批刪除時列號互相位移。
async function deleteRows(accessToken, spreadsheetId, sheetName, rowNumbers) {
  if (!rowNumbers || rowNumbers.length === 0) return;

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`讀取 Google Sheets 中繼資料失敗 (${metaRes.status}): ${text}`);
  }
  const meta = await metaRes.json();
  const sheetMeta = (meta.sheets || []).find((s) => s.properties.title === sheetName);
  if (!sheetMeta) {
    throw new Error(`找不到分頁：${sheetName}`);
  }
  const sheetId = sheetMeta.properties.sheetId;

  const requests = [...rowNumbers]
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
      },
    }));

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`刪除 Google Sheets 資料失敗 (${res.status}): ${text}`);
  }

  return res.json();
}

// ---- 以下對應 src/auth.js ----

// 老闆登入用的短期 Token：HMAC-SHA256 簽章，純 Web Crypto API，不需要額外套件、
// 不需要 D1/KV 存 session（Token 本身帶著到期時間，Worker 只需要驗簽章 + 檢查有沒有過期）。
// Token 格式：base64url(JSON payload).base64url(HMAC 簽章)，payload 只放到期時間 exp。

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 小時，過期要重新用 PIN 登入

function tokenBase64url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function tokenBase64urlToBytes(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

// PIN 驗證成功後呼叫，回傳新 token 跟到期時間（unix 秒數）。
async function signToken(secret) {
  const payload = { exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const payloadPart = tokenBase64url(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));

  return { token: `${payloadPart}.${tokenBase64url(new Uint8Array(signature))}`, expiresAt: payload.exp };
}

// 驗證某支寫入 API 帶來的 token 是否有效（簽章正確且還沒過期）。
async function verifyToken(token, secret) {
  if (typeof token !== "string") return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadPart, signaturePart] = parts;

  let valid;
  try {
    const key = await importHmacKey(secret, ["verify"]);
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      tokenBase64urlToBytes(signaturePart),
      new TextEncoder().encode(payloadPart)
    );
  } catch {
    return false;
  }
  if (!valid) return false;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(tokenBase64urlToBytes(payloadPart)));
  } catch {
    return false;
  }

  return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
}

// ---- 以下對應 src/index.js ----

// 顧客網站（Phase 4）跟老闆 PWA（Phase 6）會從不同網域打這個 Worker，開放 CORS。
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Products.active 是 Google Sheets 的核取方塊欄位，讀回來可能是布林值或字串，兩種都接受。
function isActive(value) {
  return value === true || value === "TRUE";
}

// 把前端傳來的各種「勾選」表示法（布林值、"true"、"TRUE"、1）統一轉成布林值。
function toBool(value) {
  return value === true || value === "true" || value === "TRUE" || value === 1 || value === "1";
}

// 防止顧客輸入被 Google Sheets 當成公式執行（Formula Injection）。
// appendRows/updateRow 都用 valueInputOption=USER_ENTERED 寫入，這個模式會模擬使用者手動
// 打字的行為：儲存格內容開頭是 =、+、-、@ 會被解析成公式，不是純文字。顧客下單時填的姓名、
// 備註、宅配地址不受信任，比照 customer_phone 原本防止開頭 0 被吃掉的做法（前導單引號強制
// 存成純文字），只在開頭是這幾個公式觸發字元時才加上 `'`，避免老闆之後打開 Google Sheets
// 時公式被自動執行（可能外洩其他欄位資料，或做釣魚連結）。
function sanitizeForSheets(value) {
  const str = String(value == null ? "" : value);
  return /^[=+\-@]/.test(str) ? `'${str}` : str;
}

async function getAuthedContext(env) {
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const accessToken = await getAccessToken(serviceAccount);
  return { accessToken, spreadsheetId: env.SPREADSHEET_ID };
}

// PIN 登入防暴力破解：連續失敗 LOGIN_MAX_ATTEMPTS 次就鎖定 LOGIN_LOCKOUT_SECONDS 秒，
// 期間內不管 PIN 對不對都直接擋下。專案不用 D1/KV（技術棧原則），失敗次數跟鎖定到期時間
// 直接借用既有的 Settings 分頁存兩個 key（login_fail_count、login_locked_until），跟專案
// 其他地方「讀了再寫」的簡單檢查（訂單編號流水號、總量上限）同一套取捨：極端情況下幾乎
// 同時的兩個請求可能互相蓋掉對方的計數、少算一兩次，但這裡只是要把暴力破解 6 位數 PIN
// （100 萬種組合）拉長到不可行的時間，少算一兩次不影響防護效果。因為只有老闆一個人會
// 登入，鎖定期間連老闆自己也會被擋，這是可以接受的代價（比被暴力破解好）。
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
const LOGIN_THROTTLE_KEYS = new Set(["login_fail_count", "login_locked_until"]);

// 匯款資訊已下架（資安/防詐考量，改用 LINE Pay／全支付／現金自取等付款方式），這幾個
// key 就算 Settings 分頁裡還留著舊資料，公開的 GET /settings 也一律不回傳。
const REMOVED_SETTINGS_KEYS = new Set(["bank_name", "bank_account", "bank_owner"]);

// Settings 分頁的 upsert（key 存在就覆寫、不存在就新增一列），給登入節流跟之後任何
// 需要單一存一組 key-value 的地方共用。
async function upsertSetting(accessToken, spreadsheetId, key, value) {
  const found = await findRowByKey(accessToken, spreadsheetId, "Settings", "setting_key", key);
  if (found) {
    const { header, row, rowNumber } = found;
    const keyIndex = header.indexOf("setting_key");
    const valueIndex = header.indexOf("setting_value");
    const newRow = header.map((_, i) => (row[i] !== undefined ? row[i] : ""));
    newRow[keyIndex] = key;
    newRow[valueIndex] = value;
    await updateRow(accessToken, spreadsheetId, "Settings", rowNumber, newRow);
  } else {
    await appendRows(accessToken, spreadsheetId, "Settings", [[key, value]]);
  }
}

// POST /auth/login：老闆輸入 PIN 換一支短期 Token（12 小時），之後老闆端的寫入 API
// 都要在 Authorization: Bearer <token> header 帶這支 token 才能呼叫。
// PIN（`ADMIN_PIN`）跟簽章用的密鑰（`TOKEN_SECRET`）都是 Cloudflare Dashboard 的「秘密」
// 環境變數，做法比照 Phase 3-1 的 SPREADSHEET_ID / GOOGLE_SERVICE_ACCOUNT_KEY，不寫進 repo。
async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  const pin = body && body.pin;
  if (!pin || typeof pin !== "string") {
    return json({ ok: false, error: "缺少必要欄位（pin）" }, { status: 400 });
  }

  if (!env.ADMIN_PIN || !env.TOKEN_SECRET) {
    return json(
      { ok: false, error: "伺服器尚未設定 ADMIN_PIN / TOKEN_SECRET，請先在 Cloudflare Dashboard 設定" },
      { status: 500 }
    );
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const settingsRows = await getSheetRows(accessToken, spreadsheetId, "Settings");
  const settingsMap = {};
  for (const row of settingsRows) {
    if (row.setting_key) settingsMap[row.setting_key] = row.setting_value;
  }
  const failCount = toNumber(settingsMap.login_fail_count);
  const lockedUntil = toNumber(settingsMap.login_locked_until);
  const now = Math.floor(Date.now() / 1000);

  if (lockedUntil > now) {
    const remainingMinutes = Math.ceil((lockedUntil - now) / 60);
    return json({ ok: false, error: `登入嘗試次數過多，請於 ${remainingMinutes} 分鐘後再試` }, { status: 429 });
  }

  if (pin !== env.ADMIN_PIN) {
    const nextFailCount = failCount + 1;
    if (nextFailCount >= LOGIN_MAX_ATTEMPTS) {
      await Promise.all([
        upsertSetting(accessToken, spreadsheetId, "login_fail_count", "0"),
        upsertSetting(accessToken, spreadsheetId, "login_locked_until", String(now + LOGIN_LOCKOUT_SECONDS)),
      ]);
      return json(
        { ok: false, error: `登入嘗試次數過多，請於 ${Math.ceil(LOGIN_LOCKOUT_SECONDS / 60)} 分鐘後再試` },
        { status: 429 }
      );
    }
    await upsertSetting(accessToken, spreadsheetId, "login_fail_count", String(nextFailCount));
    return json({ ok: false, error: "PIN 錯誤" }, { status: 401 });
  }

  if (failCount > 0 || lockedUntil > 0) {
    await Promise.all([
      upsertSetting(accessToken, spreadsheetId, "login_fail_count", "0"),
      upsertSetting(accessToken, spreadsheetId, "login_locked_until", "0"),
    ]);
  }

  const { token, expiresAt } = await signToken(env.TOKEN_SECRET);
  return json({ ok: true, token, expires_at: expiresAt });
}

// 檢查請求是否帶著有效、還沒過期的 token（Authorization: Bearer <token>）。
async function isAuthorized(request, env) {
  if (!env.TOKEN_SECRET) return false;

  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return false;

  return verifyToken(match[1], env.TOKEN_SECRET);
}

function unauthorized() {
  return json(
    { ok: false, error: "請先用 PIN 登入（POST /auth/login），並在 Authorization: Bearer <token> 帶上拿到的 token" },
    { status: 401 }
  );
}

// 台北時區的日期（給訂單編號用）跟 ISO 格式時間（給 created_at 用）。
function nowInTaipei() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));

  return {
    dateCompact: `${parts.year}${parts.month}${parts.day}`,
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    isoLocal: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`,
  };
}

// 把 Sheets 讀回來的日期統一成 YYYY-MM-DD，方便直接用字串比大小。
// 依儲存格格式，同一欄可能回傳 "2026-08-15" 或 "2026/8/15"，兩種都吃得下；
// 認不出來就回傳空字串，當成「沒有填結束日」處理——寧可讓預購維持開放，
// 也不要因為讀錯格式就誤判成已結束、把顧客擋在門外。
function normalizeDateString(value) {
  const m = String(value == null ? "" : value).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// 檔期是不是「還在預購中」：status 要是 active，而且今天落在預購起訖日之間。
// start_date 當天就算開放（前一天還不開放）、end_date 當天仍然算開放（隔天才關），
// 沒填的那一邊就不設限。這是「預購有沒有開放」的單一判斷依據，公開 API 跟老闆後台都走這個函式，
// 完全自動：老闆只要把起訖日設好，不用再手動切換檔期狀態。
function isCampaignOngoing(campaign, today) {
  if (!campaign || campaign.status !== "active") return false;
  const startDate = normalizeDateString(campaign.start_date);
  if (startDate && startDate > today) return false;
  const endDate = normalizeDateString(campaign.end_date);
  if (endDate && endDate < today) return false;
  return true;
}

// 訂單編號格式 ORD-YYYYMMDD-XXXX，同一天內流水號遞增。
// 這裡是簡單的「讀了再寫」，跟 Phase 5 的總量控制一樣不做原子鎖：
// 極端情況下（幾乎同時送出兩張訂單）可能撞號重試，機率很低，先接受這個風險。
function generateOrderId(existingOrders, dateCompact) {
  const prefix = `ORD-${dateCompact}-`;
  let maxSeq = 0;

  for (const order of existingOrders) {
    if (typeof order.order_id === "string" && order.order_id.startsWith(prefix)) {
      const seq = parseInt(order.order_id.slice(prefix.length), 10);
      if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

// 檔期「已訂購量」加總（只算未取消訂單），共用給 GET /campaigns、POST /orders 使用，
// 避免同一段邏輯散落在多個地方、之後改規則卻漏改。
function campaignOrderedQuantity(campaignId, orders, orderItems) {
  const countedOrderIds = new Set(
    orders.filter((o) => o.campaign_id === campaignId && o.order_status !== "cancelled").map((o) => o.order_id)
  );
  return orderItems.reduce(
    (sum, item) => (countedOrderIds.has(item.order_id) ? sum + toNumber(item.quantity) : sum),
    0
  );
}

// 檔期剩餘量（給顧客看、也是前端數量選擇器能選的上限）。這裡一律是真實數字，不打折扣——
// 原本考慮過「剩餘量偏低時刻意少顯示幾份」當緩衝，但這樣顯示的數字跟實際可購買數量不一致，
// 有消費者保護法規上的疑慮，改成如實顯示 + Campaigns.low_stock_threshold 只用來決定要不要
// 顯示低庫存提示（見 handleCampaigns() 的 low_stock 欄位、site/js/app.js 的免責文字提示）。
function campaignRemainingQuantity(campaign, orderedQty) {
  const cap = toNumber(campaign.total_quantity_cap);
  if (cap <= 0) return null; // 不限制
  return Math.max(0, cap - orderedQty);
}

// POST /orders：顧客下單，商品單價一律以 Sheets 上的 Products 資料為準，不採信前端傳來的價格。
// 驗證項目：檔期是否開放、取貨方式對應欄位是否齊全（自取要有 pickup_slot_id 且時段屬於這個檔期，
// 宅配要有 delivery_address）、單一商品是否超過 max_per_order、
// 檔期總量（Campaigns.total_quantity_cap）是否還有餘量。
// 宅配運費一律從 Settings.shipping_fee 讀取，不採信前端傳來的金額，跟商品價格同一套防呆邏輯。
async function handleCreateOrder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  const {
    campaign_id,
    customer_name,
    customer_phone,
    pickup_slot_id,
    delivery_method,
    delivery_address,
    note,
    items,
  } = body || {};

  // 沒帶 delivery_method 時預設 pickup，保持舊版顧客端（沒有宅配功能）的行為不變。
  const deliveryMethod = delivery_method === "delivery" ? "delivery" : "pickup";

  if (!campaign_id || !customer_name || !customer_phone) {
    return json(
      { ok: false, error: "缺少必要欄位（campaign_id、customer_name、customer_phone）" },
      { status: 400 }
    );
  }
  if (deliveryMethod === "pickup" && !pickup_slot_id) {
    return json({ ok: false, error: "缺少必要欄位（pickup_slot_id）" }, { status: 400 });
  }
  if (deliveryMethod === "delivery" && !(typeof delivery_address === "string" && delivery_address.trim())) {
    return json({ ok: false, error: "缺少必要欄位（delivery_address）" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return json({ ok: false, error: "訂單至少要有一項商品" }, { status: 400 });
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);

  const [campaigns, slots, products, existingOrders, existingOrderItems, settingsRows] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Campaigns"),
    getSheetRows(accessToken, spreadsheetId, "PickupSlots"),
    getSheetRows(accessToken, spreadsheetId, "Products"),
    getSheetRows(accessToken, spreadsheetId, "Orders"),
    getSheetRows(accessToken, spreadsheetId, "Order_Items"),
    getSheetRows(accessToken, spreadsheetId, "Settings"),
  ]);

  const campaign = campaigns.find((c) => c.campaign_id === campaign_id);
  if (!campaign || campaign.status !== "active") {
    return json({ ok: false, error: "此檔期目前未開放預購" }, { status: 400 });
  }
  // 起訖日過了就不再收單，不用等老闆手動切換檔期狀態。理論上顧客不會走到「還沒開始」
  // 這個分支（GET /campaigns 已經先擋掉了），這裡分開訊息純粹是保險，避免誤導成「已結束」。
  const today = nowInTaipei().dateISO;
  if (!isCampaignOngoing(campaign, today)) {
    const startDate = normalizeDateString(campaign.start_date);
    const notStartedYet = startDate && startDate > today;
    return json(
      { ok: false, error: notStartedYet ? "本檔期預購尚未開始，請稍後再試" : "本檔期預購已結束，請等待下一檔期" },
      { status: 400 }
    );
  }

  if (deliveryMethod === "pickup") {
    const slot = slots.find((s) => s.slot_id === pickup_slot_id && s.campaign_id === campaign_id);
    if (!slot) {
      return json({ ok: false, error: "取貨時段不存在，或不屬於這個檔期" }, { status: 400 });
    }
  }

  const productsById = new Map(products.map((p) => [p.product_id, p]));
  const orderItems = [];

  for (const rawItem of items) {
    const product = productsById.get(rawItem && rawItem.product_id);
    if (!product || product.campaign_id !== campaign_id || !isActive(product.active)) {
      return json({ ok: false, error: `商品不存在或已下架：${rawItem && rawItem.product_id}` }, { status: 400 });
    }

    const quantity = toNumber(rawItem.quantity);
    if (quantity <= 0) {
      return json({ ok: false, error: `${product.name} 的數量必須大於 0` }, { status: 400 });
    }

    const maxPerOrder = toNumber(product.max_per_order);
    if (maxPerOrder > 0 && quantity > maxPerOrder) {
      return json({ ok: false, error: `${product.name} 每筆訂單最多只能訂 ${maxPerOrder} ${product.unit || "袋"}` }, { status: 400 });
    }

    const unitPrice = toNumber(product.price);
    orderItems.push({
      product_id: product.product_id,
      product_name_snapshot: product.name,
      unit_price: unitPrice,
      quantity,
      subtotal: unitPrice * quantity,
    });
  }

  const requestedQuantity = orderItems.reduce((sum, item) => sum + item.quantity, 0);
  const quantityCap = toNumber(campaign.total_quantity_cap);
  if (quantityCap > 0) {
    // 這裡刻意用未經緩衝的真實剩餘量把關，不能讓顧客用「顯示用剩餘量」的緩衝騙過最終檢查。
    const alreadyOrdered = campaignOrderedQuantity(campaign_id, existingOrders, existingOrderItems);

    if (alreadyOrdered + requestedQuantity > quantityCap) {
      const remaining = Math.max(0, quantityCap - alreadyOrdered);
      return json(
        {
          ok: false,
          error:
            remaining > 0
              ? `本檔期預購已達上限，剩餘 ${remaining} 份，訂單需求 ${requestedQuantity} 份，請減少數量後再試`
              : "本檔期預購已額滿，請等待下一檔期",
        },
        { status: 400 }
      );
    }
  }

  const settingsMap = {};
  for (const row of settingsRows) {
    if (row.setting_key) settingsMap[row.setting_key] = row.setting_value;
  }
  const shippingFee = deliveryMethod === "delivery" ? toNumber(settingsMap.shipping_fee) : 0;

  const itemsSubtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
  const total = itemsSubtotal + shippingFee;
  const { dateCompact, isoLocal } = nowInTaipei();
  const orderId = generateOrderId(existingOrders, dateCompact);
  const pickupSlotIdValue = deliveryMethod === "pickup" ? pickup_slot_id : "";
  const deliveryAddressValue = deliveryMethod === "delivery" ? delivery_address.trim() : "";

  await appendRows(accessToken, spreadsheetId, "Orders", [
    [
      orderId,
      campaign_id,
      isoLocal,
      sanitizeForSheets(customer_name),
      `'${customer_phone}`,
      pickupSlotIdValue,
      total,
      "pending",
      "new",
      sanitizeForSheets(note || ""),
      deliveryMethod,
      shippingFee,
      sanitizeForSheets(deliveryAddressValue),
    ],
  ]);

  await appendRows(
    accessToken,
    spreadsheetId,
    "Order_Items",
    orderItems.map((item) => [
      orderId,
      item.product_id,
      item.product_name_snapshot,
      item.unit_price,
      item.quantity,
      item.subtotal,
    ])
  );

  return json(
    {
      ok: true,
      order: {
        order_id: orderId,
        campaign_id,
        created_at: isoLocal,
        customer_name,
        customer_phone,
        pickup_slot_id: pickupSlotIdValue,
        delivery_method: deliveryMethod,
        shipping_fee: shippingFee,
        delivery_address: deliveryAddressValue,
        total,
        payment_status: "pending",
        order_status: "new",
        note: note || "",
        items: orderItems.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name_snapshot,
          unit_price: item.unit_price,
          quantity: item.quantity,
          subtotal: item.subtotal,
        })),
      },
    },
    { status: 201 }
  );
}

// 商品編號格式 P001、P002...，取現有商品裡最大的編號 +1（不分檔期，跨檔期共用同一組編號）。
function generateProductId(existingProducts) {
  let maxSeq = 0;
  for (const p of existingProducts) {
    const match = typeof p.product_id === "string" && p.product_id.match(/^P(\d+)$/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return `P${String(maxSeq + 1).padStart(3, "0")}`;
}

// POST /products：老闆新增商品。
async function handleCreateProduct(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  const { campaign_id, name, category, price, max_per_order, active, variant_group, variant_label, unit } = body || {};

  if (!campaign_id || !name) {
    return json({ ok: false, error: "缺少必要欄位（campaign_id、name）" }, { status: 400 });
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const existingProducts = await getSheetRows(accessToken, spreadsheetId, "Products");
  const productId = generateProductId(existingProducts);
  const isProductActive = active === undefined ? true : toBool(active);

  await appendRows(accessToken, spreadsheetId, "Products", [
    [
      productId,
      campaign_id,
      name,
      category || "",
      toNumber(price),
      toNumber(max_per_order),
      isProductActive,
      variant_group || "",
      variant_label || "",
      unit || "",
    ],
  ]);

  return json(
    {
      ok: true,
      product: {
        product_id: productId,
        campaign_id,
        name,
        category: category || "",
        price: toNumber(price),
        max_per_order: toNumber(max_per_order),
        active: isProductActive,
        variant_group: variant_group || "",
        variant_label: variant_label || "",
        unit: unit || "",
      },
    },
    { status: 201 }
  );
}

// PATCH /products/:product_id：老闆編輯商品（改名稱、分類、價格、單筆上限、上下架）。
// 只更新請求裡有帶到的欄位，其他欄位維持原樣。
async function handleUpdateProduct(request, env, productId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const found = await findRowByKey(accessToken, spreadsheetId, "Products", "product_id", productId);
  if (!found) {
    return json({ ok: false, error: `找不到商品：${productId}` }, { status: 404 });
  }

  const { header, row, rowNumber } = found;
  const current = {};
  header.forEach((key, i) => {
    current[key] = row[i] !== undefined ? row[i] : "";
  });

  const updated = { ...current };
  if (body.campaign_id !== undefined) updated.campaign_id = body.campaign_id;
  if (body.name !== undefined) updated.name = body.name;
  if (body.category !== undefined) updated.category = body.category;
  if (body.price !== undefined) updated.price = toNumber(body.price);
  if (body.max_per_order !== undefined) updated.max_per_order = toNumber(body.max_per_order);
  if (body.active !== undefined) updated.active = toBool(body.active);
  if (body.variant_group !== undefined) updated.variant_group = body.variant_group;
  if (body.variant_label !== undefined) updated.variant_label = body.variant_label;
  if (body.unit !== undefined) updated.unit = body.unit;

  await updateRow(
    accessToken,
    spreadsheetId,
    "Products",
    rowNumber,
    header.map((key) => updated[key])
  );

  return json({
    ok: true,
    product: {
      product_id: updated.product_id,
      campaign_id: updated.campaign_id,
      name: updated.name,
      category: updated.category,
      price: toNumber(updated.price),
      max_per_order: toNumber(updated.max_per_order),
      active: isActive(updated.active),
      variant_group: updated.variant_group || "",
      variant_label: updated.variant_label || "",
      unit: updated.unit || "",
    },
  });
}

// DELETE /products/:product_id：老闆刪除商品。過去訂單的品項是存快照（product_name_snapshot 等），
// 不會因為商品被刪除而受影響，所以這裡不檢查有沒有被訂過，跟 Phase 1 假資料版的行為一致。
async function handleDeleteProduct(env, productId) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const found = await findRowByKey(accessToken, spreadsheetId, "Products", "product_id", productId);
  if (!found) {
    return json({ ok: false, error: `找不到商品：${productId}` }, { status: 404 });
  }

  await deleteRows(accessToken, spreadsheetId, "Products", [found.rowNumber]);
  return json({ ok: true });
}

// GET /admin/products（Phase 6 新增）：給老闆商品管理頁用，回傳「所有」商品（不分檔期 active 與否、
// 不分上下架），已訂購量算法跟公開的 GET /products 一樣（未取消訂單的 Order_Items 加總），
// 但不限定只算 active 檔期，方便老闆回頭看已結束檔期的訂購狀況。
async function handleAdminProducts(env) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const [products, orders, orderItems] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Products"),
    getSheetRows(accessToken, spreadsheetId, "Orders"),
    getSheetRows(accessToken, spreadsheetId, "Order_Items"),
  ]);

  const countedOrderIds = new Set(
    orders.filter((o) => o.order_status !== "cancelled").map((o) => o.order_id)
  );

  const orderedQtyByProduct = {};
  for (const item of orderItems) {
    if (!countedOrderIds.has(item.order_id)) continue;
    orderedQtyByProduct[item.product_id] =
      (orderedQtyByProduct[item.product_id] || 0) + toNumber(item.quantity);
  }

  const list = products.map((p) => ({
    product_id: p.product_id,
    campaign_id: p.campaign_id,
    name: p.name,
    category: p.category,
    price: toNumber(p.price),
    max_per_order: toNumber(p.max_per_order),
    active: isActive(p.active),
    ordered_quantity: orderedQtyByProduct[p.product_id] || 0,
    variant_group: p.variant_group || "",
    variant_label: p.variant_label || "",
    unit: p.unit || "",
  }));

  return json({ ok: true, products: list });
}

// 檔期編號格式 C001、C002...，取現有檔期裡最大的編號 +1。
function generateCampaignId(existingCampaigns) {
  let maxSeq = 0;
  for (const c of existingCampaigns) {
    const match = typeof c.campaign_id === "string" && c.campaign_id.match(/^C(\d+)$/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return `C${String(maxSeq + 1).padStart(3, "0")}`;
}

// 取貨時段編號格式 S001、S002...，不分檔期共用同一組編號（比照商品編號的做法）。
function maxSlotSeq(existingSlots) {
  let maxSeq = 0;
  for (const s of existingSlots) {
    const match = typeof s.slot_id === "string" && s.slot_id.match(/^S(\d+)$/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return maxSeq;
}

// 拿掉了原本的 "upcoming"（即將開始）：老闆改用官方 LINE 通知顧客，不需要這個手動中間狀態，
// 檔期一建立就是 active，能不能被顧客看到完全交給 isCampaignOngoing() 的起訖日判斷。
// "ended" 保留給「結束檔期」按鈕用，屬於老闆手動強制關閉，跟起訖日無關。
const CAMPAIGN_STATUS_VALUES = ["active", "ended"];

// 把某個檔期底下的所有商品，整批複製成新檔期底下的新商品（新的 product_id，其他欄位照抄）。
// 給「新增檔期」時「沿用上一檔商品清單」用，回傳這次複製了幾筆。
async function copyProductsToCampaign(accessToken, spreadsheetId, fromCampaignId, toCampaignId) {
  const existingProducts = await getSheetRows(accessToken, spreadsheetId, "Products");
  const sourceProducts = existingProducts.filter((p) => p.campaign_id === fromCampaignId);
  if (!sourceProducts.length) return 0;

  let seq = 0;
  for (const p of existingProducts) {
    const match = typeof p.product_id === "string" && p.product_id.match(/^P(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > seq) seq = n;
    }
  }

  const rows = sourceProducts.map((p) => {
    seq += 1;
    return [
      `P${String(seq).padStart(3, "0")}`,
      toCampaignId,
      p.name || "",
      p.category || "",
      toNumber(p.price),
      toNumber(p.max_per_order),
      isActive(p.active),
      p.variant_group || "",
      p.variant_label || "",
      p.unit || "",
    ];
  });

  await appendRows(accessToken, spreadsheetId, "Products", rows);
  return rows.length;
}

// POST /campaigns（Phase 6 新增）：老闆新增檔期，可以一次帶取貨時段陣列一起建立。
// copy_products_from_campaign_id：選填，帶了的話會把該檔期底下所有商品複製一份到新檔期
// （老闆端「沿用上一檔商品清單」功能，避免每次開新檔期都要重新輸入 40 個品項）。
async function handleCreateCampaign(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  const {
    name,
    start_date,
    end_date,
    total_quantity_cap,
    low_stock_threshold,
    status,
    pickup_slots,
    copy_products_from_campaign_id,
  } = body || {};
  if (!name) {
    return json({ ok: false, error: "缺少必要欄位（name）" }, { status: 400 });
  }

  const campaignStatus = status !== undefined ? status : "active";
  if (!CAMPAIGN_STATUS_VALUES.includes(campaignStatus)) {
    return json({ ok: false, error: `status 必須是：${CAMPAIGN_STATUS_VALUES.join(" / ")}` }, { status: 400 });
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const [existingCampaigns, existingSlots] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Campaigns"),
    getSheetRows(accessToken, spreadsheetId, "PickupSlots"),
  ]);

  const campaignId = generateCampaignId(existingCampaigns);
  await appendRows(accessToken, spreadsheetId, "Campaigns", [
    [
      campaignId,
      name,
      campaignStatus,
      start_date || "",
      end_date || "",
      toNumber(total_quantity_cap),
      toNumber(low_stock_threshold),
    ],
  ]);

  const slotsInput = Array.isArray(pickup_slots) ? pickup_slots : [];
  let seq = maxSlotSeq(existingSlots);
  const newSlots = slotsInput.map((s) => {
    seq += 1;
    return {
      slot_id: `S${String(seq).padStart(3, "0")}`,
      campaign_id: campaignId,
      date: (s && s.date) || "",
      time_range: (s && s.time_range) || "",
    };
  });
  if (newSlots.length) {
    await appendRows(
      accessToken,
      spreadsheetId,
      "PickupSlots",
      newSlots.map((s) => [s.slot_id, s.campaign_id, s.date, s.time_range])
    );
  }

  let copiedProductCount = 0;
  if (copy_products_from_campaign_id) {
    copiedProductCount = await copyProductsToCampaign(
      accessToken,
      spreadsheetId,
      copy_products_from_campaign_id,
      campaignId
    );
  }

  return json(
    {
      ok: true,
      campaign: {
        campaign_id: campaignId,
        name,
        status: campaignStatus,
        start_date: start_date || "",
        end_date: end_date || "",
        total_quantity_cap: toNumber(total_quantity_cap),
        low_stock_threshold: toNumber(low_stock_threshold),
        pickup_slots: newSlots.map(({ slot_id, date, time_range }) => ({ slot_id, date, time_range })),
      },
      copied_product_count: copiedProductCount,
    },
    { status: 201 }
  );
}

// PATCH /campaigns/:campaign_id（Phase 6 新增）：編輯檔期基本欄位，只更新有帶到的欄位。
// 如果請求裡帶了 pickup_slots（陣列，可以是空陣列），會把這個檔期原本的取貨時段全部刪掉、
// 換成這次傳進來的新清單（整批覆蓋，不是逐筆增刪），比較符合老闆後台「編輯這個檔期的時段清單」的操作方式。
async function handleUpdateCampaign(request, env, campaignId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  if (body.status !== undefined && !CAMPAIGN_STATUS_VALUES.includes(body.status)) {
    return json({ ok: false, error: `status 必須是：${CAMPAIGN_STATUS_VALUES.join(" / ")}` }, { status: 400 });
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const found = await findRowByKey(accessToken, spreadsheetId, "Campaigns", "campaign_id", campaignId);
  if (!found) {
    return json({ ok: false, error: `找不到檔期：${campaignId}` }, { status: 404 });
  }

  const { header, row, rowNumber } = found;
  const current = {};
  header.forEach((key, i) => {
    current[key] = row[i] !== undefined ? row[i] : "";
  });

  const updated = { ...current };
  if (body.name !== undefined) updated.name = body.name;
  if (body.status !== undefined) updated.status = body.status;
  if (body.start_date !== undefined) updated.start_date = body.start_date;
  if (body.end_date !== undefined) updated.end_date = body.end_date;
  if (body.total_quantity_cap !== undefined) updated.total_quantity_cap = toNumber(body.total_quantity_cap);
  if (body.low_stock_threshold !== undefined) updated.low_stock_threshold = toNumber(body.low_stock_threshold);

  await updateRow(
    accessToken,
    spreadsheetId,
    "Campaigns",
    rowNumber,
    header.map((key) => updated[key])
  );

  let pickupSlotsResult;
  if (Array.isArray(body.pickup_slots)) {
    const allSlots = await getRowsWithNumbers(accessToken, spreadsheetId, "PickupSlots");
    const thisCampaignSlots = allSlots.filter((s) => s.campaign_id === campaignId);
    if (thisCampaignSlots.length) {
      await deleteRows(accessToken, spreadsheetId, "PickupSlots", thisCampaignSlots.map((s) => s.__rowNumber));
    }

    let seq = maxSlotSeq(allSlots);
    const newSlots = body.pickup_slots.map((s) => {
      seq += 1;
      return {
        slot_id: `S${String(seq).padStart(3, "0")}`,
        campaign_id: campaignId,
        date: (s && s.date) || "",
        time_range: (s && s.time_range) || "",
      };
    });
    if (newSlots.length) {
      await appendRows(
        accessToken,
        spreadsheetId,
        "PickupSlots",
        newSlots.map((s) => [s.slot_id, s.campaign_id, s.date, s.time_range])
      );
    }
    pickupSlotsResult = newSlots.map(({ slot_id, date, time_range }) => ({ slot_id, date, time_range }));
  } else {
    const allSlots = await getSheetRows(accessToken, spreadsheetId, "PickupSlots");
    pickupSlotsResult = allSlots
      .filter((s) => s.campaign_id === campaignId)
      .map((s) => ({ slot_id: s.slot_id, date: s.date, time_range: s.time_range }));
  }

  return json({
    ok: true,
    campaign: {
      campaign_id: updated.campaign_id,
      name: updated.name,
      status: updated.status,
      start_date: updated.start_date,
      end_date: updated.end_date,
      total_quantity_cap: toNumber(updated.total_quantity_cap),
      low_stock_threshold: toNumber(updated.low_stock_threshold),
      pickup_slots: pickupSlotsResult,
    },
  });
}

// DELETE /campaigns/:campaign_id（Phase 6 新增）：只有這個檔期完全沒有任何訂單時才能刪除
// （不分訂單狀態，取消的訂單也算），有訂單的檔期請改用 PATCH 把 status 改成 ended（結束檔期），
// 跟 Phase 1 假資料版「有訂單不能刪、只能結束」的規則一致。
// 連帶清掉 PickupSlots、Products 底下屬於這個檔期的資料，避免變成孤兒資料——
// 檔期編號是「目前最大編號 +1」算出來的，刪除後編號會被下一個新檔期重複使用，
// 沒清乾淨的舊商品就會被新檔期「借屍還魂」帶回來（實際發生過的 bug）。
async function handleDeleteCampaign(env, campaignId) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const found = await findRowByKey(accessToken, spreadsheetId, "Campaigns", "campaign_id", campaignId);
  if (!found) {
    return json({ ok: false, error: `找不到檔期：${campaignId}` }, { status: 404 });
  }

  const orders = await getSheetRows(accessToken, spreadsheetId, "Orders");
  if (orders.some((o) => o.campaign_id === campaignId)) {
    return json(
      { ok: false, error: "此檔期已有訂單，無法刪除，請改用「結束檔期」（PATCH status 改成 ended）" },
      { status: 400 }
    );
  }

  const allSlots = await getRowsWithNumbers(accessToken, spreadsheetId, "PickupSlots");
  const thisCampaignSlots = allSlots.filter((s) => s.campaign_id === campaignId);
  if (thisCampaignSlots.length) {
    await deleteRows(accessToken, spreadsheetId, "PickupSlots", thisCampaignSlots.map((s) => s.__rowNumber));
  }

  const allProducts = await getRowsWithNumbers(accessToken, spreadsheetId, "Products");
  const thisCampaignProducts = allProducts.filter((p) => p.campaign_id === campaignId);
  if (thisCampaignProducts.length) {
    await deleteRows(accessToken, spreadsheetId, "Products", thisCampaignProducts.map((p) => p.__rowNumber));
  }

  await deleteRows(accessToken, spreadsheetId, "Campaigns", [found.rowNumber]);

  return json({ ok: true });
}

// GET /admin/campaigns（Phase 6 新增）：給老闆檔期設定頁用，回傳「所有」檔期（不分 active/ended），
// 跟公開的 GET /campaigns（只回傳目前還在預購中的檔期）不一樣。
async function handleAdminCampaigns(env) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const [campaigns, slots] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Campaigns"),
    getSheetRows(accessToken, spreadsheetId, "PickupSlots"),
  ]);

  const list = campaigns.map((c) => ({
    campaign_id: c.campaign_id,
    name: c.name,
    status: c.status,
    start_date: c.start_date,
    end_date: c.end_date,
    total_quantity_cap: toNumber(c.total_quantity_cap),
    low_stock_threshold: toNumber(c.low_stock_threshold),
    pickup_slots: slots
      .filter((s) => s.campaign_id === c.campaign_id)
      .map((s) => ({ slot_id: s.slot_id, date: s.date, time_range: s.time_range })),
  }));

  return json({ ok: true, campaigns: list });
}

// PATCH /orders/:order_id：老闆確認付款、更新訂單狀態（4 段：new/prepping_done/picked_up/cancelled）、改備註。
// 這三個欄位都是可選的，至少要帶一個才有意義。
async function handleUpdateOrder(request, env, orderId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  const allowedPaymentStatus = ["pending", "confirmed"];
  const allowedOrderStatus = ["new", "prepping_done", "picked_up", "cancelled"];

  if (body.payment_status !== undefined && !allowedPaymentStatus.includes(body.payment_status)) {
    return json({ ok: false, error: `payment_status 必須是：${allowedPaymentStatus.join(" / ")}` }, { status: 400 });
  }
  if (body.order_status !== undefined && !allowedOrderStatus.includes(body.order_status)) {
    return json({ ok: false, error: `order_status 必須是：${allowedOrderStatus.join(" / ")}` }, { status: 400 });
  }
  if (body.payment_status === undefined && body.order_status === undefined && body.note === undefined) {
    return json({ ok: false, error: "至少要提供 payment_status、order_status 或 note 其中一項" }, { status: 400 });
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const found = await findRowByKey(accessToken, spreadsheetId, "Orders", "order_id", orderId);
  if (!found) {
    return json({ ok: false, error: `找不到訂單：${orderId}` }, { status: 404 });
  }

  const { header, row, rowNumber } = found;
  const current = {};
  header.forEach((key, i) => {
    current[key] = row[i] !== undefined ? row[i] : "";
  });

  const updated = { ...current };
  if (body.payment_status !== undefined) updated.payment_status = body.payment_status;
  if (body.order_status !== undefined) updated.order_status = body.order_status;
  if (body.note !== undefined) updated.note = body.note;

  await updateRow(
    accessToken,
    spreadsheetId,
    "Orders",
    rowNumber,
    header.map((key) => updated[key])
  );

  return json({
    ok: true,
    order: {
      order_id: updated.order_id,
      campaign_id: updated.campaign_id,
      created_at: updated.created_at,
      customer_name: updated.customer_name,
      customer_phone: updated.customer_phone,
      pickup_slot_id: updated.pickup_slot_id,
      delivery_method: updated.delivery_method || "pickup",
      shipping_fee: toNumber(updated.shipping_fee),
      delivery_address: updated.delivery_address || "",
      total: toNumber(updated.total),
      payment_status: updated.payment_status,
      order_status: updated.order_status,
      note: updated.note,
    },
  });
}

// DELETE /orders/:order_id（Phase 6 新增）：老闆永久刪除一筆訂單（連同它在 Order_Items 的品項明細）。
// 跟「取消訂單」（PATCH order_status=cancelled）不一樣：取消只是改狀態、資料還留著；
// 這支是真的從 Google Sheets 上把這幾列拿掉，用在測試訂單、輸入錯誤等要徹底移除的情況。
async function handleDeleteOrder(env, orderId) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const found = await findRowByKey(accessToken, spreadsheetId, "Orders", "order_id", orderId);
  if (!found) {
    return json({ ok: false, error: `找不到訂單：${orderId}` }, { status: 404 });
  }

  const itemRows = await getRowsWithNumbers(accessToken, spreadsheetId, "Order_Items");
  const thisOrderItems = itemRows.filter((i) => i.order_id === orderId);
  if (thisOrderItems.length) {
    await deleteRows(accessToken, spreadsheetId, "Order_Items", thisOrderItems.map((i) => i.__rowNumber));
  }
  await deleteRows(accessToken, spreadsheetId, "Orders", [found.rowNumber]);

  return json({ ok: true });
}

// PATCH /settings：老闆改公告、開關預購、改店家資料等單一設定值。
// Settings 分頁是 key-value 格式（欄位「setting_key」「setting_value」），這支可以一次更新多組。
// 傳入的 key 如果 Settings 裡已經有就更新該列，沒有就新增一列（upsert）。
async function handleUpdateSettings(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "請求格式錯誤，需要 JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
    return json(
      { ok: false, error: '請傳入至少一組要更新的 key-value（例如 { "announcement_text": "..." }）' },
      { status: 400 }
    );
  }

  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const updated = {};

  for (const [key, value] of Object.entries(body)) {
    const found = await findRowByKey(accessToken, spreadsheetId, "Settings", "setting_key", key);

    if (found) {
      const { header, row, rowNumber } = found;
      const keyIndex = header.indexOf("setting_key");
      const valueIndex = header.indexOf("setting_value");
      if (valueIndex === -1) {
        throw new Error('Settings 分頁找不到欄位「setting_value」');
      }

      const newRow = header.map((_, i) => (row[i] !== undefined ? row[i] : ""));
      newRow[keyIndex] = key;
      newRow[valueIndex] = value;
      await updateRow(accessToken, spreadsheetId, "Settings", rowNumber, newRow);
    } else {
      await appendRows(accessToken, spreadsheetId, "Settings", [[key, value]]);
    }

    updated[key] = value;
  }

  return json({ ok: true, settings: updated });
}

// GET /settings：公開讀取店家資料、公告、預購開關等設定值，給顧客網站用。
// Settings 分頁是 key-value 格式，這裡全部回傳（裡面沒有顧客個資，都是可公開的店家資訊）。
async function handleGetSettings(env) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const [rows, campaigns] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Settings"),
    getSheetRows(accessToken, spreadsheetId, "Campaigns"),
  ]);

  const settings = {};
  for (const row of rows) {
    // login_fail_count/login_locked_until 是 PIN 登入防暴力破解用的內部節流計數
    // （見 handleLogin），不是給顧客看的店家資訊；bank_name/bank_account/bank_owner
    // 是已下架的匯款資訊。這兩類 key 這支公開 API 都不回傳。
    if (row.setting_key && !LOGIN_THROTTLE_KEYS.has(row.setting_key) && !REMOVED_SETTINGS_KEYS.has(row.setting_key)) {
      settings[row.setting_key] = row.setting_value;
    }
  }

  // 「顧客現在到底能不能下單」＝ 老闆的手動開關 AND 至少有一個還在預購中的檔期。
  // 這兩個計算欄位不存在 Sheets 裡，每次讀取即時算（沿用 Phase 2「不存彙總欄位」的原則）：
  // 檔期結束的隔天自動關閉、下一檔開跑又自動恢復，老闆不用記得手動去撥開關。
  const settingsToday = nowInTaipei().dateISO;
  const hasOngoingCampaign = campaigns.some((c) => isCampaignOngoing(c, settingsToday));
  const manualOpen = String(settings.preorder_open || "").trim().toUpperCase() === "TRUE";

  settings.has_ongoing_campaign = hasOngoingCampaign ? "TRUE" : "FALSE";
  settings.preorder_open_effective = manualOpen && hasOngoingCampaign ? "TRUE" : "FALSE";

  return json({ ok: true, settings });
}

// GET /campaigns：目前還在預購中的檔期（status=active 且預購結束日還沒過），含各自的取貨時段。
async function handleCampaigns(env) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const [campaigns, slots, orders, orderItems] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Campaigns"),
    getSheetRows(accessToken, spreadsheetId, "PickupSlots"),
    getSheetRows(accessToken, spreadsheetId, "Orders"),
    getSheetRows(accessToken, spreadsheetId, "Order_Items"),
  ]);

  const today = nowInTaipei().dateISO;
  const active = campaigns
    .filter((c) => isCampaignOngoing(c, today))
    .map((c) => {
      const orderedQty = campaignOrderedQuantity(c.campaign_id, orders, orderItems);
      const cap = toNumber(c.total_quantity_cap);
      const threshold = toNumber(c.low_stock_threshold);
      const remaining = campaignRemainingQuantity(c, orderedQty);
      return {
        campaign_id: c.campaign_id,
        name: c.name,
        status: c.status,
        start_date: c.start_date,
        end_date: c.end_date,
        total_quantity_cap: cap,
        // 給前端顯示/當作數量選擇器上限用的剩餘量，一律是真實數字；沒有設定總量上限時是
        // null（不限制）。
        remaining_quantity: remaining,
        // 是否低於低庫存門檻，前端只用這個決定要不要顯示「庫存緊張」的免責提示。
        low_stock: remaining !== null && threshold > 0 && remaining <= threshold,
        pickup_slots: slots
          .filter((s) => s.campaign_id === c.campaign_id)
          .map((s) => ({ slot_id: s.slot_id, date: s.date, time_range: s.time_range })),
      };
    });

  return json({ ok: true, campaigns: active });
}

// GET /products：目前 active 檔期、且上架中的商品，已訂購量從 Order_Items 即時加總
// （只算未取消的訂單），不讀任何預先存好的彙總欄位。
async function handleProducts(env) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const [campaigns, products, orders, orderItems] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Campaigns"),
    getSheetRows(accessToken, spreadsheetId, "Products"),
    getSheetRows(accessToken, spreadsheetId, "Orders"),
    getSheetRows(accessToken, spreadsheetId, "Order_Items"),
  ]);

  const today = nowInTaipei().dateISO;
  const activeCampaignIds = new Set(
    campaigns.filter((c) => isCampaignOngoing(c, today)).map((c) => c.campaign_id)
  );

  const countedOrderIds = new Set(
    orders
      .filter((o) => activeCampaignIds.has(o.campaign_id) && o.order_status !== "cancelled")
      .map((o) => o.order_id)
  );

  const orderedQtyByProduct = {};
  for (const item of orderItems) {
    if (!countedOrderIds.has(item.order_id)) continue;
    orderedQtyByProduct[item.product_id] =
      (orderedQtyByProduct[item.product_id] || 0) + toNumber(item.quantity);
  }

  const list = products
    .filter((p) => activeCampaignIds.has(p.campaign_id) && isActive(p.active))
    .map((p) => ({
      product_id: p.product_id,
      campaign_id: p.campaign_id,
      name: p.name,
      category: p.category,
      price: toNumber(p.price),
      max_per_order: toNumber(p.max_per_order),
      ordered_quantity: orderedQtyByProduct[p.product_id] || 0,
      variant_group: p.variant_group || "",
      variant_label: p.variant_label || "",
      unit: p.unit || "",
    }));

  return json({ ok: true, products: list });
}

// GET /orders：給老闆後台看的訂單列表，含每張訂單的品項明細，新訂單排前面。
async function handleOrders(env) {
  const { accessToken, spreadsheetId } = await getAuthedContext(env);
  const [orders, orderItems] = await Promise.all([
    getSheetRows(accessToken, spreadsheetId, "Orders"),
    getSheetRows(accessToken, spreadsheetId, "Order_Items"),
  ]);

  const itemsByOrderId = {};
  for (const item of orderItems) {
    if (!itemsByOrderId[item.order_id]) itemsByOrderId[item.order_id] = [];
    itemsByOrderId[item.order_id].push({
      product_id: item.product_id,
      product_name: item.product_name_snapshot,
      unit_price: toNumber(item.unit_price),
      quantity: toNumber(item.quantity),
      subtotal: toNumber(item.subtotal),
    });
  }

  const list = orders
    .map((o) => ({
      order_id: o.order_id,
      campaign_id: o.campaign_id,
      created_at: o.created_at,
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      pickup_slot_id: o.pickup_slot_id,
      delivery_method: o.delivery_method || "pickup",
      shipping_fee: toNumber(o.shipping_fee),
      delivery_address: o.delivery_address || "",
      total: toNumber(o.total),
      payment_status: o.payment_status,
      order_status: o.order_status,
      note: o.note,
      items: itemsByOrderId[o.order_id] || [],
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return json({ ok: true, orders: list });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      if (url.pathname === "/auth/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }

      // 顧客下單，公開不需要登入。
      if (url.pathname === "/orders" && request.method === "POST") {
        return await handleCreateOrder(request, env);
      }

      // 以下都是老闆專用的寫入 API，要先用 PIN 登入換到有效的 token 才能呼叫。
      const orderMatch = url.pathname.match(/^\/orders\/([^/]+)$/);
      if (orderMatch && request.method === "PATCH") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleUpdateOrder(request, env, decodeURIComponent(orderMatch[1]));
      }
      if (orderMatch && request.method === "DELETE") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleDeleteOrder(env, decodeURIComponent(orderMatch[1]));
      }

      if (url.pathname === "/products" && request.method === "POST") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleCreateProduct(request, env);
      }

      const productMatch = url.pathname.match(/^\/products\/([^/]+)$/);
      if (productMatch && request.method === "PATCH") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleUpdateProduct(request, env, decodeURIComponent(productMatch[1]));
      }
      if (productMatch && request.method === "DELETE") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleDeleteProduct(env, decodeURIComponent(productMatch[1]));
      }

      // Phase 6 新增：老闆檔期設定頁的新增/編輯/刪除檔期。
      if (url.pathname === "/campaigns" && request.method === "POST") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleCreateCampaign(request, env);
      }
      const campaignMatch = url.pathname.match(/^\/campaigns\/([^/]+)$/);
      if (campaignMatch && request.method === "PATCH") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleUpdateCampaign(request, env, decodeURIComponent(campaignMatch[1]));
      }
      if (campaignMatch && request.method === "DELETE") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleDeleteCampaign(env, decodeURIComponent(campaignMatch[1]));
      }

      if (url.pathname === "/settings" && request.method === "PATCH") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleUpdateSettings(request, env);
      }

      if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed" }, { status: 405 });
      }

      // Phase 3-1 驗收用的測試 endpoint，繼續保留方便之後排錯。
      if (url.pathname === "/api/test-sheets") {
        const { accessToken, spreadsheetId } = await getAuthedContext(env);
        const values = await getValues(accessToken, spreadsheetId, "Settings!A1:B2");
        return json({ ok: true, values });
      }

      // 顧客網站要讀的商品/檔期/店家設定資訊，公開不需要登入。
      if (url.pathname === "/products") return await handleProducts(env);
      if (url.pathname === "/campaigns") return await handleCampaigns(env);
      if (url.pathname === "/settings") return await handleGetSettings(env);

      // 訂單列表含顧客姓名電話，只有老闆能看，需要登入。
      if (url.pathname === "/orders") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleOrders(env);
      }

      // Phase 6 新增：老闆後台專用的「全部」商品/檔期列表（不像公開版只回傳 active 檔期/上架中商品）。
      if (url.pathname === "/admin/products") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleAdminProducts(env);
      }
      if (url.pathname === "/admin/campaigns") {
        if (!(await isAuthorized(request, env))) return unauthorized();
        return await handleAdminCampaigns(env);
      }

      return json({ ok: false, error: "Not found" }, { status: 404 });
    } catch (err) {
      return json({ ok: false, error: err.message }, { status: 500 });
    }
  },
};
