(() => {
  const CACHE_KEY = 'monster-slayer-kit:currency-rates:v1';
  const API_ROOT = 'https://api.frankfurter.dev/v2/rate';
  const currencies = ['JPY', 'CNY', 'USD'];
  const fields = Object.fromEntries(currencies.map((currency) => [
    currency,
    document.querySelector(`#amount-${currency.toLowerCase()}`),
  ]));
  const cards = Object.fromEntries(currencies.map((currency) => [
    currency,
    document.querySelector(`[data-field-card="${currency}"]`),
  ]));
  const roles = Object.fromEntries(currencies.map((currency) => [
    currency,
    document.querySelector(`[data-role="${currency}"]`),
  ]));
  const status = document.querySelector('#rate-status');
  const rateDate = document.querySelector('#rate-date');
  const refreshButton = document.querySelector('#refresh-rates');
  let rates = null;
  let sourceCurrency = null;
  let isRefreshing = false;

  function parseAmount(raw) {
    const normalized = raw.trim().replace(/,/g, '');
    if (!normalized || !/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
  }

  function formatAmount(value, currency) {
    if (!Number.isFinite(value)) return '';
    const digits = currency === 'JPY' ? 2 : 2;
    const rounded = Math.round((value + Number.EPSILON) * (10 ** digits)) / (10 ** digits);
    return new Intl.NumberFormat('zh-CN', {
      useGrouping: false,
      maximumFractionDigits: digits,
    }).format(rounded);
  }

  function formatRate(value, maximumFractionDigits) {
    return new Intl.NumberFormat('zh-CN', {
      useGrouping: false,
      maximumFractionDigits,
    }).format(value);
  }

  function updateFieldState() {
    currencies.forEach((currency) => {
      const isSource = currency === sourceCurrency;
      cards[currency].classList.toggle('is-source', isSource);
      cards[currency].classList.toggle('is-derived', Boolean(sourceCurrency) && !isSource && fields[currency].value !== '');
      roles[currency].textContent = isSource ? '当前输入' : sourceCurrency && fields[currency].value !== '' ? '自动换算' : '';
    });
  }

  function setStatus(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function updateRateDetails() {
    if (!rates) {
      rateDate.textContent = '汇率日期：--';
      return;
    }
    const updated = new Date(rates.fetchedAt);
    const jpyDate = rates.jpyDate || rates.date;
    const usdDate = rates.usdDate || rates.date;
    const row = (label, value) => {
      const line = document.createElement('div');
      line.className = 'rate-detail';
      const name = document.createElement('span');
      name.textContent = label;
      const text = document.createElement('span');
      text.textContent = value;
      line.append(name, text);
      return line;
    };
    rateDate.replaceChildren(
      row('1 JPY', formatRate(rates.jpyCny, 6) + ' CNY'),
      row('1 USD', formatRate(rates.usdCny, 4) + ' CNY'),
      row('汇率日期', jpyDate === usdDate ? jpyDate : 'JPY ' + jpyDate + ' / USD ' + usdDate),
    );
    if (!Number.isNaN(updated.getTime())) {
      rateDate.append(row('上次更新', updated.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
    }
  }

  function saveRates(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // 存储不可用时不影响本次换算。
    }
  }

  function readCachedRates() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY));
      const hasDate = parsed.date || (parsed.jpyDate && parsed.usdDate);
      if (!parsed || !Number.isFinite(parsed.jpyCny) || parsed.jpyCny <= 0 || !Number.isFinite(parsed.usdCny) || parsed.usdCny <= 0 || !hasDate) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function calculateFrom(source) {
    if (!rates) {
      setStatus('暂时无法获取汇率，请联网后重试。', 'error');
      updateFieldState();
      return;
    }
    const amount = parseAmount(fields[source].value);
    if (amount === null) {
      currencies.filter((currency) => currency !== source).forEach((currency) => { fields[currency].value = ''; });
      updateFieldState();
      if (fields[source].value.trim()) setStatus('请输入有效的非负数金额。', 'error');
      return;
    }

    const cny = source === 'JPY' ? amount * rates.jpyCny : source === 'USD' ? amount * rates.usdCny : amount;
    const values = {
      JPY: cny / rates.jpyCny,
      CNY: cny,
      USD: cny / rates.usdCny,
    };
    currencies.filter((currency) => currency !== source).forEach((currency) => {
      fields[currency].value = formatAmount(values[currency], currency);
    });
    updateFieldState();
  }

  async function responseRate(from) {
    const response = await fetch(`${API_ROOT}/${from}/CNY`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Number.isFinite(payload.rate) || payload.rate <= 0 || !payload.date) throw new Error('Invalid rate data');
    return payload;
  }

  async function refreshRates() {
    if (isRefreshing) return;
    isRefreshing = true;
    refreshButton.disabled = true;
    setStatus('正在获取最新参考汇率…');
    try {
      const [jpy, usd] = await Promise.all([responseRate('JPY'), responseRate('USD')]);
      rates = {
        jpyCny: jpy.rate,
        usdCny: usd.rate,
        jpyDate: jpy.date,
        usdDate: usd.date,
        fetchedAt: new Date().toISOString(),
      };
      saveRates(rates);
      updateRateDetails();
      setStatus('已获取最新参考汇率', 'up');
      if (sourceCurrency && fields[sourceCurrency].value.trim()) calculateFrom(sourceCurrency);
    } catch {
      const cachedRates = readCachedRates();
      if (cachedRates) {
        rates = cachedRates;
        updateRateDetails();
        setStatus('当前离线 · 使用缓存汇率', 'flat');
        if (sourceCurrency && fields[sourceCurrency].value.trim()) calculateFrom(sourceCurrency);
      } else {
        rates = null;
        updateRateDetails();
        setStatus('暂时无法获取汇率，请联网后重试。', 'error');
      }
    } finally {
      isRefreshing = false;
      refreshButton.disabled = false;
    }
  }

  currencies.forEach((currency) => {
    const field = fields[currency];
    field.addEventListener('input', () => {
      sourceCurrency = currency;
      updateFieldState();
      calculateFrom(currency);
    });
    field.addEventListener('focus', () => {
      sourceCurrency = currency;
      updateFieldState();
    });
  });

  refreshButton.addEventListener('click', refreshRates);
  updateFieldState();
  refreshRates();
})();
