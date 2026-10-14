(() => {
  const fields = {
    a: document.querySelector('#price-a'),
    b: document.querySelector('#price-b'),
    c: document.querySelector('#change-c'),
  };
  const cards = Object.fromEntries(
    Object.keys(fields).map((key) => [key, document.querySelector(`[data-field-card="${key}"]`)]),
  );
  const roles = Object.fromEntries(
    Object.keys(fields).map((key) => [key, document.querySelector(`[data-role="${key}"]`)]),
  );
  const status = document.querySelector('#status-message');
  const clearButton = document.querySelector('#clear-button');
  const bDrop = document.querySelector('#price-b-drop');
  const bDropValue = document.querySelector('#price-b-drop-value');
  const manualOrder = [];
  let derivedKey = null;

  const labels = { a: '起始价格', b: '目标价格', c: '涨跌幅' };

  function parseValue(raw) {
    const normalized = raw.trim().replace(/％$/, '').replace(/,/g, '');
    if (!normalized || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function formatNumber(value, isPercent = false) {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round((value + Number.EPSILON) * 1e8) / 1e8;
    let text;
    const magnitude = Math.abs(rounded);
    if (magnitude !== 0 && (magnitude >= 1e12 || magnitude < 1e-8)) {
      text = rounded.toPrecision(10).replace(/\.?(0+)(e|$)/, '$2');
    } else {
      text = String(rounded);
    }
    if (isPercent && rounded > 0) text = `+${text}`;
    return text;
  }

  function setStatus(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function updateFieldStates() {
    Object.keys(fields).forEach((key) => {
      const isDerived = key === derivedKey && fields[key].value !== '';
      cards[key].classList.toggle('is-derived', isDerived);
      roles[key].textContent = isDerived ? '自动计算 · 可编辑' : '';
    });

    cards.c.classList.remove('is-up', 'is-down', 'is-flat');
    const change = parseValue(fields.c.value);
    if (change !== null) {
      cards.c.classList.add(change > 0 ? 'is-up' : change < 0 ? 'is-down' : 'is-flat');
    }
    clearButton.disabled = !Object.values(fields).some((field) => field.value !== '');
    const bPrice = parseValue(fields.b.value);
    const dropPrice = bPrice !== null && bPrice >= 0 ? formatNumber(bPrice * 0.99) : '';
    bDropValue.textContent = dropPrice;
    bDrop.hidden = dropPrice === '';
  }

  function showError(message, targetKey = null) {
    if (derivedKey) fields[derivedKey].value = '';
    derivedKey = null;
    Object.values(cards).forEach((card) => card.classList.remove('has-error'));
    if (targetKey) cards[targetKey].classList.add('has-error');
    setStatus(message, 'error');
    updateFieldStates();
  }

  function calculate() {
    Object.values(cards).forEach((card) => card.classList.remove('has-error'));
    if (manualOrder.length < 2) {
      derivedKey = null;
      setStatus(manualOrder.length === 1 && fields[manualOrder[0]].value.trim() ? '再填写一项即可计算' : '');
      updateFieldStates();
      return;
    }

    const inputs = manualOrder.slice(-2);
    const missingKey = ['a', 'b', 'c'].find((key) => !inputs.includes(key));
    const first = parseValue(fields[inputs[0]].value);
    const second = parseValue(fields[inputs[1]].value);

    if (first === null || second === null) {
      if (derivedKey) fields[derivedKey].value = '';
      derivedKey = null;
      const invalidKey = first === null ? inputs[0] : inputs[1];
      const hasText = fields[invalidKey].value.trim() !== '';
      setStatus(hasText ? `请检查${labels[invalidKey]}的输入` : '再填写一项即可计算', hasText ? 'error' : '');
      if (hasText) cards[invalidKey].classList.add('has-error');
      updateFieldStates();
      return;
    }

    const values = {
      [inputs[0]]: first,
      [inputs[1]]: second,
    };

    if ((inputs.includes('a') && values.a < 0) || (inputs.includes('b') && values.b < 0)) {
      const invalidKey = values.a < 0 ? 'a' : 'b';
      showError(`${labels[invalidKey]}不能小于 0`, invalidKey);
      return;
    }

    let result;
    if (missingKey === 'c') {
      if (values.a === 0) {
        showError('起始价格为 0 时无法计算涨跌幅', 'a');
        return;
      }
      result = ((values.b - values.a) / values.a) * 100;
    } else if (missingKey === 'b') {
      result = values.a * (1 + values.c / 100);
      if (result < 0) {
        showError('该涨跌幅会使目标价格小于 0', 'c');
        return;
      }
    } else {
      const divisor = 1 + values.c / 100;
      if (divisor === 0) {
        showError('涨跌幅为 -100% 时无法反推起始价格', 'c');
        return;
      }
      result = values.b / divisor;
      if (result < 0) {
        showError('该组合无法得到有效的起始价格', 'c');
        return;
      }
    }

    if (!Number.isFinite(result)) {
      showError('数值过大，请缩小后再试');
      return;
    }

    derivedKey = missingKey;
    fields[missingKey].value = formatNumber(result, missingKey === 'c');
    const change = parseValue(fields.c.value);
    const tone = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    setStatus('可继续编辑任意两项', tone);
    updateFieldStates();
  }

  Object.entries(fields).forEach(([key, field]) => {
    field.addEventListener('input', () => {
      const existingIndex = manualOrder.indexOf(key);
      if (existingIndex !== -1) manualOrder.splice(existingIndex, 1);
      manualOrder.push(key);
      if (manualOrder.length > 3) manualOrder.shift();
      if (key === derivedKey) derivedKey = null;
      calculate();
    });

    field.addEventListener('focus', () => {
      requestAnimationFrame(() => field.select());
    });
  });

  clearButton.addEventListener('click', () => {
    Object.values(fields).forEach((field) => { field.value = ''; });
    manualOrder.length = 0;
    derivedKey = null;
    Object.values(cards).forEach((card) => card.classList.remove('has-error'));
    setStatus('');
    updateFieldStates();
    fields.a.focus();
  });

  updateFieldStates();
})();
