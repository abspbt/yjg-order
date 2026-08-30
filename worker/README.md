# Worker（Phase 3）

Cloudflare Worker，讀寫「歪嘴雞烘焙預購系統」的 Google Sheets 資料庫。

## 一、準備 Google Cloud Service Account（老闆需要做的部分）

Service Account 是一個「機器人帳號」，讓 Worker 可以用程式化方式讀寫 Google Sheets，不需要透過老闆的個人帳號登入。以下步驟只需要做一次。

### 1. 建立 Google Cloud 專案

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/)（用老闆平常的 Google 帳號登入即可，不用另外申請）
2. 左上角點專案下拉選單 → 「新增專案」
3. 專案名稱填 `yggbagle`（或任何好記的名字）→ 建立
4. 建立後，確認畫面上方切換到這個新專案

### 2. 啟用 Google Sheets API

1. 左側選單「API 和服務」→「程式庫」
2. 搜尋 `Google Sheets API`
3. 點進去 → 按「啟用」

### 3. 建立 Service Account

1. 左側選單「API 和服務」→「憑證」
2. 上方「建立憑證」→「服務帳戶」
3. 服務帳戶名稱填 `yggbagle-worker`，其他欄位可以留預設 → 「建立並繼續」
4. 「這個服務帳戶的存取權」這步可以直接跳過（點「繼續」）不用指定角色
5. 最後「完成」

### 4. 產生 JSON 金鑰

1. 在「憑證」頁面的「服務帳戶」清單，點剛建立的 `yggbagle-worker`
2. 上方分頁切到「金鑰」
3. 「新增金鑰」→「建立新的金鑰」→ 格式選 **JSON** → 建立
4. 瀏覽器會自動下載一個 `.json` 檔案，**這個檔案只會出現這一次，請妥善保存**（不要放進 Google 雲端硬碟公開資料夾、不要傳一般 LINE 群組）
5. 這個 JSON 檔裡有一個 `client_email` 欄位，格式類似：
   `yggbagle-worker@專案代號.iam.gserviceaccount.com`
   下一步要用到這個信箱

### 5. 把 Service Account 加到 Google Sheets 的共用權限

1. 打開 Phase 2 建好的那份 Google Sheets 試算表
2. 右上角「共用」
3. 貼上上一步的 `client_email` 信箱
4. 權限選 **編輯者**（因為 Worker 之後要寫入訂單，不能只給檢視者）
5. 取消勾選「通知使用者」（這是機器人帳號，不用寄信通知）→ 傳送/共用

### 6. 記下試算表 ID

打開 Google Sheets 網址，格式是：

```
https://docs.google.com/spreadsheets/d/【這一串就是試算表 ID】/edit
```

把 `/d/` 和 `/edit` 中間那一串記下來，等一下要填進 Worker 設定。

### 7. 決定老闆登入用的 PIN 跟簽章密鑰（Phase 3-5 新增）

老闆端的寫入 API（改商品、確認付款、改公告等）現在需要先用 PIN 登入才能用。這一步要決定兩組值，等一下會跟 `SPREADSHEET_ID` 一樣，用「秘密」類型存在 Cloudflare Dashboard：

- **`ADMIN_PIN`**：老闆登入用的 PIN 碼，自己想一組數字（例如 6 位數），不要用 `123456` 這種容易猜的
- **`TOKEN_SECRET`**：給 Worker 簽 Token 用的一長串亂碼，不是密碼、老闆不需要記得，只要夠長夠亂就好。可以用 [1Password 密碼產生器](https://1password.com/password-generator) 這類線上工具產生一組 32 個字元以上的隨機字串，或請開發者用終端機跑 `openssl rand -hex 32`

這兩個值只有 Worker 自己需要知道，不用寫進 Google Sheets、也不會有人看到，之後要換掉（例如 PIN 忘記或想換）直接回 Cloudflare Dashboard 改掉這個環境變數重新部署即可。

---

## 二、Worker 專案設定（開發者做，本檔案所在的 `worker/` 資料夾）

### 本機安裝與測試

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
```

編輯 `.dev.vars`，填入：
- `SPREADSHEET_ID`：上面第 6 步記下的試算表 ID
- `GOOGLE_SERVICE_ACCOUNT_KEY`：把下載的整個 JSON 檔內容貼成**一行**（貼上前用 JSON 格式化工具轉成單行，或直接 `cat 你的檔名.json | tr -d '\n'` 產生單行字串）
- `ADMIN_PIN`：上面第 7 步決定的登入 PIN（本機測試可以先隨便填一組，跟正式環境的值不用一樣）
- `TOKEN_SECRET`：上面第 7 步決定的簽章密鑰（本機測試一樣可以先隨便填一組亂碼）

啟動本機測試伺服器：

```bash
npm run dev
```

瀏覽器打開 `http://localhost:8787/api/test-sheets`，如果看到 `{"ok":true,"values":[...]}` 就代表 Service Account 授權成功、Worker 能讀到 Sheets 資料。

也可以打開 `http://localhost:8787/products`、`/campaigns`、`/orders` 測試 Phase 3-2 新增的讀取 API（見下方「讀取 API」章節）。

`POST /orders`（Phase 3-3 新增的建立訂單 API，見下方「寫入 API」章節）沒辦法用瀏覽器網址列直接測試，因為瀏覽器打開網址預設是 `GET`。開發時可以用終端機：

```bash
curl -X POST http://localhost:8787/orders \
  -H "Content-Type: application/json" \
  -d '{"campaign_id":"C001","customer_name":"測試","customer_phone":"0912345678","pickup_slot_id":"S001","items":[{"product_id":"P001","quantity":1}]}'
```

或用 [Postman](https://www.postman.com/) 這類圖形化工具（不用打指令，填表單即可）送出 POST 請求測試。

Phase 3-4 新增的 `PATCH` endpoint（`/products/:id`、`/orders/:id`、`/settings`）也一樣要用 curl 或 Postman 測試，瀏覽器網址列沒辦法送出 `PATCH` 請求。

Phase 3-5 開始，這些老闆專用的寫入 API（`POST /products`、`PATCH /products/:id`、`PATCH /orders/:id`、`PATCH /settings`）**還要多帶一個登入拿到的 token**，不然會收到 HTTP 401。先用 PIN 換 token：

```bash
curl -X POST http://localhost:8787/auth/login \
  -H "Content-Type: application/json" \
  -d '{"pin":"你設定的 ADMIN_PIN"}'
```

回應會有一個 `token`，把它帶在後續請求的 `Authorization` header：

```bash
curl -X PATCH http://localhost:8787/products/P001 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 剛剛拿到的 token" \
  -d '{"active": false}'
```

### 部署到 Cloudflare（正式環境）

#### 方法 A：不用終端機，全部在網頁上做（推薦給不熟終端機的人）

1. 打開 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers 和 Pages → 點進你已經建立好的那個 Worker
2. 「設定 → 變數與機密」確認 `SPREADSHEET_ID`、`GOOGLE_SERVICE_ACCOUNT_KEY` 都已經設定好，Phase 3-5 要再多加兩個「秘密」類型的環境變數：`ADMIN_PIN`、`TOKEN_SECRET`（值怎麼決定見上面「一、7. 決定老闆登入用的 PIN 跟簽章密鑰」）
3. 上方分頁切到「概觀」或「部署」，找到「編輯程式碼」（Edit code，有的介面也叫「快速編輯」Quick edit）按鈕並點進去，會打開一個網頁版的程式碼編輯器
4. 把編輯器裡原本的預設程式碼**整個刪掉**
5. 打開這個 repo 裡的 `worker/dashboard-single-file.js`，把整份內容複製、貼進編輯器
6. 按右上角「部署」（Deploy / Save and deploy）
7. 部署完，瀏覽器打開該 Worker 的網址加上 `/api/test-sheets`（Worker 網址可以在「概觀」頁複製，長得像 `https://ygg-hidden-star-9fe8.你的帳號.workers.dev`），確認看到 `{"ok":true,"values":[...]}`
8. 也可以打開網址加上 `/products`、`/campaigns`，確認看到 `{"ok":true,"products":[...]}` 這類回應（如果 Sheets 裡還沒有 status 是 `active` 的檔期，會回傳空陣列，這是正常的，先去 `Campaigns` 分頁把某個檔期的 `status` 改成 `active` 再測試看看）
9. `/orders`（GET）跟所有老闆專用的寫入 API 從 Phase 3-5 開始都需要登入 token，瀏覽器網址列沒辦法測，要用 curl 或 Postman（見下方「PIN 登入 API」章節）

之所以要用 `dashboard-single-file.js` 這份「整合版」而不是 `src/index.js`，是因為網頁版編輯器不像本機開發環境，沒辦法拆成多個檔案互相 `import`，所以把四個檔案的內容先合併成一份，貼上就能直接用。之後如果程式邏輯有改，也要記得同步更新這份檔案。

#### 方法 B：用終端機 + wrangler 指令（開發者/之後迭代用）

`wrangler.toml` 的 `name` 要跟 Dashboard 上這個 Worker 的名字完全一致（例如 `ygg-hidden-star-9fe8`），部署才會部署到「同一個」已經設好機密的 Worker，而不是另外建一個新的。因為機密已經在 Dashboard 設定好了，`wrangler.toml` 刻意沒有再宣告這兩個變數，避免部署時把 Dashboard 上設定好的值覆蓋掉。

```bash
npx wrangler login
npm run deploy
```

> 如果之後想改用指令設定機密（例如要輪替金鑰），可以用：
> ```bash
> npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY
> npx wrangler secret put SPREADSHEET_ID
> ```

## 商品大小規格／宅配運費（顧客介面改版新增，需要老闆手動改 Google Sheets）

顧客網站改版後多了「大小規格商品卡」跟「自取／宅配」流程，Worker 程式碼已經改好，但 **Google Sheets 上的欄位要老闆自己手動加**（Worker 沒有自動改表結構的功能）。以下是要加的欄位，**都加在每張表現有欄位的最右邊**，這樣才不會把 `訂單查詢`、`月報表` 分頁裡用欄位字母（例如 `Orders!C:C`）寫的公式對錯位置。

### `Products` 分頁：新增兩欄

在最後一欄（`active`）右邊，依序新增：

| 新欄位 | 說明 |
|---|---|
| `variant_group` | 同一組大/小規格的商品，這欄填一樣的值（例如兩顆商品都填 `V001`）；沒有大小規格的商品留空白 |
| `variant_label` | 顯示在商品卡上的規格文字，例如「大　5顆/袋」、「小　8顆/袋」；沒有大小規格的商品留空白 |

老闆後台的商品管理頁目前還沒有介面可以填這兩欄（PWA 要等 Phase 6 才會做），這次先直接在 Google Sheets 手動輸入，或用 `POST /products`／`PATCH /products/:id` 這兩支 API 帶 `variant_group`／`variant_label` 欄位設定（見下方「老闆端寫入 API」）。

### `Products` 分頁：再新增一欄（商品數量單位，中秋節禮盒改用「盒」時新增）

在 `variant_label` 右邊（也就是最後一欄）新增：

| 新欄位 | 說明 |
|---|---|
| `unit` | 這個商品的數量單位，顯示在商品卡的「NT$ xx / 單位」、「每人限購 x 單位」、後台商品列表跟限購超過的錯誤訊息裡。留空白時，前端跟 Worker 都會當作「袋」（沿用原本的預設值），舊商品不用補這一欄也不會壞 |

老闆後台商品管理頁的新增/編輯商品頁面已經有「數量單位」欄位可以直接填（不填預設「袋」），也可以用 `POST /products`／`PATCH /products/:id` 帶 `unit` 欄位設定。

### `Orders` 分頁：新增三欄

在最後一欄（`note`）右邊，依序新增：

| 新欄位 | 說明 |
|---|---|
| `delivery_method` | `pickup`（自取）或 `delivery`（宅配），`POST /orders` 建立訂單時會自動填 |
| `shipping_fee` | 這筆訂單實際收取的運費金額（自取是 0），`POST /orders` 會自動算好填入 |
| `delivery_address` | 宅配收件地址，自取訂單這欄是空白 |

這三欄都是 Worker 寫訂單時自動帶入，不用老闆手動填，但欄位標題列要先手動加好，不然 `POST /orders` 寫入時會對不到位置。

### `Settings` 分頁：新增一列資料

在 `Settings` 分頁（欄位是 `setting_key`／`setting_value`）新增一列：

| setting_key | setting_value |
|---|---|
| `shipping_fee` | 宅配運費金額（純數字，例如 `150`） |

可以直接在 Google Sheets 手動新增這一列，或用 `PATCH /settings` 帶 `{"shipping_fee": 150}` 讓 Worker 自動新增/更新（見下方「老闆端寫入 API」）。這個 key 沒有設定時，顧客網站的宅配運費會顯示 NT$0。

### 改完之後要檢查的地方

- `訂單查詢`、`月報表` 分頁如果是用「整欄」（例如 `Orders!C:C`）或固定欄位字母寫公式，加在最右邊的新欄位不會影響到既有公式；但如果公式裡有算「這一列到最後一欄」這種寫法，改完要重新打開檢查一下數字對不對
- `POST /products`、`POST /orders` 這兩支 API 是照欄位順序寫入 Sheets（不是照欄位名稱對應），**新欄位一定要加在最右邊**，不能插在中間，不然會寫錯欄位

## 檔期低庫存提示設定（需要老闆手動改 Google Sheets）

顧客測試時發現：檔期總量上限原本只有 `POST /orders` 送出訂單那一刻才會擋單，顧客選完一長串商品、填完姓名電話才發現已經額滿，體驗很差。第一版做法是「剩餘量偏低時，顯示給顧客看的數字刻意比實際剩餘量再保守一些」當緩衝，但這樣顯示的數字跟顧客實際能買到的數量不一致，考量到消費者保護法規上的疑慮，**改成如實顯示剩餘量，只在庫存偏低時額外加一句免責提示**：「目前庫存緊張，實際可以購買數量，以訂單明細為主」，固定顯示在顧客網站購物車列下方，不用彈窗打斷顧客。

### `Campaigns` 分頁：新增一欄

在最後一欄（`total_quantity_cap`）右邊新增：

| 新欄位 | 說明 |
|---|---|
| `low_stock_threshold` | 剩餘量低於多少開始顯示「庫存緊張」提示，留空或 0 代表不啟用（不顯示這個提示） |

老闆後台 PWA「預購檔期設定」頁面已經有這個欄位可以直接填（跟「總量上限」同一頁），不需要進 Google Sheets 操作；這裡列出來是給要手動核對 Sheets 資料，或用 `POST /campaigns`／`PATCH /campaigns/:campaign_id` API 直接帶欄位的人參考。

⚠️ 這欄沒加之前，`toNumber(c.low_stock_threshold)` 讀到的是 `undefined`（當作 0），效果等同「不啟用」，不會出錯，只是不會顯示低庫存提示——所以**沒有立刻加這欄不會壞掉任何現有功能**，想用這個功能的時候再加即可。

## 讀取 API（Phase 3-2）

三個 endpoint 都是 `GET`，不需要帶任何參數，回傳格式都是 `{"ok": true, ...}`；失敗時是 `{"ok": false, "error": "..."}`（HTTP 狀態碼會是 4xx/5xx）。

### `GET /campaigns`

回傳目前**還在預購中**的檔期，每個檔期底下帶著自己的取貨時段（`PickupSlots`）。

「還在預購中」＝ `status` 是 `active`，**而且**今天落在 `start_date`（預購起日）～`end_date`（預購結束日）之間（台北時區；`start_date` 當天就算開放，`end_date` 當天仍然算開放，隔天才會自動消失）。兩個日期只要空白就不看那一邊。老闆只要把起訖日設好，檔期會自動開放/關閉，不需要手動切換狀態；`status` 目前只剩 `active`/`ended` 兩種，`ended` 是老闆用「結束檔期」手動強制關閉，不管日期都不會再開放。這個判斷邏輯（`isCampaignOngoing()`）同時用在 `GET /products`、`POST /orders` 跟 `GET /settings` 的 `preorder_open_effective`。

`remaining_quantity`／`low_stock`（Phase 5 後續優化新增）：解決顧客測試時發現的問題——原本檔期總量上限只在最後 `POST /orders` 送出時才擋單，顧客選了半天商品、填完資料才發現已經額滿。現在 `GET /campaigns` 會即時算出剩餘量，前端數量選擇器直接用這個數字當上限，選超過就選不下去，不用等到送出才知道。

- `remaining_quantity`：檔期還剩多少可以訂，一律是**真實數字**（不會為了防同時搶購而刻意打折扣顯示），`total_quantity_cap` 沒設（0 或空白）時是 `null`（不限制）
- `low_stock`：布林值，`remaining_quantity` 是否已經低於 `Campaigns.low_stock_threshold`（低庫存門檻），前端用這個決定要不要在購物車列下方顯示「目前庫存緊張，實際可以購買數量，以訂單明細為主」的免責提示；`low_stock_threshold` 沒填就一律是 `false`，不顯示提示
- `low_stock_threshold` 是**檔期層級**的設定，跟 `total_quantity_cap` 一樣是整檔期共用一個門檻，不分商品/口味各自計算；老闆可以直接在後台 PWA「預購檔期設定」頁面設定，不用進 Google Sheets
- 因為顧客同時選購仍然有時間差，就算 `remaining_quantity` 是即時真實數字，還是可能出現「看到的時候還有、送出時已經被別人訂走」的情況；真正的把關永遠是 `POST /orders` 的總量檢查（見下方「檔期總量上限」），`remaining_quantity` 只是讓顧客提早知道、減少選到一半才被擋的機率

```json
{
  "ok": true,
  "campaigns": [
    {
      "campaign_id": "C001",
      "name": "8 月中秋預購",
      "status": "active",
      "start_date": "2026-08-10",
      "end_date": "2026-08-20",
      "total_quantity_cap": 200,
      "remaining_quantity": 5,
      "low_stock": true,
      "pickup_slots": [
        { "slot_id": "S001", "date": "2026-08-22", "time_range": "14:00-16:00" }
      ]
    }
  ]
}
```

### `GET /products`

回傳目前**還在預購中**的檔期（判斷方式見 `GET /campaigns`：`status` 是 `active` 且今天落在起訖日之間）、且上架中（`active` 勾選）的商品。`ordered_quantity` 是即時從 `Order_Items` 加總算出來的已訂購量（只算該商品所屬檔期、且訂單狀態不是 `cancelled` 的訂單），**不是**存在 Sheets 裡的欄位，延續 Phase 2 「不存彙總欄位」的原則。

`variant_group`／`variant_label` 是顧客介面改版新增的大小規格欄位（見下方「商品大小規格（`Products` 新增欄位）」），沒有設定時回傳空字串 `""`。`unit` 是商品的數量單位欄位，沒有設定時回傳空字串 `""`，前端會當作「袋」處理。

```json
{
  "ok": true,
  "products": [
    {
      "product_id": "P001",
      "campaign_id": "C001",
      "name": "原味貝果（無餡）",
      "category": "貝果",
      "price": 45,
      "max_per_order": 10,
      "ordered_quantity": 12,
      "variant_group": "",
      "variant_label": "",
      "unit": ""
    }
  ]
}
```

### `GET /settings`（Phase 4 新增）

公開讀取店家資料、公告、預購開關等設定值，給顧客網站用。回傳 `Settings` 分頁目前全部的 key-value（裡面沒有顧客個資，都是可以公開的店家資訊），但 `bank_name`/`bank_account`/`bank_owner`（已下架的匯款資訊，見下方說明）一律排除，就算 Sheets 裡還留著舊資料也不會回傳。

```json
{
  "ok": true,
  "settings": {
    "shop_name": "歪嘴雞烘焙",
    "shop_intro": "手工窯烤麵包，每週三、六限量預購。",
    "shop_line": "@ykjbakery",
    "shop_phone": "0912-345-678",
    "shop_address": "台中市西區美村路一段123號",
    "announcement_text": "本週六預購開放中！",
    "announcement_visible": "TRUE",
    "preorder_open": "TRUE",
    "pause_message": "目前暫停接單，恢復時間將於粉絲頁公告，謝謝您的支持！",
    "shipping_fee": "150",
    "has_ongoing_campaign": "TRUE",
    "preorder_open_effective": "TRUE"
  }
}
```

- 老闆用 `PATCH /settings`（需登入）改的值，這支馬上就會讀到最新的
- `announcement_visible`、`preorder_open` 是文字 `"TRUE"`/`"FALSE"`（跟 Sheets 資料驗證下拉選單的值一致），前端要自己轉成布林值判斷
- `has_ongoing_campaign`、`preorder_open_effective` 是**即時算出來的欄位，Sheets 裡沒有這兩列，也不能用 `PATCH /settings` 修改**：
  - `has_ongoing_campaign`：現在有沒有「還在預購中」的檔期（判斷方式見 `GET /campaigns`）。同時有多個檔期時，只要其中一個還沒結束就是 `TRUE`
  - `preorder_open_effective`：顧客實際能不能下單 ＝ `preorder_open`（老闆手動開關）**且** `has_ongoing_campaign`。檔期結束的隔天會自動變成 `FALSE`，下一個檔期開跑又自動變回 `TRUE`，老闆不用手動去撥開關；手動開關則保留「臨時暫停」的用途，關掉時一律以關掉為準
- `shipping_fee`（顧客介面改版新增）：宅配運費金額，沒有設定這個 key 時不會出現在回應裡，前端會當作 0

### `GET /orders`

> 🔒 **這支從 Phase 3-5 開始需要登入**（訂單裡有顧客姓名電話，不能公開），要帶 `Authorization: Bearer <token>`，見下方「PIN 登入 API」。

給老闆後台看的訂單列表，每張訂單帶著自己的品項明細（`Order_Items`），依 `created_at` 新到舊排序。這支目前沒有依 active 檔期過濾，回傳全部訂單。

```json
{
  "ok": true,
  "orders": [
    {
      "order_id": "ORD-20260812-0001",
      "campaign_id": "C001",
      "created_at": "2026-08-12T10:30:00+08:00",
      "customer_name": "王小明",
      "customer_phone": "0912345678",
      "pickup_slot_id": "S001",
      "delivery_method": "pickup",
      "shipping_fee": 0,
      "delivery_address": "",
      "total": 450,
      "payment_status": "pending",
      "order_status": "new",
      "note": "",
      "items": [
        { "product_id": "P001", "product_name": "原味貝果（無餡）", "unit_price": 45, "quantity": 10, "subtotal": 450 }
      ]
    }
  ]
}
```

`delivery_method`／`shipping_fee`／`delivery_address` 是顧客介面改版新增的欄位，`pickup_slot_id` 在宅配訂單會是空字串，`delivery_address` 在自取訂單會是空字串。

## 寫入 API（Phase 3-3）

### `POST /orders`

顧客下單用，建立一筆訂單（同時寫入 `Orders` 和 `Order_Items` 兩張表）。取貨方式分兩種，`delivery_method` 決定要帶哪些欄位：

**自取（`pickup`，或沒帶 `delivery_method` 時的預設值）**：

```json
{
  "campaign_id": "C001",
  "customer_name": "王小明",
  "customer_phone": "0912345678",
  "delivery_method": "pickup",
  "pickup_slot_id": "S001",
  "note": "麻煩切半",
  "items": [
    { "product_id": "P001", "quantity": 2 },
    { "product_id": "P002", "quantity": 1 }
  ]
}
```

**宅配（`delivery`）**：

```json
{
  "campaign_id": "C001",
  "customer_name": "王小明",
  "customer_phone": "0912345678",
  "delivery_method": "delivery",
  "delivery_address": "台中市西區美村路一段123號",
  "items": [
    { "product_id": "P001", "quantity": 2 }
  ]
}
```

- `campaign_id`、`customer_name`、`customer_phone`、`items` 一律必填，`items` 至少要有一筆，`note` 可省略
- `delivery_method` 是 `pickup` 時要帶 `pickup_slot_id`；是 `delivery` 時要帶非空白的 `delivery_address`；沒帶 `delivery_method` 時當作 `pickup`（保留舊版顧客端相容）
- 商品單價一律以 Sheets 上 `Products` 分頁當下的資料為準，**不採信前端傳來的價格**，避免被竄改
- 會檢查：檔期是否為 `active`、自取時段是否屬於這個檔期、商品是否存在／上架、單一商品數量是否超過該商品的 `max_per_order`
- **宅配運費**：`delivery_method` 是 `delivery` 時，一律從 `Settings.shipping_fee` 讀取金額加進 `total`，**不採信前端傳來的金額**，跟商品價格同一套防呆邏輯；自取訂單的運費是 0
- **檔期總量上限（`Campaigns.total_quantity_cap`，Phase 5 新增）**：把這個檔期所有「未取消」訂單的 `Order_Items` 數量加總，加上這筆新訂單要訂的數量，超過 `total_quantity_cap` 就擋下，回傳 HTTP 400。`total_quantity_cap` 是 0（或空白）代表不限制，不會做這項檢查
  - 擋下時的錯誤訊息會附上剩餘可訂數量，例如：`本檔期預購已達上限，剩餘 3 份，訂單需求 5 份，請減少數量後再試`；剩餘 0 份時顯示「本檔期預購已額滿，請等待下一檔期」
  - 這是「讀了再寫」的簡單檢查，不是原子鎖——跟訂單編號流水號一樣的取捨，極端情況下（幾乎同時送出兩張訂單）可能多接一兩份，老闆手動調整即可
  - 目前總量上限是「整個檔期共用一個上限」，不是每個取貨時段各自獨立算（`PickupSlots` 表沒有各時段自己的上限欄位）；大/小規格商品在 Sheets 裡本來就是不同 `product_id`、不同列，天生就各自獨立算，不受這次改動影響
- 訂單編號格式 `ORD-YYYYMMDD-XXXX`（西元年月日 + 當天流水號，從 `0001` 開始），日期以台北時區計算
- 這是簡單的「讀了再寫」（讀 `Orders` 找當天最大流水號 +1），不是原子操作——極端情況下（幾乎同時送出兩張訂單）理論上有極低機率撞號，跟總量控制走一樣的取捨（老闆手動處理即可），不做額外的鎖
- **防公式注入（Formula Injection，安全性修正）**：`customer_name`、`note`、`delivery_address` 這三個顧客自填欄位寫入 Google Sheets 前，會先用 `sanitizeForSheets()` 檢查開頭是不是 `=`、`+`、`-`、`@`，是的話比照 `customer_phone` 防止開頭 0 被吃掉的做法加上前導單引號 `'`，強制存成純文字。原因：Sheets API 是用 `USER_ENTERED` 模式寫入，儲存格開頭是這幾個字元會被解析成公式，顧客如果故意填 `=IMPORTXML(...)` 之類的內容，老闆之後打開 Google Sheets 就會被自動執行，可能外洩其他欄位資料或做釣魚連結。回傳給顧客自己看的訂單確認資料（`order` 物件）不受影響，維持顧客原本輸入的樣子。

**成功回應**（HTTP 201）：

```json
{
  "ok": true,
  "order": {
    "order_id": "ORD-20260812-0001",
    "campaign_id": "C001",
    "created_at": "2026-08-12T14:05:00+08:00",
    "customer_name": "王小明",
    "customer_phone": "0912345678",
    "pickup_slot_id": "",
    "delivery_method": "delivery",
    "shipping_fee": 150,
    "delivery_address": "台中市西區美村路一段123號",
    "total": 240,
    "payment_status": "pending",
    "order_status": "new",
    "note": "",
    "items": [
      { "product_id": "P001", "product_name": "原味貝果（無餡）", "unit_price": 45, "quantity": 2, "subtotal": 90 }
    ]
  }
}
```

`total` 是商品小計加運費的最終金額（前端可以直接用這個數字顯示，不用自己再加一次運費）；自取訂單的 `shipping_fee` 是 `0`、`delivery_address` 是空字串，宅配訂單的 `pickup_slot_id` 是空字串。

**失敗回應**（HTTP 400，例如檔期未開放、商品已下架、缺少 `delivery_address`、超過 `max_per_order`、超過檔期總量上限等）：

```json
{ "ok": false, "error": "此檔期目前未開放預購" }
```

```json
{ "ok": false, "error": "本檔期預購已結束，請等待下一檔期" }
```

```json
{ "ok": false, "error": "缺少必要欄位（delivery_address）" }
```

```json
{ "ok": false, "error": "本檔期預購已達上限，剩餘 3 份，訂單需求 5 份，請減少數量後再試" }
```

## 老闆端寫入 API（Phase 3-4）

> 🔒 **這四支 endpoint 從 Phase 3-5 開始都需要登入**，要先呼叫 `POST /auth/login` 拿 token，再帶 `Authorization: Bearer <token>` 呼叫這些 endpoint，見下方「PIN 登入 API」章節。沒帶或 token 過期會收到 HTTP 401。

### `POST /products`

新增商品。

```json
{
  "campaign_id": "C001",
  "name": "抹茶紅豆貝果（有餡）",
  "category": "貝果",
  "price": 55,
  "max_per_order": 5,
  "active": true,
  "variant_group": "V001",
  "variant_label": "大　5顆/袋",
  "unit": "袋"
}
```

- `campaign_id`、`name` 為必填，其他欄位可省略（`active` 預設 `true`）
- `variant_group`／`variant_label`（顧客介面改版新增）：同一組大/小規格的商品要填一樣的 `variant_group`，`variant_label` 是顯示在卡片上的規格文字（例如「大　5顆/袋」）；沒有大小規格的單一商品不用帶這兩個欄位
- `unit`：這個商品的數量單位，不帶或帶空字串時，前端跟錯誤訊息一律當作「袋」
- 商品編號自動產生，格式 `P001`、`P002`...，取現有商品裡最大編號 +1（不分檔期，跨檔期共用同一組編號）
- 成功回傳 HTTP 201，內容跟 `GET /products` 裡單筆商品的格式一樣（多一個 `product_id`）

### `PATCH /products/:product_id`

編輯商品，例如上下架切換、改價格、設定大小規格。只有請求裡帶到的欄位會被更新，其他欄位維持原樣。

```json
{ "active": false }
```

```json
{ "price": 50, "max_per_order": 8 }
```

```json
{ "variant_group": "V001", "variant_label": "小　8顆/袋" }
```

```json
{ "unit": "盒" }
```

- 找不到該 `product_id` 回 HTTP 404
- 成功回傳更新後的完整商品內容

### `PATCH /orders/:order_id`

老闆核對付款截圖後標記付款狀態、更新訂單狀態（4 段：`new` → `prepping_done` → `picked_up`，或 `cancelled`）、改備註。三個欄位都可選，至少要帶一個。

```json
{ "payment_status": "confirmed" }
```

```json
{ "order_status": "prepping_done" }
```

- `payment_status` 只能是 `pending` 或 `confirmed`；`order_status` 只能是 `new`、`prepping_done`、`picked_up`、`cancelled`，帶了不在清單內的值會回 HTTP 400
- 找不到該 `order_id` 回 HTTP 404
- 成功回傳更新後的訂單內容，含 `delivery_method`／`shipping_fee`／`delivery_address`（這支目前不能改這三個欄位，只能在下單當下由 `POST /orders` 決定，這裡只是原樣回傳），不含 `items`，品項明細請用 `GET /orders`

### `DELETE /orders/:order_id`（Phase 6 新增）

永久刪除一筆訂單，連同它在 `Order_Items` 的品項明細一起刪掉。跟「取消訂單」（`PATCH order_status=cancelled`，資料還留著只是改狀態）不一樣，這支是真的把 Google Sheets 上的列拿掉，用在測試訂單、輸入錯誤等要徹底移除的情況，**刪除後無法復原**。找不到該 `order_id` 回 HTTP 404，成功回傳 `{ "ok": true }`。

### `PATCH /settings`

改公告、開關預購、改店家資料等單一設定值。`Settings` 分頁是 key-value 格式，欄位是 **`setting_key`、`setting_value`**（已對照過 Phase 2 實際建好的 Sheets），這支可以一次更新多組 key，Sheets 裡已經有的 key 會更新該列，沒有的話會新增一列（upsert）。

目前 `Settings` 分頁裡已經有的 key：

| setting_key | 用途 |
|---|---|
| `shop_name` | 店家名稱 |
| `shop_intro` | 店家簡介 |
| `shop_line` | LINE 官方帳號 |
| `shop_phone` | 店家電話 |
| `shop_address` | 店家地址 |
| `announcement_text` | 公告文字 |
| `announcement_visible` | 公告是否顯示（`TRUE`/`FALSE`） |
| `preorder_open` | 預購開關（`TRUE`/`FALSE`），老闆手動的臨時暫停開關；顧客端實際狀態還要看有沒有進行中的檔期，見 `GET /settings` 的 `preorder_open_effective` |
| `pause_message` | 預購暫停時顯示的訊息 |
| `shipping_fee` | 宅配運費金額（純數字，例如 `150`），顧客介面改版新增 |

```json
{
  "announcement_text": "本週六預購開放中！",
  "preorder_open": "TRUE"
}
```

- 因為是 upsert，key 打錯字不會報錯、只會在 Sheets 裡多一列新的設定，要小心拼字——盡量用上表已經有的 key，不要自己發明新的
- `bank_name`/`bank_account`/`bank_owner`（匯款銀行/帳號/戶名）已下架（資安/防詐考量），不要再用 `PATCH /settings` 寫入這幾個 key；`GET /settings` 也已經把它們排除在回傳之外

## 老闆後台專用讀取／檔期管理 API（Phase 6 新增）

老闆 PWA 這次串接真實 API，發現公開的 `GET /products`、`GET /campaigns` 只回傳「目前 active 檔期、上架中商品」，老闆商品管理頁／檔期設定頁需要看到全部資料（含已下架商品、已結束檔期），所以新增以下 endpoint，都需要登入（`Authorization: Bearer <token>`）。

### `GET /admin/products`

回傳**所有**商品，不篩選檔期狀態或上下架，格式跟 `GET /products` 一樣，多一個 `active` 欄位（布林值）。

```json
{
  "ok": true,
  "products": [
    {
      "product_id": "P001",
      "campaign_id": "C001",
      "name": "原味貝果（無餡）",
      "category": "貝果",
      "price": 45,
      "max_per_order": 10,
      "active": true,
      "ordered_quantity": 12,
      "variant_group": "",
      "variant_label": "",
      "unit": ""
    }
  ]
}
```

### `DELETE /products/:product_id`

刪除商品。過去訂單的品項是存快照（`product_name_snapshot` 等），不會因為商品被刪除而受影響，所以這支不檢查商品有沒有被訂購過。找不到該 `product_id` 回 HTTP 404，成功回傳 `{ "ok": true }`。

### `GET /admin/campaigns`

回傳**所有**檔期（不分 `active`/`ended`），格式跟 `GET /campaigns` 一樣。

### `POST /campaigns`

新增檔期，可以一次帶取貨時段陣列一起建立。

```json
{
  "name": "8月第4週檔期",
  "start_date": "2026-08-17",
  "end_date": "2026-08-21",
  "total_quantity_cap": 120,
  "low_stock_threshold": 10,
  "status": "active",
  "pickup_slots": [
    { "date": "2026-08-23", "time_range": "14:00-18:00" }
  ],
  "copy_products_from_campaign_id": "C003"
}
```

- `name` 為必填，其他欄位可省略（`status` 預設 `active`，必須是 `active`/`ended` 其中之一，`pickup_slots` 預設空陣列，`low_stock_threshold` 預設 0＝不顯示低庫存提示）；檔期建立後能不能被顧客看到，完全由 `start_date`/`end_date` 自動判斷，不需要另外的「即將開始」狀態
- 檔期編號自動產生，格式 `C001`、`C002`...；取貨時段編號 `S001`、`S002`...（不分檔期共用同一組編號，跟商品編號的做法一樣）
- `copy_products_from_campaign_id`（選填，老闆後台 PWA「沿用上一檔商品清單」功能用）：帶了的話，會把該檔期底下的所有商品**整批複製**成新檔期底下的新商品（新的 `product_id`，其他欄位——名稱/分類/價格/單筆上限/上下架/大小規格——照抄）。這支店家品項固定，開新檔期不用每次重新輸入 40 個商品，之後在「商品管理」個別調整即可
- 成功回傳 HTTP 201，內容含 `pickup_slots`（帶著自動產生的 `slot_id`）和 `copied_product_count`（這次複製了幾筆商品，沒有帶 `copy_products_from_campaign_id` 就是 `0`）

### `PATCH /campaigns/:campaign_id`

編輯檔期，只更新有帶到的欄位。

```json
{ "status": "active" }
```

```json
{
  "name": "8月第4週檔期（延後一週）",
  "pickup_slots": [
    { "date": "2026-08-30", "time_range": "14:00-18:00" }
  ]
}
```

- 如果請求裡帶了 `pickup_slots`（陣列，可以是空陣列 `[]`），這個檔期原本的取貨時段會**全部刪掉、換成新清單**（整批覆蓋，不是逐筆增刪）；沒帶這個欄位就不動取貨時段
- 找不到該 `campaign_id` 回 HTTP 404，成功回傳更新後的完整檔期內容（含 `pickup_slots`）

### `DELETE /campaigns/:campaign_id`

刪除檔期（含底下的取貨時段、商品），**只有這個檔期完全沒有任何訂單時才能刪除**（不分訂單狀態，取消的訂單也算）。有訂單的檔期請改用 `PATCH` 把 `status` 改成 `ended`（結束檔期）。

> ⚠️ 這裡會把該檔期底下的 `Products` 一併刪除，避免變成孤兒資料：新檔期編號是「目前 `Campaigns` 表最大編號 +1」算出來的，如果刪除檔期時沒清乾淨底下的商品，之後新建的檔期編號被重複使用時，舊商品就會「借屍還魂」跑進新檔期裡（PR 修正前實際發生過）。

擋下時回 HTTP 400：

```json
{ "ok": false, "error": "此檔期已有訂單，無法刪除，請改用「結束檔期」（PATCH status 改成 ended）" }
```

找不到該 `campaign_id` 回 HTTP 404，成功回傳 `{ "ok": true }`。

## PIN 登入 API（Phase 3-5）

### `POST /auth/login`

老闆輸入 PIN，換一支短期 token，之後打老闆專用的 API（`GET /orders`、`POST /products`、`PATCH /products/:id`、`PATCH /orders/:id`、`PATCH /settings`）都要帶著這支 token。

```json
{ "pin": "123456" }
```

**成功回應**：

```json
{
  "ok": true,
  "token": "eyJleHAiOjE3MjM0NTY3ODl9.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "expires_at": 1723456789
}
```

- `token` 有效期 **12 小時**，過期後這些 API 會回 HTTP 401，要重新登入拿新的 token
- `expires_at` 是到期時間（unix 秒數），前端可以用這個提早提醒老闆快過期了，或直接等收到 401 再導回登入畫面都可以
- PIN 錯誤回 HTTP 401：`{ "ok": false, "error": "PIN 錯誤" }`
- Worker 還沒設定 `ADMIN_PIN`／`TOKEN_SECRET` 這兩個環境變數的話會回 HTTP 500，提醒要先去 Cloudflare Dashboard 設定
- **防暴力破解（安全性修正）**：連續猜錯 5 次，會鎖定 15 分鐘不能再嘗試（不管這期間 PIN 對不對都直接回 HTTP 429 `{ "ok": false, "error": "登入嘗試次數過多，請於 X 分鐘後再試" }`），鎖定時間到了才能再試。原因：`/auth/login` 是公開端點，PIN 只有 6 位數字（100 萬種組合），如果沒有這道防線，攻擊者可以寫程式無限次嘗試，猜中就能拿到完整的老闆權限（讀顧客個資、改商品/訂單/設定）。因為專案不用 D1/KV，失敗次數跟鎖定到期時間是借用既有的 `Settings` 分頁存（`login_fail_count`、`login_locked_until` 這兩個 key），跟訂單編號流水號一樣是「讀了再寫」的簡單做法，不是原子鎖，極端情況下可能少算一兩次失敗次數，但不影響防護效果（重點是把暴力破解時間拉長到不可行）。這兩個 key 只有內部使用，`GET /settings` 不會回傳給顧客端。**因為只有老闆一個人會登入，鎖定期間老闆自己也會被擋**，如果不小心連續打錯密碼，等 15 分鐘或請老闆自己去 Google Sheets 的 `Settings` 分頁把這兩個 key 的值清空/歸零就能立刻解鎖

**呼叫需要登入的 API**，把拿到的 token 放進 `Authorization` header：

```
Authorization: Bearer eyJleHAiOjE3MjM0NTY3ODl9.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

沒帶、格式錯、或 token 過期都會收到：

```json
{ "ok": false, "error": "請先用 PIN 登入（POST /auth/login），並在 Authorization: Bearer <token> 帶上拿到的 token" }
```

（HTTP 401）

### 這支 token 是怎麼運作的

Token 是 Worker 自己用 `TOKEN_SECRET` 簽出來的一串「到期時間 + HMAC-SHA256 簽章」，不是存在 Google Sheets 或任何資料庫裡的 session——這樣才不用額外的 D1/KV，Worker 收到請求時純算術驗證簽章對不對、有沒有過期即可。也因為這樣，**目前沒有「登出」或「強制某支 token 失效」的功能**：token 一旦發出去，在 12 小時內都有效，直到自然過期為止。如果要提早讓某支 token 失效（例如懷疑外流），目前唯一的辦法是去 Cloudflare Dashboard 換掉 `TOKEN_SECRET` 重新部署，這樣所有舊 token（包含老闆自己手機上還沒過期的）都會一起失效，要重新登入。這個取捨對一人小商家來說夠用，先不做更複雜的機制。

## 檔案結構

- `wrangler.toml`：Worker 設定（名稱、非機密環境變數）
- `src/index.js`：Worker 進入點，包含讀取 API（`/api/test-sheets`、`/products`、`/campaigns`、`/settings`、`/orders` 的 GET、`/admin/products`、`/admin/campaigns`）、寫入 API（`POST /orders`、`POST /products`、`PATCH /products/:id`、`DELETE /products/:id`、`POST /campaigns`、`PATCH /campaigns/:id`、`DELETE /campaigns/:id`、`PATCH /orders/:id`、`DELETE /orders/:id`、`PATCH /settings`），以及 `POST /auth/login` PIN 登入
- `src/auth.js`：老闆登入用的短期 token 簽發與驗證（HMAC-SHA256，純 Web Crypto API，無額外套件、不需要 D1/KV）
- `src/googleAuth.js`：用 Service Account JSON 金鑰換 Google API access token（RS256 JWT 簽章，純 Web Crypto API，無額外套件）
- `src/sheets.js`：呼叫 Google Sheets API 讀寫資料——`getSheetRows` 把整張表轉成物件陣列、`getRowsWithNumbers` 是同一件事但每筆多帶 Sheets 上的實際列號、`appendRows` 附加新列、`findRowByKey` 依欄位值找到某一列、`updateRow` 覆寫指定列、`deleteRows` 刪除指定的多列（Phase 6 新增，給檔期／商品刪除用）
- `.dev.vars.example`：本機測試環境變數範本（`.dev.vars` 本身已加進 `.gitignore`，不會被 commit）
- `dashboard-single-file.js`：合併版程式碼，專門給不用終端機、直接在 Cloudflare Dashboard 網頁編輯器貼上部署用

## 下一步

- Phase 6：老闆後台 PWA 已從假資料改成真的串接這裡的所有 API，包含 `POST /auth/login`、商品大小規格設定（`variant_group`／`variant_label`）、訂單的取貨方式／運費／宅配地址顯示、檔期管理（新增 `/campaigns`、`/admin/campaigns`、`/admin/products` 系列 API）
- **這次新增的 admin API 還沒部署**：要記得把更新後的 `dashboard-single-file.js` 貼到 Cloudflare Dashboard 網頁編輯器重新部署，PWA 才能正常運作（見上方「部署到 Cloudflare」章節）
