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

// Access token 快取：同一個 Worker isolate 存活期間重複利用，不用每支 API 進來都重新
// 簽一次 JWT、跟 Google 換一次 token（Google 核發的 token 有效期是 1 小時，這裡提前 60
// 秒視為過期，留一點時間差避免拿著快要過期的 token 去打 Sheets API 卻被拒絕）。
// `tokenCache`/`tokenCachePromise` 是 module 層變數，只在同一個 isolate 內有效——Worker
// 換了新的 isolate（冷啟動、被回收）快取就會重來，這是可以接受的代價。
let tokenCache = null; // { accessToken, expiresAt }（expiresAt 是 epoch 秒）
let tokenCachePromise = null;

// scope 預設只要求 Sheets 讀寫權限。
export async function getAccessToken(serviceAccount, scope = "https://www.googleapis.com/auth/spreadsheets") {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.accessToken;
  }
  // 同一波併發請求（例如老闆後台首頁一次打好幾支 API）幾乎同時發現快取是空的，
  // 讓大家一起等同一個換 token 的 Promise，避免重複打好幾次 Google OAuth。
  if (tokenCachePromise) {
    return tokenCachePromise;
  }

  tokenCachePromise = (async () => {
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
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + (Number(data.expires_in) || 3600) - 60,
    };
    return data.access_token;
  })();

  try {
    return await tokenCachePromise;
  } finally {
    tokenCachePromise = null;
  }
}
