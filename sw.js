// 发布新版本时只需递增这里的版本号，并把整个项目一起上传。
const APP_VERSION = 'v1.4.0-dev.10';
const CACHE_PREFIX = `monster-slayer-kit:${encodeURIComponent(self.registration.scope)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}`;
const APP_SHELL = [
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/app.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './tools/change-calculator/index.html',
  './tools/change-calculator/calculator.js',
  './tools/currency-converter/index.html',
  './tools/currency-converter/currency-converter.js',
  './tools/atr-calculator/index.html',
  './tools/atr-calculator/atr-core.js',
  './tools/atr-calculator/atr-calculator.js',
  './tools/atr-calculator/atr-calculator.css',
  './tools/us-market/index.html',
  './tools/us-market/market-core.js',
  './tools/us-market/us-market.js',
  './tools/us-market/commodity-core.js',
  './tools/us-market/commodity-ui.js',
  './tools/us-market/us-market.css',
  './tools/us-market/mappings.json',
];

self.addEventListener('install', (event) => {
  // 绕过 HTTP 缓存。全部资源成功后才进入 waiting，旧版本继续可用。
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    APP_SHELL.map((path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' })),
  )));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: APP_VERSION });
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    // 旧版缓存没有 scope 信息；确认包含本路径首页后才清理。
    for (const key of keys.filter((name) => /^monster-slayer-kit-v\d+$/.test(name))) {
      const cache = await caches.open(key);
      if (await cache.match(new URL('./index.html', self.registration.scope))) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;

  // 目录入口和带查询参数的页面使用同一份离线资源。
  url.search = '';
  if (event.request.mode === 'navigate' && url.pathname.endsWith('/')) {
    url.pathname += 'index.html';
  }
  const path = url.href.slice(self.registration.scope.length);
  if (!APP_SHELL.includes(`./${path}`)) return;

  // 当前版本资源保持一致，直到用户选择更新；第三方 API 不进入静态缓存。
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (
    await cache.match(url.href) || fetch(event.request)
  )));
});
