'use strict';
// Uses the existing Playwright installation and system Edge; no downloads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const core = require('../tools/atr-calculator/atr-core.js');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const storageKey = 'monster-slayer-kit:atr-plans:v1';

async function withBrowser(run) {
  const server = http.createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const network = { failing: false };
    await context.route('https://api.frankfurter.dev/**', (route) => route.fulfill({
      status: network.failing ? 503 : 200,
      contentType: 'application/json', body: JSON.stringify({
        rate: route.request().url().includes('/JPY/') ? 0.05 : 7, date: '2026-10-13',
      }),
    }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.location().url.includes('api.frankfurter.dev')) errors.push(message.text());
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const captures = [];
    const shot = async (name, fullPage = true) => {
      if (!process.env.UI_SCREENSHOT_DIR) return;
      await fs.mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, name + '.png'), fullPage });
      captures.push({ file: name + '.png', cssViewport: page.viewportSize(), deviceScaleFactor: await page.evaluate(() => devicePixelRatio), fullPage });
    };
    await run({ page, context, origin, shot, network });
    if (process.env.UI_SCREENSHOT_DIR) {
      const file = path.join(process.env.UI_SCREENSHOT_DIR, 'screenshot-metadata.json');
      let previous = [];
      try { previous = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* First suite. */ }
      const names = new Set(captures.map((capture) => capture.file));
      await fs.writeFile(file, JSON.stringify([...previous.filter((capture) => !names.has(capture.file)), ...captures], null, 2));
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function checkLayout(page) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    smallInputs: [...document.querySelectorAll('input')].filter((node) => node.getClientRects().length &&
      parseFloat(getComputedStyle(node).fontSize) < 16).map((node) => node.id),
    smallButtons: [...document.querySelectorAll('button, .brand-mark, .back-link')].filter((node) => node.getClientRects().length &&
      node.getBoundingClientRect().height < 44).map((node) => node.textContent),
  }));
  assert.equal(result.overflow, false);
  assert.deepEqual(result.smallInputs, []);
  assert.deepEqual(result.smallButtons, []);
}

const viewports = [
  { width: 390, height: 844 }, { width: 375, height: 812 },
  { width: 430, height: 932 }, { width: 320, height: 568 }, { width: 1280, height: 900 },
];

test('统一UI：四页响应式、首屏操作、触控尺寸与手机截图', { timeout: 120000 }, async () => {
  await withBrowser(async ({ page, origin, shot }) => {
    const measurements = [];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const [name, url] of [
        ['home', '/'], ['change', '/tools/change-calculator/index.html'],
        ['currency', '/tools/currency-converter/index.html'], ['atr-new', '/tools/atr-calculator/index.html'],
      ]) {
        await page.goto(origin + url);
        if (name === 'currency') await page.waitForFunction(() => document.querySelector('#rate-status').textContent.includes('已获取'));
        await checkLayout(page);
        const heading = await page.locator('h1').evaluate((node) => {
          const style = getComputedStyle(node);
          return { font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
        });
        assert.ok(heading.font >= 24 && heading.font <= 28);
        if (name === 'home') {
          const bottom = await page.locator('.tool-card').last().evaluate((node) => node.getBoundingClientRect().bottom);
          assert.ok(bottom <= viewport.height, 'all three tools fit the first viewport');
          for (const card of await page.locator('.tool-card').all()) {
            const box = await card.boundingBox();
            assert.ok(box.height >= 88 && box.height <= 108);
          }
        }
        if (name === 'change' || name === 'currency') {
          const bottom = await page.locator('.status-row').evaluate((node) => node.getBoundingClientRect().bottom);
          assert.ok(bottom <= viewport.height, name + ' primary controls fit the viewport');
        }
        if (name === 'atr-new') {
          assert.equal(await page.locator('#new-plan').isVisible(), true);
          assert.equal(await page.locator('#current-section').isVisible(), false);
          const box = await page.locator('.atr-level').first().boundingBox();
          assert.ok(box.height <= (viewport.width <= 360 ? 176 : 140), 'draft level height at ' + viewport.width + 'px: ' + box.height);
        }
        measurements.push({ viewport, name, geometry: await page.evaluate(() => {
          const box = (selector) => [...document.querySelectorAll(selector)].map((node) => {
            const r = node.getBoundingClientRect(); return { top: r.top, width: r.width, height: r.height };
          });
          return { pageHeight: document.documentElement.scrollHeight, cards: box('.tool-card, .calculator-card'), levels: box('.atr-level') };
        }) });
        if (viewport.width === 390) await shot(name + '-390');
        if (viewport.width === 1280) await shot(name + '-1280');
      }
    }
    if (process.env.UI_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.UI_SCREENSHOT_DIR, 'layout-measurements.json'), JSON.stringify(measurements, null, 2));
  });
});

test('旧工具：三种反推、可编辑结果、汇率三币种和缓存回退', { timeout: 120000 }, async () => {
  await withBrowser(async ({ page, origin, shot, context, network }) => {
    await page.goto(origin + '/tools/change-calculator/index.html');
    const clear = () => page.locator('#clear-button').click();
    await page.locator('#price-a').fill('10');
    await page.locator('#price-b').fill('11');
    assert.equal(await page.locator('#change-c').inputValue(), '+10');
    assert.equal(await page.locator('#price-b-drop-value').textContent(), '10.89');
    assert.equal(await page.locator('#change-c').isEditable(), true);
    await shot('change-filled-390');
    await page.locator('#change-c').fill('20');
    assert.equal(await page.locator('#price-a').inputValue(), '9.16666667');
    await clear();
    await page.locator('#price-a').fill('10');
    await page.locator('#change-c').fill('-10');
    assert.equal(await page.locator('#price-b').inputValue(), '9');
    await clear();
    await page.locator('#price-b').fill('11');
    await page.locator('#change-c').fill('10');
    assert.equal(await page.locator('#price-a').inputValue(), '10');
    await page.locator('#change-c').fill('-100');
    assert.match(await page.locator('#status-message').textContent(), /无法反推/);
    await clear();
    await page.locator('#price-a').fill('0');
    await page.locator('#price-b').fill('11');
    assert.match(await page.locator('#status-message').textContent(), /为 0/);
    await page.locator('#price-a').fill('-1');
    assert.match(await page.locator('#status-message').textContent(), /不能小于 0/);
    await page.reload();
    assert.equal(await page.locator('#price-a').inputValue(), '');

    await page.goto(origin + '/tools/currency-converter/index.html');
    await page.waitForFunction(() => document.querySelector('#rate-status').textContent.includes('已获取'));
    for (const [source, value, other, expected] of [
      ['usd', '10', 'cny', '70'], ['jpy', '1400', 'usd', '10'], ['cny', '70', 'jpy', '1400'],
    ]) {
      await page.locator('#amount-' + source).fill(value);
      assert.equal(await page.locator('#amount-' + other).inputValue(), expected);
      assert.match(await page.locator('[data-role="' + source.toUpperCase() + '"]').textContent(), /当前输入/);
      assert.match(await page.locator('[data-role="' + other.toUpperCase() + '"]').textContent(), /自动换算/);
      assert.equal(await page.locator('#amount-' + other).isEditable(), true);
    }
    await shot('currency-filled-390');
    await page.locator('#amount-cny').fill('');
    assert.equal(await page.locator('#amount-usd').inputValue(), '');
    assert.equal(await page.locator('.currency-field.is-derived').count(), 0);
    await page.locator('#amount-cny').fill('abc');
    assert.match(await page.locator('#rate-status').textContent(), /有效/);
    await page.locator('#amount-usd').fill('1.23');
    assert.equal(await page.locator('#amount-cny').inputValue(), '8.61');
    network.failing = true;
    await page.locator('#refresh-rates').click();
    await page.waitForFunction(() => document.querySelector('#rate-status').textContent.includes('使用缓存'));
    assert.equal(await page.locator('#amount-cny').inputValue(), '8.61');
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#rate-status').textContent.includes('使用缓存'));
    await page.locator('#amount-jpy').fill('1400');
    assert.equal(await page.locator('#amount-usd').inputValue(), '10');
    await shot('currency-cached-390');
    await context.setOffline(false);
    await page.evaluate(() => localStorage.removeItem('monster-slayer-kit:currency-rates:v1'));
    await page.locator('#refresh-rates').click();
    await page.waitForFunction(() => document.querySelector('#rate-status').textContent.includes('无法获取'));
  });
});

test('ATR新界面：计划优先、折叠保留草稿、三类价格、长名称及冲突反馈', { timeout: 120000 }, async () => {
  await withBrowser(async ({ page, context, origin, shot }) => {
    const url = origin + '/tools/atr-calculator/index.html';
    await page.goto(url);
    await page.locator('#asset-name').fill('科创50ETF');
    await page.locator('#asset-code').fill('00588000');
    await page.locator('#opening-price').fill('1.108');
    await page.locator('#atr-value').fill('.043');
    for (const input of await page.locator('[data-draft-field="multiplier"]').all()) await input.fill('.4');
    await shot('atr-new-filled-390');
    await page.locator('#generate-plan').click();
    assert.equal(await page.locator('#new-plan').isVisible(), false);
    assert.equal(await page.locator('#current-section').isVisible(), true);
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok((await page.locator('#current-section').boundingBox()).y < 280);
    await shot('atr-plan-390');
    await page.locator('#toggle-draft').click();
    await page.locator('#asset-name').fill('尚未保存的草稿');
    await page.evaluate(() => { window.retainedNameInput = document.querySelector('#asset-name'); });
    await page.locator('#toggle-draft').click();
    await page.locator('#toggle-draft').click();
    assert.equal(await page.locator('#asset-name').inputValue(), '尚未保存的草稿');
    assert.equal(await page.evaluate(() => window.retainedNameInput === document.querySelector('#asset-name')), true);
    assert.equal(await page.locator('#asset-name').evaluate((node) => node === document.activeElement), true);
    await page.locator('#toggle-draft').click();
    const row = (index) => page.locator('[data-execution-level="' + index + '"]');
    await row(0).getByRole('button', { name: '确认补仓', exact: true }).click();
    await row(0).locator('input').fill('1.088');
    await row(0).getByRole('button', { name: '确认并锁定', exact: true }).click();
    assert.match(await row(0).textContent(), /实际成交价格/);
    assert.match(await row(0).textContent(), /确认时参考价：1.0908/);
    assert.match(await row(1).textContent(), /当前参考价/);
    assert.match(await row(1).textContent(), /1.0708/);
    assert.match(await row(1).textContent(), /原计划价格：1.0736/);
    assert.equal(await row(0).locator('input').count(), 0);
    await page.evaluate(() => scrollTo(0, 0));
    await shot('atr-confirmed-390');
    await row(1).getByRole('button', { name: '确认补仓', exact: true }).click();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await checkLayout(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await shot('atr-trade-editor-390');
    await row(1).getByRole('button', { name: '取消', exact: true }).click();
    await page.reload();
    assert.equal(await page.locator('#new-plan').isVisible(), false);
    assert.equal(await row(0).locator('input').count(), 0);
    await page.locator('#toggle-draft').click();
    await page.locator('#asset-name').fill('长股票名称'.repeat(10));
    await page.locator('#opening-price').fill('999999999.12345678');
    await page.locator('#atr-value').fill('.12345678');
    await page.locator('#generate-plan').click();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await checkLayout(page);
    }
    // Same-page storage change bypasses the storage event: the write must still detect it.
    await page.locator('#toggle-draft').click();
    await page.locator('#asset-name').fill('冲突不能覆盖');
    await page.evaluate((key) => {
      const data = JSON.parse(localStorage.getItem(key));
      data.plans = data.plans.slice(0, 1);
      localStorage.setItem(key, JSON.stringify(data));
    }, storageKey);
    await page.locator('#generate-plan').click();
    assert.match(await page.locator('#action-message').textContent(), /其他页面/);
    assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).plans.length, storageKey), 1);
    await page.reload();
    const other = await context.newPage();
    await other.goto(url);
    await other.locator('#toggle-draft').click();
    await other.locator('#asset-name').fill('来自另一页的计划');
    await other.locator('#opening-price').fill('2');
    await other.locator('#atr-value').fill('.03');
    await other.locator('#generate-plan').click();
    await page.waitForFunction(() => document.querySelector('#plan-count').textContent === '2 份');
    await other.close();
    await page.locator('#active-plans button').filter({ hasText: '来自另一页的计划' }).click();
    await row(0).getByRole('button', { name: '确认补仓', exact: true }).click();
    await row(0).locator('input').fill('3');
    await row(0).getByRole('button', { name: '确认并锁定', exact: true }).click();
    assert.match(await row(0).locator('.atr-drop').textContent(), /累计涨幅 \+50.00%/);
    assert.equal(await row(0).locator('.atr-drop').getAttribute('data-tone'), 'up');
  });
});


test('第二轮定向UI：执行布局与全部记录状态，四种CSS视口截图', { timeout: 120000 }, async () => {
  await withBrowser(async ({ page, origin, shot }) => {
    const draft = { name: '科创50ETF', code: '588000', price: '1.108', atr: '.043',
      period: '14', openingPosition: '10',
      levels: Array.from({ length: 3 }, () => ({ multiplier: '.4', position: '10' })) };
    const pending = core.createPlan(draft, 'round2-plan', '2026-10-14T01:00:00.000Z');
    const first = core.recordTrade(pending, 0, '1.088', 'confirm', '2026-10-14T01:01:00.000Z');
    const multiple = core.recordTrade(first, 1, '1.071', 'confirm', '2026-10-14T01:02:00.000Z');
    const corrected = core.recordTrade(first, 0, '1.087', 'correct', '2026-10-14T01:03:00.000Z');
    const legacy = JSON.parse(JSON.stringify(pending));
    delete legacy.executionVersion; delete legacy.executions; delete legacy.dynamic;
    legacy.completed[0] = true;
    const invalid = core.recordTrade(pending, 0, '.01', 'confirm', '2026-10-14T01:04:00.000Z');
    const ended = { ...multiple, status: 'ended' };
    const measurements = [];
    const atrUrl = origin + '/tools/atr-calculator/index.html';
    const loadPlan = async (plan, version = 2) => {
      await page.goto(atrUrl);
      await page.evaluate(({ key, plan, version }) => {
        localStorage.setItem(key, JSON.stringify({ version, plans: [plan] }));
      }, { key: storageKey, plan, version });
      await page.reload();
    };
    const row = (index) => page.locator('[data-execution-level="' + index + '"]');
    const rowHeight = (index) => row(index).evaluate((node) => node.getBoundingClientRect().height);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const suffix = viewport.width + 'x' + viewport.height;
      for (const [name, url] of [['home', '/'], ['change', '/tools/change-calculator/index.html'],
        ['currency', '/tools/currency-converter/index.html']]) {
        await page.goto(origin + url);
        if (name === 'currency') {
          await page.waitForFunction(() => document.querySelector('#rate-status').textContent.includes('已获取'));
          assert.equal(await page.locator('.rate-detail').count(), 4);
          await page.locator('#amount-cny').fill('70');
        } else if (name === 'change') {
          assert.equal(await page.locator('.field-role').allTextContents().then((values) => values.join('')), '');
          assert.equal(await page.locator('#status-message').textContent(), '');
          await page.locator('#price-a').fill('10');
          await page.locator('#price-b').fill('11');
          assert.equal(await page.locator('[data-role="c"]').textContent(), '自动计算 · 可编辑');
        }
        await checkLayout(page);
        assert.equal(await page.locator('.site-shell').evaluate((node) => node.getBoundingClientRect().width <= 560), true);
        if (name !== 'home') {
          assert.equal(await page.locator('.back-link').evaluate((node) => getComputedStyle(node).textDecorationLine), 'none');
          assert.equal(await page.locator('.back-link span').evaluate((node) => getComputedStyle(node).textDecorationLine), 'none');
        }
        await shot(name + '-' + suffix);
      }
      await page.goto(atrUrl);
      // This origin and browser context are created only for this test.
      await page.evaluate((key) => localStorage.removeItem(key), storageKey);
      await page.reload();
      assert.equal(await page.locator('[data-preview-drop]').first().getAttribute('data-tone'), '');
      const placeholderColor = await page.locator('[data-preview-drop]').first().evaluate((node) => getComputedStyle(node).color);
      assert.equal(placeholderColor, await page.locator('[data-preview-price]').first().evaluate((node) => getComputedStyle(node).color));
      for (const [id, value] of [['asset-name', draft.name], ['asset-code', draft.code],
        ['opening-price', draft.price], ['atr-value', draft.atr]]) await page.locator('#' + id).fill(value);
      for (const input of await page.locator('[data-draft-field="multiplier"]').all()) await input.fill('.4');
      await checkLayout(page);
      const deleteButton = await page.getByRole('button', { name: '删除第 1 档', exact: true }).boundingBox();
      assert.ok(deleteButton.height >= 44 && deleteButton.width >= 44);
      await shot('atr-new-' + suffix);

      for (const [name, plan, version] of [
        ['pending', pending, 2], ['first-trade', first, 2], ['multiple-trades', multiple, 2],
        ['corrected', corrected, 2], ['ended', ended, 2], ['missing-actual', legacy, 1], ['invalid-target', invalid, 2],
      ]) {
        await loadPlan(plan, version);
        await checkLayout(page);
        for (const price of await page.locator('.atr-execution .atr-price').all()) {
          assert.equal(await price.evaluate((node) => getComputedStyle(node).fontSize), '26px');
        }
        assert.match(await row(0).textContent(), /原计划价格：1.0908/);
        assert.match(await row(0).textContent(), /计划仓位 10%/);
        if (name === 'pending') {
          assert.equal(await row(0).getByRole('button', { name: '确认补仓', exact: true }).isEnabled(), true);
          assert.equal(await row(1).getByRole('button', { name: '确认补仓', exact: true }).isDisabled(), true);
          assert.equal(await row(2).getByRole('button', { name: '确认补仓', exact: true }).isDisabled(), true);
          // Primary action uses the space beside the price, rather than another full row.
          const action = await row(0).locator('.atr-execution-action').boundingBox();
          const price = await row(0).locator('.atr-execution-price').boundingBox();
          assert.ok(action.x >= price.x + price.width);
          assert.ok(action.y < price.y + price.height);
          if (viewport.width === 390) assert.ok(await rowHeight(0) <= 164);
          await shot('atr-existing-first-screen-' + suffix, false);
          await page.locator('#current-section').evaluate((node) => node.scrollIntoView({ block: 'start' }));
          await shot('atr-three-pending-' + suffix);
          await row(0).getByRole('button', { name: '确认补仓', exact: true }).click();
          await row(0).locator('input').fill('1.088');
          assert.equal(await row(0).getByRole('button', { name: '确认补仓', exact: true }).isVisible(), false);
          await row(0).getByRole('button', { name: '取消', exact: true }).click();
          assert.equal(await row(0).getByRole('button', { name: '确认补仓', exact: true }).isVisible(), true);
        } else if (name === 'first-trade') {
          assert.match(await row(0).textContent(), /实际成交价格/);
          assert.match(await row(0).textContent(), /1.0880/);
          assert.match(await row(0).textContent(), /确认时参考价：1.0908/);
          assert.match(await row(0).textContent(), /确认时间：/);
          assert.match(await row(1).textContent(), /1.0708/);
          assert.equal(await row(1).getByRole('button', { name: '确认补仓', exact: true }).isEnabled(), true);
          if (viewport.width === 390) assert.ok(await rowHeight(0) <= 220);
          await shot('atr-first-trade-' + suffix);
        } else if (name === 'multiple-trades') {
          assert.match(await row(1).textContent(), /1.0710/);
          assert.match(await row(2).textContent(), /1.0538/);
          assert.equal(await row(2).getByRole('button', { name: '确认补仓', exact: true }).isEnabled(), true);
        } else if (name === 'corrected') {
          assert.match(await row(0).textContent(), /1.0870/);
          assert.match(await row(1).textContent(), /1.0698/);
          await row(0).locator('summary').click();
          assert.match(await row(0).locator('details').textContent(), /1.088 → 1.087/);
        } else if (name === 'ended') {
          assert.equal(await page.getByRole('button', { name: '确认补仓', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: '纠正记录', exact: true }).count(), 0);
          assert.match(await row(0).textContent(), /确认时间：/);
        } else if (name === 'missing-actual') {
          assert.match(await row(0).textContent(), /实际价格未记录/);
          assert.equal(await row(0).getByRole('button', { name: '补录实际价格', exact: true }).isEnabled(), true);
          assert.equal(await row(1).getByRole('button', { name: '确认补仓', exact: true }).isDisabled(), true);
          assert.equal(await row(1).locator('.atr-price').textContent(), '—');
          assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).version, storageKey), 1);
        } else if (name === 'invalid-target') {
          assert.equal(await row(1).locator('.atr-price').textContent(), '—');
          assert.match(await row(1).textContent(), /目标价格无效/);
          assert.equal(await row(1).getByRole('button', { name: '确认补仓', exact: true }).isEnabled(), true);
        }
        measurements.push({ cssViewport: viewport, deviceScaleFactor: 1, state: name,
          levelHeights: await page.locator('.atr-execution').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height)) });
        await shot('atr-' + name + '-' + suffix);
      }
    }
    if (process.env.UI_SCREENSHOT_DIR) await fs.writeFile(path.join(process.env.UI_SCREENSHOT_DIR, 'atr-state-measurements.json'), JSON.stringify(measurements, null, 2));
  });
});


test('ATR已结束文案：未执行、历史参考、异常历史及数据不写入；进行中保持原样', { timeout: 120000 }, async () => {
  await withBrowser(async ({ page, origin }) => {
    const draft = { name: '历史文案ETF', code: '00588000', price: '1.108', atr: '.043',
      period: '14', openingPosition: '10',
      levels: Array.from({ length: 3 }, () => ({ multiplier: '.4', position: '10' })) };
    const pending = core.createPlan(draft, 'wording-plan', '2026-10-14T01:00:00.000Z');
    const first = core.recordTrade(pending, 0, '1.088', 'confirm', '2026-10-14T01:01:00.000Z');
    const corrected = core.recordTrade(first, 0, '1.087', 'correct', '2026-10-14T01:02:00.000Z');
    const second = core.recordTrade(first, 1, '1.071', 'confirm', '2026-10-14T01:03:00.000Z');
    const finished = core.recordTrade(second, 2, '1.054', 'confirm', '2026-10-14T01:04:00.000Z');
    const invalid = core.recordTrade(pending, 0, '.01', 'confirm', '2026-10-14T01:05:00.000Z');
    const legacy = JSON.parse(JSON.stringify(pending));
    delete legacy.executionVersion; delete legacy.executions; delete legacy.dynamic;
    legacy.completed[0] = true;
    const gap = JSON.parse(JSON.stringify(legacy));
    gap.completed = [false, true, false];
    const filledGap = core.recordTrade(core.normalizePlan(gap), 1, '1.071', 'backfill', '2026-10-14T01:06:00.000Z');
    const load = async (plan, version = 2) => {
      await page.goto(origin + '/tools/atr-calculator/index.html');
      const raw = JSON.stringify({ version, plans: [plan] });
      await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: storageKey, raw });
      await page.reload();
      return raw;
    };
    const expected = [
      [pending, 2, /历史参考价：1.0908/], [first, 2, /历史参考价：1.0708/],
      [corrected, 2, /历史参考价：1.0698/], [finished, 2, /全部档位已执行/],
      [invalid, 2, /历史参考价不大于 0/], [legacy, 1, /实际价格未记录/],
      [filledGap, 2, /历史计划存在跳档记录/],
    ];
    for (const [plan, version, message] of expected) {
      const ended = { ...plan, status: 'ended' };
      const raw = await load(ended, version);
      const current = page.locator('#current-plan');
      assert.match(await current.textContent(), message);
      assert.match(await current.locator('.atr-metrics').textContent(), /未执行仓位/);
      assert.doesNotMatch(await current.textContent(), /待补仓|待补录|等待前档|等待补录|下一档目标价格|距离下一档|请先补录|重新评估|仍可记录/);
      for (let index = 0; index < ended.completed.length; index += 1) {
        if (!ended.completed[index]) {
          assert.equal(await current.locator('[data-execution-level="' + index + '"] .atr-execution-head strong').textContent(), '未执行');
          assert.equal(await current.locator('[data-execution-level="' + index + '"] .atr-price-label').textContent(), '历史参考价');
        }
      }
      assert.equal(await current.getByRole('button', { name: '确认补仓', exact: true }).count(), 0);
      assert.equal(await current.getByRole('button', { name: '纠正记录', exact: true }).count(), 0);
      if (plan === corrected) {
        await current.locator('summary').click();
        assert.match(await current.locator('details').textContent(), /1.088 → 1.087/);
        assert.match(await current.textContent(), /确认时参考价：1.0908/);
      }
      await checkLayout(page);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), raw);
    }
    const raw = await load(first);
    assert.match(await page.locator('.atr-next-info').textContent(), /下一档目标价格：1.0708 · 距离下一档：-1.58%/);
    assert.match(await page.locator('.atr-metrics').textContent(), /剩余仓位20%/);
    assert.equal(await page.locator('[data-execution-level="1"] .atr-execution-head strong').textContent(), '待补仓');
    assert.equal(await page.locator('[data-execution-level="2"] .atr-execution-head strong').textContent(), '等待前档');
    assert.equal(await page.locator('[data-execution-level="1"] .atr-price-label').textContent(), '当前参考价');
    assert.equal(await page.locator('[data-execution-level="1"]').getByRole('button', { name: '确认补仓', exact: true }).isEnabled(), true);
    assert.equal(await page.locator('[data-execution-level="2"]').getByRole('button', { name: '确认补仓', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), raw);
  });
});
