// 歪嘴雞烘焙後台 PWA — Service Worker
// 策略：靜態資源 cache-first + 背景更新（stale-while-revalidate）；
// 導覽（頁面本身）請求另外做限時網路搶先，見 fetch handler 內的 navigate 分支。

const CACHE_VERSION = 'v2.1.3';
const CACHE_NAME = 'ykj-pwa-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/api.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/logo.png'
];

// 導覽請求等網路回應的時限——超過就先用快取讓畫面出現，網路仍在背景跑完並
// 更新快取。太短等於沒改善「卡在舊版本」；太長會讓慢網路下開啟變慢，2.5 秒
// 是折衷值。
const NAVIGATION_NETWORK_TIMEOUT_MS = 2500;

// 若途中被導向過（例如 Cloudflare 強制 HTTPS 或補結尾斜線），response.redirected
// 會是 true；這種 response 直接存進 Cache 或拿去 respondWith() 回應 navigate
// 請求，Safari/Chrome 都會判定整頁載入失敗（「Response served by service worker
// has redirections」），外觀就是「主畫面圖示打不開」。用 new Response() 重新包
// 一層即可拿掉導向紀錄，內容不變。
function stripRedirected(response) {
  return response.redirected ? new Response(response.body, response) : response;
}

// 安裝新版本：預先快取核心檔案，並立刻取代舊版
//
// 不用 cache.addAll()：它不處理 redirect，一旦其中一個 fetch 中途被導向，
// 存進快取的就是壞掉的 response，之後 fetch handler 命中這筆記錄直接回應
// navigate 請求就會整頁打不開。逐一 fetch 後用 stripRedirected() 處理過再
// 存，維持跟 addAll() 一樣「全有全無」的語意。
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(
      PRECACHE_URLS.map((url) => fetch(url).then((response) => cache.put(url, stripRedirected(response))))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 尊重 no-store：完全不碰 Cache Storage，直接打網路
  if (req.cache === 'no-store') {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((networkResponse) => {
          const safeResponse = stripRedirected(networkResponse);
          if (safeResponse.ok || safeResponse.type === 'opaque') {
            cache.put(req, safeResponse.clone());
          }
          return safeResponse;
        })
        .catch(() => cached);

      event.waitUntil(networkFetch);

      // 導覽（開啟頁面本身）請求：讓網路在時限內搶先，時限內回應就用最新
      // 版本；逾時或離線才退回目前的快取，網路仍在背景跑完更新快取。靜態
      // 資源不受影響，仍是上面說的 cache-first。
      if (req.mode === 'navigate') {
        const timedOut = new Promise((resolve) => setTimeout(resolve, NAVIGATION_NETWORK_TIMEOUT_MS));
        const fast = await Promise.race([networkFetch, timedOut]);
        if (fast) return fast;
        if (cached) return cached;
        const resolved = await networkFetch;
        return resolved || new Response(
          '目前離線，且尚無可用的快取版本，請確認網路連線後再試一次。',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }

      // cache-first：有快取先回應，背景同時更新
      return cached || networkFetch;
    })
  );
});
