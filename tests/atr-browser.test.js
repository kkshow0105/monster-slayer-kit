'use strict';
// 使用已有 Playwright 和系统 Edge；不下载浏览器或依赖。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const key = 'monster-slayer-kit:atr-plans:v1';
const core = require('../tools/atr-calculator/atr-core.js');
async function confirmTrade(page, index, price) {
  const row = page.locator('[data-execution-level="' + index + '"]');
  await row.getByRole('button', { name: '确认补仓', exact: true }).click();
  if (price !== undefined) await row.locator('.atr-trade-editor input').fill(price);
  await row.getByRole('button', { name: '确认并锁定', exact: true }).click();
}
async function correctTrade(page, index, price) {
  const row = page.locator('[data-execution-level="' + index + '"]');
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: '纠正记录', exact: true }).click();
  await row.locator('.atr-trade-editor input').fill(price);
  await row.getByRole('button', { name: '保存纠正并锁定', exact: true }).click();
}

test('真实浏览器：ATR交互、持久化、布局、旧工具及PWA离线/更新回归', { timeout: 120000 }, async () => {
  let nextVersion = false;
  const server = http.createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith('/preview/')) pathname = pathname.slice('/preview'.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      let body = await fs.readFile(file);
      if (file === path.join(root, 'sw.js') && nextVersion) {
        body = Buffer.from(body.toString().replace('v1.3.0', 'v1.3.1-test'));
      }
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('https://api.frankfurter.dev/**', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({
        rate: route.request().url().includes('/JPY/') ? 0.05 : 7, date: '2026-10-13',
      }),
    }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const atrUrl = origin + '/preview/tools/atr-calculator/index.html';
    const stored = () => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
    const prices = () => page.locator('[data-preview-price]').allTextContents();
    const generate = () => page.getByRole('button', { name: '生成补仓明细单', exact: true }).click();
    const fill = async (name = '科创50ETF', code = '00588000', price = '0.583', atr = '0.026') => {
      if (!await page.locator('#new-plan').isVisible()) await page.locator('#toggle-draft').click();
      await page.locator('#asset-name').fill(name);
      await page.locator('#asset-code').fill(code);
      await page.locator('#opening-price').fill(price);
      await page.locator('#atr-value').fill(atr);
    };
    await page.goto(origin + '/preview/');
    assert.equal(await page.locator('.tool-card').count(), 3);
    await page.getByRole('link', { name: /ATR补仓计算器/ }).click();
    await fill();
    assert.deepEqual(await prices(), ['0.5752', '0.5622', '0.5440']);
    assert.match(await page.locator('#preview-summary').textContent(), /4.46%/);
    assert.equal(await page.locator('#position-total').textContent(), '计划总仓位：40%');
    await page.locator('#add-level').click();
    assert.equal((await prices())[3], '0.5362');
    assert.equal(await page.locator('#position-warning').isVisible(), true);
    await page.getByRole('button', { name: '删除第 2 档', exact: true }).click();
    assert.deepEqual(await prices(), ['0.5752', '0.5570', '0.5492']);
    await page.getByRole('button', { name: '删除第 3 档', exact: true }).click();
    await page.getByRole('button', { name: '删除第 2 档', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '删除第 1 档', exact: true }).isDisabled(), true);
    for (const multiplier of ['0.5', '0.7']) {
      await page.locator('#add-level').click();
      await page.locator('[data-draft-field="multiplier"]').last().fill(multiplier);
    }
    await page.locator('[data-draft-field="multiplier"]').first().fill('0.35');
    assert.equal((await prices())[0], '0.5739');
    await page.locator('[data-draft-field="multiplier"]').first().fill('0.3');
    await page.locator('#opening-price').fill('1.025');
    assert.equal((await prices())[2], '0.9860');
    await page.locator('#opening-price').fill('0.583');
    await page.locator('#atr-value').fill('0.02');
    assert.equal((await prices())[2], '0.5530');
    for (const [field, bad, good] of [
      ['#opening-price', '0', '0.583'], ['#atr-value', '0', '0.026'],
      ['#atr-value', 'abc', '0.026'], ['#atr-value', '1', '0.026'],
      ['[data-draft-field="multiplier"]', '-1', '0.3'],
    ]) {
      await page.locator(field).first().fill(bad);
      assert.equal(await page.locator('#generate-plan').isDisabled(), true);
      assert.deepEqual(await prices(), ['—', '—', '—']);
      await page.locator(field).first().fill(good);
    }
    await page.locator('#opening-position').fill('12.5');
    await page.locator('[data-draft-field="position"]').first().fill('7.5');
    assert.equal(await page.locator('#position-total').textContent(), '计划总仓位：40%');
    await generate();
    let plans = (await stored()).plans;
    const firstId = plans[0].id;
    assert.equal(plans[0].snapshot.code, '00588000');
    assert.equal(plans[0].snapshot.openingPosition, '12.5');
    assert.equal(plans[0].snapshot.levels[0].position, '7.5');
    await confirmTrade(page, 0);
    assert.match(await page.locator('.atr-metrics').textContent(), /已执行仓位20%/);
    await page.reload();
    assert.equal((await stored()).plans[0].executions[0].actualPrice, '0.5752');
    assert.equal(await page.locator('#current-plan input').count(), 0);
    await correctTrade(page, 0, '0.574');
    await page.reload();
    assert.equal((await stored()).plans[0].executions[0].actualPrice, '0.574');
    assert.equal((await stored()).plans[0].executions[0].corrections.length, 1);
    const locked = (await stored()).plans[0].snapshot;
    await fill('通信ETF', '515880', '2', '0.03');
    assert.deepEqual((await stored()).plans[0].snapshot, locked);
    await generate();
    assert.equal((await stored()).plans.length, 2);
    await confirmTrade(page, 0);
    await page.locator('#active-plans button').filter({ hasText: '科创50ETF' }).click();
    assert.equal(await page.locator('#current-plan .is-complete').count(), 1);
    await page.getByRole('button', { name: '复制为新计划', exact: true }).click();
    plans = (await stored()).plans;
    assert.equal(plans.length, 3);
    assert.notEqual(plans[0].id, firstId);
    assert.deepEqual(plans[0].completed, [false, false, false]);
    assert.deepEqual(plans[0].executions, [null, null, null]);
    await page.getByRole('button', { name: '标记为已结束', exact: true }).click();
    assert.equal(await page.locator('#ended-plans button').count(), 1);
    await page.locator('#ended-plans button').click();
    assert.equal(await page.locator('#current-title').textContent(), '历史补仓明细单');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '删除计划', exact: true }).click();
    assert.equal((await stored()).plans.length, 3);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '删除计划', exact: true }).click();
    assert.equal((await stored()).plans.length, 2);
    assert.deepEqual((await stored()).plans.find((plan) => plan.id === firstId).snapshot, locked);

    // 新示例完整成交流程，严格顺序、取消、非法输入、重复提交和纠正锁定。
    const otherPlans = JSON.stringify((await stored()).plans);
    await fill('成交接续ETF', '000001', '1.1080', '0.0430');
    for (const multiplier of await page.locator('[data-draft-field="multiplier"]').all()) await multiplier.fill('0.4');
    await generate();
    const sampleId = (await stored()).plans[0].id;
    const executedRow = (index) => page.locator('[data-execution-level="' + index + '"]');
    assert.deepEqual((await stored()).plans[0].dynamic.levels.map((level) => level.priceDisplay),
      ['1.0908', '1.0736', '1.0564']);
    assert.equal(await executedRow(1).getByRole('button', { name: '确认补仓', exact: true }).isDisabled(), true);
    assert.match(await executedRow(1).getByRole('button', { name: '确认补仓', exact: true }).getAttribute('title'), /请先确认上一档补仓记录/);
    await executedRow(0).getByRole('button', { name: '确认补仓', exact: true }).click();
    assert.equal(await executedRow(0).locator('input').inputValue(), '1.0908');
    await executedRow(0).getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await stored()).plans[0].completed[0], false);
    await executedRow(0).getByRole('button', { name: '确认补仓', exact: true }).click();
    for (const bad of ['', '0', '-1', 'abc', '1000000001']) {
      await executedRow(0).locator('input').fill(bad);
      await executedRow(0).getByRole('button', { name: '确认并锁定', exact: true }).click();
      assert.equal((await stored()).plans[0].completed[0], false);
      assert.ok((await executedRow(0).locator('.atr-trade-editor .status-message').textContent()).length > 0);
    }
    await executedRow(0).locator('input').fill('2');
    assert.match(await executedRow(0).locator('.atr-trade-editor').textContent(), /偏离计划价超过 10%/);
    await executedRow(0).locator('input').fill('1.0880');
    await executedRow(0).locator('form').evaluate((form) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal((await stored()).plans[0].executions[0].actualPrice, '1.088');
    assert.deepEqual((await stored()).plans[0].dynamic.levels.slice(1).map((level) => level.priceDisplay),
      ['1.0708', '1.0536']);
    assert.match(await page.locator('.atr-next-info').textContent(), /距离下一档：-1.58%/);
    assert.match(await executedRow(0).textContent(), /原计划价格：1.0908/);
    assert.equal(await executedRow(0).locator('input').count(), 0);
    await page.reload();
    assert.equal((await stored()).plans[0].executions[0].actualPrice, '1.088');
    // 纠正前需要主动确认；取消不会进入编辑或修改数据。
    const firstRecord = (await stored()).plans[0].executions[0];
    page.once('dialog', (dialog) => dialog.dismiss());
    await executedRow(0).getByRole('button', { name: '纠正记录', exact: true }).click();
    assert.equal(await executedRow(0).locator('input').count(), 0);
    assert.deepEqual((await stored()).plans[0].executions[0], firstRecord);
    await correctTrade(page, 0, '1.087');
    assert.equal((await stored()).plans[0].dynamic.levels[1].priceDisplay, '1.0698');
    await correctTrade(page, 0, '1.088');
    await confirmTrade(page, 1, '1.0710');
    const secondRecord = (await stored()).plans[0].executions[1];
    assert.equal(secondRecord.referencePrice, '1.0708');
    assert.equal((await stored()).plans[0].dynamic.levels[2].priceDisplay, '1.0538');
    await correctTrade(page, 0, '1.087');
    assert.deepEqual((await stored()).plans[0].executions[1], secondRecord);
    assert.equal((await stored()).plans[0].dynamic.levels[2].priceDisplay, '1.0538');
    assert.equal(JSON.stringify((await stored()).plans.filter((plan) => plan.id !== sampleId)), otherPlans);
    // 清空取消与确认；默认档位、仓位恢复，已保存成交和历史完全不变。
    const beforeReset = await stored();
    await page.locator('#toggle-draft').click();
    await page.locator('#atr-period').fill('20');
    await page.locator('#opening-position').fill('50');
    await page.locator('#add-level').click();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#reset-draft').click();
    assert.equal(await page.locator('#atr-period').inputValue(), '20');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#reset-draft').click();
    for (const field of ['#asset-name', '#asset-code', '#opening-price', '#atr-value']) {
      assert.equal(await page.locator(field).inputValue(), '');
    }
    assert.equal(await page.locator('#atr-period').inputValue(), '14');
    assert.equal(await page.locator('#opening-position').inputValue(), '10');
    assert.deepEqual(await page.locator('[data-draft-field="multiplier"]').evaluateAll((nodes) => nodes.map((node) => node.value)),
      ['0.3', '0.5', '0.7']);
    assert.deepEqual(await page.locator('[data-draft-field="position"]').evaluateAll((nodes) => nodes.map((node) => node.value)),
      ['10', '10', '10']);
    assert.deepEqual(await stored(), beforeReset);
    await page.getByRole('button', { name: '标记为已结束', exact: true }).click();
    await page.locator('#ended-plans button').filter({ hasText: '成交接续ETF' }).click();
    assert.equal(await page.locator('#current-title').textContent(), '历史补仓明细单');
    assert.equal(await page.getByRole('button', { name: '纠正记录', exact: true }).count(), 0);
    assert.equal(await page.locator('.atr-execution.is-complete').count(), 2);

    const before = await stored();
    await page.locator('.back-link').click();
    await page.getByRole('link', { name: /涨跌幅计算器/ }).click();
    await page.locator('#price-a').fill('10');
    await page.locator('#price-b').fill('11');
    assert.equal(await page.locator('#change-c').inputValue(), '+10');
    await page.locator('.back-link').click();
    await page.getByRole('link', { name: /汇率计算器/ }).click();
    await page.waitForFunction(() => document.querySelector('#rate-status').textContent.includes('已获取'));
    await page.locator('#amount-usd').fill('10');
    assert.equal(await page.locator('#amount-cny').inputValue(), '70');
    await page.goto(atrUrl);
    assert.deepEqual(await stored(), before);
    await fill();
    const screenshots = process.env.ATR_SCREENSHOT_DIR;
    if (screenshots) {
      await fs.mkdir(screenshots, { recursive: true });
      await page.screenshot({ path: path.join(screenshots, 'atr-desktop.png'), fullPage: true });
    }
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      const input = page.locator('#opening-price');
      await input.focus();
      assert.equal(await input.evaluate((node) => getComputedStyle(node).fontSize), '22px');
      const hitArea = await page.locator('.atr-execution').first().boundingBox();
      assert.ok(hitArea.width > 240 && hitArea.height >= 44);
    }
    if (screenshots) await page.screenshot({ path: path.join(screenshots, 'atr-mobile.png'), fullPage: true });

    // 新工具与所有旧页面在子路径下离线打开、数据保留。
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    assert.equal(await page.locator('#pwa-update').count(), 0);
    await context.setOffline(true);
    for (const tool of ['atr-calculator', 'change-calculator', 'currency-converter']) {
      await page.goto(origin + '/preview/tools/' + tool + '/index.html');
      assert.equal(await page.locator('h1').count(), 1);
    }
    await page.goto(origin + '/preview/');
    assert.equal(await page.locator('.tool-card').count(), 3);
    await page.goto(atrUrl);
    assert.deepEqual(await stored(), before);
    await fill();
    assert.deepEqual(await prices(), ['0.5752', '0.5622', '0.5440']);
    await context.setOffline(false);
    // 服务仅在内存中模拟下一版本；点击更新刷新后计划数据仍在。
    nextVersion = true;
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting));
    await page.waitForSelector('#pwa-update:not([hidden])');
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: '立即更新', exact: true }).click(),
    ]);
    assert.deepEqual(await stored(), before);
    await page.waitForFunction(() => document.querySelector('[data-app-version]').textContent.includes('v1.3.1-test'));
    const versions = await page.evaluate(() => caches.keys());
    assert.equal(versions.filter((name) => name.startsWith('monster-slayer-kit:')).length, 1);
    nextVersion = false;
    // 根路径也独立注册并缓存新工具。
    const rootContext = await browser.newContext();
    const rootPage = await rootContext.newPage();
    await rootPage.goto(origin + '/tools/atr-calculator/index.html');
    await rootPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await rootContext.setOffline(true);
    await rootPage.reload();
    assert.equal(await rootPage.locator('h1').textContent(), 'ATR补仓计算器');
    await rootContext.close();

    // 同步多标签页，持久化错误不覆盖旧计划。
    const other = await context.newPage();
    await other.goto(atrUrl);
    await confirmTrade(other, 1);
    await page.waitForFunction(() => document.querySelectorAll('#current-plan .is-complete').length === 2);
    await other.close();
    const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
    await confirmTrade(page, 2);
    assert.match(await page.locator('#action-message').textContent(), /保存失败/);
    assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), raw);
    await fill();
    await generate();
    assert.match(await page.locator('#action-message').textContent(), /保存失败/);
    assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), raw);
    await page.reload();
    await page.evaluate((storageKey) => localStorage.setItem(storageKey, '{broken'), key);
    await page.reload();
    assert.equal(await page.locator('#storage-message').isVisible(), true);
    await fill();
    assert.equal(await page.locator('#generate-plan').isDisabled(), true);
    assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), '{broken');

    // 在隔离测试来源中加载旧数据：不提前写入，不伪造成交价，补录后持久化。
    const oldContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const old = core.createPlan({
      name: '旧计划ETF', code: '001234', price: '1.1080', atr: '.0430',
      period: '14', openingPosition: '10',
      levels: Array.from({ length: 3 }, () => ({ multiplier: '.4', position: '10' })),
    }, 'legacy', '2026-10-13T04:00:00.000Z');
    delete old.executionVersion; delete old.executions; delete old.dynamic;
    old.completed[0] = true;
    const oldRaw = JSON.stringify({ version: 1, plans: [old] });
    await oldContext.addInitScript(({ storageKey, value }) => {
      if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, value);
    }, { storageKey: key, value: oldRaw });
    const oldPage = await oldContext.newPage();
    oldPage.on('pageerror', (error) => errors.push(error.message));
    await oldPage.goto(atrUrl);
    assert.match(await oldPage.locator('[data-execution-level="0"]').textContent(), /实际价格未记录/);
    assert.equal(await oldPage.evaluate((storageKey) => localStorage.getItem(storageKey), key), oldRaw);
    assert.equal(await oldPage.locator('[data-execution-level="1"]').getByRole('button', { name: '确认补仓', exact: true }).isDisabled(), true);
    assert.match(await oldPage.locator('[data-execution-level="1"]').getByRole('button', { name: '确认补仓', exact: true }).getAttribute('title'), /请先补录/);
    await oldPage.getByRole('button', { name: '补录实际价格', exact: true }).click();
    assert.equal(await oldPage.locator('.atr-trade-editor input').inputValue(), '');
    await oldPage.locator('.atr-trade-editor input').fill('1.088');
    await oldPage.getByRole('button', { name: '保存补录并锁定', exact: true }).click();
    await oldPage.reload();
    const restored = await oldPage.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key);
    assert.equal(restored.version, 2);
    assert.equal(restored.plans[0].id, old.id);
    assert.deepEqual(restored.plans[0].snapshot, old.snapshot);
    assert.deepEqual(restored.plans[0].completed, old.completed);
    assert.equal(restored.plans[0].executions[0].actualPrice, '1.088');
    assert.equal(restored.plans[0].dynamic.levels[1].priceDisplay, '1.0708');
    await oldPage.getByRole('button', { name: '纠正记录', exact: true }).click({ trial: true });
    await correctTrade(oldPage, 0, '.01');
    assert.equal(await oldPage.locator('[data-execution-level="1"] .atr-price').textContent(), '—');
    assert.match(await oldPage.locator('.atr-next-info').textContent(), /不大于 0/);
    await correctTrade(oldPage, 0, '1.088');
    // 确认表单在手机尺寸下也不横向溢出，按钮点击区域足够。
    await oldPage.locator('[data-execution-level="1"]').getByRole('button', { name: '确认补仓', exact: true }).click();
    for (const width of [320, 375, 390, 430]) {
      await oldPage.setViewportSize({ width, height: 844 });
      assert.equal(await oldPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await oldPage.locator('.atr-trade-editor input').evaluate((node) => getComputedStyle(node).fontSize), '18px');
      const inputBounds = await oldPage.locator('.atr-trade-editor input').boundingBox();
      assert.ok(inputBounds.width >= 160 && inputBounds.height >= 44);
      const bounds = await oldPage.getByRole('button', { name: '确认并锁定', exact: true }).boundingBox();
      assert.ok(bounds.height >= 44);
    }
    if (screenshots) await oldPage.screenshot({ path: path.join(screenshots, 'atr-mobile-confirm.png'), fullPage: true });
    await oldPage.getByRole('button', { name: '取消', exact: true }).click();
    await oldContext.close();

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

// 正式发布升级回归：服务器仅在内存中切换旧版与正式版，源码与用户数据不变。
test('正式版升级：v1.1.1 / v1.2.0-dev.2 / v1.2.0 → v1.3.0，旧计划与其他存储保留', { timeout: 120000 }, async () => {
  const releaseWorker = await fs.readFile(path.join(root, 'sw.js'), 'utf8');
  assert.match(releaseWorker, /const APP_VERSION = 'v1\.3\.0';/);
  const predecessors = { v111: 'v1.1.1', dev2: 'v1.2.0-dev.2', v120: 'v1.2.0' };
  const published = new Set();
  const server = http.createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const prefix = pathname.split('/')[1];
      if (!predecessors[prefix]) { response.writeHead(404).end(); return; }
      pathname = pathname.slice(prefix.length + 1);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      let body = await fs.readFile(file);
      if (!published.has(prefix)) {
        if (file === path.join(root, 'sw.js')) {
          let old = releaseWorker.replace("'v1.3.0'", "'" + predecessors[prefix] + "'");
          if (prefix === 'v111') old = old.replace(/^.*'\.\/tools\/atr-calculator\/.*\n/gm, '');
          body = Buffer.from(old);
        } else if (prefix === 'v111' && file === path.join(root, 'index.html')) {
          body = Buffer.from(body.toString()
            .replace(/\s*<a class="tool-card" href="\.\/tools\/atr-calculator\/index\.html">[\s\S]*?<\/a>/, '')
            .replace('<span>3 个</span>', '<span>2 个</span>'));
        } else if (file === path.join(root, 'assets', 'styles.css')) {
          body = Buffer.from('/* predecessor-cache: ' + prefix + ' */\n' + body.toString());
        }
      }
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const [prefix, predecessor] of Object.entries(predecessors)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const scope = origin + '/' + prefix + '/';
      const draft = {
        name: '发布前ETF', code: '00588000', price: '1.108', atr: '.043', period: '14',
        openingPosition: '10',
        levels: Array.from({ length: 3 }, () => ({ multiplier: '.4', position: '10' })),
      };
      const old = core.createPlan(draft, 'legacy-kept', '2026-10-13T04:00:00.000Z');
      delete old.executionVersion; delete old.executions; delete old.dynamic;
      old.completed[0] = true;
      let plans = [old];
      let version = 1;
      if (prefix === 'dev2' || prefix === 'v120') {
        let confirmed = core.recordTrade(core.createPlan(draft, 'confirmed-kept'),
          0, '1.088', 'confirm', '2026-10-13T04:00:00.000Z');
        confirmed = core.recordTrade(confirmed, 0, '1.087', 'correct', '2026-10-13T05:00:00.000Z');
        plans = [confirmed, { ...core.normalizePlan(old), status: 'ended' }];
        version = 2;
      }
      const raw = JSON.stringify({ version, plans });
      const ratesKey = 'monster-slayer-kit:currency-rates:v1';
      const rates = '{"jpyCny":0.05,"usdCny":7,"date":"2026-10-13"}';
      await context.addInitScript(({ storageKey, raw, ratesKey, rates }) => {
        if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, raw);
        if (localStorage.getItem(ratesKey) === null) localStorage.setItem(ratesKey, rates);
        if (localStorage.getItem('other-app') === null) localStorage.setItem('other-app', 'keep');
      }, { storageKey: key, raw, ratesKey, rates });
      await page.goto(prefix === 'v111' ? scope : scope + 'tools/atr-calculator/index.html');
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await page.waitForFunction((version) => document.querySelector('[data-app-version]')?.textContent.includes(version),
        predecessor);
      assert.equal(await page.locator('#pwa-update:not([hidden])').count(), 0);
      const stylesheetUrl = scope + 'assets/styles.css';
      assert.match(await page.evaluate(async (url) => (await caches.match(url)).text(), stylesheetUrl), /predecessor-cache/);
      await page.evaluate(async () => {
        const unrelated = await caches.open('unrelated-application');
        await unrelated.put('/unrelated-marker', new Response('preserve'));
      });
      assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), raw);
      let navigations = 0;
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1; });
      published.add(prefix);
      await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
      await page.waitForSelector('#pwa-update:not([hidden])');
      assert.equal(await page.locator('[data-app-version]').textContent(), '要你命3000 · ' + predecessor);
      assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), raw);
      await Promise.all([
        page.waitForNavigation(),
        page.getByRole('button', { name: '立即更新', exact: true }).click(),
      ]);
      await page.waitForFunction(() => document.querySelector('[data-app-version]')?.textContent === '要你命3000 · v1.3.0');
      assert.equal(navigations, 1);
      assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), raw);
      assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), ratesKey), rates);
      assert.equal(await page.evaluate(() => localStorage.getItem('other-app')), 'keep');
      const cacheKeys = await page.evaluate(() => caches.keys());
      assert.equal(cacheKeys.filter((name) => name.startsWith('monster-slayer-kit:')).length, 1);
      assert.ok(cacheKeys.some((name) => name.endsWith(':v1.3.0')));
      assert.equal(await page.evaluate(async (url) => (await caches.match(url)).text(), stylesheetUrl),
        await fs.readFile(path.join(root, 'assets', 'styles.css'), 'utf8'));
      assert.ok(cacheKeys.includes('unrelated-application'));
      const responseText = await page.evaluate(async () => (await caches.match('/unrelated-marker')).text());
      assert.equal(responseText, 'preserve');
      await context.setOffline(true);
      await page.goto(scope + 'tools/atr-calculator/index.html');
      assert.equal(await page.locator('h1').textContent(), 'ATR补仓计算器');
      assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), raw);
      assert.equal(await page.locator('#plan-count').textContent(), plans.length + ' 份');
      if (prefix === 'v111') {
        assert.match(await page.locator('#current-plan').textContent(), /实际价格未记录/);
      } else {
        assert.match(await page.locator('#current-plan').textContent(), /1\.0870/);
        assert.equal(await page.locator('.atr-corrections').count(), 1);
      }
      await page.goto(scope);
      assert.equal(await page.locator('.tool-card').count(), 3);
      await page.waitForFunction(() => document.querySelector('[data-app-version]')?.textContent === '要你命3000 · v1.3.0');
      for (const tool of ['change-calculator', 'currency-converter']) {
        await page.goto(scope + 'tools/' + tool + '/index.html');
        await page.waitForFunction(() => document.querySelector('[data-app-version]')?.textContent === '要你命3000 · v1.3.0');
      }
      assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key), raw);
      assert.equal(await page.evaluate((storageKey) => localStorage.getItem(storageKey), ratesKey), rates);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
