'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../tools/atr-calculator/atr-core.js');

const input = (changes = {}) => ({
  name: '科创50ETF', code: '00588000', price: '0.583', atr: '0.026', period: '14',
  openingPosition: '10',
  levels: ['0.3', '0.5', '0.7'].map((multiplier) => ({ multiplier, position: '10' })),
  ...changes,
});
function legacy(plan) {
  const { executionVersion, executions, dynamic, ...old } = plan;
  return old;
}
function memory() {
  const data = new Map([['other-tool', 'untouched']]);
  return { data, getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value) };
}
test('指定例子：累计三档、跌幅、ATR比例和默认仓位', () => {
  const result = core.calculate(input());
  assert.deepEqual(result.levels.map((level) => level.priceDisplay), ['0.5752', '0.5622', '0.5440']);
  assert.deepEqual(result.levels.map((level) => level.dropPercent), ['-1.34', '-3.57', '-6.69']);
  assert.equal(result.atrPercent, '4.46');
  assert.equal(result.totalPosition, '40');
  assert.equal(result.overThreshold, false);
});
test('自定义倍数、第四档及中间档删除后重新累计', () => {
  const data = input({ levels: ['0.2', '0.35', '0.8', '1.2'].map((multiplier) => ({ multiplier, position: '10' })) });
  assert.deepEqual(core.calculate(data).levels.map((level) => level.priceDisplay),
    ['0.5778', '0.5687', '0.5479', '0.5167']);
  assert.equal(core.calculate(data).overThreshold, true);
  data.levels.splice(1, 1);
  assert.deepEqual(core.calculate(data).levels.map((level) => level.priceDisplay), ['0.5778', '0.5570', '0.5258']);
});
test('变更开仓价和ATR会重新计算，周期只作记录', () => {
  assert.equal(core.calculate(input({ price: '1.025' })).levels[2].priceDisplay, '0.9860');
  assert.equal(core.calculate(input({ atr: '0.02' })).levels[2].priceDisplay, '0.5530');
  assert.deepEqual(core.calculate(input({ period: '20' })).levels, core.calculate(input()).levels);
  assert.equal(core.calculate(input({ period: '' })).period, null);
});
test('精确计算保留16位乘积，不逐档舍入；最终显示正确四舍五入', () => {
  const data = input({ price: '1', atr: '0.00005',
    levels: ['0.3', '0.3', '0.3'].map((multiplier) => ({ multiplier, position: '0' })) });
  const result = core.calculate(data);
  assert.equal(result.levels[2].price, '0.999955');
  assert.equal(result.levels[2].priceDisplay, '1.0000');
  assert.equal(core.calculate(input({ price: '1.23455', atr: '0.00000001' })).priceDisplay, '1.2346');
  assert.equal(core.calculate(input({ price: '.583', atr: '.026' })).levels[2].priceDisplay, '0.5440');
});
test('拒绝零、负数、指数、非数字、超长小数和非正结果', () => {
  for (const field of ['price', 'atr']) {
    for (const bad of ['0', '-1', 'abc', 'Infinity', '1e2', '', '0.123456789', '99999999999', '0x10']) {
      assert.throws(() => core.calculate(input({ [field]: bad })));
    }
  }
  for (const bad of ['-0.3', '0', 'abc', '']) {
    assert.throws(() => core.calculate(input({ levels: [{ multiplier: bad, position: '10' }] })));
  }
  assert.throws(() => core.calculate(input({ price: '.026', atr: '.026',
    levels: [{ multiplier: '1', position: '10' }] })));
  assert.throws(() => core.calculate(input({ atr: '1' })));
  assert.throws(() => core.snapshot(input({ name: '  ' })));
  for (const bad of ['0', '14.5', '-1', '1001', 'abc']) assert.throws(() => core.calculate(input({ period: bad })));
});
test('档位和仓位边界；40%仅提醒，允许超过', () => {
  assert.throws(() => core.calculate(input({ levels: [] })));
  assert.throws(() => core.calculate(input({ levels: Array(21).fill({ multiplier: '.01', position: '1' }) })));
  assert.equal(core.calculate(input({ levels: Array(20).fill({ multiplier: '.01', position: '1' }) })).levels.length, 20);
  assert.throws(() => core.calculate(input({ openingPosition: '101' })));
  assert.throws(() => core.calculate(input({ levels: [{ multiplier: '.3', position: '-1' }] })));
  assert.equal(core.calculate(input({ openingPosition: '50' })).totalPosition, '80');
});
test('正式快照不跟随输入变化；代码保留前导零', () => {
  const data = input();
  const plan = core.createPlan(data, 'one');
  data.price = '2';
  data.levels[0].multiplier = '2';
  assert.equal(plan.snapshot.code, '00588000');
  assert.equal(plan.snapshot.price, '0.583');
  assert.equal(plan.snapshot.levels[0].priceDisplay, '0.5752');
  assert.equal(core.validPlan(plan), true);
});
test('旧版多ETF、同代码多轮、勾选/撤销及刷新读取互相独立', () => {
  const storage = memory();
  const store = core.createStore(storage);
  store.read();
  const a = legacy(core.createPlan(input(), 'one'));
  const b = core.createPlan(input({ name: '通信ETF', code: '515880', price: '2' }), 'two');
  const c = core.createPlan(input(), 'three');
  store.save([a, b, c]);
  a.completed[0] = true;
  store.save([a, b, c]);
  let restored = core.createStore(storage).read();
  assert.equal(restored.plans.length, 3);
  assert.deepEqual(restored.plans.map((plan) => plan.completed[0]), [true, false, false]);
  assert.deepEqual(core.summary(restored.plans[0]), { count: 1, total: '40', executed: '20', remaining: '20' });
  a.completed[0] = false;
  store.save([a, b, c]);
  restored = core.createStore(storage).read();
  assert.equal(restored.plans[0].completed[0], false);
  assert.equal(storage.data.get('other-tool'), 'untouched');
  assert.equal(JSON.parse(storage.getItem(core.STORAGE_KEY)).version, 2);
});
test('结束保留记录；删除仅指定ID；复制新ID且执行重置', () => {
  const storage = memory();
  const store = core.createStore(storage);
  store.read();
  const a = legacy(core.createPlan(input(), 'one'));
  a.completed[1] = true;
  a.status = 'ended';
  const b = core.copyPlan(a, 'two');
  assert.notEqual(a.id, b.id);
  assert.equal(b.status, 'active');
  assert.deepEqual(b.completed, [false, false, false]);
  assert.deepEqual(b.snapshot, a.snapshot);
  assert.notEqual(b.snapshot, a.snapshot);
  store.save([a, b]);
  assert.equal(core.createStore(storage).read().plans[0].status, 'ended');
  store.save([b]);
  assert.deepEqual(core.createStore(storage).read().plans.map((plan) => plan.id), ['two']);
});
test('损坏JSON、不兼容版本、重复ID、快照篡改均禁止覆盖', () => {
  const a = legacy(core.createPlan(input(), 'one'));
  const tampered = JSON.parse(JSON.stringify(a));
  tampered.snapshot.levels[0].price = '999';
  for (const raw of ['{broken', 'null', JSON.stringify({ version: 3, plans: [] }),
    JSON.stringify({ version: 1, plans: [a, a] }),
    JSON.stringify({ version: 1, plans: [a, tampered] })]) {
    const storage = memory();
    storage.setItem(core.STORAGE_KEY, raw);
    const store = core.createStore(storage);
    assert.equal(store.read().readOnly, true);
    assert.throws(() => store.save([]));
    assert.equal(storage.getItem(core.STORAGE_KEY), raw);
  }
});
test('存储禁用、空间不足和其他页面更新不误报成功，不覆盖数据', () => {
  const blocked = core.createStore({ getItem() { throw new Error('blocked'); } });
  assert.equal(blocked.read().readOnly, true);
  assert.throws(() => blocked.save([]));
  const storage = memory();
  const store = core.createStore(storage);
  store.read();
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.save([core.createPlan(input(), 'one')]), /保存失败/);
  assert.equal(storage.getItem(core.STORAGE_KEY), null);
  const shared = memory();
  const first = core.createStore(shared), second = core.createStore(shared);
  first.read(); second.read();
  first.save([core.createPlan(input(), 'one')]);
  const original = shared.getItem(core.STORAGE_KEY);
  assert.throws(() => second.save([core.createPlan(input(), 'two')]), /其他页面/);
  assert.equal(shared.getItem(core.STORAGE_KEY), original);
});

test('读取后突然禁用存储时，保持原计划并给出明确提示', () => {
  const storage = memory();
  const store = core.createStore(storage);
  store.read();
  const plan = core.createPlan(input(), 'one');
  store.save([plan]);
  const original = storage.data.get(core.STORAGE_KEY);
  storage.getItem = () => { throw new Error('blocked'); };
  assert.throws(() => store.save([]), /无法读取本地计划/);
  assert.equal(storage.data.get(core.STORAGE_KEY), original);
});

const executionInput = () => input({
  price: '1.1080', atr: '0.0430',
  levels: Array.from({ length: 3 }, () => ({ multiplier: '0.4', position: '10' })),
});
const tradeTime = '2026-10-13T04:00:00.000Z';
test('默认草稿恢复现有参数，且每次创建独立数组', () => {
  const defaults = core.defaultDraft();
  assert.deepEqual(defaults, {
    name: '', code: '', price: '', atr: '', period: '14', openingPosition: '10',
    levels: ['0.3', '0.5', '0.7'].map((multiplier) => ({ multiplier, position: '10' })),
  });
  defaults.levels[0].multiplier = '9';
  assert.equal(core.defaultDraft().levels[0].multiplier, '0.3');
});
test('指定成交接续例子：原计划、第一笔/第二笔成交及下一档跌幅', () => {
  const original = core.createPlan(executionInput(), 'trade');
  const snapshot = JSON.stringify(original.snapshot);
  assert.deepEqual(original.dynamic.levels.map((level) => level.priceDisplay), ['1.0908', '1.0736', '1.0564']);
  assert.equal(original.dynamic.next.distancePercent, '-1.55');
  const first = core.recordTrade(original, 0, '1.0880', 'confirm', tradeTime);
  assert.deepEqual(first.dynamic.levels.map((level) => level.priceDisplay), ['1.0908', '1.0708', '1.0536']);
  assert.deepEqual(first.dynamic.levels.slice(1).map((level) => level.dropPercent), ['-3.36', '-4.91']);
  assert.equal(first.dynamic.next.distancePercent, '-1.58');
  assert.equal(first.dynamic.base.price, '1.088');
  assert.equal(first.executions[0].actualPrice, '1.088');
  assert.equal(first.executions[0].confirmedAt, tradeTime);
  assert.equal(first.dynamic.levels[0].actual.dropPercent, '-1.81');
  const second = core.recordTrade(first, 1, '1.0710', 'confirm', tradeTime);
  assert.equal(second.dynamic.levels[2].priceDisplay, '1.0538');
  assert.equal(second.dynamic.levels[2].dropPercent, '-4.89');
  assert.equal(second.executions[1].referencePrice, '1.0708');
  assert.equal(second.snapshot.levels[1].priceDisplay, '1.0736');
  assert.deepEqual(second.executions[0], first.executions[0]);
  assert.equal(JSON.stringify(second.snapshot), snapshot);
  assert.deepEqual(original.completed, [false, false, false]);
  assert.equal(core.validPlan(second), true);
  const finished = core.recordTrade(second, 2, '1.054', 'confirm', tradeTime);
  assert.equal(finished.dynamic.next, null);
  assert.deepEqual(core.summary(finished), { count: 3, total: '40', executed: '40', remaining: '0' });
});
test('顺序约束、重复确认、非法成交价及已结束计划保护', () => {
  const plan = core.createPlan(executionInput(), 'trade');
  assert.throws(() => core.recordTrade(plan, 1, '1.07'), /请先确认上一档补仓记录/);
  for (const bad of ['', '0', '-1', 'abc', 'Infinity', '1e2', '1000000001', '.123456789']) {
    assert.throws(() => core.recordTrade(plan, 0, bad));
  }
  const done = core.recordTrade(plan, 0, '1.088');
  assert.throws(() => core.recordTrade(done, 0, '1.088'), /不能重复确认/);
  assert.throws(() => core.recordTrade({ ...done, status: 'ended' }, 1, '1.07'), /已结束/);
  assert.throws(() => core.recordTrade(plan, 0, '1.1', 'correct'), /请先记录/);
  assert.throws(() => core.recordTrade(done, 0, '1.088', 'correct'), /没有变化/);
});
test('纠正只改指定实际记录，保护后来已成交价格和确认时计划价', () => {
  let first = core.recordTrade(core.createPlan(executionInput(), 'trade'), 0, '1.088', 'confirm', tradeTime);
  const corrected = core.recordTrade(first, 0, '1.08', 'correct', '2026-10-13T05:00:00.000Z');
  assert.equal(corrected.dynamic.levels[1].priceDisplay, '1.0628');
  assert.equal(corrected.dynamic.levels[2].priceDisplay, '1.0456');
  assert.equal(corrected.executions[0].referencePrice, '1.0908');
  assert.equal(corrected.executions[0].confirmedAt, tradeTime);
  const second = core.recordTrade(first, 1, '1.071', 'confirm', tradeTime);
  const preserved = JSON.stringify(second.executions[1]);
  const earlierCorrection = core.recordTrade(second, 0, '1.08', 'correct', '2026-10-13T05:00:00.000Z');
  assert.equal(JSON.stringify(earlierCorrection.executions[1]), preserved);
  assert.equal(earlierCorrection.dynamic.levels[1].priceDisplay, '1.0708');
  assert.equal(earlierCorrection.dynamic.levels[2].priceDisplay, '1.0538');
  assert.equal(earlierCorrection.dynamic.base.price, '1.071');
  const laterCorrection = core.recordTrade(earlierCorrection, 1, '1.065', 'correct', '2026-10-13T06:00:00.000Z');
  assert.equal(laterCorrection.dynamic.levels[2].priceDisplay, '1.0478');
  assert.deepEqual(earlierCorrection.executions[0].corrections, [
    { before: '1.088', after: '1.08', at: '2026-10-13T05:00:00.000Z' },
  ]);
  assert.deepEqual(core.summary(earlierCorrection), core.summary(second));
  const repeated = core.recordTrade(corrected, 0, '1.079', 'correct', '2026-10-13T07:00:00.000Z');
  assert.equal(repeated.executions[0].corrections.length, 2);
  assert.equal(core.validPlan(repeated), true);
});
test('定点接续保留精度，偏离计划但合法的实际成交价可保存', () => {
  const plan = core.createPlan(input({ price: '1', atr: '.00000003',
    levels: Array.from({ length: 3 }, () => ({ multiplier: '.33333333', position: '10' })) }), 'precision');
  const traded = core.recordTrade(plan, 0, '1.12345678');
  assert.equal(traded.dynamic.levels[1].price, '1.1234567700000001');
  assert.equal(traded.dynamic.levels[2].price, '1.1234567600000002');
  assert.equal(core.validPlan(traded), true);
  assert.equal(core.recordTrade(core.createPlan(executionInput(), 'outlier'), 0, '2').executions[0].actualPrice, '2');
});
test('真实成交导致非正目标时保存真实记录，不展示无效后续目标', () => {
  const plan = core.createPlan(executionInput(), 'low');
  const traded = core.recordTrade(plan, 0, '.01');
  assert.equal(traded.executions[0].actualPrice, '0.01');
  assert.equal(traded.dynamic.invalidTargets, true);
  assert.equal(traded.dynamic.levels[1].price, null);
  assert.equal(traded.dynamic.levels[2].priceDisplay, null);
  assert.equal(traded.dynamic.next.distancePercent, null);
  assert.equal(core.validPlan(traded), true);
  const repaired = core.recordTrade(traded, 0, '1.088', 'correct');
  assert.equal(repaired.dynamic.invalidTargets, false);
  assert.equal(repaired.dynamic.levels[1].priceDisplay, '1.0708');
});
test('旧版读取无写入；勾选状态保留，未补录不伪造价格且不继续确认', () => {
  const old = legacy(core.createPlan(executionInput(), 'old', tradeTime));
  old.completed[0] = true;
  const storage = memory();
  const raw = JSON.stringify({ version: 1, plans: [old] });
  storage.setItem(core.STORAGE_KEY, raw);
  const store = core.createStore(storage);
  const state = store.read();
  assert.equal(state.readOnly, false);
  assert.equal(storage.getItem(core.STORAGE_KEY), raw);
  const loaded = state.plans[0];
  assert.deepEqual(loaded.completed, [true, false, false]);
  assert.equal(loaded.executions[0].actualPrice, null);
  assert.equal(loaded.executions[0].confirmedAt, null);
  assert.equal(loaded.dynamic.levels[1].price, null);
  assert.throws(() => core.recordTrade(loaded, 1, '1.07'), /请先补录/);
  const filled = core.recordTrade(loaded, 0, '1.088', 'backfill', tradeTime);
  assert.equal(filled.dynamic.levels[1].priceDisplay, '1.0708');
  assert.deepEqual(filled.completed, loaded.completed);
  assert.deepEqual(filled.snapshot, old.snapshot);
  assert.equal(filled.id, old.id);
  assert.equal(filled.createdAt, old.createdAt);
  store.save([filled]);
  assert.equal(JSON.parse(storage.getItem(core.STORAGE_KEY)).version, 2);
  assert.deepEqual(core.createStore(storage).read().plans[0], filled);
});
test('旧版跳档记录保留，补录只记录真实价；按顺序补齐前面档位', () => {
  const old = legacy(core.createPlan(executionInput(), 'old'));
  old.completed[1] = true;
  const loaded = core.normalizePlan(old);
  assert.equal(loaded.dynamic.legacyGap, true);
  assert.equal(loaded.executions[1].actualPrice, null);
  assert.throws(() => core.recordTrade(loaded, 0, '1.088'), /请先补录/);
  const filled = core.recordTrade(loaded, 1, '1.071', 'backfill');
  assert.equal(filled.dynamic.next.distancePercent, null);
  assert.equal(filled.dynamic.levels[2].priceDisplay, '1.0538');
  const gapFilled = core.recordTrade(filled, 0, '1.088');
  assert.equal(gapFilled.executions[1].actualPrice, '1.071');
  assert.equal(gapFilled.dynamic.legacyGap, false);
  assert.equal(gapFilled.dynamic.next.index, 2);
});
test('成交与纠正历史持久化，复制重置，不串改其他计划', () => {
  const storage = memory(), store = core.createStore(storage);
  store.read();
  const a = core.createPlan(executionInput(), 'one');
  const b = core.createPlan(input({ name: '通信ETF', price: '2' }), 'two');
  const confirmed = core.recordTrade(a, 0, '1.088', 'confirm', tradeTime);
  const corrected = core.recordTrade(confirmed, 0, '1.08', 'correct', tradeTime);
  store.save([corrected, b]);
  const reloaded = core.createStore(storage).read().plans;
  assert.deepEqual(reloaded, [corrected, b]);
  const copied = core.copyPlan(corrected, 'copy');
  assert.deepEqual(copied.executions, [null, null, null]);
  assert.deepEqual(copied.completed, [false, false, false]);
  assert.deepEqual(copied.dynamic.levels.map((level) => level.priceDisplay), ['1.0908', '1.0736', '1.0564']);
  assert.notEqual(copied.id, corrected.id);
  assert.equal(core.validPlan(copied), true);
});
test('损坏新成交字段、纠正链或动态数据时，其他有效计划可查看且原文不覆盖', () => {
  const good = core.recordTrade(core.createPlan(executionInput(), 'good'), 0, '1.088', 'confirm', tradeTime);
  for (const mutate of [
    (bad) => { bad.executions[0].actualPrice = '0'; },
    (bad) => { bad.executions[0].confirmedAt = null; },
    (bad) => { delete bad.executions; },
    (bad) => { bad.dynamic.levels[1].price = '999'; },
    (bad) => { bad.completed[0] = false; },
    (bad) => { bad.executions[0].corrections.push({ before: '1.088', after: '1.07', at: tradeTime }); },
  ]) {
    const bad = JSON.parse(JSON.stringify(good));
    bad.id = 'bad'; mutate(bad);
    const storage = memory();
    const raw = JSON.stringify({ version: 2, plans: [bad, good] });
    storage.setItem(core.STORAGE_KEY, raw);
    const store = core.createStore(storage);
    const state = store.read();
    assert.equal(state.readOnly, true);
    assert.deepEqual(state.plans.map((plan) => plan.id), ['good']);
    assert.throws(() => store.save([]));
    assert.equal(storage.getItem(core.STORAGE_KEY), raw);
  }
});
