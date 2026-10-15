'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const core = require('../tools/us-market/market-core');
const { collect, atomicJson } = require('../scripts/collect-us-market');
const fixture = require('./us-market-fixtures');
const { collectSox } = require('../scripts/collect-sox');
const { collectExtra } = require('../scripts/collect-market-extras');
const now = new Date('2026-10-15T04:00:00Z');
async function workspace(run) { const dir = await fs.mkdtemp(path.join(os.tmpdir(),'us-market-test-')); try { await run(dir); } finally { await fs.rm(dir,{recursive:true,force:true}); } }
function options(dir, fetchImpl, extra = {}) { return { dir, fetchImpl, testMode:true, key:'mock-secret-only', now, ...extra }; }
test('TOP5严格正负过滤、两交易所不合并、数值排序与零值', () => {
  const data = fixture.snapshot(), all = core.rank(data.datasets.industry);
  assert.equal(all.total,16); assert.equal(all.flatCount,2);
  assert.ok(all.up.every(r=>r.change>0)); assert.ok(all.down.every(r=>r.change<0));
  for(const side of ['up','down']) for(let i=1;i<all[side].length;i++) assert.ok(side==='up'?all[side][i-1].change>=all[side][i].change:all[side][i-1].change<=all[side][i].change);
  const same = core.rank([{name:'same',exchange:'NASDAQ',change:1},{name:'same',exchange:'NYSE',change:2},{name:'zero',exchange:'NYSE',change:0}]);
  assert.equal(same.up.length,2);assert.equal(same.down.length,0);assert.equal(same.up[0].exchange,'NYSE');
  assert.ok(core.rank(data.datasets.industry,'NYSE').up.every(r=>r.exchange==='NYSE'));
  assert.equal(core.percent(1.234),'+1.23%'); assert.equal(core.percent(-2.345),'-2.35%');
});
test('交易日历：节假日、周末、提前收盘日、夏冬令时及超范围保护', () => {
  for(const date of ['2026-09-07','2026-04-03','2026-07-03','2026-10-11','2025-01-09','2027-06-18','2028-12-25']) assert.equal(core.isTradingDay(date),false,date);
  assert.equal(core.isTradingDay('2026-10-12'),true);assert.equal(core.isTradingDay('2026-11-27'),true);
  assert.equal(core.isTradingDay('2026-02-30'),false);assert.equal(core.isTradingDay('2029-01-03'),false);
  assert.equal(core.previousSession('2026-09-08'),'2026-09-04');
  assert.equal(core.expectedSession(new Date('2026-10-15T21:59:00Z')),'2026-10-14');
  assert.equal(core.expectedSession(new Date('2026-10-15T22:00:00Z')),'2026-10-15');
  assert.equal(core.expectedSession(new Date('2026-12-15T22:59:00Z')),'2026-12-14');
  assert.equal(core.expectedSession(new Date('2026-12-15T23:00:00Z')),'2026-12-15');
});
test('指数只按相邻交易日收盘价计算，忽略错误changePercent', () => {
  const r=core.indexFromCloses(fixture.closes('^GSPC','2026-10-14'),'^GSPC','2026-10-14');assert.ok(Math.abs(r.change-10)<1e-9);
  assert.throws(()=>core.indexFromCloses([{symbol:'^GSPC',date:'2026-10-14',close:1}],'^GSPC','2026-10-14'),/相邻/);
});
test('拒绝休市、混日期、重复、缺交易所、非法数值和指数口径错误', () => {
  const base=fixture.snapshot();assert.equal(core.validateSnapshot(base),base);
  for(const mutate of [d=>d.tradingDate='2026-09-07',d=>d.datasets.industry.push(d.datasets.industry[0]),d=>d.datasets.sector.pop(),d=>d.datasets.industry[0].change='1',d=>d.indices[0].change=999,d=>d.indices[0].previousDate='2026-10-12']){
    const d=structuredClone(base);mutate(d);assert.throws(()=>core.validateSnapshot(d));
  }
  assert.throws(()=>core.normalizeRows([{date:'2026-10-13',exchange:'NASDAQ',industry:'x',averageChange:1}],'industry','NASDAQ','2026-10-14'));
});
test('采集正常6次、同日去重0次、原始数据不包含密钥',async()=>workspace(async dir=>{
  const seen=[];const result=await collect(options(dir,fixture.mockFetch(seen)));assert.equal(result.requests,6);assert.equal(seen.length,6);assert.ok(seen.every(r=>r.params.symbol!=='^DJI'));
  const again=await collect(options(dir,()=>{throw new Error('must not fetch');}));assert.equal(again.skipped,true);assert.equal(again.requests,0);
  const raw=await fs.readFile(path.join(dir,'snapshots/2026-10-14.json'),'utf8');assert.equal(raw.includes('mock-secret-only'),false);
  const ledger=await fs.readFile(path.join(dir,'requests.json'),'utf8');assert.equal(ledger.includes('mock-secret-only'),false);assert.equal(JSON.parse(ledger).days['2026-10-15'].requests,6);
}));
test('20次预算和250次总额均在发送前阻断，计数损坏不绕过',async()=>workspace(async dir=>{
  let calls=0;const fetch=()=>{calls++;throw new Error('forbidden');};
  for(const day of [{requests:15,externalBaseline:67,events:[]},{requests:0,externalBaseline:245,events:[]},{requests:'bad',externalBaseline:0,events:[]}]){
    await atomicJson(path.join(dir,'requests.json'),{version:1,days:{'2026-10-15':day}});
    await assert.rejects(()=>collect(options(dir,fetch)));assert.equal(calls,0);
  }
}));
test('402、429不重试；失败保留上一份有效行情并写明状态',async()=>workspace(async dir=>{
  await fs.mkdir(path.join(dir,'snapshots'));const old=fixture.snapshot('2026-10-13');await atomicJson(path.join(dir,'snapshots/2026-10-13.json'),old);
  await atomicJson(path.join(dir,'manifest.json'),{version:1,dates:['2026-10-13'],latest:'2026-10-13'});
  for(const status of [402,429]){
    let calls=0;await assert.rejects(()=>collect(options(dir,async()=>{calls++;return new Response('blocked',{status});})),new RegExp('HTTP '+status));assert.equal(calls,1);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'snapshots/2026-10-13.json'),'utf8')),old);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8')).latest,'2026-10-13');
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'status.json'),'utf8')).lastAttempt.success,false);
  }
}));
test('网络最多重试一次，失败尝试也占预算',async()=>workspace(async dir=>{
  let calls=0;const mock=fixture.mockFetch();const result=await collect(options(dir,async url=>{if(++calls===1)throw new Error('mock network');return mock(url);}));assert.equal(result.requests,7);
}));
test('连续网络失败只发送2次；空数据、跨交易日缺失不发布',async()=>workspace(async dir=>{
  let calls=0;await assert.rejects(()=>collect(options(dir,async()=>{calls++;throw new Error('mock network');})),/重试一次/);assert.equal(calls,2);
  await assert.rejects(()=>collect(options(dir,async()=>new Response('[]'))),/无数据/);
  await assert.rejects(()=>fs.access(path.join(dir,'manifest.json')));
}));
test('自动化测试必须显式注入Mock；未收盘日期不请求',async()=>workspace(async dir=>{
  await assert.rejects(()=>collect({dir,testMode:true,now,key:'mock'}),/Mock/);
  await assert.rejects(()=>collect(options(dir,fixture.mockFetch(),{date:'2026-09-07'})),/交易日/);
  await assert.rejects(()=>collect(options(dir,fixture.mockFetch(),{date:'2026-10-15'})),/收盘/);
}));
test('全部140个行业有中文翻译，ETF代码均有官方核实来源',async()=>{
  const config=JSON.parse(await fs.readFile(path.join(__dirname,'../tools/us-market/mappings.json'),'utf8'));
  assert.equal(Object.keys(config.industry).length,140);assert.equal(Object.keys(config.sector).length,11);
  for(const value of Object.values(config.industry))assert.match(value.zh,/[\u4e00-\u9fff]/);
  for(const f of config.catalogue){assert.match(f.code,/^\d{6}$/);assert.ok(f.source.startsWith('https://'));assert.equal(f.verifiedAt,'2026-10-15');}
  assert.deepEqual(config.industry.Semiconductors.etfs.map(e=>e.id),['semi','chip']);
  assert.equal(config.industry['Shell Companies'].etfs.length,0);
  assert.equal(Object.hasOwn(config.industry,'Cloud Computing'),false);
});

test('已有快照但清单缺失时从快照恢复，0次网络请求',async()=>workspace(async dir=>{
  await fs.mkdir(path.join(dir,'snapshots'));await atomicJson(path.join(dir,'snapshots/2026-10-14.json'),fixture.snapshot());
  const result=await collect(options(dir,()=>{throw new Error('must not fetch');}));assert.equal(result.requests,0);assert.equal(result.skipped,true);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8')).latest,'2026-10-14');
}));
test('无效JSON、缺少指数前收盘价均不重试或发布',async()=>workspace(async dir=>{
  let calls=0;await assert.rejects(()=>collect(options(dir,async()=>{calls++;return new Response('not json');})),/无效JSON/);assert.equal(calls,1);
  const mock=fixture.mockFetch();calls=0;await assert.rejects(()=>collect(options(dir,async url=>{calls++;return url.pathname.endsWith('/full')?new Response('[]'):mock(url);})),/相邻/);assert.equal(calls,5);
  await assert.rejects(()=>fs.access(path.join(dir,'manifest.json')));
}));

test('大行业完整排序不截断，细分默认仍TOP5；本地归组覆盖140类',async()=>{
  const data=fixture.snapshot();const all=core.rank(data.datasets.sector,'NASDAQ',Infinity);assert.equal(all.up.length,3);assert.equal(all.down.length,8);
  const config=JSON.parse(await fs.readFile(path.join(__dirname,'../tools/us-market/mappings.json'),'utf8'));
  for(const value of Object.values(config.industry))assert.ok(Object.hasOwn(config.sector,value.sector));
  for(const value of Object.values(config.sector)){assert.ok(value.etfs.length>0);for(const link of value.etfs)assert.ok(config.catalogue.some(f=>f.id===link.id));}
  assert.equal(config.sector.Technology.etfs.find(e=>e.id==='star50').relation,'indirect');
  const related=core.relatedIndustries(data.datasets.industry,'Healthcare',config.industry);assert.equal(related.length,4);assert.ok(related.every(r=>['Biotechnology','Drug Manufacturers - General'].includes(r.name)));
  assert.equal(core.relatedIndustries(data.datasets.industry,'',config.industry).length,16);
  const unknown={name:'Unknown',exchange:'NYSE',change:1};assert.equal(core.relatedIndustries([unknown],'Technology',config.industry).length,0);assert.equal(core.relatedIndustries([unknown],'',config.industry).length,1);
});

test('完整榜单按未四舍五入数值降序，含持平与全部下跌记录',()=>{
  const rows=[{name:'lower',exchange:'NASDAQ',change:2.001},{name:'higher',exchange:'NASDAQ',change:2.004},{name:'flat',exchange:'NASDAQ',change:0},{name:'mild',exchange:'NASDAQ',change:-1},{name:'deep',exchange:'NASDAQ',change:-3}];
  assert.deepEqual(core.rank(rows,'NASDAQ',Infinity).ordered.map(r=>r.name),['higher','lower','flat','mild','deep']);
});


test('SOX CSV：相邻交易日收盘计算、缺失值非零、错误数据拒绝',()=>{
  const data=core.parseSoxCsv('observation_date,NASDAQSOX\n2026-10-09,9000\n2026-10-10,.\n2026-10-12,10000\n',now.toISOString());
  assert.equal(data.observations.length,2);
  const result=core.soxForDate(data,'2026-10-12');assert.equal(result.status,'current');assert.equal(result.record.previousDate,'2026-10-09');assert.ok(Math.abs(result.record.change-100/9)<1e-8);
  assert.ok(Math.abs(core.soxForDate(fixture.sox(),'2026-10-14').record.change+5)<1e-8);
  for(const csv of ['date,FAKE\n2026-10-12,1\n2026-10-13,2','observation_date,NASDAQSOX\n2026-10-12,0\n2026-10-13,2','observation_date,NASDAQSOX\n2026-10-12,1\n2026-10-12,2','observation_date,NASDAQSOX\n2026-09-07,1\n2026-09-08,2','observation_date,NASDAQSOX\n2026-10-12,NaN\n2026-10-13,2'])assert.throws(()=>core.parseSoxCsv(csv,now.toISOString()));
  const invalid=fixture.sox();invalid.source='Unknown';assert.throws(()=>core.validateSox(invalid));
  assert.equal(core.validateSox({version:1,observations:[]}),null);
});

test('SOX日期：旧数据明确区分、不向历史借用未来值、缺前收盘不跨缺日计算',()=>{
  const data=fixture.sox();
  assert.equal(core.soxForDate(data,'2026-10-13').record.close,10000);
  assert.equal(core.soxForDate(data,'2026-10-09').status,'missing');
  assert.equal(core.soxForDate(data,'2026-10-15').status,'stale');assert.equal(core.soxForDate(data,'2026-10-15').record.date,'2026-10-14');
  data.observations=data.observations.filter(r=>r.date!=='2026-10-13');
  assert.equal(core.soxForDate(data,'2026-10-14').status,'incomplete');assert.equal(core.soxForDate(data,'2026-10-14').record,null);
  assert.equal(core.soxForDate(null,'2026-10-14').status,'missing');
});

test('SOX采集Mock：独立1次请求、同日去重0次、保留历史及每条获取时间，FMP保留旧代码兼容',async()=>workspace(async dir=>{
  assert.deepEqual(Object.keys(core.INDEXES),['^GSPC','^IXIC','^DJI']);
  const old=core.parseSoxCsv('observation_date,NASDAQSOX\n2026-10-08,8000\n2026-10-09,8500\n','2026-10-10T04:00:00Z');await atomicJson(path.join(dir,'sox.json'),old);
  const seen=[];const mock=async url=>{seen.push(String(url));assert.equal(url.hostname,'fred.stlouisfed.org');assert.equal(url.searchParams.get('id'),'NASDAQSOX');assert.equal(url.searchParams.has('apikey'),false);return new Response(fixture.soxCsv(),{status:200});};
  const result=await collectSox({dir,now,testMode:true,fetchImpl:mock});assert.equal(result.requests,1);assert.equal(result.status,'current');assert.equal(seen.length,1);
  const stored=JSON.parse(await fs.readFile(path.join(dir,'sox.json'),'utf8'));assert.equal(stored.observations.length,5);assert.equal(stored.observations[0].fetchedAt,'2026-10-10T04:00:00Z');
  assert.equal(core.soxForDate(stored,'2026-10-14').record.fetchedAt,now.toISOString());
  const again=await collectSox({dir,now,testMode:true,fetchImpl:()=>{throw Error('must not request');}});assert.equal(again.requests,0);assert.equal(again.skipped,true);
  const ledger=JSON.parse(await fs.readFile(path.join(dir,'sox-requests.json'),'utf8'));assert.equal(ledger.days['2026-10-15'].requests,1);
}));

test('SOX采集Mock：2次日预算、失败无盲目重试、不覆盖有效数据、强制隔离测试',async()=>{
  for(const status of [402,429,500,'network','invalid'])await workspace(async dir=>{
    const old=fixture.sox();old.observations.pop();await atomicJson(path.join(dir,'sox.json'),old);const before=await fs.readFile(path.join(dir,'sox.json'),'utf8');
    let calls=0;const mock=async()=>{calls++;if(status==='network')throw Error('network');return new Response(status==='invalid'?'bad':fixture.soxCsv(),{status:typeof status==='number'?status:200});};
    await assert.rejects(()=>collectSox({dir,now,testMode:true,fetchImpl:mock}));assert.equal(calls,1);assert.equal(await fs.readFile(path.join(dir,'sox.json'),'utf8'),before);
    await atomicJson(path.join(dir,'sox-requests.json'),{version:1,days:{'2026-10-15':{requests:2,events:[]}}});
    await assert.rejects(()=>collectSox({dir,now,testMode:true,fetchImpl:mock}),/预算/);assert.equal(calls,1);
  });
  await assert.rejects(()=>collectSox({testMode:true}),/Mock/);await assert.rejects(()=>collectSox({}),/Mock/);
});


test('指数展示逐项判断交易日：同日、延迟、缺失、未来、异常；采集严格校验保持不变',()=>{
  for(const symbol of Object.keys(core.INDEXES)){
    const same=core.indexFromCloses(fixture.closes(symbol,'2026-10-14'),symbol,'2026-10-14');
    const old=core.indexFromCloses(fixture.closes(symbol,'2026-10-13'),symbol,'2026-10-13');
    const future=core.indexFromCloses(fixture.closes(symbol,'2026-10-15'),symbol,'2026-10-15');
    assert.equal(core.indexForDate([same],symbol,'2026-10-14').status,'current');
    assert.equal(core.indexForDate([old],symbol,'2026-10-14').status,'stale');assert.equal(core.indexForDate([old],symbol,'2026-10-14').record.date,'2026-10-13');
    assert.equal(core.indexForDate([old],symbol,'2026-10-13').status,'current');
    assert.equal(core.indexForDate([future],symbol,'2026-10-14').record,null);
    assert.equal(core.indexForDate([old,future],symbol,'2026-10-14').record.date,'2026-10-13');
    assert.equal(core.indexForDate([same,same],symbol,'2026-10-14').record,null);
    assert.equal(core.indexForDate([{...same,change:999}],symbol,'2026-10-14').record,null);
    assert.equal(core.indexForDate([{...same,previousDate:'2026-10-12'}],symbol,'2026-10-14').record,null);
    for(const missing of [null,undefined,[],[null],{}])assert.equal(core.indexForDate(missing,symbol,'2026-10-14').record,null);
    const data=fixture.snapshot();data.indices=data.indices.filter(r=>r.symbol!==symbol);data.indices.push(old);
    assert.equal(core.validateSnapshot(data,{forDisplay:true}),data);assert.throws(()=>core.validateSnapshot(data));
  }
  const data=fixture.snapshot();data.indices=null;assert.equal(core.validateSnapshot(data,{forDisplay:true}),data);assert.throws(()=>core.validateSnapshot(data));
});


test('NBI与Brent：各自交易期、真实前期价格、滞后/未来隔离及无前期只显示价格',()=>{
  const nbi=core.parseDailyCsv('observation_date,NASDAQNBI\n2026-10-12,100\n2026-10-13,110\n2026-10-14,105\n',now.toISOString(),'NBI');
  assert.ok(Math.abs(core.dailySeriesForDate(nbi,'NBI','2026-10-14').record.change-(105/110-1)*100)<1e-10);
  assert.equal(core.dailySeriesForDate(nbi,'NBI','2026-10-13').record.close,110);
  assert.equal(core.dailySeriesForDate(nbi,'NBI','2026-10-09').record,null);
  const gap=core.parseDailyCsv('observation_date,NASDAQNBI\n2026-10-09,100\n2026-10-13,110\n',now.toISOString(),'NBI');
  assert.equal(core.dailySeriesForDate(gap,'NBI','2026-10-13').record.change,null);assert.equal(core.dailySeriesForDate(gap,'NBI','2026-10-13').record.close,110);
  const brent=core.parseDailyCsv('observation_date,DCOILBRENTEU\n2026-09-04,100\n2026-09-07,110\n2026-09-08,.\n2026-09-09,105\n',now.toISOString(),'BRENT');
  assert.equal(core.isTradingDay('2026-09-07'),false);assert.equal(brent.observations[1].previousDate,'2026-09-04');assert.equal(brent.observations[2].previousDate,'2026-09-07');
  const delayed=core.dailySeriesForDate(brent,'BRENT','2026-10-14');assert.equal(delayed.status,'stale');assert.equal(delayed.record.date,'2026-09-09');
  const single=core.parseDailyCsv('observation_date,DCOILBRENTEU\n2026-10-06,125.44\n',now.toISOString(),'BRENT');assert.equal(core.dailySeriesForDate(single,'BRENT','2026-10-14').record.change,null);
  for(const csv of ['observation_date,FAKE\n2026-10-13,1','observation_date,NASDAQNBI\n2026-09-07,1','observation_date,NASDAQNBI\n2026-10-13,0','observation_date,NASDAQNBI\n2026-10-13,1\n2026-10-13,2'])assert.throws(()=>core.parseDailyCsv(csv,now.toISOString(),'NBI'));
});

test('新旧FMP历史兼容：旧三项不删除，新两项有效，道琼斯不再采集',()=>{
  const old=fixture.snapshot();assert.equal(core.validateSnapshot(old),old);assert.equal(old.indices.length,3);
  const fresh=structuredClone(old);fresh.indices=fresh.indices.filter(r=>r.symbol!=='^DJI');assert.equal(core.validateSnapshot(fresh),fresh);
  assert.deepEqual(Object.keys(core.ACTIVE_INDEXES),['^GSPC','^IXIC']);assert.equal(old.indices.length,3);
  const row={...fresh.indices[0]};delete row.previousClose;delete row.previousDate;assert.equal(core.indexForDate([row],row.symbol,'2026-10-14').record.change,null);
  fresh.indices.pop();assert.throws(()=>core.validateSnapshot(fresh));
});

test('补充采集Mock：每源1次，同观察日不重复，包括延迟Brent，保留历史和获取时间',async()=>{
 for(const symbol of ['NBI','BRENT'])await workspace(async dir=>{
  const old=core.parseDailyCsv('observation_date,'+core.DAILY_SERIES[symbol].series+'\n2026-10-08,90\n2026-10-09,100\n','2026-10-10T04:00:00Z',symbol);await atomicJson(path.join(dir,symbol.toLowerCase()+'.json'),old);
  let calls=0;const csv=symbol==='BRENT'?'observation_date,DCOILBRENTEU\n2026-10-12,100\n2026-10-13,110\n':fixture.dailyCsv(symbol);
  const mock=async url=>{calls++;assert.equal(url.hostname,'fred.stlouisfed.org');assert.equal(url.searchParams.get('id'),core.DAILY_SERIES[symbol].series);return new Response(csv);};
  const result=await collectExtra({dir,symbol,now,testMode:true,fetchImpl:mock});assert.equal(result.requests,1);assert.equal(result.status,symbol==='BRENT'?'stale':'current');
  const repeated=await collectExtra({dir,symbol,now,testMode:true,fetchImpl:()=>{throw Error('no request');}});assert.equal(repeated.requests,0);assert.equal(calls,1);
  const data=JSON.parse(await fs.readFile(path.join(dir,symbol.toLowerCase()+'.json'),'utf8'));assert.equal(data.observations[0].fetchedAt,'2026-10-10T04:00:00Z');
 });
});

test('补充采集Mock：预算、402/429及网络异常不重试，失败不覆盖，测试强制隔离',async()=>{
 for(const failure of [402,429,'network','invalid'])await workspace(async dir=>{
  const symbol='NBI',old=fixture.daily(symbol);old.observations.pop();await atomicJson(path.join(dir,'nbi.json'),old);const before=await fs.readFile(path.join(dir,'nbi.json'),'utf8');
  let calls=0;const mock=async()=>{calls++;if(failure==='network')throw Error('network');return new Response(failure==='invalid'?'invalid':fixture.dailyCsv(symbol),{status:typeof failure==='number'?failure:200});};
  await assert.rejects(()=>collectExtra({dir,symbol,now,testMode:true,fetchImpl:mock}));assert.equal(calls,1);assert.equal(await fs.readFile(path.join(dir,'nbi.json'),'utf8'),before);
  await atomicJson(path.join(dir,'nbi-requests.json'),{version:1,days:{'2026-10-15':{requests:2,events:[]}}});await assert.rejects(()=>collectExtra({dir,symbol,now,testMode:true,fetchImpl:mock}),/预算/);assert.equal(calls,1);
 });
 await assert.rejects(()=>collectExtra({symbol:'NBI',testMode:true}),/Mock/);await assert.rejects(()=>collectExtra({symbol:'NBI'}),/Mock/);await assert.rejects(()=>collectExtra({symbol:'XAUUSD'}),/只支持/);
});


test('Brent伦敦工作日延迟：严格2/3日边界、周末、英国节假日及跨年；不套用NYSE日历',()=>{
 assert.equal(core.brentBusinessDayLag('2026-10-12','2026-10-14'),2);
 assert.equal(core.brentBusinessDayLag('2026-10-09','2026-10-14'),3);
 assert.equal(core.brentBusinessDayLag('2026-10-06','2026-10-14'),6);
 assert.equal(core.brentBusinessDayLag('2026-09-04','2026-09-07'),1,'美国劳动节，伦敦有报价');
 assert.equal(core.brentBusinessDayLag('2026-08-28','2026-09-02'),2,'英国夏季银行假日不计入');
 assert.equal(core.brentBusinessDayLag('2026-04-02','2026-04-08'),2,'耶稣受难日与复活节周一不计入');
 assert.equal(core.brentBusinessDayLag('2026-12-24','2026-12-30'),2,'圣诞及节礼日补休日不计入');
 assert.equal(core.brentBusinessDayLag('2027-12-24','2027-12-30'),2);
 assert.equal(core.brentBusinessDayLag('2027-12-31','2028-01-05'),2,'元旦周末顺延，不用美股周五补休');
 assert.equal(core.brentBusinessDayLag('2026-10-14','2026-10-14'),0);
 for(const [a,b] of [['bad','2026-10-14'],['2026-10-15','2026-10-14'],['2028-12-29','2029-01-02']])assert.equal(core.brentBusinessDayLag(a,b),null);
 const data=fixture.daily('BRENT'),before=JSON.stringify(data);core.brentBusinessDayLag('2026-10-12','2026-10-14');assert.equal(JSON.stringify(data),before,'提示逻辑不改写行情或涨跌幅');
});
