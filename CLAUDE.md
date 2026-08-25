# 🍞 歪嘴雞烘焙預購系統｜分階段開發任務卡

## 目前進度

- ✅ Phase 0：老闆 PWA 資訊架構 + Wireframe（已完成，8 頁全部定案）
- ✅ Phase 1：假資料版 PWA（已完成，已併入 main，PR #2）
- ✅ Phase 2：Google Sheets 資料表設計（已完成，表已建到 Google 雲端空間）
- ✅ Phase 3-1：Worker 專案初始化 + Google Sheets API 授權設定（已完成，見下方備註）
- ✅ Phase 3-2：讀取 API（已完成，見下方備註）
- ✅ Phase 3-3：寫入 API（已完成，見下方備註）
- ✅ Phase 3-4：老闆端寫入 API（已完成，見下方備註）
- ✅ Phase 3-5：PIN 登入 + 短期 Token 驗證機制（已完成，見下方備註，**Phase 3 全部完成**）
- ✅ Phase 4：顧客預購網站前端（已完成，見下方備註）
- ✅ Phase 5：預購總量上限控制邏輯（已完成，見下方備註）
- ✅ 顧客介面改版（前端 + 後端都已完成，見下方備註）：品牌識別區、購物車列固定在上方、
  分類頁籤、大/小規格商品卡、自取／宅配步驟等，已併入 main（PR #13）
- ✅ Phase 6：老闆後台 PWA 串接真實 Worker API（已完成，見下方備註）——商品管理頁已支援
  設定大小規格（`variant_group`/`variant_label`），訂單列表/詳情頁已顯示取貨方式/運費/
  宅配地址，PIN 登入、四段訂單狀態、確認付款、永久刪除訂單都可正常使用，已併入 main（PR #14）
- ✅ Phase 6 併入後陸續完成一連串顧客網站／PWA 小修正與體驗優化（見下方「近期優化備註」），
  每項都各自開 PR 併入 main（PR #15～#33），包含：LINE 好友連結、購物車列/品牌識別區固定
  顯示的多輪 bug 修正、後台訂單即時更新（不快取）、新增檔期一鍵沿用上一檔商品清單、完成頁
  排版與訂購明細多次調整、公告文字置中、步驟頁捲動被固定區塊蓋住的 bug（兩輪修正）、完成頁
  付款方式提示、大小規格商品品項名稱放大置中、電話號碼格式驗證、訂單摘要頁與完成頁補上
  訂購人資料供核對、「上一步」改做成按鈕固定在購物車列
- ✅ 又陸續完成四個小修正（PR #35～#38，見下方「近期優化備註」）：顧客網站購物車摘要列跟
  步驟標題間距太近、跳步驟自動捲動沒把新間距算進去、訂單電話號碼開頭 0 被 Google Sheets
  吃掉、老闆後台 PWA 在電腦瀏覽器上被拉成全螢幕寬度
- ✅ 顧客網站宅配加上「僅限台灣本島」提示（見下方「近期優化備註」，PR #40）：選取貨方式
  按鈕文字、地址欄位下方提示、填地址時偵測離島關鍵字跳警示彈窗（可選「取消」或「開啟
  LINE 聯絡老闆」）
- ✅ 修正顧客網站最上方固定區塊捲動時會滑動的問題（見下方「近期優化備註」，PR #42 + #43）：
  真正的根因是 `#app` 的 `padding-top` 讓 sticky 元素的「自然位置」比「卡住的位置」低
  16px，捲動時一定會先跑完這 16px 才鎖住（PR #43 才修對；PR #42 當時誤判成 JS 的問題）
- ✅ 接著修好「選商品」步驟標題被分類頁籤蓋住的問題（見下方「近期優化備註」，PR #44）：
  `.step` 的 `scroll-margin-top` 漏算分類頁籤高度，新增 `--tabs-h` 變數補上
- ✅ 又修好「購物車是空的」時同一個標題被分類頁籤蓋住的另一種情況（見下方「近期優化
  備註」，PR #45）：`.tabs` 的負 `margin-top` 沒考慮到購物車列隱藏時沒有 `margin-bottom`
  可抵銷
- ✅ 預購檔期結束後，老闆後台的預購狀態會自動關閉，不用再手動撥開關（見下方「近期優化
  備註」，PR #48）：判斷方式改成「手動開關是開的 **而且** 至少有一個檔期還在預購中」，
  同時有多個檔期時只要一檔還沒結束就維持開放
- ✅ 顧客網站完成頁「複製文字明細」按鈕補上備註內容（見下方「近期優化備註」，PR #51）：
  之前複製出來的文字沒有帶備註，顧客貼給老闆的訊息裡看不到備註
- ✅ 檔期預購起訖日改成完全自動判斷、拿掉手動的「即將開始」狀態（見下方「近期優化備註」，
  PR #53）：老闆確認改用官方 LINE 通知顧客新檔期，設定好起訖日就會自動開放/關閉，不用
  再手動切換檔期狀態；顧客網站「目前沒有開放中的預購檔期」的文字也改成引導加官方 LINE
- ✅ Worker API 安全性修正（見下方「近期優化備註」，PR #57）：老闆主動要求跑一次
  `/security-review`，抓出並修好兩個漏洞——`POST /orders` 的 Formula Injection（顧客姓名/
  備註/宅配地址寫入 Google Sheets 前先跳脫公式觸發字元）、`POST /auth/login` 的 PIN 防暴力
  破解節流（連續猜錯 5 次鎖定 15 分鐘）
- ✅ 拿掉店家匯款資訊（見下方「近期優化備註」，PR #60）：資安/防詐考量，顧客網站完成頁
  拿掉「請匯款至」帳戶卡片、老闆後台店家資料頁拿掉匯款資訊三個欄位，Worker 公開的
  `GET /settings` 也把 `bank_name`/`bank_account`/`bank_owner` 排除在回傳之外，就算
  Sheets 裡還留著舊資料也不會外洩
- ✅ 完成頁文案調整，引導客人透過 LINE 跟老闆確認訂單及付款方式（見下方「近期優化備註」，
  PR #61）：付款這個步驟改成統一由老闆透過 LINE 跟顧客確認處理（帳戶資訊不公開顯示在
  網站上，改由老闆私下透過 LINE 提供），付款方式清單重新加回「匯款」選項
- ✅ 新增檔期低庫存提示，解決顧客測試回報「訂購超過上限要填到結帳才會知道」的問題
  （見下方「近期優化備註」，PR #62 + #63）：`GET /campaigns` 即時算出真實剩餘量，顧客
  網站數量選擇器直接卡在這個上限；剩餘量偏低時購物車列下方會顯示「目前庫存緊張，實際
  可以購買數量，以訂單明細為主」的免責提示，真正的把關仍在 `POST /orders`。**PR #62
  原本的做法是剩餘量偏低時刻意打折顯示（緩衝）+ 跳一次性彈窗，後來考量消費者保護法規
  疑慮，PR #63 改成如實顯示真實剩餘量、拿掉彈窗，只保留購物車列下方的常駐免責提示**
- ✅ Phase 7：部署 + 網域設定（已完成）——業主買好 Cloudflare 網域 `yjg-bakery.com`，三個網站
  分別建立獨立的 Cloudflare Pages/Workers 專案（Git 連結 `main` 分支自動部署，靜態資源用
  `wrangler.toml` 的 `[assets]` 設定），掛上正式子網域：
  - `yjg-bakery.com`（含 `www.` 自動轉址）→ 首頁，`abspbt/yjg-bakery` repo 根目錄
  - `order.yjg-bakery.com` → 顧客訂購網站，`abspbt/yjg-order` repo 的 `site/` 資料夾
  - `bakerhsu.yjg-bakery.com` → 老闆後台 PWA，`abspbt/yjg-order` repo 根目錄（原本暫時掛在
    GitHub Pages 的 `https://abspbt.github.io/yjg-order/` 已停用，改用這個正式網址）
  三個網址都已用手機（行動網路）實測：完整下單流程正常、訂單有寫進 Google Sheets、
  老闆後台 PIN 登入與訂單列表正常、PWA 重新加到主畫面正常。
  - Cloudflare 目前已經把 Pages 併入 Workers，「連結到 Git」的部署介面改用 `wrangler.toml`
    的 `[assets]` 設定描述靜態資源目錄，不是舊版 Pages 的「建置輸出目錄」欄位；
    `yjg-order` repo 新增了 `wrangler.toml`（根目錄，PWA 用）跟 `site/wrangler.toml`
    （顧客網站用），跟 `worker/wrangler.toml`（真正的 API Worker，用網頁編輯器貼
    `dashboard-single-file.js` 部署）完全獨立、互不影響；`yjg-bakery` repo 也比照新增了
    根目錄 `wrangler.toml`
  - `yjg-bakery` repo 各頁面的 `canonical`、`sitemap.xml`、`robots.txt` 已經把絕對網址從
    暫用的 GitHub Pages 網址換成正式網域 `https://yjg-bakery.com/`；之後需要另外去 Google
    Search Console 用新網域重新驗證、重新提交 sitemap（不急，網站穩定後再處理即可）
  - `www.yjg-bakery.com` 用 Cloudflare 的「重新導向規則」範本（從 WWW 重新導向轉接到根）
    設定 301 轉址到 `yjg-bakery.com`，因為 www 子網域原本沒有 DNS 記錄，套用範本時額外
    建立了一筆 A 記錄指到保留位址 `192.0.2.1`（僅用來讓流量經過 Cloudflare Proxy 觸發
    轉址規則，實際上不會真的連到這個 IP）
  - 三個 Worker 的 `*.workers.dev` 測試網址目前都顯示「已停用」，這是 Cloudflare 現在的
    預設行為（避免測試用網址被公開索引/存取），不影響正式的自訂網域，不用特別處理
  - `bagel-order`/`cake-order` 頁目前只有 LINE 好友連結，還沒有連到 `order.yjg-bakery.com`
    這個正式訂購網址，要不要加上、怎麼加，之後可以另外討論

**Phase 3-1 備註**：
- 已建立 Google Cloud Service Account，金鑰以「秘密」類型設定在 Cloudflare Dashboard 的 Worker 環境變數（`SPREADSHEET_ID`、`GOOGLE_SERVICE_ACCOUNT_KEY`），沒有寫進程式碼或 repo
- Worker 名稱：`ygg-hidden-star-9fe8`（Cloudflare 自動命名，`worker/wrangler.toml` 已同步）
- 測試 endpoint `/api/test-sheets` 已驗證能透過 Service Account 讀到 Google Sheets 資料
- 踩過的坑：Phase 2 的試算表原本是以 `.xlsx` 檔案上傳到 Google 雲端硬碟，Sheets API 不支援讀寫 Office 檔案格式，後來用「另存為 Google 試算表」轉成原生 Google Sheets 格式，換了新的 `SPREADSHEET_ID` 才能讀取成功
- **老闆不熟悉終端機下指令**，之後的部署都優先用 Cloudflare Dashboard 網頁編輯器操作（`worker/dashboard-single-file.js` 是專門給網頁編輯器貼上用的合併版程式碼），除非必要盡量避免要求在終端機執行指令

**Phase 3-2 備註**：
- 新增三支讀取 API：`GET /campaigns`（目前 active 檔期 + 取貨時段）、`GET /products`（active 檔期上架中商品，已訂購量即時從 `Order_Items` 加總）、`GET /orders`（訂單列表 + 每筆訂單的品項明細）
- 延續 Phase 2 設計原則：已訂購量不存彙總欄位，Worker 讀取時即時從 `Order_Items` 加總算出
- `worker/src/sheets.js` 新增 `getSheetRows()`，把整張表轉成「第一列是欄位名稱」的物件陣列，之後的 API 都靠這個讀資料
- 加了 CORS header，因為之後 Phase 4/6 前端會從別的網域打這個 Worker
- `worker/dashboard-single-file.js` 已同步更新，API 細節與範例回應格式見 `worker/README.md`
- 開發這次時發現 Phase 3-1 分支當時還沒併入 main，已在 `claude/phase-3-2-api-read-0rkozk` 分支裡先合併進來——**併 PR 時要注意，如果 Phase 3-1 有獨立的 PR 還沒關掉，這邊會重複收錄**

**Phase 3-3 備註**：
- 新增 `POST /orders`：顧客下單，同時寫入 `Orders` + `Order_Items` 兩張表
- 商品單價一律以 Sheets 上 `Products` 分頁當下資料為準，不採信前端傳來的價格，避免被竄改
- 會檢查檔期是否 active、取貨時段是否屬於該檔期、單一商品是否超過 `max_per_order`；**檔期/時段總量上限（`total_quantity_cap`）的檢查刻意留給 Phase 5**，這支目前不會擋超賣
- 訂單編號格式 `ORD-YYYYMMDD-XXXX`（台北時區日期 + 當天流水號），用「讀了再寫」算下一個流水號，不做原子鎖——跟 Phase 5 總量控制走一樣的取捨（極端情況下可能撞號，機率很低，先接受這個風險，之後真的常常發生的話再回頭處理）
- `worker/src/sheets.js` 新增 `appendRows()` 寫入輔助函式
- API 細節、請求/回應範例、curl 測試方法見 `worker/README.md`

**Phase 3-4 備註**：
- 新增四支老闆端寫入 API：`POST /products`（新增商品，自動產生 `P001`、`P002`... 編號）、`PATCH /products/:id`（編輯商品，只更新有帶到的欄位）、`PATCH /orders/:id`（確認付款狀態、更新訂單 4 段狀態、改備註）、`PATCH /settings`（改公告/開關預購/店家資料，key-value upsert）
- **⚠️ 這四支目前完全沒有登入驗證，誰都能打**，程式碼跟 README 都有標註，Phase 3-5 要記得補上
- `Settings` 分頁實際欄位是 `setting_key`/`setting_value`（不是原本猜的 `key`/`value`，已經跟老闆核對過 Sheets 實際內容修正），已有的 key 清單（`shop_name`、`shop_intro`、`shop_line`、`shop_phone`、`shop_address`、`bank_name`、`bank_account`、`bank_owner`、`announcement_text`、`announcement_visible`、`preorder_open`、`pause_message`）列在 `worker/README.md`
- `worker/src/sheets.js` 新增 `findRowByKey()`（依欄位值找到某一列）、`updateRow()`（覆寫指定列）兩個輔助函式
- API 細節、請求/回應範例、curl/Postman 測試方法見 `worker/README.md`

**Phase 3-5 備註**：
- 新增 `POST /auth/login`：老闆輸入 PIN 換一支短期 token（有效 12 小時），HMAC-SHA256 簽章，不用 D1/KV 存 session——token 本身帶著到期時間，Worker 只要驗簽章+檢查有沒有過期
- 新增兩個 Cloudflare 秘密環境變數：`ADMIN_PIN`（登入 PIN）、`TOKEN_SECRET`（簽章密鑰），做法比照 `SPREADSHEET_ID`，不寫進 repo
- 上鎖的 endpoint：`GET /orders`（含顧客個資）、`POST /products`、`PATCH /products/:id`、`PATCH /orders/:id`、`PATCH /settings`，都要帶 `Authorization: Bearer <token>`，沒帶/過期回 HTTP 401
- 保持公開（顧客前台之後要用）：`GET /products`、`GET /campaigns`、`POST /orders`
- **目前沒有登出／強制某支 token 失效的機制**，token 一旦發出去 12 小時內都有效；要提早讓所有 token 失效只能去 Cloudflare Dashboard 換掉 `TOKEN_SECRET` 重新部署（這樣連老闆自己手機上還沒過期的 token 也會一起失效，要重新登入）——這個取捨對一人小商家先夠用
- 新增 `worker/src/auth.js` 模組，內部的 base64url 輔助函式改名成 `tokenBase64url`/`tokenBase64urlToBytes`，避免跟 `googleAuth.js` 的同名函式在 `dashboard-single-file.js` 合併時撞名
- API 細節、登入流程、token 運作方式見 `worker/README.md`
- **Phase 3（Cloudflare Worker API）到這裡全部做完**：3-1 授權設定、3-2 讀取 API、3-3 顧客下單寫入、3-4 老闆端寫入、3-5 PIN 登入驗證

**Phase 4 備註**：
- 新增 `site/` 目錄：純前端單頁式顧客預購網站（無框架、無建置流程），流程為 公告 → 選商品（含數量選擇器）→ 選取貨時段 → 填姓名電話 → 確認訂單摘要 → 送出 → 顯示訂單編號 + 匯款資訊 + LINE 連結
- 只串接公開 API：`GET /campaigns`、`GET /products`、`POST /orders`，不需要登入
- 開發過程中發現 Worker 少一支公開的 `GET /settings`（顧客網站要讀公告、匯款資訊、預購開關才需要），已補上這支（`worker/src/index.js`、`worker/dashboard-single-file.js`、`worker/README.md` 同步更新），已部署並實測正常
- 順手修了一個小 bug：Worker 的 JSON 回應沒有明確標註 `charset=utf-8`，導致直接用瀏覽器打開 API 網址時 Safari 會把中文顯示成亂碼（用程式串接不受影響），已修正
- 已在本機用瀏覽器打開 `site/index.html` 實際測試過完整下單流程，操作順暢
- 目前還沒部署到 Cloudflare Pages，正式上線的網域設定留給 Phase 7；畫面/文字之後想再調整，隨時都可以，不用等整個專案做完

**Phase 5 備註**：
- `POST /orders` 新增檔期總量檢查：把該檔期所有「未取消」訂單的 `Order_Items` 數量加總，加上這筆新訂單要訂的數量，超過 `Campaigns.total_quantity_cap` 就擋下，回傳 HTTP 400（例如「本檔期預購已達上限，剩餘 3 份，訂單需求 5 份，請減少數量後再試」；剩餘 0 份時顯示「本檔期預購已額滿，請等待下一檔期」）
- `total_quantity_cap` 為 0 或空白代表不限制，不會做這項檢查
- 目前是「整個檔期共用一個上限」，不是每個取貨時段各自獨立算（`PickupSlots` 表沒有各時段自己的上限欄位），跟原本大綱寫的「檔期/時段總量上限」有些出入，以實際的 Google Sheets 資料表結構（Phase 2 定案）為準
- 沿用 Phase 3-3 訂單編號流水號一樣的取捨：「讀了再寫」的簡單檢查，不做原子鎖，極端情況下可能多接一兩份，老闆手動調整即可
- 前端 `site/js/app.js` 不用改，本來就會把 API 回傳的 `error` 訊息直接顯示在送出按鈕下方
- `worker/src/index.js`、`worker/dashboard-single-file.js`、`worker/README.md` 都已同步更新，已透過 Cloudflare Dashboard 網頁編輯器部署並併入 `main`（PR #12，同時併入了原本卡著沒併的 Phase 4）
- 開發時發現 Phase 4 的分支 `claude/new-session-r689do` 當時還沒併入 `main`，這次 Phase 5 分支是接在 Phase 4 分支上做的，PR #12 一次把 Phase 4 + Phase 5 都併進 `main` 了

**顧客介面改版備註**（已併入 main，PR #13）：
- 前端（4 個 commit）：品牌識別區、購物車列改固定在上方（可展開/收合）、分類頁籤、
  大/小規格商品卡（依 `variant_group`/`variant_label` 分組）、新增「選自取／宅配」步驟
  （宅配改填收件地址、跳過選時段，運費讀 `Settings.shipping_fee`）、每個步驟加「‹ 上一頁」、
  完成頁加訂購明細卡片、換上真實店家 logo、完成頁「複製文字明細」按鈕（固定只做複製文字這件事，
  不依裝置切換行為）
- 後端：Google Sheets 新增欄位——`Products` 加 `variant_group`、`variant_label`；`Orders` 加
  `delivery_method`、`shipping_fee`、`delivery_address`；`Settings` 新增一列
  `shipping_fee`（都加在原本欄位最右邊，避免打亂 `訂單查詢`/`月報表`公式）
- Worker API 同步更新：`POST /orders` 依 `delivery_method` 分流驗證（自取要
  `pickup_slot_id`，宅配要 `delivery_address`），宅配運費一律從 `Settings.shipping_fee`
  讀取、不採信前端金額，`order.total` 直接回傳含運費的最終金額；`GET`/`POST /products`、
  `PATCH /products/:id` 讀寫大小規格欄位；`GET`/`PATCH /orders` 回應含取貨方式/運費/宅配地址
- 前端 `site/js/app.js` 的 `showDone()` 已改用後端回傳的 `order.total`/`order.shipping_fee`，
  拿掉舊版「前端自己再加一次運費」的邏輯，避免重複計算
- `worker/src/index.js`、`worker/dashboard-single-file.js`、`worker/README.md` 都已同步更新，
  已透過 Cloudflare Dashboard 網頁編輯器部署
- Phase 5 的總量上限檢查邏輯不用改：大/小規格商品在 Sheets 裡本來就是不同
  `product_id`、不同列，天生就各自獨立算
- 老闆已手動在 Google Sheets 加好上述欄位，並完成 Cloudflare Dashboard 重新部署

**Phase 6 備註**（老闆後台 PWA 串接真實 API，已完成，PR #14，詳見 `HANDOFF_PWA_PHASE6.md`）：
- repo 根目錄的 `index.html`/`js/app.js`/`js/api.js`/`css/style.css`（獨立於顧客網站的
  `site/` 資料夾）從假資料改成串接真實 Worker API
- 商品管理頁（新增/編輯）已支援大小規格：`規格分組`（`variant_group`）、`規格標籤`
  （`variant_label`）兩個欄位，跟顧客網站共用同一套資料
- 訂單列表/詳情頁已顯示取貨方式（自取/宅配）、宅配收件地址、自取取貨時段、宅配運費，
  列表也可以用取貨方式篩選
- PIN 登入、四段訂單狀態（新訂單/已備料/已取貨/已取消）、確認付款、訂單永久刪除都已可用
- 已透過 GitHub Pages 暫時掛上線（`https://abspbt.github.io/yjg-order/`）方便手機測試，
  這不是正式部署路線，Phase 7 要決定要不要搬到 Cloudflare Pages

**近期優化備註**（Phase 6 併入 main 之後陸續完成的小修正與體驗優化，各自獨立 PR #15～#44，
不算獨立 Phase，一併記在這裡方便查）：
- LINE 官方帳號加好友連結（顧客網站+後台首頁都有），修正過連結容錯處理（`＠`全形符號、
  忘記帶`@`等常見貼上問題）
- 購物車摘要列／品牌識別區改成固定在畫面最上方（`position: sticky`），中間修了好幾輪
  「固定顯示失效」的 bug，最後查到真正原因是 CSS `overflow` 規則讓 `html`/`body` 變成
  自己的捲動容器，導致裡面的 `sticky` 元素整個失效，改用 `overflow-x: clip` 解決
- 老闆後台 API 一律不快取，確保新訂單能即時顯示；首頁加上手動「檢查新訂單」按鈕
- 新增檔期時可一鍵「沿用上一檔商品清單」，改抓最近一次有商品的檔期
- 顧客完成頁多次排版調整：加上訂購明細卡片、「複製文字明細」按鈕、圖示與標題對齊、
  拿掉重複的「複製訂單編號」按鈕、拿掉各步驟內重複的「下一步」按鈕
- 公告文字框改置中對齊
- 步驟頁捲動被固定區塊蓋住的 bug，修了兩輪：先補上品牌/公告固定區的高度
  （`scroll-margin-top`），後來發現購物車摘要列也是固定的，一起補上高度才完全解決
  「上一頁」「訂單編號」被蓋住看不到的問題
- 完成頁新增「其他付款方式」提示（LINE Pay／全支付／現金自取，除了匯款外都可以在
  加 LINE 好友時跟老闆確認）
- 大小規格商品（如「有餡/無餡」卡士達）的品項名稱放大、置中，加分隔線跟規格選項區隔
- 電話號碼加上基本格式驗證（至少 8 碼數字），避免填「0」這種明顯錯誤的內容也能送出
- 訂單摘要頁（送出前最後一頁）、完成頁的訂購明細都補上姓名/電話/備註，方便顧客送出前
  跟送出後都能核對自己填的資料有沒有寫錯
- 各步驟頁面裡原本的小字「‹ 上一頁」連結拿掉，改做成按鈕搬到固定的購物車列，跟「下一步」
  並排常駐顯示，不會再被捲動或固定區塊蓋住；兩個按鈕改成等寬、間距加大、同色系配色
  （上一步白底橘框、下一步實心橘），左右都加上 CSS 繪製的方向箭頭
- 顧客網站購物車摘要列跟下方步驟標題距離太近，`.cart-summary` 補上 `margin-bottom`（PR #35）
- 上一項修完才發現跳步驟時點「下一步」的自動捲動（`scrollIntoView`）沒把新加的間距算
  進去，捲完當下標題還是貼著購物車列，要手動再滑一下才看得到間距；抽成 CSS 變數
  `--step-gap`，同時用在 `margin-bottom` 和 `.step` 的 `scroll-margin-top`，讓自動捲動
  落點也算進這段間距（PR #36）
- 老闆後台訂單詳情裡顧客電話開頭的 0 不見了（例如 `0956030321` 顯示成 `956030321`）：
  根因是 `POST /orders` 寫入 Google Sheets 用 `USER_ENTERED` 模式，Sheets 會把看起來像
  數字的字串自動轉成數字、吃掉開頭的 0；寫入前幫電話號碼加上前導單引號 `'`強制存成
  純文字解決（PR #37）。**這個修正只對之後新送出的訂單有效**，已經存在 Sheets 裡、開頭
  0 已經被吃掉的舊訂單需要手動到 Google Sheets 補回去（補的時候儲存格前面一樣要加 `'`，
  或先把那一格格式設成「純文字」，不然存檔又會被吃掉）
- 老闆後台 PWA（repo 根目錄，目前掛在 GitHub Pages）原本只針對手機設計，`#app` 沒有限制
  寬度，用電腦瀏覽器打開會整個拉滿螢幕；補上 `--app-max-width`（480px）並置中，底部頁籤列、
  PIN 登入頁版本號、更新提示橫幅這幾個 `position: fixed` 元素也一起改成跟著置中，桌面瀏覽
  時會維持像手機 App 一樣的固定寬版面（PR #38）
- 顧客網站宅配加上「僅限台灣本島」提示（PR #40）：「低溫宅配」按鈕文字加註
  「（僅限台灣本島）」；填寫收件地址欄位下方補一行提示文字；點「下一步」時如果地址裡
  出現「澎湖／金門／馬祖／連江／蘭嶼／琉球」任一關鍵字，會跳出警示彈窗（不會直接進到
  下一步），下方有「取消」「開啟 LINE 聯絡老闆」兩個按鈕。**這只是關鍵字比對提醒，不是
  嚴格擋單機制**，地址寫法不規則、縣名寫法不同都可能抓不到；LINE 按鈕也只是開啟既有的
  加好友連結，不會自動幫顧客把訊息送出去。併入 main 後老闆有直接在 GitHub 上微調過警示
  彈窗的文案用字
- 顧客網站最上方的固定區塊（品牌識別區／購物車列／分類頁籤）捲動時會往上滑一小段才卡住，
  手機、電腦瀏覽器都會。這題修了兩輪，**第一輪 PR #42 是誤判、沒修到**，記在這裡避免以後
  又往同個方向找：
  - ❌ PR #42（誤判）：以為是 `site/js/app.js` 用 `window` 的 `resize` 事件同步固定區塊
    高度，被手機 Safari 網址列收合觸發而反覆重排。改成 `ResizeObserver` 後老闆實測「狀況
    還是一樣」。這個改動本身無害（`ResizeObserver` 確實比較合適），就留著沒退回
  - ✅ PR #43（真正的根因）：`position: sticky` 元素只要「自然位置」跟「卡住的位置」對不
    起來，就一定會先滑完那段差距才鎖住。`#app` 有 `padding-top: calc(16px + safe-top)`，
    所以 `.top-info` 的自然位置在 `16px + safe-top`，但它的 `top` 只寫 `var(--safe-top)`
    —— 差了 16px，這 16px 就是老闆看到的位移（截圖縮放 3.4 倍後約 54px，跟實測吻合）
  - 修法：把上方留白從 `#app` 的 `padding-top` 搬進 `.top-info` 自己的 `padding-top`，
    sticky 改成 `top: 0`，兩者對齊後位移歸零。連帶把下游的 `.cart-summary`、`.tabs`、
    `.step` 的 `top`/`scroll-margin-top` 拿掉重複加的 `safe-top`（`--topinfo-h` 取自
    `offsetHeight`，已含 padding），`.tabs` 則用負 `margin-top` 抵銷 `.cart-summary` 的
    `margin-bottom`、間距改由自己的 `padding-top` 補回來（不能只是把 `top` 加大，那會在
    購物車列下方留一條透明縫，捲動的內容會從縫裡穿過去）
  - `ResizeObserver` 一併補上 `{ box: "border-box" }`：預設的 `content-box` 不含 padding，
    而 `.top-info` 的 `padding-top` 含 `safe-area-inset-top`（轉螢幕方向會變），用預設值
    會收不到這種變化、`--topinfo-h` 停在舊值，下面的購物車列就會錯位
  - 用 headless Chromium 逐格捲動實測：修正前三個固定區塊各滑動 16px／16px／32px，修正後
    全部為 0；並比對修正前後的間距與截圖，版面完全一致，PR #35/#36 修好的「自動捲動落點
    不被蓋住」也維持原本的 16px 淨空間
- 上一項修好後，換成「選商品」的步驟標題被分類頁籤整個蓋住（PR #44）：`.step` 的
  `scroll-margin-top` 只算了品牌區 + 購物車列，**漏掉分類頁籤的高度**——而選商品正好是唯一
  會顯示頁籤的步驟，所以從「選擇取貨方式」按「上一步」回來時（`goToStepKey("products")`
  會做 `scrollIntoView`），標題就落在頁籤底下。這其實跟 PR #35/#36 是同一類 bug，當時補了
  品牌區和購物車列的高度，就是漏了頁籤這一塊。修法比照既有做法：新增 `--tabs-h` CSS 變數
  （隱藏時設 0），由 `syncTabsHeight()` 同步、一樣用 `ResizeObserver` 監看，並加進
  `.step` 的 `scroll-margin-top`。實測落點從「被蓋掉 25.5px、還往上超出 52px」變成淨空間
  16px（正好是 `--step-gap`）；頁籤隱藏的步驟落點、三個固定區塊的零位移、整體版面間距都
  重新驗證過沒有退化
  - ⚠️ 教訓：這種「固定區塊高度」的 bug 有三個區塊要顧（品牌區／購物車列／分類頁籤），
    而且**分類頁籤只在選商品那一步顯示**，測試時很容易只測到頁籤隱藏的步驟就以為過關
    （這次就是這樣才漏掉的）。以後動到 sticky 或捲動落點，兩種情況都要測
- 上一項修好後，換成「購物車是空的」時「1. 選商品」標題被分類頁籤蓋住（老闆截圖回報，
  一進網站、還沒選任何商品時就看得到；選了一件商品之後字就不會被蓋住）：根因是 `.tabs`
  的 `margin-top: -16px`（PR #43 加的，用來抵銷 `.cart-summary` 的 `margin-bottom`，
  讓頁籤緊貼在購物車列下方）沒考慮到購物車是空的時候 `.cart-summary` 會整個
  `display: none`，沒有 `margin-bottom` 可以抵銷，頁籤的自然位置就比 sticky 卡住的位置
  高 16px，卡住時等於往下壓在後面內容上，把標題蓋掉一截；選了商品、購物車列出現後兩個
  margin 才會互相抵銷、位置對上，這就是為什麼「選一件之後就正常」。修法：新增
  `#cart-summary.hidden + .tabs { margin-top: 0; }`，購物車一隱藏就把負 margin 拿掉。
  用 headless Chromium 實測（模擬 iPhone 尺寸），空購物車時標題淨空間從 -12px（被蓋住）
  修正到 +4px，跟有商品時一致；其餘情境（有商品、頁籤隱藏的步驟、三個固定區塊捲動零
  位移）數值都跟修正前相同，沒有退化
  - ⚠️ 教訓：跟 PR #44 是同一家族的 bug，但這次的變數是「購物車是不是空的」，不是
    「哪個步驟」。以後動到這幾個固定區塊的 margin/padding 抵銷關係，除了「哪個步驟」，
    「購物車空／非空」這兩種狀態也都要測
- 預購檔期結束後，老闆後台左上角的狀態還是顯示「預購開放中」，要手動去撥「預購開關」
  才會關掉（老闆回報）。根因是那個狀態只看 `Settings.preorder_open`（老闆手動的開關），
  跟檔期日期完全無關。改成兩個條件一起看（PR #48）：
  - **顧客實際能不能下單 ＝ 手動開關是開的 AND 至少有一個檔期還在預購中**
  - 「還在預購中」＝ 檔期 `status` 是 `active`，而且 `end_date`（預購結束日）還沒過。
    用台北時區判斷，**結束日當天仍然可以下單，隔天才自動關閉**；`end_date` 空白就只看
    `status`（維持原本行為）
  - 同時有多個檔期時，只要其中一檔還沒結束就維持開放（老闆特別問的情境）
  - 手動開關保留「臨時暫停」的用途，**關掉時一律以關掉為準**；下一個檔期開跑會自動恢復
    開放，不用再手動撥回來
  - Worker 端新增 `isCampaignOngoing()` 當作單一判斷依據，`GET /campaigns`、`GET /products`
    不再回傳過期檔期，`POST /orders` 也會擋下（回「本檔期預購已結束，請等待下一檔期」）；
    `GET /settings` 新增兩個**即時計算**欄位 `has_ongoing_campaign`、`preorder_open_effective`
    （沿用 Phase 2「不存彙總欄位」原則，Sheets 裡沒有這兩列，也不能用 `PATCH /settings` 改）
  - 後台首頁左上角狀態改成三種：預購開放中／預購已暫停／**目前無預購檔期**；已訂購量優先
    顯示還在預購中的檔期；預購開關頁會說明「開關開著但沒有檔期，所以顧客端仍是關閉」；
    檔期列表中 `status` 還掛 `active` 但已過期的檔期，標籤改顯示「預購已結束」
  - 顧客網站 `site/` 不用改：過期檔期不會再出現在 `GET /campaigns`，會自動落到既有的
    「目前沒有開放中的預購檔期」畫面
  - 日期字串容錯處理 `2026-08-15` 與 `2026/8/15` 兩種格式（Sheets 依儲存格格式回傳的寫法
    不一定），認不出來時當成「沒填結束日」維持開放——寧可多開一天，也不要誤判成結束把
    顧客擋在門外
  - ⚠️ 這項改動**要重新部署 Worker 才會生效**（Cloudflare Dashboard 貼上
    `worker/dashboard-single-file.js`）；另外整個機制靠檔期的「預購結束日」欄位，老闆新增
    檔期時如果沒填結束日，就不會自動關
- 顧客網站完成頁「複製文字明細」按鈕補上備註內容（老闆回報，PR #51）：這顆按鈕複製的文字是
  `buildOrderShareText()` 另外組出來的字串，跟畫面上顯示的「訂購明細」卡片是兩份獨立的資料，
  之前只有畫面上看得到備註，複製出來貼給老闆的文字沒有帶到。修法：`showDone()` 存
  `state.lastOrder` 時多存一個 `note` 欄位，`buildOrderShareText()` 在總計後面補一行
  「備註：xxx」（備註留空時不會多出這一行）
- 檔期預購起訖日改成完全自動判斷、拿掉手動的「即將開始」狀態（老闆反應「預購檔期設定」裡
  的起訖日設定完全沒有作用，PR #53）：根因是 `isCampaignOngoing()` 原本只檢查 `end_date`，
  完全沒看 `start_date`，所以就算檔期還沒到起日，只要 status 是 `active` 就會立刻對顧客
  開放；而 status 裡原本還有一個「即將開始」（`upcoming`）選項，但那只是純手動顯示用的
  徽章，跟起訖日完全脫鉤，兩套機制看起來像同一件事、實際上互不相干，容易搞混
  - 跟老闆確認作業方式：老闆用官方 LINE 通知顧客新檔期，不需要「即將開始」這個手動中間
    狀態，希望「設定好日期就自己跑，日期到了自動開始、日期結束自動關閉」
  - 修法：`isCampaignOngoing()` 補上 `start_date` 判斷（比照既有 `end_date` 的寫法），起日
    當天算開放、之前不開放，兩個日期只要空白就不設限；`status` 精簡成 `active`/`ended`
    兩種，拿掉 `upcoming`，新增檔期預設就是 `active`，「已結束」保留給既有的「結束檔期」
    按鈕做手動強制關閉（跟日期無關，是老闆想提早關掉時的手動 override）
  - 老闆後台檔期列表的徽章不再照 `status` 原始值顯示，改成用起訖日即時算出「即將開始／
    進行中／已結束」三種顯示狀態（新增 `campaignDisplayStatus()`），起日還沒到的檔期老闆
    一樣看得出來狀態，只是不再是一個可以手動選的欄位
  - `POST /orders` 的錯誤訊息一併修正：起日還沒到時顯示「本檔期預購尚未開始」，不會誤報成
    「本檔期預購已結束」（正常情況顧客不會走到這個分支，因為 `GET /campaigns` 已經先擋掉，
    這裡只是保險）
  - 顧客網站「目前沒有開放中的預購檔期」文字改成「請加入官方LINE，會不定時的發佈預購
    資訊」，引導顧客改用 LINE 追蹤新檔期公告
  - `worker/src/index.js`、`worker/dashboard-single-file.js`、`js/app.js` 都已同步更新，
    已透過 Cloudflare Dashboard 網頁編輯器重新部署
- Worker API 安全性修正（老闆主動要求跑一次 `/security-review`，PR #57）：
  - **Formula Injection**：`POST /orders` 是公開不需登入的端點，顧客下單填的
    `customer_name`、`note`、`delivery_address` 寫入 Google Sheets 時用的是
    `USER_ENTERED` 模式（模擬使用者手動打字，開頭是 `=`/`+`/`-`/`@` 會被解析成公式），
    原本沒有做任何跳脫——顧客故意填惡意公式（例如 `IMPORTXML`），老闆之後打開
    Google Sheets 核對訂單就會被自動執行，可能外洩其他欄位的顧客個資，或做釣魚連結。
    修法：新增 `sanitizeForSheets()`，比照 `customer_phone` 原本防止開頭 0 被吃掉的
    做法，開頭是這幾個公式觸發字元時加上前導單引號強制存成純文字；回傳給顧客自己看的
    訂單確認資料不受影響
  - **PIN 登入防暴力破解**：`POST /auth/login` 同樣公開不需登入，PIN 只有 6 位數字
    （100 萬種組合），原本沒有任何嘗試次數限制。修法：連續猜錯 5 次鎖定 15 分鐘，期間
    不管 PIN 對不對都直接擋下（HTTP 429）；專案不用 D1/KV，失敗次數跟鎖定到期時間借用
    既有 `Settings` 分頁存（`login_fail_count`、`login_locked_until`），`GET /settings`
    已排除這兩個內部 key、不會回傳給顧客端。因為只有老闆一個人登入，鎖定期間老闆自己
    也會被擋，是刻意接受的代價
  - `worker/src/index.js`、`worker/dashboard-single-file.js`、`worker/README.md` 都已
    同步更新，已透過 Cloudflare Dashboard 網頁編輯器重新部署
- 拿掉店家匯款資訊（老闆主動提出，資安/防詐考量，PR #60）：
  - 顧客網站完成頁的「請匯款至」卡片（銀行/帳號/戶名）整個拿掉
  - 老闆後台「店家資料」頁拿掉匯款資訊三個欄位，儲存時也不再送出
    `bank_name`/`bank_account`/`bank_owner` 這幾個 Settings key
  - `GET /settings` 是公開不需登入的端點，光拿掉前端顯示還不夠——任何人都能直接打這支
    API 拿到資料，所以就算 Google Sheets 的 `Settings` 分頁裡還留著舊的匯款資料，這支
    公開 API 也一律排除 `bank_name`/`bank_account`/`bank_owner`，不會回傳給外部
  - `worker/src/index.js`、`worker/dashboard-single-file.js`、`worker/README.md`、
    `js/app.js`、`site/index.html`、`site/js/app.js` 都已同步更新，已透過 Cloudflare
    Dashboard 網頁編輯器重新部署
- 完成頁文案調整，引導客人透過 LINE 跟老闆確認訂單及付款方式（PR #61）：老闆說明因為
  資安/詐騙風險，付款這個步驟改成統一由老闆在 LINE 對話裡跟顧客確認處理（帳戶資訊不會
  再公開顯示在網站上，改由老闆私下透過 LINE 提供），付款方式清單重新加回「匯款」選項，
  完成頁提示文字改成「💳 付款方式有匯款／LINE Pay／全支付／現金自取，請透過 LINE 跟
  老闆確認訂單內容及付款方式，謝謝您的預購！」
- 新增檔期低庫存緩衝機制（老闆測試時發現，PR #62）：檔期總量上限原本只有 `POST /orders`
  送出訂單那一刻才會擋單，顧客選完一長串商品、填完姓名電話才發現已經額滿；而且同時有
  好幾個人在選購時，大家看到的剩餘量都是同一個數字，容易在最後幾份時一起搶、一起送出，
  真的超賣
  - `GET /campaigns` 新增即時計算的 `remaining_quantity`（顯示用剩餘量）、`low_stock`
    （是否已跌破低庫存門檻）：顧客網站數量選擇器直接用 `remaining_quantity` 當上限，
    選超過就選不下去，不用等到填完資料才被擋
  - `Campaigns` 新增兩欄 `low_stock_threshold`（剩餘量低於多少開始套用緩衝）、
    `low_stock_buffer`（套用緩衝時要少顯示幾份）：剩餘量跌破門檻後，`remaining_quantity`
    會刻意比實際剩餘量再保守一些，讓同時選購的多人之間留一點緩衝，降低大家都以為自己
    搶到最後名額、結果同時送出而真的超賣的機率；兩欄任一沒填就不套用緩衝
  - ⚠️ 緩衝只影響**顯示**與前端數量選擇器的上限，`POST /orders` 最終把關一律用未經緩衝
    的真實剩餘量，不會讓緩衝後的數字騙過真正的總量上限檢查
  - 老闆不擅長用電腦，兩個緩衝欄位已經加進後台 PWA「預購檔期設定」頁面（跟「總量上限」
    同一頁），可以直接用手機設定，不用進 Google Sheets
  - 緩衝是**整檔期共用**一個額度，跟 `total_quantity_cap` 一樣不分商品/口味各自計算——
    這是老闆特別確認過的設計，避免顧客誤以為某個口味單獨限量
  - 顧客網站新增：選商品步驟標題下方的低庫存提示橫幅（整檔期共用一條，不掛在單一商品
    卡片旁邊，避免讓顧客誤會成某個口味單獨限量）、第一次加入購物車且已進入低庫存狀態時
    跳一次性提醒彈窗（之後不會每次點+都打斷，靠橫幅持續露出最新剩餘量）
  - `worker/src/index.js`、`worker/dashboard-single-file.js`、`js/app.js`、
    `site/js/app.js`、`site/index.html`、`site/css/style.css`、`worker/README.md`
    都已同步更新
  - ⚠️ 這項改動**要重新部署 Worker 才會生效**（Cloudflare Dashboard 貼上
    `worker/dashboard-single-file.js`），而且**需要老闆手動在 Google Sheets 的
    `Campaigns` 分頁最右邊加上 `low_stock_threshold`、`low_stock_buffer` 兩欄**才會
    真正啟用緩衝（沒加之前效果等同不啟用，不影響其他功能）
  - ⚠️ **這個緩衝打折顯示的做法，PR #63 已經拿掉、改成如實顯示，見下方 PR #63 條目**——
    留著這段記錄是為了完整記錄設計演進過程，實際部署請照 PR #63 的版本，不要照這裡的
    `low_stock_buffer` 欄位設定
- 拿掉低庫存緩衝打折顯示與彈窗，改成如實顯示剩餘量 + 購物車下方免責提示（老闆考量消費者
  保護法規疑慮主動提出，PR #63）：PR #62 剛做完的「剩餘量偏低時刻意少顯示幾份」緩衝機制，
  老闆後來想到這個做法可能讓顧客看到的數字跟實際能買到的數量不一致，有消費者保護法規上
  的疑慮，主動要求拿掉
  - `GET /campaigns` 的 `remaining_quantity` 改回**一律是真實剩餘量**，不再打折扣；
    `campaignDisplayRemaining()` 改名成 `campaignRemainingQuantity()`，邏輯簡化成單純
    「總量上限 − 已訂購量」，不再讀 `low_stock_buffer`
  - `Campaigns.low_stock_buffer` 欄位整個拿掉（後端讀寫、老闆後台 PWA「預購檔期設定」頁
    的輸入欄位、`worker/README.md` 都同步移除），`low_stock_threshold` 保留，但用途改成
    單純「剩餘量低於多少開始顯示提示」，不再決定緩衝要扣幾份
  - 低庫存時的作法從「跳一次性彈窗」改成「顧客網站購物車列（`#cart-summary`）下方固定
    顯示一行免責文字：『目前庫存緊張，實際可以購買數量，以訂單明細為主』」——老闆認為
    多一個彈窗會扣消費體驗分數，這句文字也刻意不帶剩餘量數字，避免顯示的數字被其他人
    同時選購的時間差追過去而不準確
  - 提示文字放在購物車列**內部**（`.cart-actions` 下方），不是外面獨立的一個區塊：因為
    `.tabs` 有一條 `#cart-summary.hidden + .tabs { margin-top: 0; }` 的相鄰兄弟選擇器
    （PR #45 修的那個 bug），依賴 `.tabs` 一定要是 `#cart-summary` 的直接下一個兄弟節點，
    在兩者中間插新元素會弄斷這個選擇器、重新出現「購物車是空的時候標題被頁籤蓋住」的
    舊 bug；放在 `#cart-summary` 內部就不會動到這個結構，而且購物車列的高度
    （`--cartbar-h`）本來就是量測整個 `#cart-summary` 的 `offsetHeight`，提示文字的
    高度會自動被算進去，不用額外處理
  - 彈窗相關的程式碼（`#low-stock-warning` 彈窗 HTML、`maybeShowLowStockWarning()`／
    `hideLowStockWarning()`／`lowStockWarningShown`）整個刪除，`renderLowStockBanner()`
    改成只在 `updateCartBar()` 呼叫（原本在 `renderProducts()` 呼叫，因為提示現在是購物車
    列的一部分，不是選商品步驟的一部分）
  - `worker/src/index.js`、`worker/dashboard-single-file.js`、`js/app.js`、
    `site/js/app.js`、`site/index.html`、`site/css/style.css`、`worker/README.md`
    都已同步更新
  - ⚠️ 這項改動**要重新部署 Worker 才會生效**（Cloudflare Dashboard 貼上
    `worker/dashboard-single-file.js`）；Google Sheets 的 `Campaigns` 分頁**只需要加
    `low_stock_threshold` 一欄**（PR #62 原本說要加兩欄，`low_stock_buffer` 那欄已經不用了，
    如果已經照 PR #62 加了兩欄也沒關係，多的那欄留著不會有影響，只是不會再被讀取）
- 修正刪除檔期時沒有一併清掉商品資料的漏洞（老闆回報新增「中秋節禮盒」檔期時已經把
  「沿用上一檔商品清單」開關關掉，商品管理頁篩選這個新檔期卻還是滿的，PR #66）：
  - 根因是 `DELETE /campaigns/:id` 原本只清 `Campaigns`、`PickupSlots` 兩張表，**沒有清
    `Products`**；新檔期編號是「目前 `Campaigns` 表最大編號 +1」算出來的，跟 `Products`
    表完全無關
  - 推測經過：老闆第一次新增「中秋節禮盒」時沒注意到「沿用上一檔商品清單」開關預設是
    開的，商品被複製進來；發現不對把那個檔期刪掉重建，但複製進來的商品留在 `Products`
    表裡沒被清掉，變成孤兒資料；重建第二次「中秋節禮盒」時編號剛好被重複分配到，孤兒
    商品資料就「借屍還魂」跑回來，看起來像開關沒生效
  - 修法：`handleDeleteCampaign()` 刪除檔期時，連同底下的 `Products` 一併刪除，避免產生
    孤兒資料；`worker/src/index.js`、`worker/dashboard-single-file.js`、`worker/README.md`
    都已同步更新
  - 老闆已手動到 Google Sheets 清掉這次異常殘留的商品資料，並透過 Cloudflare Dashboard
    網頁編輯器重新部署 Worker

Phase 0 各頁 Wireframe 定案內容已整理成交接摘要，見對話紀錄
（今日 Dashboard、商品管理、訂單列表+付款確認、公告設定、
預購檔期設定、店家資料、預購開關、PIN 登入畫面）。

> 📝 **關於下方 Phase 規劃的說明**：以下 Phase 0～8 是專案一開始訂的大綱方向，
> 但實際動手做、老闆真機試用之後，常常會冒出規劃時沒想到的細節，需要跟著調整
> （例如 Phase 1 把訂單狀態從原本規劃的 3 段拆成 4 段、備料總覽的計算邏輯重新設計等）。
> 這是正常且預期中的過程，之後的 Phase 也會持續發生類似的情況——遇到跟大綱不一致的
> 地方，以「實際做出來、測試過的版本」為準，大綱本身不會回頭照實作反推硬改，
> 但重大調整會盡量在對應 Phase 或交接摘要裡註記一筆，方便之後回頭查。

## 使用方式（重要，請先讀）

1. **每個 Phase 盡量在「一個新對話」裡完成**，不要接著前一個 Phase 的舊對話繼續做，對話越長越容易吃光用量。
2. 每個 Phase 結尾都有一段「▶ 交接摘要」，**開新對話時，把上一個 Phase 的交接摘要貼上去當開場白**，不用貼整份歷史紀錄。
3. 如果你是付費方案，建議把這份文件整份存進 Claude 的 **Project 知識庫**，之後每個新對話都能自動讀到背景，交接摘要可以省略更多細節。
4. 每完成一個 Phase，回來這份文件把對應的 checkbox 打勾、把交接摘要裡的內容填實際結果，這份文件就是你的「專案聖經」，隨時可查目前進度到哪。
5. 如果某個 Phase 感覺內容太多、做到一半就快用完額度，**就地再拆成 Phase X-1 / X-2**，不用勉強一次做完。

---

## 總覽：確定的技術棧（已簡化版）

- **前台網站**：Cloudflare Pages
- **API / 後端邏輯**：Cloudflare Worker（或 Pages Functions）
- **資料庫**：Google Sheets（唯一資料來源，不用 D1、不用 Durable Objects）
- **通知/客服**：LINE OA（人工核對付款截圖，非自動串接金流）
- **老闆後台**：手機 PWA，PIN 登入 + 短期 Token

不需要的東西（已排除，不用重新討論）：
- Cloudflare D1
- Cloudflare Durable Objects
- 金流 API 串接
- 會員系統 / 帳密登入
- 逐件庫存鎖定（只做「檔期總量上限」）

---

## 工作流程規則

這個專案分成 Phase 0～8 進行（完整計畫見 docs/project-plan.md）。

- 每次完成一個 Phase 的產出、或段落任務告一段落時，
  **主動提醒我**：「這個階段完成了，要不要更新 CLAUDE.md 的『目前進度』？」
- 不要自己直接改，先問過我內容要寫什麼再更新。
- 如果我確認要改，把「目前進度」欄位更新成完成了什麼、下一步要做什麼。
- **一律使用中文回應**，不要用英文。

---

## Phase 0：老闆 PWA 資訊架構 + Wireframe

**目標**：把老闆後台每一頁長什麼樣、有哪些按鈕、怎麼操作，逐頁定案。不寫任何程式碼。

**開始前準備**：
- 這份文件全文（或前面幾輪對話整理出的架構摘要）
- 圖二那張「你的後台」流程圖

**這階段要做的頁面**（一次一頁，覺得吃力可以拆多個對話）：
- [x] 🏠 今日 Dashboard
- [x] 🥖 商品管理（含新增/編輯）
- [x] 📦 訂單列表 + 付款確認
- [x] 📢 公告設定
- [x] 📅 預購檔期設定（含總量上限、取貨日期/時段）
- [x] 🏪 店家資料
- [x] 🔴 預購開關
- [x] 🔑 PIN 登入畫面

**產出**：每頁的文字版 Wireframe（畫面上有哪些區塊、欄位、按鈕、點下去發生什麼事），不用是圖片，文字描述即可。

**驗收標準**：老闆看著這份文字 Wireframe，能想像出「點開手機、看到什麼、要按哪裡」，沒有模糊地帶。

**▶ 交接摘要範本**（做完這階段，複製以下段落，填空後貼到下一個新對話開頭）：
```
我在做「歪嘴雞烘焙預購系統」，技術棧：Cloudflare Pages + Worker + Google Sheets。
已完成 Phase 0（PWA 資訊架構與 Wireframe），以下是各頁面定案內容：
[貼上 Phase 0 產出的 Wireframe 文字]

現在要做 Phase 1：用假資料做出這幾頁的 PWA 前端（純前端，不接後端）。
```

---

## Phase 1：假資料版 PWA（純前端，不接後端）

**目標**：把 Phase 0 定案的頁面做成可以在手機上滑動操作的 PWA，資料先寫死（假資料），主要是驗證「操作順不順手」。

**開始前準備**：Phase 0 的交接摘要（貼 Wireframe 內容）

**產出**：
- [ ] 可加到 iPhone 主畫面的 PWA（manifest.json + service worker 基本設定）
- [ ] 4 個 Tab 導覽可切換
- [ ] 各頁面用假資料呈現（例如今日訂單 18 筆、假商品卡片等）
- [ ] 基本互動（點商品進編輯頁、切換上下架開關等）能跑，但不用真的存檔

**驗收標準**：老闆拿實體 iPhone 加到主畫面試用一輪，覺得「操作邏輯沒問題」再進下一步。這是整個專案最重要的把關點，寧可這階段多花時間調整，也不要帶著不順手的設計往後做。

**▶ 交接摘要範本**：
```
延續「歪嘴雞烘焙預購系統」，已完成 Phase 1：假資料版 PWA，
老闆試用後的回饋是：[貼上老闆的意見/要調整的地方]
PWA 程式碼位置：[貼 GitHub repo 連結]

現在要做 Phase 2：設計 Google Sheets 資料表結構。
```

---

## Phase 2：Google Sheets 資料表設計

**目標**：定出 Google Sheets 裡每張表的欄位，這是後面 API 和前端資料串接的依據。

**開始前準備**：Phase 1 交接摘要

**這階段要定案的表**（實際定案內容，跟原本大綱有些出入，見下方「跟大綱不同的地方」）：
- [x] `Campaigns`（預購檔期）：campaign_id、name、status（upcoming/active/ended）、start_date、end_date、total_quantity_cap
- [x] `PickupSlots`（取貨時段，**新增**）：slot_id、campaign_id、date、time_range
- [x] `Products`（商品）：product_id、campaign_id、name（含「（有餡）/（無餡）」前綴）、category、price、max_per_order、active
- [x] `Orders`（訂單）：order_id、campaign_id、created_at、customer_name、customer_phone、pickup_slot_id、total、payment_status（pending/confirmed）、order_status（**4 段**：new/prepping_done/picked_up/cancelled）、note
- [x] `Order_Items`（訂單明細）：order_id、product_id、product_name_snapshot、unit_price、quantity、subtotal
- [x] `Settings`（店家資料/公告/預購開關等單一設定值，key-value 格式）

**跟原本大綱不同的地方**（老闆真的會用這份表查資料，所以多做了兩個唯讀查詢分頁）：
- 新增 `PickupSlots` 表：因為 Phase 1 的「預購檔期設定」頁面已經做成一個檔期可以有多筆取貨時段，一對多關係塞不進 `Campaigns` 單一欄位
- 新增 `訂單查詢` 分頁：老闆非技術背景，輸入訂單編號或手機號碼，公式自動抓出符合的訂單，不用操作篩選器
- 新增 `月報表` 分頁：輸入年月，公式自動算出當月訂單數/營收、付款狀況、商品銷售排行（前 5 名）
- 兩個查詢分頁都是公式即時讀 `Orders`/`Order_Items`，不是複製一份資料，避免又出現「兩邊對不起來」的問題（Phase 1 已經踩過這個坑）
- 不存任何彙總/計算欄位在原始表裡（例如已訂購量），一律即時算，理由同上
- `status` 類欄位都加了資料驗證下拉選單，避免老闆手動改資料時打錯字

**產出**：一份實際建好、有正確欄位標題列的 Google Sheets 檔案（含示範資料），已匯入老闆的 Google 雲端空間。

**驗收標準**：每張表的欄位跟 Phase 0 定案的頁面需求對得起來；月報表分頁的公式數字已經跟老闆核對過，正確。

**▶ 交接摘要範本**：
```
延續「歪嘴雞烘焙預購系統」，已完成 Phase 2：Google Sheets 資料表設計，
已建好 8 個分頁（6 張原始資料表 + 訂單查詢 + 月報表），已匯入 Google 雲端空間。
表結構：[貼上最終欄位清單，或附 Sheets 連結]

現在要做 Phase 3：Cloudflare Worker API，讀寫這份 Google Sheets。
```

---

## Phase 3：Cloudflare Worker API

**目標**：寫出 Worker，能讀寫 Phase 2 定的 Google Sheets，提供給前台網站與 PWA 呼叫。

**開始前準備**：Phase 2 交接摘要（表結構）

**建議再拆成幾個小任務，各自可以是獨立對話**：
- [ ] 3-1：Worker 專案初始化 + Google Sheets API 授權設定（Service Account）
- [ ] 3-2：讀取 API（GET 商品列表、GET 檔期資訊、GET 訂單列表）
- [ ] 3-3：寫入 API（POST 建立訂單，含訂單編號產生邏輯 `ORD-YYYYMMDD-XXXX`）
- [ ] 3-4：老闆端寫入 API（改商品、改公告、改付款狀態、開關預購）
- [ ] 3-5：PIN 登入 + 短期 Token 驗證機制

**驗收標準**：用 Postman 或瀏覽器測試每個 API endpoint，能正確讀到/寫入 Google Sheets 的資料。

**▶ 交接摘要範本**：
```
延續「歪嘴雞烘焙預購系統」，已完成 Phase 3：Cloudflare Worker API。
已完成的 endpoint 清單：[貼 API 清單，例如 GET /products、POST /orders...]
Worker 程式碼位置：[GitHub repo 連結]

現在要做 Phase 4：顧客預購網站前端，串接這些 API。
```

---

## Phase 4：顧客預購網站前端

**目標**：做出顧客看到的單頁式預購網站，串接 Phase 3 的 API。

**開始前準備**：Phase 3 交接摘要（API 清單）

**產出**：
- [x] 公告 → 選商品 → 選數量/口味 → 選取貨日期/時段 → 填姓名電話 → 送出訂單 → 顯示訂單編號 + 匯款資訊 → 前往 LINE / 複製訂單編號

**驗收標準**：從真實手機瀏覽器（iPhone Safari）走完整個下單流程，訂單真的寫進 Google Sheets。
（目前只在電腦瀏覽器上本機測試過完整流程，訂單有真的寫進 Google Sheets；還沒用真實 iPhone Safari 測過，之後找時間補測。）

**▶ 交接摘要範本**：
```
延續「歪嘴雞烘焙預購系統」，已完成 Phase 4：顧客預購網站，已可正常下單。
網站程式碼位置：[GitHub repo 連結]

現在要做 Phase 5：預購總量上限控制邏輯。
```

---

## Phase 5：預購總量控制邏輯

**目標**：顧客送出訂單時,檢查該檔期/該時段是否已達總量上限,超過則擋下並提示。

**開始前準備**：Phase 4 交接摘要

**產出**：
- [x] 送出訂單前檢查 `total_quantity_cap` 是否還有餘量
- [x] 超過上限時前台顯示「本時段/本檔期已額滿」
- [x] 這裡不用做原子鎖，簡單的 read-then-write 檢查即可（極端情況下多接一兩張訂單，老闆手動調整即可）

**驗收標準**：手動把上限設低（例如設 2），測試第 3 筆訂單會被擋下。

**▶ 交接摘要範本**：
```
延續「歪嘴雞烘焙預購系統」，已完成 Phase 5：總量控制邏輯已測試通過。

現在要做 Phase 6：把 Phase 1 的假資料 PWA 換成串接真實 API。
```

---

## Phase 6：PWA 串接真實 API

**目標**：把 Phase 1 的假資料版 PWA，改成真的呼叫 Phase 3 的 API，讀寫真實 Google Sheets 資料。

**開始前準備**：Phase 1（PWA 程式碼）+ Phase 3（API 清單）的交接摘要

**產出**：
- [x] 今日 Dashboard 顯示真實數字
- [x] 商品管理可真的新增/編輯/上下架（含大小規格 `variant_group`/`variant_label`）
- [x] 訂單列表顯示真實訂單、可標記付款狀態（含取貨方式/運費/宅配地址）
- [x] 公告、店家資料、預購開關、取貨設定都能真的儲存
- [x] PIN 登入串接 Phase 3-5 的驗證機制

**驗收標準**：老闆用真機走一輪完整操作流程,所有資料變更都真的反映在 Google Sheets。已完成，
見上方「Phase 6 備註」；目前暫時部署在 GitHub Pages 方便測試，正式部署留給 Phase 7。

**▶ 交接摘要範本**：
```
延續「歪嘴雞烘焙預購系統」，已完成 Phase 6：PWA 已串接真實 API，功能可正常運作。

現在要做 Phase 7：Cloudflare Pages 部署 + 網域設定。
```

---

## Phase 7：部署 + 網域設定

**目標**：把顧客網站與 PWA 都部署到 Cloudflare Pages，掛上你 Cloudflare 已有的網域。

**產出**：
- [x] 顧客網站部署上線（`order.yjg-bakery.com`）
- [x] PWA 部署上線（`bakerhsu.yjg-bakery.com`）
- [x] 首頁部署上線（`yjg-bakery.com`，含 `www.` 自動轉址），`abspbt/yjg-bakery` repo
- [x] Worker（API）CORS 本來就是開放所有來源，不用改，三個新網域都測試過能正常呼叫
- [x] DNS 設定確認可正常連線（已用手機行動網路實測三個網址）

**驗收標準**：三個網址都能從外部（非本機）正常打開並運作。已完成，詳見上方「目前進度」
Phase 7 條目。

**▶ 交接摘要範本**：
```
延續「歪嘴雞烘焙預購系統」，已完成 Phase 7：已部署上線。
網址：顧客端 [連結]、老闆端 [連結]

現在要做 Phase 8：視覺/UX 打磨與上線前最終測試。
```

---

## Phase 8：視覺打磨 + 上線前測試

**目標**：最後調整介面美觀度、跑一次完整的端到端測試清單。

**測試清單**：
- [ ] 顧客下單全流程（含 LINE 跳轉/複製訂單編號兩種路徑都測）
- [ ] 老闆確認付款流程
- [ ] 總量額滿擋單測試
- [ ] 暫停預購開關測試（顧客端是否正確顯示暫停訊息）
- [ ] 手機不同瀏覽器測試（Safari、LINE 內建瀏覽器、已加入主畫面的 PWA）

---

## 附錄：每次開新對話的建議開場白模板

```
我在做「歪嘴雞烘焙預購系統」的 [第 X 階段名稱]。
背景：預購型貝果訂購系統，技術棧 Cloudflare Pages + Worker + Google Sheets，
不需要 D1/Durable Objects，總量控制用簡單檢查即可，付款是人工核對截圖。

已完成進度：[貼上一階段的交接摘要]

這次要做：[這階段的目標，複製上面對應 Phase 的「目標」欄位]
```
