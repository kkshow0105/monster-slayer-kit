(() => {
  'use strict';
  const core = window.ATRCalculator;
  const $ = (id) => document.getElementById(id);
  const form = $('atr-form');
  const fields = {
    name: $('asset-name'), code: $('asset-code'), price: $('opening-price'),
    atr: $('atr-value'), period: $('atr-period'), openingPosition: $('opening-position'),
  };
  let draft = core.defaultDraft().levels;
  // localStorage 的访问本身也可能抛错，由 store 的 read/save 统一处理。
  const store = core.createStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  });
  let state = store.read();
  let selected = state.plans.find((plan) => plan.status === 'active')?.id || state.plans[0]?.id || null;
  let draftOpen = state.plans.length === 0;

  // Only toggle visibility: existing form nodes, draft values and listeners stay intact.
  function setDraftOpen(open, moveFocus = false) {
    draftOpen = open;
    $('new-plan').hidden = !open;
    $('toggle-draft').setAttribute('aria-expanded', String(open));
    $('toggle-draft').textContent = open ? '收起新建' : '＋ 新建计划';
    if (moveFocus) {
      if (open) {
        $('new-plan').scrollIntoView({ block: 'start' });
        fields.name.focus({ preventScroll: true });
      } else {
        $('toggle-draft').focus();
      }
    }
  }
  $('toggle-draft').addEventListener('click', () => setDraftOpen(!draftOpen, true));

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function changeLabel(value) {
    const change = Number(value);
    return (change > 0 ? '累计涨幅 +' : change === 0 ? '累计涨跌幅 ' : '累计跌幅 ') + value + '%';
  }
  function changeNode(value) {
    const node = element('span', 'atr-drop', changeLabel(value));
    node.dataset.tone = Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : 'flat';
    return node;
  }
  function button(text, callback, className = '') {
    const node = element('button', 'atr-button ' + className, text);
    node.type = 'button';
    node.addEventListener('click', callback);
    return node;
  }
  function inputData() {
    return { ...Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])),
      levels: draft.map((level) => ({ ...level })) };
  }
  function notify(text, error = false) {
    $('action-message').textContent = text;
    $('action-message').dataset.tone = error ? 'error' : '';
  }
  function newId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    if (window.crypto?.getRandomValues) {
      return 'atr-' + Array.from(window.crypto.getRandomValues(new Uint32Array(4)),
        (value) => value.toString(16).padStart(8, '0')).join('');
    }
    return 'atr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) +
      '-' + Math.random().toString(36).slice(2);
  }

  function renderDraft() {
    $('draft-levels').replaceChildren();
    draft.forEach((level, index) => {
      const card = element('div', 'atr-level');
      const head = element('div', 'atr-level-head');
      const remove = button('删除', () => {
        if (draft.length <= 1) return;
        draft.splice(index, 1);
        renderDraft();
        updatePreview();
        const nextInput = $('draft-levels').querySelectorAll('input')[Math.min(index, draft.length - 1) * 2];
        nextInput?.focus();
      });
      remove.setAttribute('aria-label', '删除第 ' + (index + 1) + ' 档');
      remove.disabled = draft.length === 1;
      head.append(element('h3', '', '第' + (index + 1) + '档'), remove);
      const inputs = element('div', 'atr-fields');
      [['multiplier', 'ATR倍数'], ['position', '计划仓位 %']].forEach(([key, text]) => {
        const label = element('label', 'atr-field', text);
        const input = element('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.value = level[key];
        input.setAttribute('aria-label', '第 ' + (index + 1) + ' 档' + text);
        input.setAttribute('aria-describedby', 'preview-status');
        input.dataset.draftField = key;
        input.addEventListener('input', () => {
          level[key] = input.value;
        });
        label.append(input);
        inputs.append(label);
      });
      const result = element('div', 'atr-result');
      const price = element('output', 'atr-price', '—');
      price.dataset.previewPrice = index;
      price.setAttribute('aria-label', '第 ' + (index + 1) + ' 档补仓价');
      const drop = element('span', 'atr-drop', '累计跌幅 —');
      drop.dataset.previewDrop = index;
      result.append(element('span', 'atr-hint', '计划价格'), price, drop);
      card.append(head, inputs, result);
      $('draft-levels').append(card);
    });
    $('add-level').disabled = draft.length >= core.MAX_LEVELS;
    $('add-level').textContent = draft.length >= core.MAX_LEVELS ? '已达 20 档上限' : '＋ 增加档位';
  }

  function updatePreview() {
    let result = null;
    let error = '';
    try { result = core.calculate(inputData()); }
    catch (cause) { error = cause.message; }
    document.querySelectorAll('[data-preview-price]').forEach((node, index) => {
      node.textContent = result?.levels[index].priceDisplay ?? '—';
      node.dataset.empty = String(!result);
    });
    document.querySelectorAll('[data-preview-drop]').forEach((node, index) => {
      const change = result?.levels[index].dropPercent;
      node.textContent = result ? changeLabel(change) : '累计跌幅 —';
      node.dataset.tone = change === undefined ? '' : Number(change) > 0 ? 'up' : Number(change) < 0 ? 'down' : 'flat';
    });
    $('preview-summary').textContent = result
      ? (fields.name.value.trim() || '未命名') + ' · 开仓价 ' + result.priceDisplay +
        ' · ATR' + (result.period ?? '') + ' ' + result.atrDisplay + ' · ATR占开仓价 ' + result.atrPercent + '%'
      : '填写真实价格与 ATR，自动计算。';
    $('position-total').replaceChildren(element('span', '', '计划总仓位：'),
      element('strong', '', result ? result.totalPosition + '%' : '—'));
    $('position-warning').hidden = !result?.overThreshold;
    $('position-warning').textContent = result?.overThreshold
      ? '计划总仓位 ' + result.totalPosition + '%，超过默认 40% 提醒线；请确认仓位安排。' : '';
    const pristine = !fields.price.value.trim() && !fields.atr.value.trim();
    $('preview-status').textContent = result
      ? (fields.name.value.trim() ? '生成后锁定参数并保存到本机。' : '填写股票/ETF名称后即可生成计划。')
      : (pristine ? '先填写首次开仓价格和 ATR。' : error);
    $('preview-status').dataset.tone = !result && !pristine ? 'error' : '';
    let valid = false;
    try { core.snapshot(inputData()); valid = true; } catch { /* 提交时仍完整校验。 */ }
    $('generate-plan').disabled = !valid || state.readOnly;
  }

  function persist(plans, selection, message) {
    try {
      state = store.save(plans);
      selected = selection;
      renderPlans();
      updatePreview();
      notify(message);
      return true;
    } catch (error) {
      state = store.read();
      renderPlans();
      updatePreview();
      notify(error.message, true);
      return false;
    }
  }


  function renderNextInfo(card, plan) {
    const dynamic = plan.dynamic;
    const box = element('div', 'atr-next-info');
    // Ended plans only describe saved history; active-plan wording stays unchanged.
    if (plan.status === 'ended') {
      if (dynamic.missingActual) {
        box.append(element('p', 'atr-meta', '历史成交记录的实际价格未记录，历史参考价暂不可计算。'));
      } else if (dynamic.legacyGap) {
        box.append(element('p', 'atr-meta', '历史计划存在跳档记录，保留原有执行状态；历史参考距离暂不显示。'));
      } else if (!dynamic.next) {
        box.append(element('p', 'atr-meta', '全部档位已执行，记录仅供历史查阅。'));
      } else if (dynamic.next.targetPrice === null) {
        box.append(element('p', 'atr-meta', '未执行档位的历史参考价不大于 0，保留原始记录。'));
      } else {
        const next = dynamic.next;
        box.append(element('p', 'atr-hint', '历史计算基准：' + core.formatPrice(next.basePrice)));
        box.append(element('p', 'atr-meta', '首个未执行档位历史参考价：' + next.targetDisplay +
          ' · 历史参考距离：' + next.distancePercent + '%'));
        box.append(element('p', 'atr-hint', '基于已保存参数和成交记录计算，仅供历史查看。'));
      }
      if (dynamic.invalidTargets && dynamic.next?.targetPrice !== null) {
        box.append(element('p', 'atr-meta', '部分未执行档位的历史参考价不大于 0，保留原始记录。'));
      }
      card.append(box);
      return;
    }
    if (dynamic.missingActual) {
      box.append(element('p', 'atr-meta', plan.status === 'active'
        ? '旧补仓记录的实际价格未记录，请先补录；暂不计算下一档距离。'
        : '旧补仓记录的实际价格未记录，保留历史执行状态；暂不计算下一档距离。'));
    } else if (dynamic.legacyGap) {
      box.append(element('p', 'atr-meta', '旧计划存在跳档记录；补齐前面未执行档位前，暂不显示下一档距离。'));
    } else if (!dynamic.next) {
      box.append(element('p', 'atr-meta', '补仓计划已全部执行'));
    } else if (dynamic.next.targetPrice === null) {
      box.append(element('p', 'atr-meta', '下一档参考价不大于 0，请重新评估或结束计划。'));
    } else {
      const next = dynamic.next;
      box.append(element('p', 'atr-hint',
        (next.baseIndex === null ? '首次开仓基准：' : '上一次实际成交价格：') + core.formatPrice(next.basePrice)));
      box.append(element('p', 'atr-meta', '下一档目标价格：' + next.targetDisplay +
        ' · 距离下一档：' + next.distancePercent + '%'));
      box.append(element('p', 'atr-hint', '从上一笔成交价到下一档的计划跌幅，非实时行情。'));
    }
    if (dynamic.invalidTargets && dynamic.next?.targetPrice !== null) {
      box.append(element('p', 'atr-meta', '部分后续参考价不大于 0，已停止显示无效目标；请重新评估计划。'));
    }
    card.append(box);
  }

  function openTradeEditor(plan, index, mode, body) {
    body.querySelectorAll('.atr-record-message').forEach((node) => node.remove());
    function localMessage(message) {
      const node = element('p', 'atr-record-message status-message', message);
      node.setAttribute('role', 'alert');
      node.dataset.tone = 'error';
      body.append(node);
    }
    if (mode === 'confirm') {
      if (plan.completed.slice(0, index).some((done) => !done)) {
        localMessage('请先确认上一档补仓记录。');
        return;
      }
      if (plan.dynamic.missingActual) {
        localMessage('请先补录旧记录的实际成交价格。');
        return;
      }
    }
    const trade = plan.executions[index];
    if (mode === 'correct' && !window.confirm('当前锁定成交价：' + trade.actualPrice +
      '。纠正可能影响后续尚未执行档位；其他已确认成交价保持锁定。是否进入纠正模式？')) return;
    $('current-plan').querySelectorAll('.atr-trade-editor').forEach((node) => {
      node.closest('.atr-execution-body').querySelector('.atr-execution-action button').hidden = false;
      node.remove();
    });
    const trigger = body.querySelector('.atr-execution-action button');
    trigger.hidden = true;
    const editor = element('form', 'atr-trade-editor');
    editor.noValidate = true;
    const label = element('label', 'atr-field', mode === 'correct' ? '纠正实际成交价格' : '实际成交价格');
    const input = element('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.required = true;
    input.value = mode === 'correct' ? trade.actualPrice :
      mode === 'confirm' && Number(plan.dynamic.levels[index].priceDisplay) > 0
        ? plan.dynamic.levels[index].priceDisplay : '';
    label.append(input);
    const warning = element('p', 'atr-hint', mode === 'backfill'
      ? '旧记录已执行，请补录真实价格；原执行状态保持不变。'
      : '计划仓位 ' + plan.snapshot.levels[index].position + '%，保存后锁定成交记录。');
    const error = element('p', 'status-message');
    error.setAttribute('role', 'alert');
    error.dataset.tone = 'error';
    const hint = element('p', 'atr-hint');
    hint.setAttribute('role', 'status');
    input.addEventListener('input', () => {
      const actual = Number(input.value);
      const reference = Number(plan.dynamic.levels[index].price);
      hint.textContent = Number.isFinite(actual) && actual > 0 && reference > 0 &&
        Math.abs(actual / reference - 1) > 0.1 ? '成交价偏离计划价超过 10%，请核对；仍可确认合法价格。' : '';
      error.textContent = '';
    });
    const actions = element('div', 'atr-actions');
    const cancel = button('取消', () => {
      editor.remove();
      trigger.hidden = false;
      trigger.focus();
    });
    const save = element('button', 'atr-button atr-primary',
      mode === 'correct' ? '保存纠正并锁定' : mode === 'backfill' ? '保存补录并锁定' : '确认并锁定');
    save.type = 'submit';
    actions.append(cancel, save);
    editor.append(label, warning, hint, error, actions);
    let saving = false;
    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      if (saving) return;
      let updated;
      try { updated = core.recordTrade(plan, index, input.value, mode); }
      catch (cause) { error.textContent = cause.message; input.focus(); return; }
      saving = true;
      save.disabled = true;
      const message = mode === 'correct' ? '成交价已纠正，纠正历史已保存。' :
        mode === 'backfill' ? '真实成交价已补录并锁定。' : '补仓成交记录已确认并锁定。';
      if (persist(state.plans.map((item) => item.id === plan.id ? updated : item), plan.id,
        updated.dynamic.invalidTargets ? message + ' 后续存在无效目标，请重新评估计划。' : message)) {
        $('current-plan').querySelector('[data-execution-level="' + index + '"] button')?.focus();
      } else {
        $('action-message').scrollIntoView({ block: 'center' });
      }
    });
    body.append(editor);
    input.focus();
    input.select();
  }

  function renderCurrent() {
    const target = $('current-plan');
    target.replaceChildren();
    const plan = state.plans.find((item) => item.id === selected);
    $('current-title').textContent = plan?.status === 'ended' ? '历史补仓明细单' : '当前补仓明细单';
    if (!plan) {
      target.append(element('div', 'atr-empty', '生成一份计划，或从下方选择进行中的计划。'));
      return;
    }
    const data = plan.snapshot;
    const card = element('article', 'atr-plan-card');
    card.append(element('h3', '', data.name + (data.code ? '（' + data.code + '）' : '')));
    card.append(element('span', 'atr-badge' + (plan.status === 'ended' ? ' atr-badge-ended' : ''),
      plan.status === 'active' ? '进行中 · 参数已锁定' : '已结束 · 历史记录'));
    card.append(element('p', 'atr-meta',
      '首次开仓价 ' + data.priceDisplay + ' · 锁定ATR' + (data.period ?? '') + ' ' + data.atrDisplay));
    card.append(element('p', 'atr-hint', '创建时间：' + new Date(plan.createdAt).toLocaleString('zh-CN')));
    const stats = core.summary(plan);
    const metrics = element('div', 'atr-metrics');
    [['计划总仓位', stats.total + '%'], ['补仓进度', stats.count + '/' + data.levels.length],
      ['已执行仓位', stats.executed + '%'], [plan.status === 'ended' ? '未执行仓位' : '剩余仓位', stats.remaining + '%']].forEach(([label, value]) => {
      const metric = element('p', '', label);
      metric.append(element('strong', '', value));
      metrics.append(metric);
    });
    card.append(metrics);
    renderNextInfo(card, plan);
    const list = element('div', 'atr-stack');
    data.levels.forEach((level, index) => {
      const done = plan.completed[index];
      const trade = plan.executions[index];
      const reference = plan.dynamic.levels[index];
      const row = element('div', 'atr-execution' + (done ? ' is-complete' : ''));
      row.dataset.executionLevel = index;
      const body = element('div', 'atr-execution-body');
      const ready = !plan.completed.slice(0, index).some((completed) => !completed) && !plan.dynamic.missingActual;
      const head = element('div', 'atr-execution-head');
      const status = done ? trade.actualPrice === null
        ? plan.status === 'ended' ? '已补仓 · 价格未记录' : '已补仓 · 待补录' : '✓ 已补仓'
        : plan.status === 'ended' ? '未执行' : ready ? '待补仓' : plan.dynamic.missingActual ? '等待补录' : '等待前档';
      head.append(element('span', '', '第 ' + (index + 1) + ' 档 · ' + level.multiplier + ' ATR'),
        element('strong', '', status));
      const main = element('div', 'atr-execution-main');
      const priceBox = element('div', 'atr-execution-price');
      priceBox.append(element('span', 'atr-price-label', done ? '实际成交价格' : plan.status === 'ended' ? '历史参考价' : '当前参考价'));
      const result = element('div', 'atr-result');
      if (done && trade.actualPrice === null) {
        result.append(element('span', 'atr-missing-price', '实际价格未记录'));
      } else {
        const shown = done ? reference.actual : reference;
        const price = element('span', 'atr-price', shown.priceDisplay ?? '—');
        price.dataset.empty = String(shown.priceDisplay === null);
        result.append(price);
        if (shown.dropPercent !== null) result.append(changeNode(shown.dropPercent));
      }
      priceBox.append(result);
      main.append(priceBox);
      const meta = element('div', 'atr-execution-meta');
      meta.append(element('span', '', '原计划价格：' + level.priceDisplay + '（' + level.dropPercent + '%）'),
        element('span', '', '计划仓位 ' + level.position + '%'));
      body.append(head, main, meta);
      if (done) {
        const recordMeta = element('div', 'atr-record-meta');
        recordMeta.append(element('span', '', '确认时参考价：' + (reference.priceDisplay ?? '—')),
          element('span', '', (trade.legacy ? '补录确认时间：' : '确认时间：') +
            (trade.confirmedAt ? new Date(trade.confirmedAt).toLocaleString('zh-CN') : '未记录')));
        body.append(recordMeta);
        if (trade.actualPrice?.split('.')[1]?.length > 4) {
          body.append(element('p', 'atr-hint', '实际记录：' + trade.actualPrice));
        }
      } else if (reference.price === null) {
        body.append(element('p', 'atr-hint atr-invalid-target', plan.status === 'ended'
          ? plan.dynamic.missingActual ? '历史参考价无法计算：真实成交价未记录。' : '历史参考价无效，原计划价格和成交记录保留。'
          : plan.dynamic.missingActual
          ? '请先补录真实成交价，当前参考价暂不可计算。' : '目标价格无效，请重新评估；仍可记录真实成交价。'));
      }
      if (plan.status === 'active') {
        const mode = !done ? 'confirm' : trade.actualPrice === null ? 'backfill' : 'correct';
        const action = button(mode === 'confirm' ? '确认补仓' : mode === 'backfill' ? '补录实际价格' : '纠正记录',
          () => openTradeEditor(plan, index, mode, body),
          mode === 'confirm' && ready ? 'atr-primary' : mode === 'correct' ? 'atr-subtle' : '');
        action.disabled = state.readOnly || (mode === 'confirm' && !ready);
        if (mode === 'confirm' && !ready) {
          action.title = plan.dynamic.missingActual ? '请先补录旧记录的实际成交价格。' : '请先确认上一档补仓记录。';
        }
        const actionBox = element('div', 'atr-execution-action');
        actionBox.append(action);
        main.classList.add('has-action');
        main.append(actionBox);
      }
      if (done && trade.corrections.length) {
        const history = element('details', 'atr-corrections');
        history.append(element('summary', '', '纠正记录（' + trade.corrections.length + '）'));
        trade.corrections.forEach((change) => {
          history.append(element('p', 'atr-hint', change.before + ' → ' + change.after + ' · ' +
            new Date(change.at).toLocaleString('zh-CN')));
        });
        body.append(history);
      }
      row.append(body);
      list.append(row);
    });
    card.append(list, element('p', 'atr-hint', '首次开仓按已完成计算；仓位为计划比例。'));
    const actions = element('div', 'atr-actions');
    if (plan.status === 'active') {
      actions.append(button('标记为已结束', () => {
        const plans = state.plans.map((item) => item.id === plan.id ? { ...item, status: 'ended' } : item);
        persist(plans, plans.find((item) => item.status === 'active')?.id || null, '计划已结束，明细保留在历史计划中。');
      }));
    }
    actions.append(button('复制为新计划', () => {
      const copy = core.copyPlan(plan, newId());
      persist([copy, ...state.plans], copy.id, '已复制为新计划，补仓勾选状态已重置。');
    }));
    actions.append(button('删除计划', () => {
      if (!window.confirm('删除「' + data.name + (data.code ? '（' + data.code + '）' : '') +
        '」这份计划？删除后无法恢复，其他计划不受影响。')) return;
      const plans = state.plans.filter((item) => item.id !== plan.id);
      persist(plans, plans.find((item) => item.status === 'active')?.id || null, '这份计划已删除。');
    }, 'atr-danger'));
    if (state.readOnly) actions.querySelectorAll('button').forEach((node) => { node.disabled = true; });
    card.append(actions);
    target.append(card);
  }

  function renderPlans() {
    if (!state.plans.some((plan) => plan.id === selected)) {
      selected = state.plans.find((plan) => plan.status === 'active')?.id || state.plans[0]?.id || null;
    }
    const hasPlans = state.plans.length > 0;
    document.querySelector('.atr-shell').classList.toggle('has-plans', hasPlans);
    $('plan-toolbar').hidden = !hasPlans;
    $('current-section').hidden = !hasPlans;
    $('history-section').hidden = !hasPlans;
    if (!hasPlans) draftOpen = true;
    setDraftOpen(draftOpen);
    $('storage-message').textContent = state.error;
    $('storage-message').hidden = !state.error;
    $('plan-count').textContent = state.plans.length + ' 份';
    for (const [status, targetId] of [['active', 'active-plans'], ['ended', 'ended-plans']]) {
      const target = $(targetId);
      target.replaceChildren();
      const plans = state.plans.filter((plan) => plan.status === status);
      if (!plans.length) target.append(element('div', 'atr-empty', status === 'active' ? '暂无进行中的计划' : '暂无已结束的计划'));
      plans.forEach((plan) => {
        const stats = core.summary(plan);
        const link = element('button', 'atr-plan-link');
        link.type = 'button';
        link.setAttribute('aria-pressed', String(plan.id === selected));
        link.append(element('strong', '', plan.snapshot.name + (plan.snapshot.code ? '（' + plan.snapshot.code + '）' : '')),
          element('span', '', (status === 'active' ? '进行中' : '已结束') +
            ' · 已完成 ' + stats.count + '/' + plan.completed.length + ' 档 · ' +
            new Date(plan.createdAt).toLocaleString('zh-CN')));
        link.addEventListener('click', () => {
          selected = plan.id;
          renderPlans();
          $('current-section').scrollIntoView({ block: 'start' });
        });
        target.append(link);
      });
    }
    renderCurrent();
  }

  $('reset-draft').addEventListener('click', () => {
    const defaults = core.defaultDraft();
    if (JSON.stringify(inputData()) !== JSON.stringify(defaults) &&
      !window.confirm('清空计算器输入并恢复默认值？已保存的计划和成交记录不受影响。')) return;
    Object.entries(fields).forEach(([key, field]) => { field.value = defaults[key]; });
    draft = defaults.levels;
    renderDraft();
    updatePreview();
    notify('计算器已恢复默认值，已保存计划保持不变。');
    fields.name.focus();
  });

  form.addEventListener('input', updatePreview);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const plan = core.createPlan(inputData(), newId());
      if (persist([plan, ...state.plans], plan.id, '补仓明细单已生成并保存。')) {
        setDraftOpen(false);
        $('current-section').scrollIntoView({ block: 'start' });
      }
    } catch (error) { notify(error.message, true); }
  });
  $('add-level').addEventListener('click', () => {
    if (draft.length >= core.MAX_LEVELS) return;
    draft.push({ multiplier: '0.3', position: '10' });
    renderDraft();
    updatePreview();
    $('draft-levels').lastElementChild.querySelector('input').focus();
  });
  function reloadPlans() {
    state = store.read();
    renderPlans();
    updatePreview();
  }
  window.addEventListener('storage', (event) => {
    if (event.key === core.STORAGE_KEY || event.key === null) reloadPlans();
  });
  window.addEventListener('pageshow', reloadPlans);
  renderDraft();
  renderPlans();
  updatePreview();
})();
