(() => {
  'use strict';
  const core = window.USMarket;
  const DATA = new URL('../../local-data/us-market/', location.href);
  const CACHE_KEY = 'monster-slayer-kit:us-market:snapshots:v1';
  const MAP_KEY = 'monster-slayer-kit:us-market:mappings:v1';
  const $ = id => document.getElementById(id);
  const remote=window.USMarketRemote;
  let sharedTimer=null,initializing=true;
  const state = { kind: 'sector', exchange: 'NASDAQ', sectorExchange: 'NASDAQ', industryExchange: 'both', relatedSector: '', snapshot: null, config: null, overrides: {}, mappingRaw: null,
    mappingLocked: false, cached: { version: 1, snapshots: {} }, dates: [], latest: null, status: null,
    offline: false, manifestOffline: false, manifestProblem:'', snapshotProblem:'', loadToken: 0, editBaseline: null, sox: null, soxOffline: false, soxProblem:'', extraProblems:{}, extras: { NBI:null, BRENT:null }, extrasOffline: {}, remoteMeta:null, remoteReady:false, sharedLoading:false, sharedMessage:'正在检查独立收盘数据…', sharedError:false };

  const sharedClient=remote.createClient({fetchImpl:(url,options)=>navigator.onLine===false?Promise.reject(Error('offline')):fetch(url,options)});
  function sharedControls(){
    const remaining=sharedClient.remaining(),b=$('refresh-indices');
    b.disabled=initializing||state.sharedLoading||remaining>0;b.textContent=state.sharedLoading?'正在检查…':'检查数据更新';b.setAttribute('aria-busy',String(state.sharedLoading));
    $('index-live-status').textContent=state.sharedMessage+(remaining>0&&!state.sharedLoading?' 30秒内不重复检查。':'');
    $('index-live-status').dataset.warning=String(state.sharedError);$('index-live-controls').dataset.state=state.sharedLoading?'loading':state.sharedError?'error':'ready';
    clearTimeout(sharedTimer);sharedTimer=null;if(remaining>0)sharedTimer=setTimeout(sharedControls,remaining+10);
  }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function tone(value) { return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'; }
  async function json(url) {
    let response;
    try { response = await fetch(url, { cache: 'no-store' }); }
    catch { throw new Error('网络不可用或连接失败'); }
    if (!response.ok) throw new Error(response.status===404 ? '行情文件缺失（HTTP 404）' : '行情请求失败（HTTP '+response.status+'）');
    try { return await response.json(); }
    catch { throw new Error('JSON损坏或服务器返回了非JSON内容'); }
  }
  function mapping(kind, name) {
    const override = state.overrides[kind + '|' + name];
    const original = Object.hasOwn(state.config[kind], name) ? state.config[kind][name] : null;
    return override || original || { zh: '未译行业', etfs: [] };
  }
  function validateOverrides(data) {
    if (!data || data.version !== 1 || !data.entries || Array.isArray(data.entries) || typeof data.entries !== 'object') throw new Error('版本或结构不兼容');
    for (const [key, entry] of Object.entries(data.entries)) {
      if (!/^(industry|sector)\|.{1,120}$/.test(key) || !entry || typeof entry.zh !== 'string' || !entry.zh.trim() || entry.zh.length > 80 || !Array.isArray(entry.etfs) || entry.etfs.length > 12) throw new Error('关联内容无效');
      for (const link of entry.etfs) {
        if (!Object.hasOwn(state.config.relations, link.relation) || (link.id === 'custom'
          ? typeof link.name !== 'string' || !link.name.trim() || link.name.length > 60
          : !state.config.catalogue.some(e => e.id === link.id))) throw new Error('ETF关联无效');
      }
    }
    return data.entries;
  }
  function readMappings() {
    try {
      state.mappingRaw = localStorage.getItem(MAP_KEY);
      state.overrides = state.mappingRaw === null ? {} : validateOverrides(JSON.parse(state.mappingRaw));
      state.mappingLocked = false;
    } catch { state.overrides = {}; state.mappingLocked = true; $('mapping-message').textContent = '本地关联无法读取或版本不兼容，已保护原记录。当前显示默认配置，禁止覆盖。'; }
    $('save-mapping').disabled = state.mappingLocked;
    $('reset-mapping').disabled = state.mappingLocked;
  }
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.version !== 1 || !data.snapshots || typeof data.snapshots !== 'object') return;
      try { state.sox = core.validateSox(data.sox); } catch { /* Optional SOX cache never invalidates existing FMP snapshots. */ }
      for (const symbol of Object.keys(core.DAILY_SERIES)) {
        try { state.extras[symbol] = core.validateDailySeries(data.extras?.[symbol],symbol); } catch { /* Keep the existing snapshot cache usable. */ }
      }
      if(data.remote&&typeof data.remote==='object')state.remoteMeta=data.remote;
      for (const [date, snapshot] of Object.entries(data.snapshots)) {
        try { core.validateSnapshot(snapshot, { forDisplay:true }); if (snapshot.tradingDate === date) state.cached.snapshots[date] = snapshot; } catch { /* Never rank invalid cached records. */ }
      }
    } catch { /* Existing data is left untouched; local JSON can still be read. */ }
  }
  function cacheSnapshot(snapshot) {
    state.cached.snapshots[snapshot.tradingDate] = snapshot;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const old = JSON.parse(raw);
        if (old.version !== 1 || !old.snapshots || typeof old.snapshots !== 'object') return;
      }
      const dates = Object.keys(state.cached.snapshots).sort().reverse().slice(0, 30);
      const saved = { version: 1, snapshots: Object.fromEntries(dates.map(date => [date, state.cached.snapshots[date]])) };
      if(state.remoteMeta)saved.remote=state.remoteMeta;
      saved.extras = Object.fromEntries(Object.entries(state.extras).filter(([,data])=>data));
      if (state.sox) saved.sox = state.sox; // Optional addition; existing v1 snapshots and storage keys stay compatible.
      localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
    } catch { $('data-status').textContent = '行情已读取，但浏览器离线副本未能保存。'; }
  }
  function renderIndices() {
    const selectedDate = state.snapshot?.tradingDate;
    let sox = core.soxForDate(state.sox,selectedDate);
    if (sox.status === 'incomplete') {
      const row = state.sox.observations.find(r=>r.date===sox.date);
      sox = { status:row.date===selectedDate ? 'current' : 'stale', record:{ ...row, change:null } };
    }
    const definitions = [
      {symbol:'^GSPC',name:'标普500',source:'FMP',unit:'',basis:'指数日收盘'},
      {symbol:'^IXIC',name:'纳斯达克',source:'FMP',unit:'',basis:'指数日收盘'},
      {...core.SOX,name:'费城半导体',unit:'',basis:'指数日收盘'},
      core.DAILY_SERIES.NBI
    ];
    $('indices').replaceChildren(...definitions.map(definition=>{
      const { symbol,name,unit } = definition;
      const result = symbol==='SOX' ? sox : Object.hasOwn(core.DAILY_SERIES,symbol) ? core.dailySeriesForDate(state.extras[symbol],symbol,selectedDate)
        : core.indexForDate(state.snapshot?.indices,symbol,selectedDate);
      const { record,status } = result;
      const box = el('div','index-tile');box.dataset.symbol=symbol;box.dataset.status=status;box.dataset.date=record?.date||'';
      const updated = record?.fetchedAt || (Object.hasOwn(core.ACTIVE_INDEXES,symbol) ? state.snapshot?.updatedAt : null);
      box.title = (definition.english ? definition.english+' · '+symbol+'；' : '') + '来源：'+definition.source+'；口径：'+definition.basis
        + (record ? '；实际数据日期：'+record.date+(record.previousDate ? '；前期日期：'+record.previousDate : '') : '')
        + (updated ? '；获取时间：'+updated : '')
        + (record && record.change===null ? '；缺少前一有效交易期价格，不计算涨跌幅' : '')
        + ((symbol==='SOX'&&state.soxOffline)||state.extrasOffline[symbol] ? '；'+(symbol==='SOX'?state.soxProblem:state.extraProblems[symbol])+(record?'；使用已保存副本':'；当前设备无有效副本') : '');
      const hasChange = record && typeof record.change==='number' && Number.isFinite(record.change);
      const change = el('strong','index-change '+(hasChange ? tone(record.change) : 'neutral'),hasChange ? core.percent(record.change) : record ? '—' : initializing ? '读取中…' : '暂无数据');
      const value = record ? record.close.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
      const close = el('span','index-close');close.append(el('span','index-point',value));
      if (unit) close.append(el('span','index-unit',unit));
      close.setAttribute('aria-label',(unit ? '价格 ' : '收盘点位 ')+value+(unit==='USD/oz' ? ' 美元/金衡盎司' : unit==='USD/bbl' ? ' 美元/桶' : ''));
      const meta = el('span','index-meta');
      if (status==='stale') {
        const date = el('span','index-actual-date',record.date);date.setAttribute('aria-label','实际数据日期：'+record.date);
        meta.append(el('span','index-delay','数据延迟'),date);meta.classList.add('index-warning');
      } else if (record && !hasChange) meta.textContent='缺前期价格';
      box.append(el('p','index-name',name),change,close,meta);return box;
    }),...window.USCommodities.cards());
    const link = (label,url)=>{const a=el('a','',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    $('indices-note').replaceChildren(document.createTextNode('来源：FMP（标普/纳指） · FRED/Nasdaq（'),
      link('SOX',core.SOX.sourceUrl),document.createTextNode('/'),link('NBI',core.DAILY_SERIES.NBI.sourceUrl),
      document.createTextNode('；'+core.SOX.copyright+'） · 商品（'),link('黄金',window.USCommodity.INSTRUMENTS.GC00Y.sourceUrl),document.createTextNode('/'),link('Brent',window.USCommodity.INSTRUMENTS.B00Y.sourceUrl),document.createTextNode('盘中延迟报价；版权归东方财富及相关权利人）'));
    window.USCommodities.setObservationDate(!!selectedDate && selectedDate !== state.latest);
    const dates=[...$('indices').querySelectorAll('.index-tile:not(.commodity-tile)')].map(box=>[box.querySelector('.index-name').textContent,box.dataset.date||'暂无数据']);
    $('indices-note').append(document.createTextNode(' · 四指数实际收盘日：'+(new Set(dates.map(r=>r[1])).size===1?dates[0][1]:dates.map(r=>r.join(' ')).join(' / '))));
    sharedControls();
  }
  function openRelated(sector) {
    state.sectorExchange = state.exchange;
    state.kind = 'industry'; state.relatedSector = sector; state.exchange = state.sectorExchange;
    state.industryExchange = state.exchange; render();
    $('related-controls').scrollIntoView({ block: 'nearest' });
  }
  function renderFocus() {
    const visible = state.kind === 'sector'; $('focus-strip').hidden = !visible;
    if (!visible) return;
    const rows = state.snapshot?.datasets.sector || [];
    const sectors = [['Technology','科技'],['Healthcare','医药'],['Consumer Cyclical','可选消费'],['Consumer Defensive','必需消费'],['Energy','能源'],['Financial Services','金融']];
    $('focus-strip').replaceChildren(...sectors.map(([name,label]) => {
      const row = rows.find(r => r.name === name && r.exchange === state.exchange);
      const button = el('button', 'focus-button'); button.type = 'button'; button.disabled = !row;
      button.setAttribute('aria-label', '查看' + label + '相关细分行业');
      button.append(el('span', 'focus-label', label), el('strong', row ? tone(row.change) : 'neutral', row ? core.percent(row.change) : '—'));
      button.addEventListener('click', () => openRelated(name)); return button;
    }));
  }
  function etfTags(entry) {
    const tags = el('div', 'etf-tags');
    if (!entry.etfs.length) tags.append(el('span', 'no-etf', '暂无对应ETF'));
    for (const link of entry.etfs) {
      const fund = state.config.catalogue.find(e => e.id === link.id);
      const tag = el('span', 'etf-tag');
      tag.append(el('span', '', fund ? fund.name : link.name));
      // Custom directions never display unverified codes.
      if (fund?.verifiedAt && /^\d{6}$/.test(fund.code)) tag.append(el('code', '', fund.code));
      tag.append(el('small', '', state.config.relations[link.relation]));
      tag.title = fund ? fund.fullName + '；代码核实于' + fund.verifiedAt : '自定义方向，未核实代码不展示';
      tags.append(tag);
    }
    return tags;
  }
  function renderDetail() {
    if (!state.detail) return;
    const { kind, name, exchange } = state.detail;
    const row = state.snapshot?.datasets[kind].find(r => r.name === name && r.exchange === exchange);
    const entry = mapping(kind, name);
    $('detail-title').textContent = entry.zh;
    $('detail-original').textContent = name;
    $('detail-exchange').textContent = exchange;
    $('detail-date').textContent = state.snapshot?.tradingDate || '—';
    $('detail-change').textContent = row ? core.percent(row.change) : '该日期暂无记录';
    $('detail-change').className = row ? tone(row.change) : 'neutral';
    $('detail-etfs').replaceChildren(...etfTags(entry).childNodes);
    $('detail-note').textContent = state.config[kind][name]?.note || '关联仅表示行业方向，不代表成分股或收益相同。';
    const sector = kind === 'sector' ? name : state.config.industry[name]?.sector;
    $('detail-related').hidden = !sector;
    const related = sector ? core.relatedIndustries(state.snapshot?.datasets.industry || [], sector, state.config.industry).filter(r => r.exchange === exchange) : [];
    $('detail-industries').replaceChildren(...(related.length ? core.rank(related, exchange, Infinity).ordered.map(r => {
      const item = el('div', 'detail-industry'); item.title = r.name;
      item.append(el('span', '', mapping('industry', r.name).zh === '未译行业' ? r.name : mapping('industry', r.name).zh), el('strong', tone(r.change), core.percent(r.change)));
      return item;
    }) : [el('p', 'help', '暂无已关联的细分行业记录') ]));
  }
  function openDetail(row) {
    state.detail = { kind: state.kind, name: row.name, exchange: row.exchange };
    renderDetail();
    $('edit-kind').value = state.kind; editorNames(row.name);
    // Move the existing editor, never duplicate the form or localStorage record.
    $('detail-editor').append($('mapping-message'), $('mapping-form'));
    $('detail-edit').open = false;
    $('industry-detail').showModal(); $('detail-title').focus();
  }
  function renderList(side, rows, total) {
    $(side + '-count').textContent = rows.length === total ? total + ' 条' : rows.length + ' / ' + total + ' 条';
    $(side + '-list').replaceChildren(...(rows.length ? rows.map(row => {
      const entry = mapping(state.kind, row.name), item = el('li', 'market-row');
      item.dataset.name = row.name; item.dataset.exchange = row.exchange; item.dataset.change = row.change;
      const button = el('button', 'row-button'); button.type = 'button';
      button.setAttribute('aria-label', '查看' + entry.zh + '详情（' + row.name + ' · ' + row.exchange + '）');
      button.setAttribute('aria-haspopup', 'dialog');
      const name = el('span', 'row-label');
      name.append(el('span', 'row-name', entry.zh === '未译行业' ? entry.zh + ' · ' + row.name : entry.zh));
      if (state.kind === 'industry') name.append(el('span', 'row-exchange', row.exchange));
      const bar = el('span', 'change-bar ' + tone(row.change)), fill = el('span', 'bar-fill');
      fill.style.width = (state.barMax ? Math.abs(row.change) / state.barMax * 100 : 0) + '%';
      bar.setAttribute('aria-hidden', 'true'); bar.append(fill);
      button.append(name, el('strong', 'row-change ' + tone(row.change), core.percent(row.change)), bar, el('span', 'row-detail', '详情 ›'));
      button.addEventListener('click', () => openDetail(row)); item.append(button); return item;
    }) : [el('li', 'empty-row', state.snapshot ? '该范围没有' + (side === 'up' ? '上涨' : side === 'down' ? '下跌' : '持平') + '记录' : '暂无有效行情，请先在本机手动采集')]));
  }
  function render() {
    renderIndices();
    document.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === state.kind)));
    document.querySelectorAll('button[data-exchange]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.exchange === state.exchange)));
    const overview = state.kind === 'sector';
    document.body.classList.toggle('sector-overview', overview);
    document.querySelector('button[data-exchange="both"]').hidden = overview;
    $('related-controls').hidden = overview;
    $('basis-note').textContent = (state.exchange === 'both' ? 'NASDAQ + NYSE' : state.exchange) + (overview ? ' · 非标普500行业指数' : ' · 按交易所保留行业记录');
    const title = overview ? '11大行业 · 涨跌分组'
      : (state.exchange === 'both' ? 'NASDAQ + NYSE交易所行业记录排行' : state.exchange + '交易所行业记录排行') + (state.relatedSector ? ' · ' + mapping('sector', state.relatedSector).zh + '相关细分' : '');
    $('scope-label').textContent = title;
    const sourceRows = state.snapshot?.datasets[state.kind] || [];
    const pool = overview ? sourceRows : core.relatedIndustries(sourceRows, state.relatedSector, state.config?.industry || {});
    const ranked = core.rank(pool, state.exchange, overview ? Infinity : 5);
    state.barMax = Math.max(0, ...[...ranked.up, ...ranked.down].map(r => Math.abs(r.change)));
    $('breadth').textContent = ranked.total + (overview ? ' 类' : ' 条') + ' · 涨 ' + ranked.upCount + ' / 跌 ' + ranked.downCount + ' / 平 ' + ranked.flatCount;
    $('up-title').textContent = overview ? '上涨行业' : '上涨 TOP5';
    $('down-title').textContent = overview ? '下跌行业' : '下跌 TOP5';
    $('flat-group').hidden = !ranked.flatCount;
    if (state.config) {
      renderList('up', ranked.up, ranked.upCount); renderList('down', ranked.down, ranked.downCount);
      renderList('flat', overview ? ranked.flat : ranked.flat.slice(0, 5), ranked.flatCount);
    }
    $('rank-caption').textContent = '上涨按涨幅降序，下跌按跌幅绝对值降序，持平单列。所有横条向右、共用绝对涨跌幅比例尺。点击整行查看行业详情及A股ETF。'
      + (overview ? '' : ' 同名行业保留交易所身份；相关分类由本地映射维护。');
    if (!overview && state.config) {
      const select = $('related-filter');
      select.replaceChildren(new Option('全部细分行业', ''), ...Object.entries(state.config.sector).map(([name, entry]) => new Option(entry.zh, name)));
      select.value = state.relatedSector;
    }
    renderFocus(); renderDetail();
    $('trading-date').textContent = state.snapshot?.tradingDate || '—';
    $('override-count').textContent = Object.keys(state.overrides).length ? `${Object.keys(state.overrides).length} 项已修改` : '本机保存';
    const s = state.snapshot;
    if (!s) return;
    let expected = null; try { expected = core.expectedSession(); } catch { /* Unsupported calendar is warned below. */ }
    const historical = s.tradingDate !== state.latest;
    const failure = state.status?.lastAttempt?.success === false && !historical;
    const stale = !historical && (!expected || s.tradingDate < expected || failure);
    const warnings = [];
    if (state.offline || state.manifestOffline) warnings.push('收盘行情读取失败'+((state.snapshotProblem||state.manifestProblem)?'（'+(state.snapshotProblem||state.manifestProblem)+'）':'')+'，使用浏览器已保存副本');
    if(state.soxProblem)warnings.push('SOX：'+state.soxProblem);
    if(state.extraProblems.NBI)warnings.push('NBI：'+state.extraProblems.NBI);
    if (historical) warnings.push('历史快照');
    else if (stale) warnings.push('数据过期');
    else warnings.push('已收盘 · 当前最新交易日');
    if (failure) warnings.push(`最近采集失败，保留有效行情${state.status.lastAttempt.message ? '：' + state.status.lastAttempt.message : ''}`);
    if (!expected) warnings.push('交易日历超出支持范围');
    $('data-status').textContent = warnings.join(' · ');
    $('data-status').dataset.warning = String(!!(stale || state.offline || state.manifestOffline || state.soxProblem || state.extraProblems.NBI));
    $('updated-at').textContent = '美股收盘数据更新：' + new Date(s.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）';
    const coverage = ['sector', 'industry'].map(kind => `${kind === 'sector' ? '大行业' : '细分行业'}：` + core.EXCHANGES.map(e => `${e} ${s.datasets[kind].filter(r => r.exchange === e).length}条`).join(' / '));
    let missing = 0;
    if (state.dates.length > 1) for (let date = state.dates.at(-1); date <= state.dates[0]; date = core.shift(date, 1)) {
      if (core.isTradingDay(date) && !state.dates.includes(date)) missing++;
    }
    const details = [el('p', '', `来源：${s.source} · 非ETF代理指标`), ...coverage.map(text => el('p', '', text)),
      el('p', '', `已保存 ${state.dates.length} 个交易日${missing ? `，范围内缺 ${missing} 个交易日，未补采` : ''}。`),
      el('p', '', '指数前收盘日期：' + Object.entries(core.ACTIVE_INDEXES).map(([symbol,name]) => { const { record } = core.indexForDate(s.indices,symbol,s.tradingDate); return name + ' ' + (record?.previousDate || '暂无数据'); }).join(' / '))];
    const verified = el('p', 'help', 'ETF名称及代码核实来源：');
    for (const fund of state.config.catalogue) {
      const a = el('a', '', `${fund.name} ${fund.code}`); a.href = fund.source; a.target = '_blank'; a.rel = 'noopener noreferrer';
      verified.append(a, document.createTextNode(' · '));
    }
    $('source-details').replaceChildren(...details, verified);
  }
  function historyOptions(){
    const selected=state.snapshot?.tradingDate;
    $('history-date').replaceChildren(...state.dates.map(date=>{const option=el('option','',date+(date===state.latest?' · 最新':''));option.value=date;return option;}));
    $('history-date').value=selected||state.latest||'';$('history-date').disabled=!state.dates.length;
  }
  async function selectDate(date) {
    const token=++state.loadToken;$('history-date').disabled=true;
    let snapshot,offline=false;
    try{
      if(sharedClient.current?.manifest.dates.includes(date))snapshot=await sharedClient.snapshot(date);
      else {snapshot=core.validateSnapshot(await json(new URL('snapshots/'+date+'.json',DATA)),{forDisplay:true});if(snapshot.tradingDate!==date)throw Error('日期不匹配');}
    }catch(e){snapshot=state.cached.snapshots[date];offline=true;if(token===state.loadToken)state.snapshotProblem=e.message;}
    if(token!==state.loadToken)return;
    if(!snapshot){$('data-status').textContent='无法读取'+date+'的有效快照：'+state.snapshotProblem+'；'+(state.snapshot?'已保留当前行情':'当前设备没有有效离线副本')+'。';$('data-status').dataset.warning='true';$('history-date').value=state.snapshot?.tradingDate||'';}
    else{state.snapshot=snapshot;state.offline=offline;if(!offline)state.snapshotProblem='';cacheSnapshot(snapshot);render();}
    $('history-date').disabled=false;
  }
  function applyShared(pack){
    if(state.latest&&pack.pointer.latest<state.latest){state.sharedMessage='独立清单暂旧；保留较新设备行情，稍后检查';return false;}
    const historical=state.snapshot&&state.snapshot.tradingDate!==state.latest;
    state.remoteMeta={pointer:pack.pointer,manifest:pack.manifest,status:pack.status};state.remoteReady=true;
    state.sox=pack.sox;state.extras.NBI=pack.nbi;state.status=pack.status;
    Object.assign(state.cached.snapshots,pack.snapshots);state.dates=[...new Set([...state.dates,...pack.manifest.dates,...Object.keys(state.cached.snapshots)])].sort().reverse();state.latest=state.dates[0];
    if(!historical)state.snapshot=pack.snapshots[pack.pointer.latest];
    state.offline=false;state.manifestOffline=false;state.soxOffline=false;state.extrasOffline.NBI=false;state.manifestProblem='';state.snapshotProblem='';state.soxProblem='';state.extraProblems.NBI='';
    cacheSnapshot(state.snapshot);historyOptions();render();return true;
  }
  async function checkShared(){
    state.sharedLoading=true;sharedControls();
    try{
      const result=await sharedClient.check();state.sharedError=false;
      if(result.status==='updated'){if(applyShared(result.pack))state.sharedMessage='已读取独立仓库完整收盘数据；更新网页程序不影响行情历史。';}
      else if(result.status==='unchanged')state.sharedMessage='暂无更新版本；Actions完成后Raw可能延迟约5分钟，请稍后检查。这不代表采集失败。';
      else if(result.status==='error'){state.sharedError=result.code!=='NOT_PUBLISHED';state.sharedMessage=result.message;}
      else if(result.status==='pending')state.sharedMessage=result.message;
    }finally{state.sharedLoading=false;sharedControls();}
  }
  function editorNames(selected = $('edit-name').value) {
    const kind = $('edit-kind').value;
    const names = [...new Set([...Object.keys(state.config[kind]), ...(state.snapshot?.datasets[kind] || []).map(r => r.name),
      ...Object.keys(state.overrides).filter(k => k.startsWith(kind + '|')).map(k => k.slice(kind.length + 1))])].sort((a, b) => a.localeCompare(b, 'en'));
    $('edit-name').replaceChildren(...names.map(name => { const option = el('option', '', `${mapping(kind, name).zh} · ${name}`); option.value = name; return option; }));
    if (names.includes(selected)) $('edit-name').value = selected;
    loadEditor();
  }
  function addEditorRow(link = { id: 'custom', name: '', relation: 'direct' }) {
    const row = el('div', 'etf-editor-row');
    const select = el('select'); select.setAttribute('aria-label', '关联ETF');
    for (const fund of state.config.catalogue) { const option = el('option', '', `${fund.name} ${fund.code}`); option.value = fund.id; select.append(option); }
    const custom = el('option', '', '自定义方向（无代码）'); custom.value = 'custom'; select.append(custom); select.value = link.id;
    const relation = el('select'); relation.setAttribute('aria-label', '关联类型');
    for (const [value, text] of Object.entries(state.config.relations)) { const option = el('option', '', text); option.value = value; relation.append(option); }
    relation.value = link.relation;
    const remove = el('button', '', '删除'); remove.type = 'button'; remove.addEventListener('click', () => row.remove());
    const name = el('input'); name.setAttribute('aria-label', '自定义ETF方向名称'); name.maxLength = 60; name.placeholder = '方向名称，不展示未经核实的代码'; name.value = link.name || ''; name.hidden = select.value !== 'custom';
    select.addEventListener('change', () => { name.hidden = select.value !== 'custom'; });
    row.append(select, relation, remove, name); $('edit-etfs').append(row);
  }
  function loadEditor() {
    const entry = mapping($('edit-kind').value, $('edit-name').value);
    state.editBaseline = state.mappingRaw;
    $('edit-zh').value = entry.zh; $('edit-etfs').replaceChildren(); entry.etfs.forEach(addEditorRow);
  }
  function saveEntry(remove = false) {
    if (state.mappingLocked) return;
    try {
      if (localStorage.getItem(MAP_KEY) !== state.editBaseline) { readMappings(); editorNames(); render(); throw new Error('其他页面已修改关联，已重新载入；请核对后再保存。'); }
      const entries = { ...state.overrides }, key = $('edit-kind').value + '|' + $('edit-name').value;
      if (remove) delete entries[key];
      else entries[key] = { zh: $('edit-zh').value.trim(), etfs: [...$('edit-etfs').children].map(row => {
        const [fund, relation] = row.querySelectorAll('select');
        return { id: fund.value, relation: relation.value, ...(fund.value === 'custom' ? { name: row.querySelector('input').value.trim() } : {}) };
      }) };
      const data = { version: 1, entries }; validateOverrides(data);
      const raw = JSON.stringify(data);
      localStorage.setItem(MAP_KEY, raw); // Do not change the UI state until persistence succeeds.
      state.mappingRaw = raw; state.overrides = entries; state.editBaseline = raw;
      $('mapping-message').textContent = remove ? '已恢复此行业默认关联。' : '已保存到当前浏览器。';
      const selected = $('edit-name').value; editorNames(); $('edit-name').value = selected; loadEditor(); render();
    } catch (e) { $('mapping-message').textContent = e.message.includes('其他页面') ? e.message : '未能保存：请检查名称、关联数量（最多12项）及浏览器存储权限。原记录未改变。'; }
  }
  async function loadFallback(){
    const read=async name=>{try{return {value:await json(new URL(name,DATA))};}catch(e){return {error:e.message};}};
    const [m,a,b,status]=await Promise.all(['manifest.json','sox.json','nbi.json','status.json'].map(read));
    let dates=[];try{const v=m.value;if(!v)throw Error(m.error);if(v.version!==1||!Array.isArray(v.dates)||v.dates.some(d=>!core.isTradingDay(d))||v.dates.length&&v.latest!==[...v.dates].sort().at(-1))throw Error('历史清单数据损坏或包含非交易日');if(!v.dates.length)throw Error('公开历史清单为空');dates=[...new Set(v.dates)].sort().reverse();}catch(e){m.error=e.message;}
    if(state.remoteReady){state.dates=[...new Set([...state.dates,...dates])].sort().reverse();historyOptions();return;}
    try{const fresh=core.validateSox(a.value);if(!fresh)throw Error(a.error||'日线为空或缺少有效记录');if(!state.sox||fresh.observations.at(-1).date>=state.sox.observations.at(-1).date)state.sox=fresh;}catch(e){state.soxOffline=true;state.soxProblem=a.error||e.message;}
    try{const fresh=core.validateDailySeries(b.value,'NBI');if(!fresh)throw Error(b.error||'日线为空或缺少有效记录');if(!state.extras.NBI||fresh.observations.at(-1).date>=state.extras.NBI.observations.at(-1).date)state.extras.NBI=fresh;}catch(e){state.extrasOffline.NBI=true;state.extraProblems.NBI=b.error||e.message;}
    state.manifestOffline=!!m.error;state.manifestProblem=m.error||'';state.status=status.value||null;
    state.dates=[...new Set([...dates,...Object.keys(state.cached.snapshots)])].sort().reverse();state.latest=state.dates[0]||null;
    if(!state.dates.length){render();$('data-status').textContent='美股收盘行情不可用：'+state.manifestProblem+'；当前设备没有有效离线副本。';$('data-status').dataset.warning='true';return;}
    historyOptions();
    // Read into a candidate before mutating visible state: a concurrent remote success wins.
    let candidate,problem;try{candidate=core.validateSnapshot(await json(new URL('snapshots/'+state.latest+'.json',DATA)),{forDisplay:true});if(candidate.tradingDate!==state.latest)throw Error('日期不匹配');}catch(e){problem=e.message;}
    if(state.remoteReady)return;
    if(!candidate){candidate=state.cached.snapshots[state.latest];state.offline=true;state.snapshotProblem=problem;}
    if(candidate){state.snapshot=candidate;cacheSnapshot(candidate);historyOptions();render();}
    else{$('data-status').textContent='无法读取'+state.latest+'的有效快照：'+problem+'；当前设备没有有效离线副本。';$('data-status').dataset.warning='true';$('history-date').disabled=false;}
  }
  async function init(){
    document.body.dataset.closeState='loading';readCache();state.dates=Object.keys(state.cached.snapshots).sort().reverse();state.latest=state.dates[0]||null;state.snapshot=state.cached.snapshots[state.latest]||null;
    $('trading-date').textContent=state.snapshot?.tradingDate||'—';renderIndices();
    try{
      state.config=await json(new URL('./mappings.json',location.href));if(state.config.version!==1)throw Error('配置版本不兼容');readMappings();editorNames();
      if(state.snapshot){historyOptions();render();$('data-status').textContent='已保存副本 · 正在检查独立收盘数据…';}
      const task=(async()=>{if(await sharedClient.restore(state.remoteMeta?{...state.remoteMeta,sox:state.sox,nbi:state.extras.NBI,snapshots:state.cached.snapshots}:null)){state.remoteReady=true;state.sharedMessage='已恢复独立仓库离线副本';}await checkShared();})();
      await Promise.all([task,loadFallback()]);
    }catch{$('data-status').textContent='配置读取失败，请通过本地HTTP服务打开并检查工具文件是否完整。';$('data-status').dataset.warning='true';}
    finally{initializing=false;document.body.dataset.closeState='ready';renderIndices();}
  }
  document.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
    state.kind = b.dataset.kind; state.relatedSector = '';
    state.exchange = state.kind === 'sector' ? state.sectorExchange : state.industryExchange; render();
  }));
  document.querySelectorAll('button[data-exchange]').forEach(b => b.addEventListener('click', () => { state.exchange = b.dataset.exchange; if (state.kind === 'sector') state.sectorExchange = state.exchange; else state.industryExchange = state.exchange; render(); }));
  $('close-detail').addEventListener('click', () => $('industry-detail').close());
  $('industry-detail').addEventListener('close', () => {
    $('mapping-panel').append($('mapping-message'), $('mapping-form'));
    state.detail = null;
  });
  $('detail-related').addEventListener('click', () => {
    const { kind, name, exchange } = state.detail;
    const sector = kind === 'sector' ? name : state.config.industry[name]?.sector;
    if (!sector) return;
    $('industry-detail').close(); state.exchange = exchange; openRelated(sector);
  });
  $('related-filter').addEventListener('change', () => { state.relatedSector = $('related-filter').value; render(); });
  $('back-overview').addEventListener('click', () => { state.kind = 'sector'; state.relatedSector = ''; state.exchange = state.sectorExchange; render(); });
  $('history-date').addEventListener('change', () => selectDate($('history-date').value));
  $('edit-kind').addEventListener('change', editorNames);
  $('edit-name').addEventListener('change', loadEditor);
  $('add-etf').addEventListener('click', () => { if ($('edit-etfs').children.length < 12) addEditorRow(); else $('mapping-message').textContent = '每个行业最多12项关联。'; });
  $('mapping-form').addEventListener('submit', event => { event.preventDefault(); saveEntry(); });
  $('reset-mapping').addEventListener('click', () => saveEntry(true));
  window.addEventListener('storage', event => {
    if (event.key === MAP_KEY || event.key === null) {
      readMappings(); editorNames(); render(); $('mapping-message').textContent = state.mappingLocked ? '其他页面的关联数据无法读取，已保护原记录。' : '关联已从其他页面同步。';
    }
  });
  $('refresh-indices').addEventListener('click',checkShared);
  window.addEventListener('offline',()=>{state.sharedMessage='离线：继续显示已保存收盘行情';state.sharedError=true;sharedControls();});
  window.addEventListener('pagehide',()=>{sharedClient.leave();clearTimeout(sharedTimer);sharedTimer=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted){sharedClient.resume();sharedControls();}});
  init();
  window.USCommodities.start();
})();
