'use strict';
// Existing Playwright + system Edge only; recorded public responses, no downloads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = require('../scripts/serve-local.js');
const root = path.resolve(__dirname, '..');
const fixture = require('./fixtures/us-market-v1.0.6.json');
const marketPath = 'tools/us-market/index.html';

async function recordedNetwork(context, mode = 'primary') {
  const requests = [];
  await context.route('https://**/*', async route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    const send = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.hostname === 'quote.cnbc.com') {
      const symbols = url.searchParams.get('symbols').split('|');
      if (mode === 'tencent' && !symbols.some(s => s.startsWith('.') || s.startsWith('@'))) return route.abort();
      const rows = [...fixture.commodityQuotes, ...fixture.main, ...fixture.sectors];
      return send({ FormattedQuoteResult: { FormattedQuote: symbols.map(s => rows.find(q => q.symbol === s))
        .filter(q => q && !(mode === 'sox' && q.symbol === '.SOX')) } });
    }
    if (url.hostname === 'ts-api.cnbc.com') {
      const symbol = url.searchParams.get('symbol');
      if (mode === 'sox' && symbol === '.SOX') return route.abort();
      const body = fixture.history[symbol] || fixture.commodityCharts[symbol + '-' + path.basename(url.pathname, '.json')];
      if (body) return send(body);
    }
    if (url.hostname === 'qt.gtimg.cn') return route.fulfill({ contentType: 'text/plain; charset=gbk', body: Buffer.from(fixture.tencentBase64, 'base64') });
    if (url.hostname === 'datacenter-web.eastmoney.com') return send(fixture.sox);
    return route.abort();
  });
  return requests;
}

async function withBrowser(run, basePath = '') {
  const server = createServer({ root: path.join(root, 'dist'), basePath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && message.location().url.startsWith('http://127.0.0.1:')) errors.push(message.text());
    });
    const scope = `http://127.0.0.1:${server.address().port}${basePath}/`;
    await run({ browser, context, page, scope, errors });
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function waitMarket(page) {
  await page.waitForFunction(() => !document.getElementById('refreshBtn').disabled);
}

test('集成边界：v1.0.6核心逐字保留、统一PWA、发布资源及原计算器不混入行情样式', async () => {
  const html = await fs.readFile(path.join(root, marketPath), 'utf8');
  // Git may check out CRLF on Windows; compare the same source content on both systems.
  const core = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(core).digest('hex'),
    '2cd7a8e99689fbef3fa5e5cc282f0ffc2783fa5e62625e538974ff6e03c18b91');
  assert.match(html, /href="\.\.\/\.\.\/index.html"/);
  assert.match(html, /href="\.\.\/\.\.\/manifest.webmanifest"/);
  assert.match(html, /src="\.\.\/\.\.\/assets\/app.js"/);
  assert.doesNotMatch(html, /serviceWorker\.register|pwa-script|pwaUpdateBtn|\.\/sw.js|assets\/styles.css/);
  assert.deepEqual(await fs.readdir(path.join(root, 'tools/us-market')), ['index.html']);
  assert.equal(await fs.readFile(path.join(root, 'dist', marketPath), 'utf8'), html);
  const sw = await fs.readFile(path.join(root, 'dist/sw.js'), 'utf8');
  assert.match(sw, /'\.\/tools\/us-market\/index.html'/);
  assert.doesNotMatch(sw, /market-core.js|remote-data.js|mappings.json|commodity-core.js/);
  for (const match of sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']+)'/g)) {
    await fs.access(path.join(root, 'dist', match[1]));
  }
  for (const excluded of ['_import', 'tests', 'scripts', '.github', 'public-data']) {
    await assert.rejects(fs.access(path.join(root, 'dist', excluded)), { code: 'ENOENT' });
  }
});

test('dist HTTP：第四入口、行情/曲线/行业、手机双列、60秒刷新、缓存、导航及单一根SW', { timeout: 120000 }, async () => {
  await withBrowser(async ({ context, page, scope }) => {
    const requests = await recordedNetwork(context);
    await page.clock.install({ time: new Date(fixture.time) });
    await page.goto(scope);
    assert.equal(await page.locator('.tool-card').count(), 4);
    assert.equal(await page.locator('.topbar-note').textContent(), '4 个工具');
    assert.equal(await page.locator('.tools-section .tool-card').nth(3).locator('h3').textContent(), '美股行情速览');
    if (process.env.UI_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'home-four-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'home-four-mobile.png'), fullPage: true });
    }
    await page.getByRole('link', { name: /美股行情速览/ }).click();
    await waitMarket(page);
    assert.equal(page.url(), scope + marketPath);
    assert.equal(await page.locator('#grid > .card').count(), 6);
    const stats = await page.evaluate(() => ({
      indices: ITEMS.filter(i => i.kind === 'idx').map(i => ({ key: i.key, ok: validateQuote(state[i.key]).ok, chart: sparkUsable(i, state[i.key]) })),
      commodities: ITEMS.filter(i => i.kind === 'cmd').map(i => ({ key: i.key, ok: validateQuote(state[i.key]).ok })),
      sectors: boardData().sectors.filter(s => s.quote).length,
      groups: boardData().groups.filter(g => g.complete).length,
    }));
    assert.ok(stats.indices.every(i => i.ok && i.chart), JSON.stringify(stats));
    assert.ok(stats.commodities.every(i => i.ok), JSON.stringify(stats));
    assert.equal(stats.sectors, 11);
    assert.equal(stats.groups, 25, JSON.stringify(await page.evaluate(() => ({groups: boardData().groups.filter(g => !g.complete).map(g => g.reason), problems: sectorProblems}))));
    assert.equal(await page.locator('#topList .rank-row').count(), 5);
    assert.equal(await page.locator('#botList .rank-row').count(), 5);
    assert.equal(await page.locator('#interval').inputValue(), '60000');
    assert.match(await page.locator('#countdown').textContent(), /60s/);
    const before = requests.filter(u => u.includes('quote.cnbc.com')).length;
    await page.clock.runFor(61000);
    await waitMarket(page);
    assert.ok(requests.filter(u => u.includes('quote.cnbc.com')).length > before);
    for (const width of [320, 375, 390, 393, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
        columns: getComputedStyle(document.querySelector('#grid')).gridTemplateColumns.split(' ').length }));
      assert.equal(layout.overflow, false, String(width));
      assert.equal(layout.columns, width > 960 ? 3 : 2);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'market-mobile-recorded.png'), fullPage: true });
    assert.ok(await page.evaluate(() => localStorage.getItem('us_market_board_v1')));
    await page.reload();
    await waitMarket(page);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const workers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, script: r.active?.scriptURL })));
    assert.deepEqual(workers, [{ scope, script: scope + 'sw.js' }]);
    const cached = await page.evaluate(async () => {
      const result = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(request.url);
      return result;
    });
    assert.ok(cached.every(url => url.startsWith(scope)));
    await page.getByRole('link', { name: '‹ 返回工具箱' }).click();
    assert.equal(page.url(), scope + 'index.html');
    await context.setOffline(true);
    await page.goto(scope + marketPath);
    assert.equal(await page.locator('h1').textContent(), '美股行情速览');
    await page.getByRole('link', { name: '‹ 返回工具箱' }).click();
    assert.equal(await page.locator('.tool-card').count(), 4);
  }, '/preview');
});

test('备用源：CNBC行业失效切腾讯；SOX日线走东方财富；长错误保持折叠', { timeout: 90000 }, async () => {
  for (const mode of ['tencent', 'sox']) await withBrowser(async ({ context, page, scope }) => {
    const requests = await recordedNetwork(context, mode);
    await page.clock.install({ time: new Date(mode === 'sox' ? '2026-10-24T01:20:00Z' : fixture.time) });
    await page.goto(scope + marketPath);
    await waitMarket(page);
    if (mode === 'tencent') {
      const result = await page.evaluate(() => ({ count: boardData().sectors.filter(s => s.quote?.src === '腾讯财经').length,
        groups: boardData().groups.filter(g => g.complete).length }));
      assert.equal(result.count, 11);
      assert.equal(result.groups, 25, JSON.stringify(await page.evaluate(() => ({groups: boardData().groups.filter(g => !g.complete).map(g => g.reason), problems: sectorProblems}))));
      assert.ok(requests.some(u => u.includes('qt.gtimg.cn')));
    } else {
      assert.equal(await page.evaluate(() => validateQuote(state.sox).ok && state.sox.src === '东方财富' && sparkUsable(ITEMS[2], state.sox)), true);
      assert.ok(requests.some(u => u.includes('datacenter-web.eastmoney.com')));
    }
    await page.evaluate(() => {
      state.spx = invalid({}, '接口返回的长错误信息。'.repeat(100));
      render([ITEMS[0]]);
    });
    const details = page.locator('#card-spx details');
    assert.ok(await details.count());
    assert.equal(await details.first().evaluate(node => node.open), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
});

for (const predecessor of ['dev.13', 'dev.19']) test(`真实旧工具箱${predecessor}升级：旧资源淘汰、确认切换、存储保留、行情页更新及离线`, { timeout: 90000 }, async () => {
  const legacy = new Map();
  const readLegacy = file => {
    if (!legacy.has(file)) legacy.set(file, execFileSync('git', ['show', `f8cd2938df53ce4711862154ecab5f354d72d902:${file}`], { cwd: root, maxBuffer: 5 * 1024 * 1024 }));
    return legacy.get(file);
  };
  const oldWorker = predecessor === 'dev.13' ? readLegacy('sw.js').toString() : fixture.previousToolbox.worker;
  legacy.set('sw.js', Buffer.from(oldWorker));
  for (const match of oldWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']+)'/g)) {
    if (predecessor === 'dev.13') readLegacy(match[1]);
    else legacy.set(match[1], match[1] === 'index.html' ? Buffer.from(fixture.previousToolbox.home) : await fs.readFile(path.join(root, 'dist', match[1])));
  }
  let published = false;
  let nextVersion = false;
  const missing = [];
  const server = http.createServer(async (request, response) => {
    let file = new URL(request.url, 'http://localhost').pathname.replace(/^\//, '') || 'index.html';
    if (file.endsWith('/')) file += 'index.html';
    if (!/^[a-zA-Z0-9_./-]+$/.test(file) || file.includes('..')) return response.writeHead(404).end();
    try {
      let body = published ? await fs.readFile(path.join(root, 'dist', file)) : legacy.get(file);
      if (nextVersion && file === 'sw.js') body = Buffer.from(body.toString().replace('v1.4.0-dev.21', 'v1.4.0-test.22'));
      if (!body) return response.writeHead(404).end();
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': type[path.extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch { missing.push(file); response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext();
    await recordedNetwork(context);
    const page = await context.newPage();
    const origin = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(origin);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.waitForFunction(version => document.querySelector('[data-app-version]').textContent.includes(version), predecessor);
    const stored = { us_market_board_v1: '{"schema":2,"data":{},"legacy":{"preserve":true}}',
      us_gics_board_v1: '{"schema":2,"quotes":{},"legacy":{"preserve":true}}',
      'monster-slayer-kit:atr-plans:v1': '{"version":2,"plans":[]}', 'other-application': 'preserve' };
    await page.evaluate(values => Object.entries(values).forEach(([k, v]) => localStorage.setItem(k, v)), stored);
    assert.equal(await page.evaluate(async () => Boolean(await caches.match(new URL('tools/us-market/market-core.js', location.href).href))), predecessor === 'dev.13');
    published = true;
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await page.waitForSelector('#pwa-update:not([hidden])');
    assert.ok((await page.locator('[data-app-version]').textContent()).includes(predecessor));
    if (predecessor === 'dev.13') assert.equal(await page.locator('.tool-card').nth(3).locator('h3').textContent(), '美股风向');
    else assert.equal(await page.locator('.tool-card').count(), 3);
    await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: '立即更新', exact: true }).click()]);
    await page.waitForFunction(() => document.querySelector('[data-app-version]').textContent.includes('v1.4.0-dev.21'));
    assert.equal(await page.locator('.tool-card').nth(3).locator('h3').textContent(), '美股行情速览');
    assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(stored)), stored);
    assert.deepEqual(missing, []);
    assert.equal(await page.evaluate(async () => Boolean(await caches.match(new URL('tools/us-market/market-core.js', location.href).href))), false);
    await context.setOffline(true);
    await page.goto(origin + marketPath);
    assert.equal(await page.locator('h1').textContent(), '美股行情速览');
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 1);
    await context.setOffline(false);
    await waitMarket(page);
    nextVersion = true;
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await page.waitForSelector('#pwa-update:not([hidden])');
    assert.equal(await page.locator('#pwa-update button').textContent(), '立即更新');
    assert.equal(await page.locator('#pwaUpdate').count(), 0);
    if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `market-unified-update-${predecessor}.png`), fullPage: true });
    await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: '立即更新', exact: true }).click()]);
    await page.waitForFunction(() => document.querySelector('[data-app-version]').textContent.includes('v1.4.0-test.22'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('us_market_board_v1')).legacy.preserve), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('other-application')), 'preserve');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
