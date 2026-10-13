/* 十进制定点计算：输入最多 8 位小数，乘积保持 16 位；只在显示时舍入。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATRCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const SCALE = 100000000n;
  const PRODUCT = SCALE * SCALE;
  const MAX_LEVELS = 20;
  const STORAGE_KEY = 'monster-slayer-kit:atr-plans:v1';
  const VERSION = 2;

  function decimal(raw, label, allowZero = false, max = 1000000000) {
    const text = String(raw ?? '').trim();
    if (!/^(?:\d{1,10}(?:\.\d{0,8})?|\.\d{1,8})$/.test(text)) {
      throw new Error(label + '请输入有效数字（最多 8 位小数）');
    }
    const [whole, fraction = ''] = text.split('.');
    const value = BigInt(whole || '0') * SCALE + BigInt(fraction.padEnd(8, '0'));
    if (value < 0n || (!allowZero && value === 0n) || value > BigInt(max) * SCALE) {
      throw new Error(label + (allowZero ? '须在 0 至 ' : '须大于 0 且不超过 ') + max);
    }
    return value;
  }

  function fixedRatio(numerator, denominator, digits) {
    const negative = numerator < 0n;
    const absolute = negative ? -numerator : numerator;
    const unit = 10n ** BigInt(digits);
    const rounded = (absolute * unit * 2n + denominator) / (2n * denominator);
    const text = rounded.toString().padStart(digits + 1, '0');
    return (negative && rounded !== 0n ? '-' : '') +
      (digits ? text.slice(0, -digits) + '.' + text.slice(-digits) : text);
  }

  function exact(value, scale = SCALE, digits = 8) {
    return fixedRatio(value, scale, digits).replace(/\.?0+$/, '') || '0';
  }

  function calculate(input) {
    const price = decimal(input.price, '首次开仓价格');
    const atr = decimal(input.atr, 'ATR');
    const opening = decimal(input.openingPosition, '首次开仓仓位', true, 100);
    const periodText = String(input.period ?? '').trim();
    if (periodText && (!/^\d{1,4}$/.test(periodText) || Number(periodText) < 1 || Number(periodText) > 1000)) {
      throw new Error('ATR 周期须为 1 至 1000 的整数，或留空');
    }
    if (!Array.isArray(input.levels) || input.levels.length < 1 || input.levels.length > MAX_LEVELS) {
      throw new Error('请保留 1 至 ' + MAX_LEVELS + ' 个补仓档位');
    }
    let cumulative = 0n;
    let total = opening;
    const levels = input.levels.map((level, index) => {
      const multiple = decimal(level.multiplier, '第 ' + (index + 1) + ' 档 ATR 倍数', false, 1000000);
      const position = decimal(level.position, '第 ' + (index + 1) + ' 档仓位', true, 100);
      cumulative += multiple;
      total += position;
      const result = price * SCALE - atr * cumulative;
      if (result <= 0n) throw new Error('第 ' + (index + 1) + ' 档补仓价不大于 0，请减小 ATR 或倍数');
      return {
        multiplier: exact(multiple), position: exact(position),
        price: exact(result, PRODUCT, 16),
        priceDisplay: fixedRatio(result, PRODUCT, 4),
        dropPercent: fixedRatio((result - price * SCALE) * 100n, price * SCALE, 2),
      };
    });
    return {
      price: exact(price), atr: exact(atr), period: periodText ? Number(periodText) : null,
      openingPosition: exact(opening), priceDisplay: fixedRatio(price, SCALE, 4),
      atrDisplay: fixedRatio(atr, SCALE, 4), atrPercent: fixedRatio(atr * 100n, price, 2),
      totalPosition: exact(total), overThreshold: total > 40n * SCALE, levels,
    };
  }

  function snapshot(input) {
    const name = String(input.name ?? '').trim();
    const code = String(input.code ?? '').trim();
    if (!name || name.length > 80) throw new Error('请填写股票/ETF名称（最多 80 字）');
    if (code.length > 40) throw new Error('股票/ETF代码最多 40 字');
    return { name, code, ...calculate(input) };
  }

  function defaultDraft() {
    return { name: '', code: '', price: '', atr: '', period: '14', openingPosition: '10',
      levels: ['0.3', '0.5', '0.7'].map((multiplier) => ({ multiplier, position: '10' })) };
  }

  function createPlan(input, id, createdAt = new Date().toISOString()) {
    return refreshDynamic({
      id, createdAt, status: 'active', snapshot: snapshot(input),
      completed: input.levels.map(() => false), executionVersion: 2,
      executions: input.levels.map(() => null),
    });
  }

  function copyPlan(plan, id, createdAt = new Date().toISOString()) {
    return refreshDynamic({ id, createdAt, status: 'active',
      snapshot: JSON.parse(JSON.stringify(plan.snapshot)),
      completed: plan.completed.map(() => false), executionVersion: 2,
      executions: plan.completed.map(() => null) });
  }

  function summary(plan) {
    let executed = decimal(plan.snapshot.openingPosition, '首次开仓仓位', true, 100);
    plan.completed.forEach((done, index) => {
      if (done) executed += decimal(plan.snapshot.levels[index].position, '仓位', true, 100);
    });
    const total = plan.snapshot.levels.reduce((sum, level) =>
      sum + decimal(level.position, '仓位', true, 100),
    decimal(plan.snapshot.openingPosition, '仓位', true, 100));
    return {
      count: plan.completed.filter(Boolean).length, total: exact(total),
      executed: exact(executed), remaining: exact(total - executed),
    };
  }

  function validSnapshot(plan) {
    try {
      if (!plan || typeof plan.id !== 'string' || !plan.id || plan.id.length > 150 ||
        typeof plan.createdAt !== 'string' || !Number.isFinite(Date.parse(plan.createdAt)) ||
        !['active', 'ended'].includes(plan.status)) return false;
      const data = plan.snapshot;
      if (!data || typeof data.name !== 'string' || typeof data.code !== 'string' ||
        !Array.isArray(plan.completed) || plan.completed.length !== data.levels?.length ||
        !plan.completed.every((value) => typeof value === 'boolean')) return false;
      const checked = snapshot(data);
      return Object.keys(checked).every((key) =>
        JSON.stringify(checked[key]) === JSON.stringify(data[key]));
    } catch { return false; }
  }


  function productValue(text) {
    if (typeof text !== 'string' || !/^(?:\d{1,10}(?:\.\d{1,16})?)$/.test(text)) {
      throw new Error('参考价格格式无效');
    }
    const [whole, fraction = ''] = text.split('.');
    const value = BigInt(whole) * PRODUCT + BigInt(fraction.padEnd(16, '0'));
    if (value <= 0n) throw new Error('参考价格须大于 0');
    return value;
  }

  function priceResult(value, opening) {
    if (value === null || value <= 0n) return { price: null, priceDisplay: null, dropPercent: null };
    return { price: exact(value, PRODUCT, 16), priceDisplay: fixedRatio(value, PRODUCT, 4),
      dropPercent: fixedRatio((value - opening) * 100n, opening, 2) };
  }

  // 按档位向下接续：已确认记录不变；未知的旧成交价阻断后续推算。
  function dynamicPrices(plan) {
    const opening = decimal(plan.snapshot.price, '首次开仓价格') * SCALE;
    const atr = decimal(plan.snapshot.atr, 'ATR');
    let rolling = opening;
    let baseIndex = null;
    let basePrice = plan.snapshot.price;
    let missing = false;
    let invalid = false;
    let next = null;
    const levels = plan.snapshot.levels.map((level, index) => {
      const trade = plan.executions[index];
      if (plan.completed[index]) {
        if (trade.actualPrice === null) {
          rolling = null;
          basePrice = null;
          baseIndex = index;
          missing = true;
        } else {
          rolling = decimal(trade.actualPrice, '实际成交价') * SCALE;
          basePrice = trade.actualPrice;
          baseIndex = index;
        }
        // 该档确认时的参考价锁定，创建时的参考价仍在 snapshot 内。
        return { ...priceResult(trade.referencePrice === null ? null : productValue(trade.referencePrice), opening),
          actual: trade.actualPrice === null ? null
            : priceResult(decimal(trade.actualPrice, '实际成交价') * SCALE, opening) };
      }
      rolling = rolling === null ? null : rolling - atr * decimal(level.multiplier, 'ATR倍数');
      if (rolling !== null && rolling <= 0n) invalid = true;
      const result = priceResult(rolling, opening);
      if (!next) {
        next = { index, baseIndex, basePrice, targetPrice: result.price,
          targetDisplay: result.priceDisplay,
          distancePercent: result.price === null || basePrice === null ? null
            : fixedRatio((rolling - decimal(basePrice, '计算基准') * SCALE) * 100n,
              decimal(basePrice, '计算基准') * SCALE, 2) };
      }
      return result;
    });
    const gap = next !== null && plan.completed.slice(next.index + 1).some(Boolean);
    // 旧版允许跳档勾选；保留记录，但不能给出含混的“最近一笔”距离。
    if ((missing || gap) && next) next.distancePercent = null;
    return { levels, base: { price: basePrice, levelIndex: baseIndex }, next,
      missingActual: missing, legacyGap: gap, invalidTargets: invalid };
  }

  function refreshDynamic(plan) {
    return { ...plan, dynamic: dynamicPrices(plan) };
  }

  function normalizePlan(plan) {
    if (plan.executionVersion === 2) return plan;
    return refreshDynamic({ ...plan, executionVersion: 2,
      executions: plan.completed.map((done, index) => done ? {
        actualPrice: null, confirmedAt: null, referencePrice: plan.snapshot.levels[index].price,
        legacy: true, corrections: [],
      } : null) });
  }

  function validTime(time) {
    return typeof time === 'string' && Number.isFinite(Date.parse(time));
  }

  function validPlan(plan) {
    if (!validSnapshot(plan)) return false;
    // 只有完全没有新增字段的记录，才按旧版处理；残缺的新字段不可静默丢弃。
    if (plan.executionVersion === undefined && plan.executions === undefined && plan.dynamic === undefined) return true;
    try {
      if (plan.executionVersion !== 2 || !Array.isArray(plan.executions) ||
        plan.executions.length !== plan.completed.length) return false;
      for (let index = 0; index < plan.executions.length; index += 1) {
        const record = plan.executions[index];
        if (!plan.completed[index]) {
          if (record !== null) return false;
          continue;
        }
        if (!record || typeof record.legacy !== 'boolean' || !Array.isArray(record.corrections)) return false;
        if (record.referencePrice !== null) productValue(record.referencePrice);
        if (record.actualPrice === null) {
          if (!record.legacy || record.confirmedAt !== null || record.corrections.length) return false;
        } else {
          if (typeof record.actualPrice !== 'string' ||
            exact(decimal(record.actualPrice, '实际成交价')) !== record.actualPrice ||
            !validTime(record.confirmedAt)) return false;
        }
        let previousAfter = null;
        for (const correction of record.corrections) {
          if (!correction || !validTime(correction.at) ||
            typeof correction.before !== 'string' || typeof correction.after !== 'string' ||
            exact(decimal(correction.before, '纠正前价格')) !== correction.before ||
            exact(decimal(correction.after, '纠正后价格')) !== correction.after ||
            (previousAfter !== null && correction.before !== previousAfter)) return false;
          previousAfter = correction.after;
        }
        if (previousAfter !== null && record.actualPrice !== previousAfter) return false;
      }
      return JSON.stringify(dynamicPrices(plan)) === JSON.stringify(plan.dynamic);
    } catch { return false; }
  }

  // 返回新计划对象，先完整构造，再由 store 原子保存，原记录不原地修改。
  function recordTrade(plan, index, rawPrice, mode = 'confirm', at = new Date().toISOString()) {
    if (!validPlan(plan)) throw new Error('计划数据无效，未修改。');
    if (plan.status !== 'active') throw new Error('已结束计划仅供查看；可复制为新计划。');
    if (!Number.isInteger(index) || index < 0 || index >= plan.completed.length || !validTime(at)) {
      throw new Error('补仓记录无效。');
    }
    const current = normalizePlan(plan);
    const actualPrice = exact(decimal(rawPrice, '实际成交价'));
    const old = current.executions[index];
    let record;
    if (mode === 'confirm') {
      if (current.completed[index]) throw new Error('该档已确认，不能重复确认。');
      if (current.completed.slice(0, index).some((done) => !done)) {
        throw new Error('请先确认上一档补仓记录。');
      }
      if (current.executions.some((entry) => entry && entry.actualPrice === null)) {
        throw new Error('请先补录旧记录的实际成交价格。');
      }
      record = { actualPrice, confirmedAt: at, referencePrice: current.dynamic.levels[index].price,
        legacy: false, corrections: [] };
    } else if (mode === 'backfill') {
      if (!current.completed[index] || !old?.legacy || old.actualPrice !== null) {
        throw new Error('该档没有需要补录的旧记录。');
      }
      record = { ...old, actualPrice, confirmedAt: at };
    } else if (mode === 'correct') {
      if (!current.completed[index] || !old?.actualPrice) throw new Error('请先记录实际成交价。');
      if (old.actualPrice === actualPrice) throw new Error('成交价格没有变化，无需纠正。');
      record = { ...old, actualPrice,
        corrections: [...old.corrections, { before: old.actualPrice, after: actualPrice, at }] };
    } else throw new Error('不支持的操作。');
    const completed = [...current.completed];
    completed[index] = true;
    const executions = [...current.executions];
    executions[index] = record;
    return refreshDynamic({ ...current, completed, executions });
  }

  function formatPrice(raw) {
    return fixedRatio(decimal(raw, '价格'), SCALE, 4);
  }

  // 读取失败或有不兼容记录时，只读展示可识别计划；不写入、不清空原数据。
  function createStore(storage) {
    let raw = null;
    let state = { plans: [], readOnly: false, error: '' };
    function read() {
      try {
        raw = storage.getItem(STORAGE_KEY);
        if (raw === null) state = { plans: [], readOnly: false, error: '' };
        else {
          const data = JSON.parse(raw);
          if (!data || ![1, VERSION].includes(data.version) || !Array.isArray(data.plans)) {
            throw new Error('不兼容数据');
          }
          const ids = new Set();
          const valid = data.plans.filter((plan) => {
            if (!validPlan(plan) || ids.has(plan.id)) return false;
            ids.add(plan.id);
            return true;
          });
          const readOnly = valid.length !== data.plans.length;
          state = { plans: valid.map(normalizePlan), readOnly,
            error: readOnly ? '部分计划数据无法读取，已保护原数据；目前仅可查看。' : '' };
        }
      } catch {
        state = { plans: [], readOnly: true,
          error: '本地计划读取失败或数据版本不兼容，已保护原数据；目前无法保存。' };
      }
      return state;
    }
    function save(plans) {
      if (state.readOnly) throw new Error(state.error);
      // 防止多个标签页先后写入旧快照、覆盖另一页的新计划或勾选记录。
      let current;
      try { current = storage.getItem(STORAGE_KEY); }
      catch { throw new Error('无法读取本地计划，本次操作未保存；请检查浏览器存储设置。'); }
      if (current !== raw) {
        read();
        throw new Error('计划已在其他页面更新，请查看最新记录后重试。');
      }
      if (!plans.every(validPlan) || new Set(plans.map((plan) => plan.id)).size !== plans.length) {
        throw new Error('计划数据无效，未保存。');
      }
      const normalized = plans.map(normalizePlan);
      const next = JSON.stringify({ version: VERSION, plans: normalized });
      try { storage.setItem(STORAGE_KEY, next); }
      catch { throw new Error('本地保存失败，可能空间不足或存储被禁用；本次操作未保存。'); }
      raw = next;
      state = { plans: normalized, readOnly: false, error: '' };
      return state;
    }
    return { read, save };
  }

  return { MAX_LEVELS, STORAGE_KEY, VERSION, calculate, snapshot, createPlan,
    copyPlan, summary, validPlan, createStore, defaultDraft, normalizePlan, recordTrade, formatPrice };
});
