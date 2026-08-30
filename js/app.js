// 歪嘴雞烘焙後台 PWA — Phase 6：串接真實 Worker API（js/api.js 的 Api）
// 不再使用 localStorage 假資料，所有頁面的資料都即時向 Worker 拿。

const APP_VERSION = '2.0.1';

const root = document.getElementById('app-root');
const tabbarEl = document.getElementById('tabbar');

// ---------------- 簡易路由 ----------------
const TAB_ROUTES = ['dashboard', 'orders', 'products', 'more'];

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return hash || (Api.hasValidToken() ? 'dashboard' : 'login');
}

function navigate(path) {
  location.hash = '#/' + path;
}
window.navigate = navigate;

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => {
  if (!location.hash) {
    location.hash = Api.hasValidToken() ? '#/dashboard' : '#/login';
  } else {
    render();
  }
});

// ---------------- 小工具 ----------------
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function fmtMoney(n) {
  return '$' + Number(n).toLocaleString('zh-TW');
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return String(iso).replace('T', ' ').slice(0, 16);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isSettingTrue(v) {
  return v === true || v === 'TRUE' || v === 'true';
}

function boolToSetting(v) {
  return v ? 'TRUE' : 'FALSE';
}

function taipeiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

// 把 Sheets 讀回來的日期統一成 YYYY-MM-DD，方便直接用字串比大小。
// 依儲存格格式可能拿到 "2026-08-15" 或 "2026/8/15"，兩種都吃得下；認不出來就回傳空字串，
// 當成「沒有填結束日」處理（寧可維持開放，也不要誤判成已結束）。跟 Worker 端同一套規則。
function normalizeDateString(value) {
  const m = String(value == null ? '' : value).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// 檔期是不是「還在預購中」：status 要是 active，而且今天落在預購起訖日之間
// （start_date 當天就算開放、end_date 當天仍算開放，隔天才關；沒填的那一邊就不設限）。
function isCampaignOngoing(c, today) {
  if (!c || c.status !== 'active') return false;
  const t = today || taipeiToday();
  const startDate = normalizeDateString(c.start_date);
  if (startDate && startDate > t) return false;
  const endDate = normalizeDateString(c.end_date);
  if (endDate && endDate < t) return false;
  return true;
}

// 檔期在老闆後台要顯示的狀態徽章：ended（手動結束）優先，其次看起訖日算出
// upcoming（起日還沒到）／ended（迄日已過）／active（進行中）。跟 isCampaignOngoing()
// 是同一套起訖日規則，只是這裡多拆出「即將開始」這個純顯示用的中間狀態。
function campaignDisplayStatus(c, today) {
  if (c.status === 'ended') return 'ended';
  const t = today || taipeiToday();
  const startDate = normalizeDateString(c.start_date);
  if (startDate && startDate > t) return 'upcoming';
  const endDate = normalizeDateString(c.end_date);
  if (endDate && endDate < t) return 'ended';
  return 'active';
}

// 顧客端現在到底能不能下單：老闆的手動開關 AND 至少有一個還在預購中的檔期。
// 只要還有一個檔期沒結束就維持開放（同時有兩檔、其中一檔結束時不會被誤關）。
function getPreorderState(settings, campaigns) {
  const manualOpen = isSettingTrue((settings || {}).preorder_open);
  const today = taipeiToday();
  const ongoing = (campaigns || []).filter(c => isCampaignOngoing(c, today));
  if (!manualOpen) {
    return { open: false, reason: 'paused', label: '預購已暫停', ongoing };
  }
  if (ongoing.length === 0) {
    return { open: false, reason: 'no_campaign', label: '目前無預購檔期', ongoing };
  }
  return { open: true, reason: 'open', label: '預購開放中', ongoing };
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = el(`<div class="toast">${escapeHtml(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function showDialog({ title, body, confirmText = '確認', cancelText = '取消', danger = false, onConfirm, hideCancel = false }) {
  const overlay = el(`
    <div class="overlay centered">
      <div class="dialog">
        <div class="dialog-title">${escapeHtml(title)}</div>
        <div class="dialog-body">${body}</div>
        <div class="btn-row" style="margin-top:0">
          ${hideCancel ? '' : `<button class="btn btn-outline" data-act="cancel">${escapeHtml(cancelText)}</button>`}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    </div>
  `);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('[data-act="cancel"]')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => {
    overlay.remove();
    onConfirm && onConfirm();
  });
  document.body.appendChild(overlay);
}

// 儲存流程用的「處理中 → 完成/失敗」彈窗：按下儲存立刻顯示處理中，
// API 回應後同一個彈窗切換內容，避免儲存按鈕按下去沒有任何畫面反應。
function showProcessingDialog() {
  const overlay = el(`
    <div class="overlay centered">
      <div class="dialog process-dialog">
        <div class="process-spinner"></div>
        <div class="process-text">處理中…</div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector('.dialog');

  function renderResult(title, body, danger) {
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <div class="dialog-title">${escapeHtml(title)}</div>
      ${body ? `<div class="dialog-body">${escapeHtml(body)}</div>` : ''}
      <div class="btn-row" style="margin-top:${body ? '0' : '16px'}">
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm">確定</button>
      </div>
    `;
    return new Promise((resolve) => {
      dialog.querySelector('[data-act="confirm"]').addEventListener('click', () => {
        overlay.remove();
        resolve();
      });
    });
  }

  return {
    success(title, onConfirm) {
      renderResult(title).then(() => onConfirm && onConfirm());
    },
    error(message) {
      renderResult('儲存失敗', message, true);
    },
    close() {
      overlay.remove();
    },
  };
}

// ---------------- Layout：頂部列 ----------------
function topbar({ title, back, action }) {
  return `
    <div class="topbar ${back ? '' : ''}">
      ${back ? `<button class="topbar-back" data-nav="${back}">‹</button>` : ''}
      <div class="topbar-title">${escapeHtml(title)}</div>
      ${action ? `<button class="topbar-action" data-act="${action.act}">${escapeHtml(action.label)}</button>` : ''}
    </div>
  `;
}

// ---------------- 載入中／錯誤共用畫面 ----------------
function loadingPage({ title, back }) {
  setContent(`
    ${topbar({ title, back })}
    <div class="page"><div class="empty-state"><div class="icon">⏳</div>載入中…</div></div>
  `);
}

function errorPage({ title, back, message, retry }) {
  setContent(`
    ${topbar({ title, back })}
    <div class="page">
      <div class="empty-state">
        <div class="icon">⚠️</div>
        ${escapeHtml(message)}
      </div>
      <button class="btn btn-outline" id="btn-retry" style="max-width:200px; margin:0 auto; display:block;">重新載入</button>
    </div>
  `);
  root.querySelector('#btn-retry').addEventListener('click', retry);
}

// 統一處理 API 錯誤：401 直接導回登入頁，其他錯誤顯示重試畫面。
function handleLoadError(err, { title, back, retry }) {
  if (err.isAuthError) {
    showToast(err.message);
    navigate('login');
    return;
  }
  errorPage({ title, back, message: err.message, retry });
}

// ---------------- Tabbar ----------------
const TABS = [
  { key: 'dashboard', icon: '🏠', label: '首頁' },
  { key: 'orders', icon: '📦', label: '訂單' },
  { key: 'products', icon: '🥖', label: '商品' },
  { key: 'more', icon: '☰', label: '更多' }
];

function renderTabbar(activeKey) {
  tabbarEl.innerHTML = TABS.map(t => `
    <button class="tab-item ${t.key === activeKey ? 'active' : ''}" data-nav="${t.key}">
      <span class="tab-icon">${t.icon}</span>
      <span>${t.label}</span>
    </button>
  `).join('');
}

// ================== 主渲染 ==================
function render() {
  const route = currentRoute();
  const parts = route.split('/');
  const base = parts[0];

  if (base !== 'login' && !Api.hasValidToken()) {
    location.hash = '#/login';
    return;
  }

  if (base === 'login') {
    tabbarEl.style.display = 'none';
    document.getElementById('app').style.paddingBottom = '0';
    renderLogin();
    return;
  }

  document.getElementById('app').style.paddingBottom = '';

  const isTopLevel = TAB_ROUTES.includes(route);
  tabbarEl.style.display = 'flex';
  renderTabbar(isTopLevel ? base : (['orders', 'products', 'more'].includes(base) ? base : 'dashboard'));

  switch (base) {
    case 'dashboard': return renderDashboard();
    case 'orders':
      return parts[1] ? renderOrderDetail(parts[1]) : renderOrdersList();
    case 'products':
      return parts[1] ? renderProductEdit(parts[1]) : renderProductsList();
    case 'more':
      if (!parts[1]) return renderMoreMenu();
      if (parts[1] === 'announcement') return renderAnnouncement();
      if (parts[1] === 'shop') return renderShop();
      if (parts[1] === 'toggle') return renderToggle();
      if (parts[1] === 'campaigns') return parts[2] ? renderCampaignEdit(parts[2]) : renderCampaignsList();
      return renderMoreMenu();
    default:
      return renderDashboard();
  }
}

// 事件委派：所有 data-nav / data-act 統一處理
document.addEventListener('click', (e) => {
  const navEl = e.target.closest('[data-nav]');
  if (navEl) {
    navigate(navEl.getAttribute('data-nav'));
  }
});

function setContent(html) {
  root.innerHTML = html;
}

// ================== PIN 登入 ==================
let pinBuffer = '';
let pinChecking = false;

function renderLogin() {
  pinBuffer = '';
  pinChecking = false;
  setContent(`
    <div class="pin-screen">
      <div class="pin-logo"><img src="icons/logo.png" alt="歪嘴雞烘焙"></div>
      <div class="pin-shop-name">歪嘴雞烘焙</div>
      <div class="pin-sub">老闆後台登入</div>
      <div class="pin-dots" id="pin-dots">
        ${[0,1,2,3,4,5].map(() => `<span class="pin-dot"></span>`).join('')}
      </div>
      <div class="pin-keypad" id="pin-keypad">
        ${['1','2','3','4','5','6','7','8','9','','0','⌫'].map(k => {
          if (k === '') return `<div class="pin-key empty"></div>`;
          const isFunc = k === '⌫';
          return `<button class="pin-key ${isFunc ? 'func' : ''}" data-key="${k}">${k}</button>`;
        }).join('')}
      </div>
      <div class="pin-lock-msg" id="pin-lock-msg"></div>
    </div>
    <div class="pin-version">v${APP_VERSION}</div>
  `);

  root.querySelectorAll('[data-key]').forEach(btn => {
    btn.addEventListener('click', () => handlePinKey(btn.getAttribute('data-key')));
  });
}

function handlePinKey(key) {
  if (pinChecking) return;
  if (key === '⌫') {
    pinBuffer = pinBuffer.slice(0, -1);
    renderPinDots();
    return;
  }
  if (pinBuffer.length >= 6) return;
  pinBuffer += key;
  renderPinDots();
  if (pinBuffer.length === 6) {
    setTimeout(checkPin, 120);
  }
}

function renderPinDots(errorState = false) {
  const dotsWrap = document.getElementById('pin-dots');
  if (!dotsWrap) return;
  const dots = dotsWrap.querySelectorAll('.pin-dot');
  dots.forEach((d, i) => {
    d.classList.toggle('filled', i < pinBuffer.length && !errorState);
    d.classList.toggle('error', errorState);
  });
}

async function checkPin() {
  pinChecking = true;
  const keypad = document.getElementById('pin-keypad');
  const msg = document.getElementById('pin-lock-msg');
  if (keypad) { keypad.style.pointerEvents = 'none'; keypad.style.opacity = '0.5'; }
  if (msg) msg.textContent = '登入中…';

  const pin = pinBuffer;
  try {
    const data = await Api.login(pin);
    Api.setToken(data.token, data.expires_at);
    navigate('dashboard');
    return;
  } catch (err) {
    const dotsWrap = document.getElementById('pin-dots');
    renderPinDots(true);
    dotsWrap.classList.add('shake');
    if (navigator.vibrate) navigator.vibrate(200);
    setTimeout(() => {
      pinBuffer = '';
      pinChecking = false;
      dotsWrap.classList.remove('shake');
      renderPinDots(false);
      if (keypad) { keypad.style.pointerEvents = ''; keypad.style.opacity = ''; }
      if (msg) msg.textContent = err.message || 'PIN 錯誤';
    }, 400);
  }
}

// ================== 🏠 今日 Dashboard ==================
async function renderDashboard() {
  loadingPage({ title: '' });

  let settingsData, ordersData, campaignsData, productsData;
  try {
    [settingsData, ordersData, campaignsData, productsData] = await Promise.all([
      Api.get('/settings'),
      Api.get('/orders'),
      Api.get('/admin/campaigns'),
      Api.get('/admin/products'),
    ]);
  } catch (err) {
    handleLoadError(err, { title: '首頁', retry: renderDashboard });
    return;
  }

  const settings = settingsData.settings || {};
  const orders = ordersData.orders || [];
  const campaigns = campaignsData.campaigns || [];
  const products = productsData.products || [];

  const shopName = settings.shop_name || '歪嘴雞烘焙';
  // preorderOpen 是老闆手動開關的狀態（點「預購開關」時要切換的就是它）；
  // preorder 則是顧客端實際看到的狀態＝手動開關 AND 還有沒結束的檔期。
  const preorderOpen = isSettingTrue(settings.preorder_open);
  const preorder = getPreorderState(settings, campaigns);

  const today = taipeiToday();
  // 有多個檔期時，優先顯示「還在預購中」那一檔的已訂購量；都結束了才退回顯示最後一個
  // status=active 的檔期（訂單還要備料出貨，數字留著給老闆看）。
  const activeCampaign = preorder.ongoing[0]
    || campaigns.filter(c => c.status === 'active').pop()
    || null;
  // 檔期狀態還掛著「進行中」，但預購結束日已經過了——底下的已訂購量還是照常顯示
  // （訂單要備料出貨），只是加註一行提醒老闆這檔已經不收單了。
  const activeCampaignEnded = !!activeCampaign && !isCampaignOngoing(activeCampaign, today);
  const todayOrders = orders.filter(o => (o.created_at || '').startsWith(today));
  const pendingPayment = orders.filter(o => o.payment_status === 'pending' && o.order_status !== 'picked_up' && o.order_status !== 'cancelled');

  function campaignOrderedQty(campaignId) {
    return orders
      .filter(o => o.campaign_id === campaignId && o.order_status !== 'cancelled')
      .flatMap(o => o.items || [])
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  const orderedQty = activeCampaign ? campaignOrderedQty(activeCampaign.campaign_id) : 0;
  const orderedPct = activeCampaign && activeCampaign.total_quantity_cap
    ? Math.min(100, Math.round(orderedQty / activeCampaign.total_quantity_cap * 100))
    : 0;

  const todoItems = pendingPayment.slice(0, 5).map(o => `
    <button class="todo-item card-tap" style="width:100%;" data-nav="orders/${o.order_id}">
      <div class="todo-icon">💰</div>
      <div class="todo-main">
        <div class="todo-title">${escapeHtml(o.customer_name)} · ${fmtMoney(o.total)}</div>
        <div class="todo-sub">${o.order_id} · 待確認付款</div>
      </div>
      <div class="todo-chevron">›</div>
    </button>
  `).join('');

  // 備料總覽：依 product_id 加總「新訂單」（還沒備料）的品項數量
  const scopedProducts = activeCampaign ? products.filter(p => p.campaign_id === activeCampaign.campaign_id) : products;
  const prepQtyByProduct = {};
  orders
    .filter(o => o.order_status === 'new')
    .flatMap(o => o.items || [])
    .forEach(item => {
      prepQtyByProduct[item.product_id] = (prepQtyByProduct[item.product_id] || 0) + item.quantity;
    });
  const prepProducts = scopedProducts
    .map(p => ({ ...p, prepQty: prepQtyByProduct[p.product_id] || 0 }))
    .filter(p => p.prepQty > 0)
    .sort((a, b) => b.prepQty - a.prepQty);
  const prepRows = prepProducts.map(p => `
    <div class="prep-row">
      <div class="prep-name">🥖 ${escapeHtml(p.name)}${p.variant_label ? `（${escapeHtml(p.variant_label)}）` : ''}</div>
      <div class="prep-count">${p.prepQty}</div>
    </div>
  `).join('');

  setContent(`
    <div class="topbar">
      <div class="brand-row" style="margin-bottom:0;">
        <div class="brand-logo"><img src="icons/logo.png" alt="${escapeHtml(shopName)}"></div>
        <div>
          <div class="brand-name">${escapeHtml(shopName)}</div>
          <div class="brand-status">
            <span class="status-dot ${preorder.open ? '' : 'paused'}"></span>
            ${preorder.label}
          </div>
        </div>
      </div>
    </div>
    <div class="page">
      <button class="btn btn-outline" id="btn-refresh" data-act="refresh" style="margin-bottom:14px;">檢查新訂單</button>
      <div class="section">
        <div class="section-title">今日摘要</div>
        <div class="summary-grid">
          <button class="summary-card card-tap" data-nav="orders">
            <div class="num">${todayOrders.length}</div>
            <div class="label">今日新訂單</div>
          </button>
          <button class="summary-card card-tap" data-nav="orders">
            <div class="num">${pendingPayment.length}</div>
            <div class="label">待確認付款</div>
          </button>
          <button class="summary-card card-tap" data-nav="more/campaigns">
            <div class="num">${orderedPct}%</div>
            <div class="label">已訂購量</div>
          </button>
        </div>
        ${activeCampaign ? `
          <div class="card" style="margin-top:10px;">
            <div class="order-line" style="margin-top:0;">
              <span>${escapeHtml(activeCampaign.name)}</span>
              <span>${orderedQty} / ${activeCampaign.total_quantity_cap || '不限'}</span>
            </div>
            <div class="progress-bar"><div class="progress-bar-fill" style="width:${orderedPct}%"></div></div>
            ${activeCampaignEnded ? `<div class="field-hint" style="text-align:left; margin-top:8px;">預購期間已結束（${escapeHtml(activeCampaign.end_date || '')}），顧客端已停止收單</div>` : ''}
          </div>
        ` : `<div class="field-hint" style="text-align:left; margin-top:8px;">目前沒有進行中的檔期</div>`}
      </div>

      <div class="section">
        <div class="section-title">待處理事項</div>
        <div class="card" style="padding:4px 16px;">
          ${todoItems || `<div class="empty-state" style="padding:24px 0;"><div class="icon">✅</div>目前沒有待處理事項</div>`}
        </div>
      </div>

      <div class="section">
        <div class="section-title">備料總覽（新訂單，依數量排序）</div>
        <div class="card" style="padding:4px 16px;">
          ${prepRows || `<div class="empty-state" style="padding:24px 0;"><div class="icon">✅</div>目前沒有新訂單待備料</div>`}
        </div>
      </div>

      <div class="section">
        <div class="section-title">快捷功能</div>
        <div class="quick-grid">
          <button class="quick-btn" data-nav="more/announcement"><span class="icon">📢</span>編輯公告</button>
          <button class="quick-btn" data-nav="products"><span class="icon">🥖</span>商品管理</button>
          <button class="quick-btn" data-nav="more/campaigns"><span class="icon">📅</span>檔期設定</button>
          <button class="quick-btn" data-act="quick-toggle"><span class="icon">🔴</span>預購開關</button>
        </div>
      </div>
    </div>
  `);

  root.querySelector('[data-act="quick-toggle"]').addEventListener('click', () => {
    confirmTogglePreorder(preorderOpen, () => renderDashboard());
  });

  root.querySelector('[data-act="refresh"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '檢查中…';
    try {
      await renderDashboard();
      showToast('已檢查最新訂單');
    } finally {
      btn.disabled = false;
      btn.textContent = '檢查新訂單';
    }
  });
}

function confirmTogglePreorder(currentOpen, onDone) {
  const willOpen = !currentOpen;
  showDialog({
    title: willOpen ? '確定要開放預購嗎？' : '確定要暫停預購嗎？',
    body: willOpen ? '開放後，顧客即可在預購網站正常下單。' : '暫停後，顧客端將顯示暫停訊息，無法送出新訂單。',
    danger: !willOpen,
    onConfirm: async () => {
      try {
        await Api.patch('/settings', { preorder_open: boolToSetting(willOpen) });
        showToast(willOpen ? '已開放預購' : '已暫停預購');
        onDone && onDone();
      } catch (err) {
        if (err.isAuthError) { navigate('login'); return; }
        showToast(err.message);
      }
    }
  });
}

// ================== 📦 訂單列表 ==================
const ORDER_STATUS_LABEL = {
  new: '新訂單', prepping_done: '未取貨', picked_up: '已取貨', cancelled: '已取消'
};

function orderBadge(o) {
  if (o.order_status === 'cancelled') return `<span class="badge badge-cancelled">已取消</span>`;
  if (o.order_status === 'picked_up') return `<span class="badge badge-done">已取貨</span>`;
  if (o.order_status === 'prepping_done') return `<span class="badge badge-confirmed">未取貨</span>`;
  if (o.payment_status === 'pending') return `<span class="badge badge-pending">待確認付款</span>`;
  return `<span class="badge badge-confirmed">已確認</span>`;
}

// 把所有檔期的取貨時段攤平成 slot_id -> {date, time_range} 的查詢表，訂單只存 pickup_slot_id。
function buildSlotMap(campaigns) {
  const map = {};
  campaigns.forEach(c => (c.pickup_slots || []).forEach(s => { map[s.slot_id] = s; }));
  return map;
}

function fulfillmentSummary(o, slotMap) {
  if (o.delivery_method === 'delivery') {
    return `宅配 · ${escapeHtml(o.delivery_address || '')}`;
  }
  const slot = slotMap[o.pickup_slot_id];
  return slot ? `自取 · ${escapeHtml(slot.date)} ${escapeHtml(slot.time_range)}` : '自取';
}

// 訂單列表預設只看「目前這檔」，避免舊團購的一堆已取消/已取貨訂單擠在畫面上；
// campaign 是 null 代表還沒決定，第一次載入時會自動選目前 active 的檔期（沒有的話退回全部檔期）。
let orderFilter = { chip: 'all', search: '', campaign: null };

async function renderOrdersList() {
  loadingPage({ title: '訂單列表' });

  let ordersData, campaignsData;
  try {
    [ordersData, campaignsData] = await Promise.all([
      Api.get('/orders'),
      Api.get('/admin/campaigns'),
    ]);
  } catch (err) {
    handleLoadError(err, { title: '訂單列表', retry: renderOrdersList });
    return;
  }

  const orders = ordersData.orders || [];
  const campaigns = campaignsData.campaigns || [];
  const slotMap = buildSlotMap(campaigns);

  if (orderFilter.campaign === null) {
    const active = campaigns.find(c => c.status === 'active');
    orderFilter.campaign = active ? active.campaign_id : 'all';
  }
  const campaignChips = [{ campaign_id: 'all', name: '全部檔期' }, ...campaigns.slice().reverse()];

  const chips = [
    { key: 'all', label: '全部' },
    { key: 'pending', label: '待確認付款' },
    { key: 'confirmed', label: '已確認' },
    { key: 'prepping_done', label: '未取貨' },
    { key: 'picked_up', label: '已取貨' },
    { key: 'cancelled', label: '已取消' },
    { key: 'pickup', label: '自取' },
    { key: 'delivery', label: '宅配' },
  ];

  let list = orders.slice();
  if (orderFilter.campaign !== 'all') list = list.filter(o => o.campaign_id === orderFilter.campaign);
  if (orderFilter.chip === 'pending') list = list.filter(o => o.payment_status === 'pending' && o.order_status === 'new');
  else if (orderFilter.chip === 'confirmed') list = list.filter(o => o.payment_status === 'confirmed' && o.order_status === 'new');
  else if (orderFilter.chip === 'prepping_done') list = list.filter(o => o.order_status === 'prepping_done');
  else if (orderFilter.chip === 'picked_up') list = list.filter(o => o.order_status === 'picked_up');
  else if (orderFilter.chip === 'cancelled') list = list.filter(o => o.order_status === 'cancelled');
  else if (orderFilter.chip === 'pickup') list = list.filter(o => o.delivery_method !== 'delivery');
  else if (orderFilter.chip === 'delivery') list = list.filter(o => o.delivery_method === 'delivery');

  if (orderFilter.search.trim()) {
    const q = orderFilter.search.trim();
    list = list.filter(o => o.customer_name.includes(q) || o.order_id.includes(q) || o.customer_phone.includes(q));
  }

  const cards = list.map(o => {
    const itemsSummary = (o.items || []).map(i => `${i.product_name} x${i.quantity}`).join('、');
    return `
      <button class="card card-tap" data-nav="orders/${o.order_id}">
        <div class="order-card-top">
          <div>
            <div class="order-id">${o.order_id}</div>
            <div class="order-customer">${escapeHtml(o.customer_name)}</div>
          </div>
          ${orderBadge(o)}
        </div>
        <div class="order-line"><span>取貨方式</span><span>${fulfillmentSummary(o, slotMap)}</span></div>
        <div class="order-line"><span>品項</span><span>${escapeHtml(itemsSummary)}</span></div>
        <div class="order-amount">${fmtMoney(o.total)}</div>
      </button>
    `;
  }).join('');

  setContent(`
    <div class="topbar"><div class="topbar-title">訂單列表</div></div>
    <div class="page">
      <input class="search-input" id="order-search" placeholder="搜尋訂單編號 / 姓名 / 電話" value="${escapeHtml(orderFilter.search)}" />
      <div class="chip-row">
        ${campaignChips.map(c => `<button class="chip ${orderFilter.campaign === c.campaign_id ? 'active' : ''}" data-campaign-chip="${c.campaign_id}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      <div class="chip-row">
        ${chips.map(c => `<button class="chip ${orderFilter.chip === c.key ? 'active' : ''}" data-chip="${c.key}">${c.label}</button>`).join('')}
      </div>
      ${cards || `<div class="empty-state"><div class="icon">📭</div>沒有符合條件的訂單</div>`}
    </div>
  `);

  root.querySelectorAll('[data-campaign-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      orderFilter.campaign = btn.getAttribute('data-campaign-chip');
      renderOrdersList();
    });
  });
  root.querySelectorAll('[data-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      orderFilter.chip = btn.getAttribute('data-chip');
      renderOrdersList();
    });
  });
  const searchInput = root.querySelector('#order-search');
  searchInput.addEventListener('input', () => {
    orderFilter.search = searchInput.value;
    renderOrdersList();
  });
}

async function renderOrderDetail(id) {
  loadingPage({ title: '訂單詳情', back: 'orders' });

  let ordersData, campaignsData;
  try {
    [ordersData, campaignsData] = await Promise.all([
      Api.get('/orders'),
      Api.get('/admin/campaigns'),
    ]);
  } catch (err) {
    handleLoadError(err, { title: '訂單詳情', back: 'orders', retry: () => renderOrderDetail(id) });
    return;
  }

  const o = (ordersData.orders || []).find(x => x.order_id === id);
  if (!o) { navigate('orders'); return; }
  const slotMap = buildSlotMap(campaignsData.campaigns || []);

  const itemsHtml = (o.items || []).map(i => `
    <div class="order-line" style="font-size:14px; color:var(--color-text);">
      <span>${escapeHtml(i.product_name)} x${i.quantity}</span>
      <span>${fmtMoney(i.subtotal)}</span>
    </div>
  `).join('');

  const canConfirmPayment = o.payment_status === 'pending' && (o.order_status === 'new' || o.order_status === 'prepping_done');
  const canMarkPrepped = o.order_status === 'new';
  const canMarkPickedUp = o.order_status === 'prepping_done';
  const canCancel = o.order_status === 'new' || o.order_status === 'prepping_done';

  setContent(`
    ${topbar({ title: '訂單詳情', back: 'orders' })}
    <div class="page">
      <div class="card">
        <div class="order-card-top">
          <div>
            <div class="order-id">${o.order_id}</div>
            <div class="order-customer">${escapeHtml(o.customer_name)}</div>
          </div>
          ${orderBadge(o)}
        </div>
        <div class="order-line"><span>電話</span><span>${escapeHtml(o.customer_phone)}</span></div>
        <div class="order-line"><span>取貨方式</span><span>${o.delivery_method === 'delivery' ? '宅配' : '自取'}</span></div>
        ${o.delivery_method === 'delivery'
          ? `<div class="order-line"><span>收件地址</span><span>${escapeHtml(o.delivery_address || '')}</span></div>`
          : `<div class="order-line"><span>取貨時段</span><span>${slotMap[o.pickup_slot_id] ? escapeHtml(slotMap[o.pickup_slot_id].date + ' ' + slotMap[o.pickup_slot_id].time_range) : '—'}</span></div>`}
        <div class="order-line"><span>建立時間</span><span>${escapeHtml(fmtDateTime(o.created_at))}</span></div>
      </div>

      <div class="card">
        <div class="section-title" style="margin-bottom:10px;">品項明細</div>
        ${itemsHtml}
        ${o.delivery_method === 'delivery' ? `<div class="order-line"><span>運費</span><span>${fmtMoney(o.shipping_fee)}</span></div>` : ''}
        <div class="order-amount">總計 ${fmtMoney(o.total)}</div>
      </div>

      ${o.note ? `
        <div class="card">
          <div class="section-title" style="margin-bottom:6px;">備註</div>
          <div style="font-size:14px;">${escapeHtml(o.note)}</div>
        </div>
      ` : ''}

      <div class="section" style="margin-top:20px;">
        ${canConfirmPayment ? `<button class="btn btn-primary" data-act="confirm-payment" style="margin-bottom:10px;">✅ 確認付款</button>` : ''}
        ${canMarkPrepped ? `<button class="btn btn-outline" data-act="mark-prepped" style="margin-bottom:10px;">🥯 標記已備料</button>` : ''}
        ${canMarkPickedUp ? `<button class="btn btn-outline" data-act="mark-pickedup" style="margin-bottom:10px;">📦 標記已取貨</button>` : ''}
        ${canCancel ? `<button class="btn btn-danger" data-act="cancel-order">取消訂單</button>` : ''}
      </div>
      <div class="field-hint" style="text-align:left; margin-top:4px;">如需修改品項，請客戶取消後重新下單。</div>

      <div class="section" style="margin-top:20px;">
        <button class="btn btn-danger" data-act="delete-order">🗑️ 永久刪除此訂單</button>
        <div class="field-hint" style="text-align:left; margin-top:4px;">跟「取消訂單」不一樣，這個動作會把訂單從資料表徹底移除，無法復原，通常用在測試訂單或輸入錯誤的情況。</div>
      </div>
    </div>
  `);

  async function patchOrder(patch, successMsg) {
    try {
      await Api.patch(`/orders/${encodeURIComponent(id)}`, patch);
      showToast(successMsg);
      renderOrderDetail(id);
    } catch (err) {
      if (err.isAuthError) { navigate('login'); return; }
      showToast(err.message);
    }
  }

  root.querySelector('[data-act="confirm-payment"]')?.addEventListener('click', () => {
    showDialog({
      title: '確認已收到付款？',
      body: `訂單 ${o.order_id}，金額 ${fmtMoney(o.total)}`,
      confirmText: '確認付款',
      onConfirm: () => patchOrder({ payment_status: 'confirmed' }, '已確認付款'),
    });
  });
  root.querySelector('[data-act="mark-prepped"]')?.addEventListener('click', () => {
    patchOrder({ order_status: 'prepping_done' }, '已標記為未取貨（已備料）');
  });
  root.querySelector('[data-act="mark-pickedup"]')?.addEventListener('click', () => {
    patchOrder({ order_status: 'picked_up' }, '已標記為已取貨');
  });
  root.querySelector('[data-act="cancel-order"]')?.addEventListener('click', () => {
    showDialog({
      title: '確定要取消此訂單？',
      body: '取消後將無法復原，若客戶要重新訂購請請他重新送出訂單。',
      danger: true,
      confirmText: '取消訂單',
      onConfirm: () => patchOrder({ order_status: 'cancelled' }, '訂單已取消'),
    });
  });
  root.querySelector('[data-act="delete-order"]')?.addEventListener('click', () => {
    showDialog({
      title: '確定要永久刪除此訂單？',
      body: `訂單 ${o.order_id} 連同品項明細會從資料表徹底移除，<strong>無法復原</strong>，跟「取消訂單」不一樣。確定要刪除嗎？`,
      danger: true,
      confirmText: '永久刪除',
      onConfirm: async () => {
        try {
          await Api.del(`/orders/${encodeURIComponent(id)}`);
          showToast('訂單已永久刪除');
          navigate('orders');
        } catch (err) {
          if (err.isAuthError) { navigate('login'); return; }
          showToast(err.message);
        }
      },
    });
  });
}

// ================== 🥖 商品管理 ==================
let productFilterCampaign = 'all';

async function renderProductsList() {
  loadingPage({ title: '商品管理' });

  let productsData, campaignsData;
  try {
    [productsData, campaignsData] = await Promise.all([
      Api.get('/admin/products'),
      Api.get('/admin/campaigns'),
    ]);
  } catch (err) {
    handleLoadError(err, { title: '商品管理', retry: renderProductsList });
    return;
  }

  const products = productsData.products || [];
  const campaigns = campaignsData.campaigns || [];
  const chips = [{ campaign_id: 'all', name: '全部檔期' }, ...campaigns];

  let list = products.slice();
  if (productFilterCampaign !== 'all') list = list.filter(p => p.campaign_id === productFilterCampaign);

  const cards = list.map(p => `
    <div class="card">
      <div class="product-card">
        <button class="card-tap" data-nav="products/${p.product_id}" style="display:flex; gap:12px; flex:1; min-width:0; align-items:center;">
          <div class="product-thumb">🥖</div>
          <div class="product-main">
            <div class="product-name">${escapeHtml(p.name)}${p.variant_label ? ` <span style="color:var(--color-text-muted); font-weight:normal;">（${escapeHtml(p.variant_label)}）</span>` : ''}</div>
            <div class="product-meta">${fmtMoney(p.price)} · 限購 ${p.max_per_order} ${escapeHtml(p.unit || '袋')}</div>
            <div class="product-ordered">已訂購 ${p.ordered_quantity}${p.quantity_cap ? ` / 總量上限 ${p.quantity_cap}` : ''}</div>
          </div>
        </button>
        <div class="product-side">
          <div class="switch ${p.active ? 'on' : ''}" data-toggle-active="${p.product_id}"></div>
        </div>
      </div>
    </div>
  `).join('');

  setContent(`
    <div class="topbar">
      <div class="topbar-title">商品管理</div>
      <button class="topbar-action" data-nav="products/new">+ 新增</button>
    </div>
    <div class="page">
      <div class="chip-row">
        ${chips.map(c => `<button class="chip ${productFilterCampaign === c.campaign_id ? 'active' : ''}" data-chip="${c.campaign_id}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      ${cards || `<div class="empty-state"><div class="icon">🥯</div>此檔期尚無商品</div>`}
    </div>
  `);

  root.querySelectorAll('[data-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      productFilterCampaign = btn.getAttribute('data-chip');
      renderProductsList();
    });
  });
  root.querySelectorAll('[data-toggle-active]').forEach(sw => {
    sw.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = sw.getAttribute('data-toggle-active');
      const p = products.find(x => x.product_id === id);
      try {
        await Api.patch(`/products/${encodeURIComponent(id)}`, { active: !p.active });
        showToast(!p.active ? `${p.name} 已上架` : `${p.name} 已下架`);
        renderProductsList();
      } catch (err) {
        if (err.isAuthError) { navigate('login'); return; }
        showToast(err.message);
      }
    });
  });
}

async function renderProductEdit(id) {
  const isNew = id === 'new';
  loadingPage({ title: isNew ? '新增商品' : '編輯商品', back: 'products' });

  let campaignsData, p;
  try {
    campaignsData = await Api.get('/admin/campaigns');
    if (!isNew) {
      const productsData = await Api.get('/admin/products');
      p = (productsData.products || []).find(x => x.product_id === id);
      if (!p) { navigate('products'); return; }
    }
  } catch (err) {
    handleLoadError(err, { title: isNew ? '新增商品' : '編輯商品', back: 'products', retry: () => renderProductEdit(id) });
    return;
  }

  const campaigns = campaignsData.campaigns || [];
  const data = isNew
    ? { product_id: null, name: '', category: '', price: '', max_per_order: '', campaign_id: campaigns[0]?.campaign_id || '', active: true, variant_group: '', variant_label: '', unit: '', quantity_cap: '' }
    : p;

  setContent(`
    ${topbar({ title: isNew ? '新增商品' : '編輯商品', back: 'products' })}
    <div class="page">
      <div class="field">
        <label class="field-label">商品名稱</label>
        <input class="field-input" id="f-name" value="${escapeHtml(data.name)}" placeholder="例：原味貝果" />
      </div>
      <div class="field">
        <label class="field-label">分類</label>
        <input class="field-input" id="f-category" value="${escapeHtml(data.category || '')}" placeholder="例：有餡系列" />
      </div>
      <div class="field">
        <label class="field-label">價格</label>
        <input class="field-input" id="f-price" type="number" inputmode="numeric" value="${data.price}" placeholder="0" />
      </div>
      <div class="field">
        <label class="field-label">單筆訂單限購數量</label>
        <input class="field-input" id="f-max" type="number" inputmode="numeric" value="${data.max_per_order}" placeholder="0" />
      </div>
      <div class="field">
        <label class="field-label">數量單位</label>
        <input class="field-input" id="f-unit" value="${escapeHtml(data.unit || '')}" placeholder="例：盒、份、顆，不填預設為「袋」" />
      </div>
      <div class="field">
        <label class="field-label">商品總量上限</label>
        <input class="field-input" id="f-quantity-cap" type="number" inputmode="numeric" value="${data.quantity_cap || ''}" placeholder="不填代表不限制" />
        <div class="field-hint">這個商品全部訂單合計最多能賣幾份，賣完自動額滿；跟上面「單筆訂單限購數量」是不同東西，用來讓同一檔期裡不同商品各自獨立限量（例如兩款中秋節禮盒各自設定不同總量）</div>
      </div>
      <div class="field">
        <label class="field-label">所屬檔期</label>
        <select class="field-select" id="f-campaign">
          ${campaigns.map(c => `<option value="${c.campaign_id}" ${c.campaign_id === data.campaign_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field-label">規格分組</label>
        <input class="field-input" id="f-variant-group" value="${escapeHtml(data.variant_group || '')}" placeholder="同一組大小規格請填一樣的值，例：V001" />
        <div class="field-hint">沒有大小規格的商品留空白即可</div>
      </div>
      <div class="field">
        <label class="field-label">規格標籤</label>
        <input class="field-input" id="f-variant-label" value="${escapeHtml(data.variant_label || '')}" placeholder="顯示在商品卡上的規格文字，例：大　5顆/袋" />
      </div>
      <div class="field">
        <div class="field-row">
          <label class="field-label" style="margin-bottom:0;">上架狀態</label>
          <div class="switch ${data.active ? 'on' : ''}" id="f-active"></div>
        </div>
      </div>

      <div class="sticky-footer">
        <button class="btn btn-primary" id="btn-save">儲存</button>
        ${!isNew ? `<button class="btn btn-danger" id="btn-delete" style="margin-top:10px;">刪除商品</button>` : ''}
      </div>
    </div>
  `);

  let activeVal = data.active;
  root.querySelector('#f-active').addEventListener('click', () => {
    activeVal = !activeVal;
    root.querySelector('#f-active').classList.toggle('on', activeVal);
  });

  root.querySelector('#btn-save').addEventListener('click', async (e) => {
    const name = root.querySelector('#f-name').value.trim();
    if (!name) { showToast('請輸入商品名稱'); return; }
    const campaignId = root.querySelector('#f-campaign').value;
    if (!campaignId) { showToast('請先建立檔期，才能新增商品'); return; }
    const payload = {
      name,
      category: root.querySelector('#f-category').value.trim(),
      price: Number(root.querySelector('#f-price').value) || 0,
      max_per_order: Number(root.querySelector('#f-max').value) || 0,
      campaign_id: campaignId,
      active: activeVal,
      variant_group: root.querySelector('#f-variant-group').value.trim(),
      variant_label: root.querySelector('#f-variant-label').value.trim(),
      unit: root.querySelector('#f-unit').value.trim(),
      quantity_cap: Number(root.querySelector('#f-quantity-cap').value) || 0,
    };
    const btn = e.currentTarget;
    btn.disabled = true;
    const dialog = showProcessingDialog();
    try {
      if (isNew) {
        await Api.post('/products', payload);
      } else {
        await Api.patch(`/products/${encodeURIComponent(data.product_id)}`, payload);
      }
      dialog.success('已儲存', () => navigate('products'));
    } catch (err) {
      btn.disabled = false;
      if (err.isAuthError) { dialog.close(); navigate('login'); return; }
      dialog.error(err.message);
    }
  });

  root.querySelector('#btn-delete')?.addEventListener('click', () => {
    showDialog({
      title: '確定要刪除此商品？',
      body: `「${escapeHtml(data.name)}」刪除後無法復原。`,
      danger: true,
      confirmText: '刪除',
      onConfirm: async () => {
        try {
          await Api.del(`/products/${encodeURIComponent(data.product_id)}`);
          showToast('已刪除商品');
          navigate('products');
        } catch (err) {
          if (err.isAuthError) { navigate('login'); return; }
          showToast(err.message);
        }
      }
    });
  });
}

// ================== ☰ 更多選單 ==================
function renderMoreMenu() {
  const items = [
    { icon: '📢', label: '公告設定', nav: 'more/announcement' },
    { icon: '📅', label: '預購檔期設定', nav: 'more/campaigns' },
    { icon: '🏪', label: '店家資料', nav: 'more/shop' },
    { icon: '🔴', label: '預購開關', nav: 'more/toggle' }
  ];
  setContent(`
    <div class="topbar"><div class="topbar-title">更多</div></div>
    <div class="page">
      <div class="card menu-list" style="padding:4px 12px;">
        ${items.map(i => `
          <button class="menu-item" data-nav="${i.nav}">
            <div class="icon">${i.icon}</div>
            <div class="title">${i.label}</div>
            <div class="chevron">›</div>
          </button>
        `).join('')}
      </div>
      <div class="card menu-list" style="padding:4px 12px; margin-top:16px;">
        <button class="menu-item" data-act="logout">
          <div class="icon">🚪</div>
          <div class="title">登出</div>
          <div class="chevron">›</div>
        </button>
      </div>
      <div class="field-hint" style="text-align:center; margin-top:16px;">v${APP_VERSION}</div>
    </div>
  `);
  root.querySelector('[data-act="logout"]').addEventListener('click', () => {
    showDialog({
      title: '確定要登出嗎？',
      body: '登出後需要重新輸入 PIN 碼才能進入後台。',
      confirmText: '登出',
      danger: true,
      onConfirm: () => {
        Api.clearToken();
        navigate('login');
      }
    });
  });
}

// ================== 📢 公告設定 ==================
async function renderAnnouncement() {
  loadingPage({ title: '公告設定', back: 'more' });

  let settingsData;
  try {
    settingsData = await Api.get('/settings');
  } catch (err) {
    handleLoadError(err, { title: '公告設定', back: 'more', retry: renderAnnouncement });
    return;
  }

  const settings = settingsData.settings || {};
  const MAX_LEN = 200;

  function paint() {
    const text = root.querySelector('#f-text').value;
    root.querySelector('#char-count').textContent = `${text.length} / ${MAX_LEN}`;
    root.querySelector('#preview').textContent = text || '（尚未輸入公告內容）';
  }

  setContent(`
    ${topbar({ title: '公告設定', back: 'more' })}
    <div class="page">
      <div class="field">
        <div class="field-row">
          <label class="field-label" style="margin-bottom:0;">顯示於顧客端</label>
          <div class="switch ${isSettingTrue(settings.announcement_visible) ? 'on' : ''}" id="f-visible"></div>
        </div>
      </div>
      <div class="field">
        <label class="field-label">公告內容</label>
        <textarea class="field-textarea" id="f-text" maxlength="${MAX_LEN}" style="min-height:140px;">${escapeHtml(settings.announcement_text || '')}</textarea>
        <div class="field-hint" id="char-count">0 / ${MAX_LEN}</div>
      </div>
      <div class="field">
        <div class="preview-label">顧客端預覽</div>
        <div class="preview-box" id="preview"></div>
      </div>
      <div class="sticky-footer">
        <button class="btn btn-primary" id="btn-save">儲存</button>
      </div>
    </div>
  `);

  let visibleVal = isSettingTrue(settings.announcement_visible);
  root.querySelector('#f-visible').addEventListener('click', () => {
    visibleVal = !visibleVal;
    root.querySelector('#f-visible').classList.toggle('on', visibleVal);
  });
  root.querySelector('#f-text').addEventListener('input', paint);
  paint();

  root.querySelector('#btn-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const dialog = showProcessingDialog();
    try {
      await Api.patch('/settings', {
        announcement_text: root.querySelector('#f-text').value,
        announcement_visible: boolToSetting(visibleVal),
      });
      dialog.success('公告已儲存');
      btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      if (err.isAuthError) { dialog.close(); navigate('login'); return; }
      dialog.error(err.message);
    }
  });
}

// ================== 📅 預購檔期設定 ==================
const CAMPAIGN_STATUS_LABEL = { active: '進行中', upcoming: '即將開始', ended: '已結束' };
const CAMPAIGN_STATUS_BADGE = { active: 'badge-active', upcoming: 'badge-upcoming', ended: 'badge-ended' };

// 預設只顯示「進行中／即將開始」的檔期，已結束的收在「全部（含已結束）」裡，
// 避免團購做久了舊檔期愈堆愈多——資料本身完全不受影響，純粹是這頁預設要不要顯示。
let campaignListShowEnded = false;

async function renderCampaignsList() {
  loadingPage({ title: '預購檔期設定', back: 'more' });

  let campaignsData, ordersData;
  try {
    [campaignsData, ordersData] = await Promise.all([
      Api.get('/admin/campaigns'),
      Api.get('/orders'),
    ]);
  } catch (err) {
    handleLoadError(err, { title: '預購檔期設定', back: 'more', retry: renderCampaignsList });
    return;
  }

  const allCampaigns = campaignsData.campaigns || [];
  const orders = ordersData.orders || [];
  const campaigns = (campaignListShowEnded ? allCampaigns : allCampaigns.filter(c => c.status !== 'ended')).slice().reverse();

  function orderedQty(campaignId) {
    return orders
      .filter(o => o.campaign_id === campaignId && o.order_status !== 'cancelled')
      .flatMap(o => o.items || [])
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  const today = taipeiToday();

  const cards = campaigns.map(c => {
    const ordered = orderedQty(c.campaign_id);
    const cap = c.total_quantity_cap || 0;
    const pct = cap ? Math.min(100, Math.round((ordered / cap) * 100)) : 0;
    // 徽章完全照起訖日自動算（即將開始／進行中／已結束），不是照 c.status 原始值，
    // 這樣老闆設好起訖日之後，狀態會自己跑，不用再手動切換。
    const displayStatus = campaignDisplayStatus(c, today);
    return `
      <button class="card card-tap" data-nav="more/campaigns/${c.campaign_id}">
        <div class="order-card-top">
          <div class="order-customer">${escapeHtml(c.name)}</div>
          <span class="badge ${CAMPAIGN_STATUS_BADGE[displayStatus] || ''}">${CAMPAIGN_STATUS_LABEL[displayStatus] || displayStatus}</span>
        </div>
        <div class="order-line"><span>預購期間</span><span>${escapeHtml(c.start_date || '')} ~ ${escapeHtml(c.end_date || '')}</span></div>
        <div class="order-line"><span>取貨日</span><span>${(c.pickup_slots || []).map(s => s.date).join('、') || '—'}</span></div>
        <div class="order-line"><span>已訂購量</span><span>${ordered} / ${cap || '不限'}</span></div>
        ${cap ? `<div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>` : ''}
      </button>
    `;
  }).join('');

  setContent(`
    <div class="topbar">
      <button class="topbar-back" data-nav="more">‹</button>
      <div class="topbar-title">預購檔期設定</div>
      <button class="topbar-action" data-nav="more/campaigns/new">+ 新增</button>
    </div>
    <div class="page">
      <div class="chip-row">
        <button class="chip ${!campaignListShowEnded ? 'active' : ''}" data-show-ended="false">進行中</button>
        <button class="chip ${campaignListShowEnded ? 'active' : ''}" data-show-ended="true">全部（含已結束）</button>
      </div>
      ${cards || `<div class="empty-state"><div class="icon">📅</div>${campaignListShowEnded ? '目前沒有任何檔期' : '目前沒有進行中或即將開始的檔期'}</div>`}
    </div>
  `);

  root.querySelectorAll('[data-show-ended]').forEach(btn => {
    btn.addEventListener('click', () => {
      campaignListShowEnded = btn.getAttribute('data-show-ended') === 'true';
      renderCampaignsList();
    });
  });
}

async function renderCampaignEdit(id) {
  const isNew = id === 'new';
  loadingPage({ title: isNew ? '新增檔期' : '編輯檔期', back: 'more/campaigns' });

  let c, hasOrders, prevCampaign = null, prevCampaignProductCount = 0;
  try {
    if (!isNew) {
      const [campaignsData, ordersData] = await Promise.all([
        Api.get('/admin/campaigns'),
        Api.get('/orders'),
      ]);
      c = (campaignsData.campaigns || []).find(x => x.campaign_id === id);
      if (!c) { navigate('more/campaigns'); return; }
      hasOrders = (ordersData.orders || []).some(o => o.campaign_id === id);
    } else {
      c = { campaign_id: null, name: '', start_date: '', end_date: '', pickup_slots: [], total_quantity_cap: '', low_stock_threshold: '', status: 'active' };
      hasOrders = false;
      const [campaignsData, productsData] = await Promise.all([
        Api.get('/admin/campaigns'),
        Api.get('/admin/products'),
      ]);
      // 找「最近一個有商品的檔期」當作沿用來源，不是單純抓最後建立的檔期——
      // 老闆可能已經先建了空的檔期占位，那種檔期沒有商品可複製，往前找到有商品的才有意義。
      const campaigns = campaignsData.campaigns || [];
      const products = productsData.products || [];
      for (let i = campaigns.length - 1; i >= 0; i--) {
        const count = products.filter(p => p.campaign_id === campaigns[i].campaign_id).length;
        if (count > 0) {
          prevCampaign = campaigns[i];
          prevCampaignProductCount = count;
          break;
        }
      }
    }
  } catch (err) {
    handleLoadError(err, { title: isNew ? '新增檔期' : '編輯檔期', back: 'more/campaigns', retry: () => renderCampaignEdit(id) });
    return;
  }

  let slots = (c.pickup_slots || []).map(s => ({ ...s }));

  function renderSlots() {
    const wrap = root.querySelector('#slots-wrap');
    wrap.innerHTML = slots.map((slot, idx) => `
      <div class="slot-row">
        <input class="field-input" type="date" value="${slot.date || ''}" data-slot-date="${idx}" style="flex:1;" />
        <input class="field-input" value="${escapeHtml(slot.time_range || '')}" placeholder="14:00-18:00" data-slot-time="${idx}" style="flex:1;" />
        <div class="slot-remove" data-slot-remove="${idx}">✕</div>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-slot-date]').forEach(inp => {
      inp.addEventListener('change', () => { slots[+inp.getAttribute('data-slot-date')].date = inp.value; });
    });
    wrap.querySelectorAll('[data-slot-time]').forEach(inp => {
      inp.addEventListener('input', () => { slots[+inp.getAttribute('data-slot-time')].time_range = inp.value; });
    });
    wrap.querySelectorAll('[data-slot-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        slots.splice(+btn.getAttribute('data-slot-remove'), 1);
        renderSlots();
      });
    });
  }

  setContent(`
    ${topbar({ title: isNew ? '新增檔期' : '編輯檔期', back: 'more/campaigns' })}
    <div class="page">
      <div class="field">
        <label class="field-label">檔期名稱</label>
        <input class="field-input" id="f-name" value="${escapeHtml(c.name)}" placeholder="例：8月第3週檔期" />
      </div>
      <div class="field">
        <label class="field-label">預購起訖日</label>
        <div style="display:flex; gap:10px;">
          <input class="field-input" type="date" id="f-start" value="${c.start_date || ''}" />
          <input class="field-input" type="date" id="f-end" value="${c.end_date || ''}" />
        </div>
        <div class="field-hint">顧客端會自動照這組日期開放／關閉，起日當天開放、迄日當天仍開放（隔天才關），不用再手動切換狀態。</div>
      </div>
      <div class="field">
        <label class="field-label">取貨日期／時段</label>
        <div id="slots-wrap"></div>
        <button class="add-slot-btn" id="btn-add-slot">+ 新增取貨時段</button>
      </div>
      <div class="field">
        <label class="field-label">總量上限（0 或留空代表不限制）</label>
        <input class="field-input" id="f-cap" type="number" inputmode="numeric" value="${c.total_quantity_cap || ''}" placeholder="0" />
      </div>
      <div class="field">
        <label class="field-label">剩餘量低於多少開始顯示庫存緊張提示（留空代表不啟用）</label>
        <input class="field-input" id="f-low-stock-threshold" type="number" inputmode="numeric" value="${c.low_stock_threshold || ''}" placeholder="例：10" />
        <div class="field-hint">剩餘量低於這裡設定的數字時，顧客網站的購物車列下方會顯示「目前庫存緊張，實際可以購買數量，以訂單明細為主」的提示（不會顯示不準確或打折扣的數字，顧客看到的剩餘量一律是實際數字）。留空就不啟用，不顯示這個提示。</div>
      </div>
      <div class="field">
        <label class="field-label">檔期狀態</label>
        <select class="field-select" id="f-status">
          <option value="active" ${c.status !== 'ended' ? 'selected' : ''}>進行中</option>
          <option value="ended" ${c.status === 'ended' ? 'selected' : ''}>已結束</option>
        </select>
        <div class="field-hint">「進行中」的檔期會不會被顧客看到，交給上面的預購起訖日自動判斷；這裡的「已結束」是手動強制關閉，不管日期都不會再開放。</div>
      </div>
      ${isNew && prevCampaign && prevCampaignProductCount > 0 ? `
      <div class="field">
        <div class="field-row">
          <label class="field-label" style="margin-bottom:0;">沿用「${escapeHtml(prevCampaign.name)}」的商品清單</label>
          <div class="switch on" id="f-copy-products"></div>
        </div>
        <div class="field-hint">開啟後，儲存時會自動複製上一檔的 ${prevCampaignProductCount} 項商品到這個新檔期，之後可以到「商品管理」個別調整。</div>
      </div>` : ''}

      <div class="sticky-footer">
        <button class="btn btn-primary" id="btn-save">儲存</button>
        ${!isNew ? (hasOrders
          ? `<button class="btn btn-outline" id="btn-end" style="margin-top:10px;">結束檔期</button>`
          : `<button class="btn btn-danger" id="btn-delete" style="margin-top:10px;">刪除檔期</button>`) : ''}
      </div>
      ${hasOrders ? `<div class="field-hint" style="text-align:left;">此檔期已有訂單，無法刪除，僅能結束檔期</div>` : ''}
    </div>
  `);

  renderSlots();
  root.querySelector('#btn-add-slot').addEventListener('click', () => {
    slots.push({ date: '', time_range: '' });
    renderSlots();
  });

  let copyProductsVal = !!(isNew && prevCampaign && prevCampaignProductCount > 0);
  root.querySelector('#f-copy-products')?.addEventListener('click', () => {
    copyProductsVal = !copyProductsVal;
    root.querySelector('#f-copy-products').classList.toggle('on', copyProductsVal);
  });

  root.querySelector('#btn-save').addEventListener('click', async (e) => {
    const name = root.querySelector('#f-name').value.trim();
    if (!name) { showToast('請輸入檔期名稱'); return; }
    const payload = {
      name,
      start_date: root.querySelector('#f-start').value,
      end_date: root.querySelector('#f-end').value,
      total_quantity_cap: Number(root.querySelector('#f-cap').value) || 0,
      low_stock_threshold: Number(root.querySelector('#f-low-stock-threshold').value) || 0,
      status: root.querySelector('#f-status').value,
      pickup_slots: slots.map(s => ({ date: s.date, time_range: s.time_range })),
    };
    if (copyProductsVal && prevCampaign) {
      payload.copy_products_from_campaign_id = prevCampaign.campaign_id;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    const dialog = showProcessingDialog();
    try {
      let result;
      if (isNew) {
        result = await Api.post('/campaigns', payload);
      } else {
        result = await Api.patch(`/campaigns/${encodeURIComponent(c.campaign_id)}`, payload);
      }
      const msg = result && result.copied_product_count ? `已儲存，並複製了 ${result.copied_product_count} 項商品` : '已儲存';
      dialog.success(msg, () => navigate('more/campaigns'));
    } catch (err) {
      btn.disabled = false;
      if (err.isAuthError) { dialog.close(); navigate('login'); return; }
      dialog.error(err.message);
    }
  });

  root.querySelector('#btn-delete')?.addEventListener('click', () => {
    showDialog({
      title: '確定要刪除此檔期？',
      body: `「${escapeHtml(c.name)}」刪除後無法復原。`,
      danger: true,
      confirmText: '刪除',
      onConfirm: async () => {
        try {
          await Api.del(`/campaigns/${encodeURIComponent(c.campaign_id)}`);
          showToast('已刪除檔期');
          navigate('more/campaigns');
        } catch (err) {
          if (err.isAuthError) { navigate('login'); return; }
          showToast(err.message);
        }
      }
    });
  });

  root.querySelector('#btn-end')?.addEventListener('click', () => {
    showDialog({
      title: '確定要結束此檔期？',
      body: '結束後顧客端將無法再看到此檔期的商品。',
      confirmText: '結束檔期',
      onConfirm: async () => {
        try {
          await Api.patch(`/campaigns/${encodeURIComponent(c.campaign_id)}`, { status: 'ended' });
          showToast('已結束檔期');
          navigate('more/campaigns');
        } catch (err) {
          if (err.isAuthError) { navigate('login'); return; }
          showToast(err.message);
        }
      }
    });
  });
}

// ================== 🏪 店家資料 ==================
async function renderShop() {
  loadingPage({ title: '店家資料', back: 'more' });

  let settingsData;
  try {
    settingsData = await Api.get('/settings');
  } catch (err) {
    handleLoadError(err, { title: '店家資料', back: 'more', retry: renderShop });
    return;
  }
  const s = settingsData.settings || {};

  setContent(`
    ${topbar({ title: '店家資料', back: 'more' })}
    <div class="page">
      <div class="section">
        <div class="section-title">基本資訊</div>
        <div class="field">
          <label class="field-label">店名</label>
          <input class="field-input" id="f-shopname" value="${escapeHtml(s.shop_name || '')}" />
        </div>
        <div class="field">
          <label class="field-label">簡介</label>
          <textarea class="field-textarea" id="f-intro" style="min-height:80px;">${escapeHtml(s.shop_intro || '')}</textarea>
        </div>
      </div>

      <div class="section">
        <div class="section-title">聯絡資訊</div>
        <div class="field">
          <label class="field-label">LINE 官方帳號</label>
          <input class="field-input" id="f-line" value="${escapeHtml(s.shop_line || '')}" />
        </div>
        <div class="field">
          <label class="field-label">電話</label>
          <input class="field-input" id="f-phone" value="${escapeHtml(s.shop_phone || '')}" />
        </div>
        <div class="field">
          <label class="field-label">地址</label>
          <input class="field-input" id="f-address" value="${escapeHtml(s.shop_address || '')}" />
        </div>
      </div>

      <div class="section">
        <div class="section-title">宅配</div>
        <div class="field">
          <label class="field-label">運費（元）</label>
          <input class="field-input" id="f-shipping" type="number" inputmode="numeric" value="${escapeHtml(s.shipping_fee || '0')}" />
        </div>
      </div>

      <div class="sticky-footer">
        <button class="btn btn-primary" id="btn-save">儲存</button>
      </div>
    </div>
  `);

  root.querySelector('#btn-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const dialog = showProcessingDialog();
    try {
      await Api.patch('/settings', {
        shop_name: root.querySelector('#f-shopname').value.trim(),
        shop_intro: root.querySelector('#f-intro').value.trim(),
        shop_line: root.querySelector('#f-line').value.trim(),
        shop_phone: root.querySelector('#f-phone').value.trim(),
        shop_address: root.querySelector('#f-address').value.trim(),
        shipping_fee: Number(root.querySelector('#f-shipping').value) || 0,
      });
      dialog.success('店家資料已儲存');
      btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      if (err.isAuthError) { dialog.close(); navigate('login'); return; }
      dialog.error(err.message);
    }
  });
}

// ================== 🔴 預購開關 ==================
async function renderToggle() {
  loadingPage({ title: '預購開關', back: 'more' });

  let settingsData, campaignsData;
  try {
    [settingsData, campaignsData] = await Promise.all([
      Api.get('/settings'),
      Api.get('/admin/campaigns'),
    ]);
  } catch (err) {
    handleLoadError(err, { title: '預購開關', back: 'more', retry: renderToggle });
    return;
  }
  const s = settingsData.settings || {};
  const preorderOpen = isSettingTrue(s.preorder_open);
  const preorder = getPreorderState(s, campaignsData.campaigns || []);

  const stateSub = preorder.open
    ? '顧客可正常瀏覽並下單'
    : (preorder.reason === 'paused'
      ? '顧客端將顯示暫停訊息，無法送出訂單'
      : '所有檔期的預購期間都已結束，顧客端無法下單；新檔期開始後會自動恢復');

  setContent(`
    ${topbar({ title: '預購開關', back: 'more' })}
    <div class="page">
      <div class="card toggle-hero">
        <div class="state-icon">${preorder.open ? '🟢' : '🔴'}</div>
        <div class="state-title">${preorder.label}</div>
        <div class="state-sub">${stateSub}</div>
        <div class="switch-wrap">
          <div class="switch big ${preorderOpen ? 'on' : ''}" id="f-toggle"></div>
        </div>
        ${preorder.reason === 'no_campaign' ? `<div class="field-hint" style="margin-top:10px;">手動開關目前是「開放」，但沒有進行中的檔期，所以顧客端仍是關閉狀態。</div>` : ''}
      </div>

      <div class="section" style="margin-top:20px;">
        <div class="section-title">暫停時顧客端顯示訊息</div>
        <div class="field">
          <textarea class="field-textarea" id="f-pausemsg" style="min-height:90px;">${escapeHtml(s.pause_message || '')}</textarea>
        </div>
        <button class="btn btn-outline" id="btn-save-msg">儲存暫停訊息</button>
      </div>
    </div>
  `);

  root.querySelector('#f-toggle').addEventListener('click', () => {
    confirmTogglePreorder(preorderOpen, () => renderToggle());
  });
  root.querySelector('#btn-save-msg').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const dialog = showProcessingDialog();
    try {
      await Api.patch('/settings', { pause_message: root.querySelector('#f-pausemsg').value });
      dialog.success('暫停訊息已儲存');
      btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      if (err.isAuthError) { dialog.close(); navigate('login'); return; }
      dialog.error(err.message);
    }
  });
}

// ================== Service Worker 更新提示 ==================
if ('serviceWorker' in navigator) {
  // 若這次頁面載入本來就已經被 Service Worker 控制，之後任何 controllerchange
  // 都代表「換了新版」——不能直接自動 location.reload()，老闆可能正在填訂單、
  // 編輯商品，強制重整會把還沒送出的輸入清空。改成跳提示，由老闆自己按
  // 「立即更新」。真正的首次安裝（controller 本來是 null）畫面還沒渲染任何
  // 內容，重整沒有風險，可以靜默重整一次。
  // （sw.js 的 install 階段一律呼叫 self.skipWaiting()，新版會直接在背景接管，
  // 不會真的停在「等待中」，所以這裡不需要、也不會再送 SKIP_WAITING 訊息。）
  const hadController = !!navigator.serviceWorker.controller;
  let handled = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (handled) return;
    handled = true;
    if (hadController) {
      showUpdateBanner();
    } else {
      location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });

      // 老闆手機常從背景喚醒而非真正重新整理（例如切到 LINE 回訊息再切回
      // 來），切回分頁、從 bfcache 復原時都主動再查一次 sw.js，不能只靠
      // 瀏覽器自己的預設節流去檢查。
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) reg.update();
      });
    }).catch(() => {});
  });
}

function showUpdateBanner() {
  if (document.querySelector('.update-banner')) return;
  const banner = el(`
    <div class="update-banner">
      <span>有新版本可以更新</span>
      <button>立即更新</button>
    </div>
  `);
  banner.querySelector('button').addEventListener('click', () => {
    // Service Worker 已經在背景接管（install 階段就會 skipWaiting），
    // 這裡只是把畫面換成新版內容。
    location.reload();
  });
  document.body.appendChild(banner);
}
