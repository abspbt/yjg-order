// 用 access token 讀 Google Sheets 某個範圍的值。
export async function getValues(accessToken, spreadsheetId, range) {
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

function rowsToObjects(values) {
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

// 併發時（例如老闆後台首頁一次打好幾支 API，好幾支都要讀同一張表）合併成同一次
// Google Sheets 讀取，讀完立刻把記錄清掉——**不是加 TTL 的快取**，下一次呼叫
// （哪怕只隔 1 毫秒）一定會重新真的打一次 Google Sheets，不會回傳舊資料。
// 這點很重要：後台之前特地把 API 改成不快取，才修好「新訂單不會即時顯示」的 bug
// （見 CLAUDE.md 近期優化備註），這裡只解決「同一瞬間的併發請求重複讀取」，
// 不能讓資料出現任何時間差的舊值。
const inflightSheetReads = new Map();

// 讀一整張表，用第一列當欄位名稱，把每一列轉成物件。
// 傳整個分頁名稱當 range（例如 "Products"）就會讀到該分頁所有已使用的儲存格。
export async function getSheetRows(accessToken, spreadsheetId, sheetName) {
  const key = `${spreadsheetId}::${sheetName}`;
  if (inflightSheetReads.has(key)) {
    return inflightSheetReads.get(key);
  }

  const promise = (async () => {
    const values = await getValues(accessToken, spreadsheetId, sheetName);
    return rowsToObjects(values);
  })();
  inflightSheetReads.set(key, promise);

  try {
    return await promise;
  } finally {
    inflightSheetReads.delete(key);
  }
}

// 把資料列附加到某張表的最後面。rows 是二維陣列，每個內層陣列的欄位順序
// 要跟該分頁的欄位標題列一致（呼叫端負責對齊順序，這裡不做欄位名稱轉換）。
export async function appendRows(accessToken, spreadsheetId, sheetName, rows) {
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
export async function updateRow(accessToken, spreadsheetId, sheetName, rowNumber, values) {
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
export async function findRowByKey(accessToken, spreadsheetId, sheetName, keyColumn, keyValue) {
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
export async function getRowsWithNumbers(accessToken, spreadsheetId, sheetName) {
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
export async function deleteRows(accessToken, spreadsheetId, sheetName, rowNumbers) {
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
