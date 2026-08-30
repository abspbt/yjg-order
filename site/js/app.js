(function () {
  "use strict";

  var API_BASE = "https://ygg-hidden-star-9fe8.drum3126.workers.dev";

  var els = {
    topInfo: document.getElementById("top-info"),
    shopName: document.getElementById("shop-name"),
    shopIntro: document.getElementById("shop-intro"),
    announcement: document.getElementById("announcement"),
    loading: document.getElementById("loading"),
    paused: document.getElementById("paused"),
    pauseMessage: document.getElementById("pause-message"),
    error: document.getElementById("error"),
    errorMessage: document.getElementById("error-message"),
    retryBtn: document.getElementById("retry-btn"),

    cartSummary: document.getElementById("cart-summary"),
    cartDetails: document.getElementById("cart-details"),
    cartDetailList: document.getElementById("cart-detail-list"),
    cartCount: document.getElementById("cart-count"),
    cartTotal: document.getElementById("cart-total"),
    cartNextBtn: document.getElementById("cart-next-btn"),
    cartBackBtn: document.getElementById("cart-back-btn"),
    categoryTabs: document.getElementById("category-tabs"),

    stepProducts: document.getElementById("step-products"),
    productList: document.getElementById("product-list"),
    lowStockBanner: document.getElementById("low-stock-banner"),

    stepDelivery: document.getElementById("step-delivery"),
    deliveryFeeSub: document.getElementById("delivery-fee-sub"),

    stepSlot: document.getElementById("step-slot"),
    slotList: document.getElementById("slot-list"),

    stepAddress: document.getElementById("step-address"),
    deliveryAddress: document.getElementById("delivery-address"),

    stepForm: document.getElementById("step-form"),
    customerName: document.getElementById("customer-name"),
    customerPhone: document.getElementById("customer-phone"),
    customerNote: document.getElementById("customer-note"),

    stepSummary: document.getElementById("step-summary"),
    summaryCustomerInfo: document.getElementById("summary-customer-info"),
    summaryItems: document.getElementById("summary-items"),
    summaryTotalAmount: document.getElementById("summary-total-amount"),
    submitError: document.getElementById("submit-error"),
    submitBtn: document.getElementById("submit-btn"),

    stepDone: document.getElementById("step-done"),
    doneOrderId: document.getElementById("done-order-id"),
    doneCustomerInfo: document.getElementById("done-customer-info"),
    doneFulfillment: document.getElementById("done-fulfillment"),
    doneOrderItems: document.getElementById("done-order-items"),
    doneOrderTotal: document.getElementById("done-order-total"),
    saveShareBtn: document.getElementById("save-share-btn"),
    saveShareStatus: document.getElementById("save-share-status"),
    doneLineLink: document.getElementById("done-line-link"),
    restartBtn: document.getElementById("restart-btn"),
    headerLineLink: document.getElementById("header-line-link"),

    islandWarning: document.getElementById("island-warning"),
    islandWarningCancel: document.getElementById("island-warning-cancel"),
    islandWarningLine: document.getElementById("island-warning-line"),
  };

  // 只做關鍵字比對提醒，不是嚴格擋單機制——打法不規則、縣名寫法不同都可能抓不到，
  // 只是多一層提醒，避免顧客沒注意到宅配僅限台灣本島就選了離島地址下單。
  var OUTLYING_ISLAND_KEYWORDS = ["澎湖", "金門", "馬祖", "連江", "蘭嶼", "琉球"];

  function matchesOutlyingIsland(address) {
    return OUTLYING_ISLAND_KEYWORDS.some(function (kw) {
      return address.indexOf(kw) !== -1;
    });
  }

  function showIslandWarning() {
    els.islandWarning.classList.remove("hidden");
  }

  function hideIslandWarning() {
    els.islandWarning.classList.add("hidden");
  }

  // 顯示給顧客看、也是數量選擇器能加到的上限：檔期共用一個剩餘量（不分品項），
  // 沒有設定總量上限（remaining_quantity 是 null）時視為不限制。這裡一律是真實剩餘量，
  // 不會為了防同時搶購而刻意少顯示——之前試過用緩衝打折顯示，考量到消費者保護法規
  // 疑慮改掉了，改用 renderLowStockBanner() 的免責提示文字處理。
  function campaignRemainingCap() {
    var r = state.campaign && state.campaign.remaining_quantity;
    return typeof r === "number" ? r : Infinity;
  }

  // 低庫存時的提示：固定放在購物車列下方（購物車是空的時候，整個購物車列連同這行一起隱藏），
  // 不用彈窗打斷顧客、也不特別掛在單一商品卡片旁邊（會讓人誤以為是那個口味單獨限量）。
  // 文字刻意不帶剩餘量數字，只提醒「以訂單明細為主」，避免顯示的數字被多人同時選購時的
  // 時間差追過去而不準確。
  function renderLowStockBanner() {
    if (!els.lowStockBanner) return;
    var showBanner = !!(state.campaign && state.campaign.low_stock);
    els.lowStockBanner.classList.toggle("hidden", !showBanner);
  }

  function maxQtyForProduct(product, currentQty) {
    var perProductMax = product.max_per_order > 0 ? product.max_per_order : Infinity;
    var campaignMax = campaignRemainingCap() - cartCount() + currentQty;
    // 商品自己的總量上限（跟 max_per_order「單筆限購」是不同東西）：product.remaining_quantity
    // 是後端算好的、還沒扣掉這個瀏覽器目前購物車裡已選的數量，所以要把 currentQty 加回來，
    // 邏輯跟上面 campaignMax 一樣。null 代表這個商品沒有自己的總量上限。
    var productCapMax =
      typeof product.remaining_quantity === "number" ? product.remaining_quantity + currentQty : Infinity;
    return Math.max(0, Math.min(perProductMax, campaignMax, productCapMax));
  }

  var stepSections = {
    products: els.stepProducts,
    delivery: els.stepDelivery,
    slot: els.stepSlot,
    address: els.stepAddress,
    form: els.stepForm,
    summary: els.stepSummary,
  };

  var STEP_LABELS = {
    products: "選商品",
    delivery: "選擇取貨方式",
    slot: "選取貨時段",
    address: "填寫收件地址",
    form: "填寫聯絡資訊",
  };

  var state = {
    settings: {},
    campaign: null,
    products: [],
    cart: {}, // product_id -> quantity
    activeCategory: null,
    selectedSlotId: null,
    deliveryMethod: null, // "pickup" | "delivery"
    currentStepKey: "products",
    submitting: false,
    lastOrder: null,
  };

  function isTrue(v) {
    return v === true || v === "TRUE" || v === "true" || v === "1";
  }

  function money(n) {
    return "NT$ " + Number(n || 0).toLocaleString("zh-Hant-TW");
  }

  function shippingFee() {
    return Number(state.settings.shipping_fee) || 0;
  }

  function showOnly(el) {
    [els.loading, els.paused, els.error].forEach(function (e) {
      e.classList.add("hidden");
    });
    if (el) el.classList.remove("hidden");
  }

  // 「老闆手動暫停」跟「沒有進行中的檔期」共用同一段顧客端訊息（後台「暫停時顧客端顯示訊息」設定）。
  function showPausedMessage() {
    showOnly(els.paused);
    els.pauseMessage.textContent =
      state.settings.pause_message || "目前暫停接單，請稍後再回來看看。";
  }

  function setStepsVisible(visible) {
    Object.keys(stepSections).forEach(function (key) {
      if (!visible) stepSections[key].classList.add("hidden");
    });
  }

  function syncCartBarHeight() {
    var h = els.cartSummary.classList.contains("hidden") ? 0 : els.cartSummary.offsetHeight;
    document.documentElement.style.setProperty("--cartbar-h", h + "px");
  }

  function syncTopInfoHeight() {
    document.documentElement.style.setProperty("--topinfo-h", els.topInfo.offsetHeight + "px");
  }

  function syncTabsHeight() {
    var h = els.categoryTabs.classList.contains("hidden") ? 0 : els.categoryTabs.offsetHeight;
    document.documentElement.style.setProperty("--tabs-h", h + "px");
  }

  async function fetchJson(path, options) {
    var res = await fetch(API_BASE + path, options);
    var data;
    try {
      data = await res.json();
    } catch {
      throw new Error("伺服器回應格式錯誤");
    }
    if (!res.ok || !data.ok) {
      throw new Error(data && data.error ? data.error : "發生未知錯誤（" + res.status + "）");
    }
    return data;
  }

  async function init() {
    showOnly(els.loading);
    setStepsVisible(false);
    els.cartSummary.classList.add("hidden");
    els.categoryTabs.classList.add("hidden");
    syncCartBarHeight();
    syncTabsHeight();

    try {
      var results = await Promise.all([
        fetchJson("/settings"),
        fetchJson("/campaigns"),
        fetchJson("/products"),
      ]);
      var settingsData = results[0];
      var campaignsData = results[1];
      var productsData = results[2];

      state.settings = settingsData.settings || {};
      applyShopInfo();

      if (!isTrue(state.settings.preorder_open)) {
        showPausedMessage();
        return;
      }

      var campaigns = campaignsData.campaigns || [];
      state.products = productsData.products || [];

      if (campaigns.length === 0 || state.products.length === 0) {
        showPausedMessage();
        return;
      }

      // 目前只會有一個 active 檔期（Worker 端邏輯），取第一個。
      state.campaign = campaigns[0];

      showOnly(null);
      startOrderFlow();
    } catch (err) {
      showOnly(els.error);
      els.errorMessage.textContent = "連線發生問題：" + err.message + "\n請確認網路連線後再試一次。";
    }
  }

  function buildLineUrl(handle) {
    if (!handle) return "";
    // 從 Google Sheets 貼上時常見的資料問題：前後多餘空白、中文輸入法把「@」打成全形「＠」、
    // 忘記帶「@」開頭。這裡統一修正，避免加好友連結因為這些小狀況失效。
    var cleaned = String(handle).trim().replace(/＠/g, "@");
    if (cleaned.indexOf("http") === 0) return cleaned;
    if (cleaned.charAt(0) !== "@") cleaned = "@" + cleaned;
    return "https://line.me/R/ti/p/" + encodeURIComponent(cleaned);
  }

  function applyShopInfo() {
    var s = state.settings;
    if (s.shop_name) {
      els.shopName.textContent = s.shop_name;
      document.title = s.shop_name + "｜線上預購";
    }
    if (s.shop_intro) els.shopIntro.textContent = s.shop_intro;

    if (isTrue(s.announcement_visible) && s.announcement_text) {
      els.announcement.textContent = s.announcement_text;
      els.announcement.classList.remove("hidden");
    } else {
      els.announcement.classList.add("hidden");
    }

    var islandLineUrl = buildLineUrl(s.shop_line);
    if (islandLineUrl) els.islandWarningLine.href = islandLineUrl;

    var headerLineUrl = buildLineUrl(s.shop_line);
    if (headerLineUrl) {
      els.headerLineLink.href = headerLineUrl;
      els.headerLineLink.classList.remove("hidden");
    } else {
      els.headerLineLink.classList.add("hidden");
    }

    syncTopInfoHeight();
  }

  function startOrderFlow() {
    state.deliveryMethod = null;
    state.selectedSlotId = null;
    state.activeCategory = null;
    renderCategoryTabs();
    renderProducts();
    renderDeliveryOptions();
    renderSlots();
    goToStepKey("products", { scroll: false });
  }

  // ---------- 分類頁籤 ----------

  function categories() {
    var seen = {};
    var list = [];
    state.products.forEach(function (p) {
      var c = p.category || "";
      if (c && !seen[c]) {
        seen[c] = true;
        list.push(c);
      }
    });
    return list;
  }

  function renderCategoryTabs() {
    var cats = categories();
    if (cats.length < 2) {
      els.categoryTabs.classList.add("hidden");
      els.categoryTabs.innerHTML = "";
      syncCartBarHeight();
      syncTabsHeight();
      return;
    }
    if (!state.activeCategory || cats.indexOf(state.activeCategory) === -1) {
      state.activeCategory = cats[0];
    }
    els.categoryTabs.classList.remove("hidden");
    els.categoryTabs.innerHTML = "";
    cats.forEach(function (cat) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab" + (state.activeCategory === cat ? " active" : "");
      btn.textContent = cat;
      btn.addEventListener("click", function () {
        state.activeCategory = cat;
        renderCategoryTabs();
        renderProducts();
      });
      els.categoryTabs.appendChild(btn);
    });
    syncCartBarHeight();
    syncTabsHeight();
  }

  function filteredProducts() {
    var cats = categories();
    if (cats.length < 2 || !state.activeCategory) return state.products;
    return state.products.filter(function (p) {
      return (p.category || "") === state.activeCategory;
    });
  }

  // ---------- 商品（含大／小規格分組）----------

  function productGroups() {
    var groups = [];
    var byKey = {};
    filteredProducts().forEach(function (p) {
      var key = p.variant_group || p.product_id;
      if (!byKey[key]) {
        byKey[key] = { key: key, name: p.name, items: [] };
        groups.push(byKey[key]);
      }
      byKey[key].items.push(p);
    });
    return groups;
  }

  function renderProducts() {
    els.productList.innerHTML = "";
    productGroups().forEach(function (group) {
      if (group.items.length === 1) {
        els.productList.appendChild(buildProductCard(group.items[0]));
      } else {
        els.productList.appendChild(buildVariantGroupCard(group));
      }
    });
  }

  function buildStepper(p, qty, remaining) {
    var stepper = document.createElement("div");
    stepper.className = "qty-stepper";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "qty-btn";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", p.name + " 減少數量");
    minusBtn.disabled = qty <= 0;
    minusBtn.addEventListener("click", function () {
      setQty(p.product_id, qty - 1);
    });

    var qtyEl = document.createElement("span");
    qtyEl.className = "qty-value";
    qtyEl.textContent = String(qty);

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "qty-btn";
    plusBtn.textContent = "＋";
    plusBtn.setAttribute("aria-label", p.name + " 增加數量");
    plusBtn.disabled = qty >= remaining;
    plusBtn.addEventListener("click", function () {
      setQty(p.product_id, qty + 1);
    });

    stepper.appendChild(minusBtn);
    stepper.appendChild(qtyEl);
    stepper.appendChild(plusBtn);
    return stepper;
  }

  function buildProductCard(p) {
    var qty = state.cart[p.product_id] || 0;
    var remaining = maxQtyForProduct(p, qty);

    var card = document.createElement("div");
    card.className = "product-card";

    var thumb = document.createElement("div");
    thumb.className = "product-thumb";

    var info = document.createElement("div");
    info.className = "product-info";
    var name = document.createElement("p");
    name.className = "product-name";
    name.textContent = p.name;
    var meta = document.createElement("p");
    meta.className = "product-meta";
    meta.innerHTML =
      '<span class="product-price">' +
      money(p.price) +
      "</span> / " +
      escapeHtml(p.unit || "袋") +
      (p.max_per_order ? "　每人限購 " + p.max_per_order + " " + escapeHtml(p.unit || "袋") : "");
    info.appendChild(name);
    info.appendChild(meta);

    card.appendChild(thumb);
    card.appendChild(info);
    card.appendChild(buildStepper(p, qty, remaining));
    return card;
  }

  function buildVariantGroupCard(group) {
    var card = document.createElement("div");
    card.className = "variant-group";

    var name = document.createElement("p");
    name.className = "variant-group-name";
    name.textContent = group.name;
    card.appendChild(name);

    var sizeRow = document.createElement("div");
    sizeRow.className = "variant-row";
    var priceRow = document.createElement("div");
    priceRow.className = "variant-row";
    var stepperRow = document.createElement("div");
    stepperRow.className = "variant-row";

    group.items.forEach(function (p) {
      var sizeBox = document.createElement("div");
      sizeBox.className = "variant-size-box";
      sizeBox.textContent = p.variant_label || p.name;
      sizeRow.appendChild(sizeBox);

      var priceBox = document.createElement("div");
      priceBox.className = "variant-price-box";
      priceBox.innerHTML =
        '<span class="price">' +
        money(p.price) +
        "</span>" +
        (p.max_per_order ? "每人限購 " + p.max_per_order + " " + escapeHtml(p.unit || "袋") : "");
      priceRow.appendChild(priceBox);

      var qty = state.cart[p.product_id] || 0;
      var remaining = maxQtyForProduct(p, qty);
      var stepBox = document.createElement("div");
      stepBox.className = "variant-stepper-box";
      stepBox.appendChild(buildStepper(p, qty, remaining));
      stepperRow.appendChild(stepBox);
    });

    card.appendChild(sizeRow);
    card.appendChild(priceRow);
    card.appendChild(stepperRow);
    return card;
  }

  function setQty(productId, qty) {
    var product = state.products.find(function (p) {
      return p.product_id === productId;
    });
    if (!product) return;
    var currentQty = state.cart[productId] || 0;
    var max = maxQtyForProduct(product, currentQty);
    qty = Math.max(0, Math.min(qty, max));
    if (qty === 0) {
      delete state.cart[productId];
    } else {
      state.cart[productId] = qty;
    }
    renderProducts();
    updateCartBar();
  }

  // ---------- 購物車 ----------

  function cartItems() {
    return Object.keys(state.cart).map(function (productId) {
      var product = state.products.find(function (p) {
        return p.product_id === productId;
      });
      var quantity = state.cart[productId];
      var name = product ? product.name : productId;
      if (product && product.variant_label) name += "（" + product.variant_label + "）";
      return {
        product_id: productId,
        name: name,
        price: product ? product.price : 0,
        quantity: quantity,
        subtotal: (product ? product.price : 0) * quantity,
      };
    });
  }

  function cartTotal() {
    return cartItems().reduce(function (sum, item) {
      return sum + item.subtotal;
    }, 0);
  }

  function cartCount() {
    return Object.values(state.cart).reduce(function (sum, q) {
      return sum + q;
    }, 0);
  }

  function estimatedTotal() {
    return cartTotal() + (state.deliveryMethod === "delivery" ? shippingFee() : 0);
  }

  function renderCartDetailList() {
    els.cartDetailList.innerHTML = "";
    cartItems().forEach(function (item) {
      var row = document.createElement("div");
      row.className = "cart-detail-row";
      row.innerHTML =
        "<span>" + escapeHtml(item.name) + " × " + item.quantity + "</span><span>" + money(item.subtotal) + "</span>";
      els.cartDetailList.appendChild(row);
    });
    if (state.deliveryMethod === "delivery") {
      var feeRow = document.createElement("div");
      feeRow.className = "cart-detail-row fee";
      feeRow.innerHTML = "<span>低溫宅配運費</span><span>" + money(shippingFee()) + "</span>";
      els.cartDetailList.appendChild(feeRow);
    }
  }

  var CART_NEXT_LABELS = {
    products: "下一步：選取貨方式",
    slot: "下一步：填資料",
    address: "下一步：填資料",
    form: "下一步：確認訂單",
  };

  function updateCartBar() {
    renderLowStockBanner();
    var count = cartCount();
    if (count === 0) {
      els.cartSummary.classList.add("hidden");
      syncCartBarHeight();
      return;
    }

    els.cartSummary.classList.remove("hidden");
    els.cartCount.textContent = String(count);
    els.cartTotal.textContent = money(estimatedTotal());
    renderCartDetailList();

    var key = state.currentStepKey;
    if (key === "summary") {
      els.cartNextBtn.classList.add("hidden");
    } else {
      els.cartNextBtn.classList.remove("hidden");
      var label = CART_NEXT_LABELS[key];
      if (key === "delivery") {
        label =
          state.deliveryMethod === "delivery"
            ? "下一步：填地址"
            : state.deliveryMethod === "pickup"
            ? "下一步：選時段"
            : "下一步";
      }
      els.cartNextBtn.textContent = label || "下一步";
    }
    syncCartBarHeight();
  }

  // ---------- 取貨方式 ----------

  function renderDeliveryOptions() {
    document.querySelectorAll(".delivery-card").forEach(function (card) {
      var opt = card.getAttribute("data-delivery-option");
      var input = card.querySelector("input");
      var selected = state.deliveryMethod === opt;
      card.classList.toggle("selected", selected);
      input.checked = selected;
    });
    var fee = shippingFee();
    els.deliveryFeeSub.textContent = fee > 0 ? "運費 + " + money(fee) : "運費另計";
  }

  document.querySelectorAll('input[name="delivery_method"]').forEach(function (input) {
    input.addEventListener("change", function () {
      state.deliveryMethod = input.value;
      renderDeliveryOptions();
      updateCartBar();
    });
  });

  // ---------- 取貨時段 ----------

  function renderSlots() {
    els.slotList.innerHTML = "";
    var slots = (state.campaign && state.campaign.pickup_slots) || [];
    slots.forEach(function (slot) {
      var label = document.createElement("label");
      label.className = "slot-option";
      if (state.selectedSlotId === slot.slot_id) label.classList.add("selected");

      var radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "pickup_slot";
      radio.value = slot.slot_id;
      radio.checked = state.selectedSlotId === slot.slot_id;
      radio.addEventListener("change", function () {
        state.selectedSlotId = slot.slot_id;
        renderSlots();
      });

      var text = document.createElement("span");
      text.textContent = slot.date + "　" + slot.time_range;

      label.appendChild(radio);
      label.appendChild(text);
      els.slotList.appendChild(label);
    });
  }

  // ---------- 步驟切換 ----------

  function activeSteps() {
    var steps = ["products", "delivery"];
    steps.push(state.deliveryMethod === "delivery" ? "address" : "slot");
    steps.push("form", "summary");
    return steps;
  }

  function updateStepTitles() {
    var steps = activeSteps();
    steps.forEach(function (key, i) {
      if (key === "summary") return;
      var el = document.getElementById("step-" + key + "-title");
      if (el) el.textContent = (i + 1) + ". " + STEP_LABELS[key];
    });
  }

  function renderStepVisibility() {
    var key = state.currentStepKey;
    Object.keys(stepSections).forEach(function (k) {
      stepSections[k].classList.toggle("hidden", k !== key);
    });
  }

  function refreshTabsVisibility() {
    var show = state.currentStepKey === "products" && categories().length >= 2;
    els.categoryTabs.classList.toggle("hidden", !show);
    syncCartBarHeight();
    syncTabsHeight();
  }

  function goToStepKey(key, opts) {
    state.currentStepKey = key;
    renderStepVisibility();
    if (key === "summary") renderSummary();
    if (key === "delivery") renderDeliveryOptions();
    if (key === "slot") renderSlots();
    updateStepTitles();
    updateCartBar();
    refreshTabsVisibility();
    els.cartBackBtn.classList.toggle("hidden", key === "products");
    if (!opts || opts.scroll !== false) {
      stepSections[key].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function isValidPhone(value) {
    var digits = value.replace(/[^0-9]/g, "");
    return digits.length >= 8;
  }

  function validateCurrentStep() {
    var key = state.currentStepKey;
    if (key === "products") {
      if (cartCount() === 0) return "請至少選擇一項商品";
    } else if (key === "delivery") {
      if (!state.deliveryMethod) return "請選擇取貨方式";
    } else if (key === "slot") {
      if (!state.selectedSlotId) return "請選擇取貨時段";
    } else if (key === "address") {
      if (!els.deliveryAddress.value.trim()) return "請填寫收件地址";
    } else if (key === "form") {
      if (!els.customerName.value.trim()) return "請填寫姓名";
      var phone = els.customerPhone.value.trim();
      if (!phone) return "請填寫電話";
      if (!isValidPhone(phone)) return "電話號碼看起來不太對，請確認後再試一次";
    }
    return null;
  }

  function goNext() {
    var err = validateCurrentStep();
    if (err) {
      alert(err);
      return;
    }
    if (state.currentStepKey === "address" && matchesOutlyingIsland(els.deliveryAddress.value.trim())) {
      showIslandWarning();
      return;
    }
    var steps = activeSteps();
    var idx = steps.indexOf(state.currentStepKey);
    if (idx === -1 || idx === steps.length - 1) return;
    goToStepKey(steps[idx + 1]);
  }

  function goBack() {
    var steps = activeSteps();
    var idx = steps.indexOf(state.currentStepKey);
    if (idx <= 0) return;
    goToStepKey(steps[idx - 1]);
  }

  els.cartBackBtn.addEventListener("click", goBack);
  els.cartNextBtn.addEventListener("click", goNext);
  els.islandWarningCancel.addEventListener("click", hideIslandWarning);
  els.islandWarningLine.addEventListener("click", hideIslandWarning);
  // 用 ResizeObserver 只監看這兩個固定區塊「自己的」高度變化（例如公告文字換行、
  // 螢幕轉向），不要監聽 window 的 resize 事件——手機 Safari 捲動時網址列自動
  // 收合/展開也會觸發 window resize，這會讓固定區塊在每次捲動時反覆重算高度、
  // 強制重排，畫面上就會看到品牌識別區／購物車列一直「滑動」。
  if (typeof ResizeObserver !== "undefined") {
    // 一定要指定 border-box：預設的 content-box 不含 padding，而 .top-info 的
    // padding-top 含 safe-area-inset-top（轉螢幕方向會變），用 content-box 就
    // 收不到這種變化，--topinfo-h 會停在舊值，下面的購物車列就會跟著錯位。
    new ResizeObserver(syncTopInfoHeight).observe(els.topInfo, { box: "border-box" });
    new ResizeObserver(syncCartBarHeight).observe(els.cartSummary, { box: "border-box" });
    new ResizeObserver(syncTabsHeight).observe(els.categoryTabs, { box: "border-box" });
  } else {
    window.addEventListener("resize", syncCartBarHeight);
    window.addEventListener("resize", syncTopInfoHeight);
    window.addEventListener("resize", syncTabsHeight);
  }
  els.cartDetails.addEventListener("toggle", syncCartBarHeight);

  // ---------- 打字時讓出畫面空間 ----------
  // 手機鍵盤跳出來會吃掉大半個螢幕，只剩約 300～340px 可視高度，但上方固定區塊
  // （品牌識別區 + 購物車列）就佔了約 268px，等於八成的空間都被佔住，輸入框根本
  // 沒地方擺，一定會被蓋住。所以打字的時候把品牌識別區改成不固定（讓它跟著捲走），
  // 只留購物車列固定（上一步／下一步要隨時能按），空間就夠了。
  // 只在「鍵盤真的跳出來（可視高度變矮）」時才這樣做——桌機瀏覽器畫面夠高，
  // 不需要動，不然點一下輸入框品牌區就跑掉會很突兀。
  var isTyping = false;

  function updateKeyboardState() {
    // 沒有 visualViewport（舊瀏覽器）就無從判斷鍵盤在不在，一律當成有跳出來，
    // 讓出空間比被蓋住好。
    var shortScreen = window.visualViewport ? window.visualViewport.height < 560 : true;
    var wasOpen = document.body.classList.contains("keyboard-open");
    var open = isTyping && shortScreen;
    document.body.classList.toggle("keyboard-open", open);

    // 鍵盤是「跳出來之後」才讓 visualViewport 變矮的，比 focus 事件晚，所以瀏覽器
    // 自己那次「把輸入框捲進可視範圍」是在空間還沒讓出來之前算的，落點會是錯的。
    // 這裡等版面讓出空間後再捲一次，落點才會對（scroll-margin-top 會被算進去）。
    if (open !== wasOpen && open) {
      var el = document.activeElement;
      if (isTextField(el)) {
        requestAnimationFrame(function () {
          el.scrollIntoView({ block: "nearest" });
        });
      }
    }
  }

  // 只認「會叫出鍵盤」的欄位。取貨方式那一步的 radio 也是 <input>，但點它不會
  // 跳鍵盤，不該因此把品牌識別區收起來（小螢幕橫向時可能誤判）。
  var NON_TEXT_INPUT_TYPES = ["radio", "checkbox", "button", "submit", "reset", "file", "range", "color"];

  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName !== "INPUT") return false;
    return NON_TEXT_INPUT_TYPES.indexOf((el.type || "text").toLowerCase()) === -1;
  }

  document.addEventListener("focusin", function (e) {
    if (!isTextField(e.target)) return;
    isTyping = true;
    updateKeyboardState();
  });

  document.addEventListener("focusout", function (e) {
    if (!isTextField(e.target)) return;
    isTyping = false;
    updateKeyboardState();
  });

  if (window.visualViewport) {
    // 鍵盤跳出/收起只會改變 visualViewport 的高度，不會觸發一般的 resize，
    // 所以要另外監聽這個。
    window.visualViewport.addEventListener("resize", updateKeyboardState);
  }

  els.retryBtn.addEventListener("click", init);

  // ---------- 訂單摘要 ----------

  function renderSummary() {
    els.summaryCustomerInfo.innerHTML =
      bankRow("姓名", els.customerName.value.trim()) +
      bankRow("電話", els.customerPhone.value.trim()) +
      bankRow("取貨方式", fulfillmentSummaryText()) +
      bankRow("備註", els.customerNote.value.trim());

    els.summaryItems.innerHTML = "";
    cartItems().forEach(function (item) {
      var row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML =
        "<span>" +
        escapeHtml(item.name) +
        ' <span class="sub">× ' +
        item.quantity +
        "</span></span><span>" +
        money(item.subtotal) +
        "</span>";
      els.summaryItems.appendChild(row);
    });
    if (state.deliveryMethod === "delivery") {
      var feeRow = document.createElement("div");
      feeRow.className = "summary-row fee";
      feeRow.innerHTML = "<span>低溫宅配運費</span><span>" + money(shippingFee()) + "</span>";
      els.summaryItems.appendChild(feeRow);
    }
    els.summaryTotalAmount.textContent = money(estimatedTotal());
    els.submitBtn.disabled = state.submitting;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  els.submitBtn.addEventListener("click", async function () {
    var deliveryValid =
      state.deliveryMethod === "delivery"
        ? !!els.deliveryAddress.value.trim()
        : !!state.selectedSlotId;

    if (
      !els.customerName.value.trim() ||
      !isValidPhone(els.customerPhone.value.trim()) ||
      cartCount() === 0 ||
      !state.deliveryMethod ||
      !deliveryValid
    ) {
      goToStepKey("products");
      return;
    }

    state.submitting = true;
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = "送出中…";
    els.submitError.classList.add("hidden");

    try {
      var body = {
        campaign_id: state.campaign.campaign_id,
        customer_name: els.customerName.value.trim(),
        customer_phone: els.customerPhone.value.trim(),
        note: els.customerNote.value.trim(),
        delivery_method: state.deliveryMethod,
        items: cartItems().map(function (item) {
          return { product_id: item.product_id, quantity: item.quantity };
        }),
      };
      if (state.deliveryMethod === "delivery") {
        body.delivery_address = els.deliveryAddress.value.trim();
      } else {
        body.pickup_slot_id = state.selectedSlotId;
      }

      var data = await fetchJson("/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      showDone(data.order);
    } catch (e) {
      els.submitError.textContent = e.message;
      els.submitError.classList.remove("hidden");
    } finally {
      state.submitting = false;
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "送出訂單";
    }
  });

  function fulfillmentSummaryText() {
    if (state.deliveryMethod === "delivery") {
      return "🚚 低溫宅配　" + els.deliveryAddress.value.trim();
    }
    var slots = (state.campaign && state.campaign.pickup_slots) || [];
    var slot = slots.find(function (s) {
      return s.slot_id === state.selectedSlotId;
    });
    return slot ? "🏠 自取　" + slot.date + "　" + slot.time_range : "🏠 自取";
  }

  function showDone(order) {
    setStepsVisible(false);
    els.stepDone.classList.remove("hidden");
    els.cartSummary.classList.add("hidden");
    syncCartBarHeight();

    els.doneOrderId.textContent = order.order_id;

    els.doneCustomerInfo.innerHTML =
      bankRow("姓名", order.customer_name) +
      bankRow("電話", order.customer_phone) +
      bankRow("備註", order.note);

    var fulfillment = fulfillmentSummaryText();
    els.doneFulfillment.textContent = fulfillment;

    // 訂單回傳的 product_name 是 Sheets 上的原始商品名稱，同一組大/小規格會共用同一個名稱，
    // 這裡比對還留在記憶體裡的商品清單，把 variant_label 補回去，避免明細看起來像是重複品項。
    var displayItems = (order.items || []).map(function (item) {
      var product = state.products.find(function (p) {
        return p.product_id === item.product_id;
      });
      var name = item.product_name;
      if (product && product.variant_label) name += "（" + product.variant_label + "）";
      return { name: name, quantity: item.quantity, subtotal: item.subtotal };
    });

    els.doneOrderItems.innerHTML = "";
    displayItems.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "summary-row";
      row.innerHTML =
        "<span>" +
        escapeHtml(item.name) +
        ' <span class="sub">× ' +
        item.quantity +
        "</span></span><span>" +
        money(item.subtotal) +
        "</span>";
      els.doneOrderItems.appendChild(row);
    });
    // 後端 order.total 已經是商品小計 + 運費的最終金額（shipping_fee 是後端從 Settings
    // 讀到的運費，不是前端自己算的），這裡不用再加一次運費。
    var fee = Number(order.shipping_fee) || 0;
    if (fee > 0) {
      var feeRow = document.createElement("div");
      feeRow.className = "summary-row fee";
      feeRow.innerHTML = "<span>低溫宅配運費</span><span>" + money(fee) + "</span>";
      els.doneOrderItems.appendChild(feeRow);
    }
    var grandTotal = order.total || 0;
    els.doneOrderTotal.textContent = money(grandTotal);

    state.lastOrder = {
      order_id: order.order_id,
      fulfillment: fulfillment,
      note: order.note,
      items: displayItems,
      fee: fee,
      total: grandTotal,
    };
    setShareStatus("");

    var s = state.settings;
    var lineUrl = buildLineUrl(s.shop_line);
    if (lineUrl) {
      els.doneLineLink.href = lineUrl;
      els.doneLineLink.classList.remove("hidden");
    } else {
      els.doneLineLink.classList.add("hidden");
    }

    els.stepDone.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bankRow(label, value) {
    if (!value) return "";
    return (
      '<div class="row"><span class="label">' +
      label +
      "</span><span>" +
      escapeHtml(String(value)) +
      "</span></div>"
    );
  }

  // ---------- 完成頁：分享／儲存購買明細 ----------

  function setShareStatus(text) {
    if (!text) {
      els.saveShareStatus.classList.add("hidden");
      els.saveShareStatus.textContent = "";
      return;
    }
    els.saveShareStatus.textContent = text;
    els.saveShareStatus.classList.remove("hidden");
  }

  function buildOrderShareText(order) {
    var shopName = state.settings.shop_name || "訂購";
    var lines = [shopName + " 訂購明細", "訂單編號：" + order.order_id, order.fulfillment, ""];
    order.items.forEach(function (item) {
      lines.push(item.name + " × " + item.quantity + "　" + money(item.subtotal));
    });
    if (order.fee > 0) lines.push("低溫宅配運費　" + money(order.fee));
    lines.push("總計　" + money(order.total));
    if (order.note) lines.push("", "備註：" + order.note);
    return lines.join("\n");
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  // 這顆按鈕只做一件事：把明細複製成文字，行為固定、每支手機都一樣，
  // 不再嘗試判斷裝置支不支援分享/圖片，避免客人猜不到按下去會發生什麼事。
  els.saveShareBtn.addEventListener("click", async function () {
    var order = state.lastOrder;
    if (!order) return;

    setShareStatus("");
    try {
      await copyTextToClipboard(buildOrderShareText(order));
      setShareStatus("已複製，可以貼到 LINE 了。");
    } catch {
      setShareStatus("複製失敗，請直接截圖保留這個畫面。");
    }
  });

  els.restartBtn.addEventListener("click", function () {
    state.cart = {};
    state.selectedSlotId = null;
    state.deliveryMethod = null;
    els.customerName.value = "";
    els.customerPhone.value = "";
    els.customerNote.value = "";
    els.deliveryAddress.value = "";
    els.stepDone.classList.add("hidden");
    init();
  });

  init();
})();
