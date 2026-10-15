 'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../tools/us-market/commodity-core');
const fixture=require('./us-market-fixtures');
const NOW=Date.parse('2026-10-15T10:00:00Z');
function memory(initial){const data=new Map(Object.entries(initial||{}));return{data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
function controller(options={}){let time=NOW,calls=0,lastOptions;const storage=options.storage||memory({unrelated:'keep'});const c=core.createController({storage,now:()=>time,fetchImpl:async(url,opts)=>{calls++;lastOptions=opts;return{ok:true,json:async()=>fixture.commodities(time)};},...options});return{c,storage,calls:()=>calls,options:()=>lastOptions,advance:n=>{time+=n;}};}
function response(data=fixture.commodities(NOW)){return{ok:true,json:async()=>data};}

test('商品：单次完整列表取出末尾B00Y，昨结校验、单位、连续合约及交易日不推断',()=>{
 const data=fixture.commodities(NOW),s=core.parseResponse(data,NOW);
 assert.equal(s.source,'Eastmoney');assert.equal(s.kind,'intraday-continuous-futures');assert.equal(s.basis,'previousSettlement');
 assert.deepEqual(s.quotes.map(q=>[q.symbol,q.price,q.previousSettlement,q.change,q.unit,q.tradingDate]),[['GC00Y',110,100,10,'USD/oz',null],['B00Y',90,100,-10,'USD/bbl',null]]);
 assert.ok(data.list.findIndex(q=>q.dm==='B00Y')>20);assert.equal(s.fetchedAt,new Date(NOW).toISOString());
 assert.equal(s.quotes[0].quoteAt,new Date(NOW-600000).toISOString());assert.deepEqual(core.validateSnapshot(s),s);
 const url=new URL(core.requestUrl());assert.equal(url.searchParams.get('pageSize'),'2000');assert.equal(url.searchParams.get('pageIndex'),'0');
});
test('商品：缺失、重复、非数字、错市场和昨收/开盘涨幅混用均拒绝',()=>{
 for(const kind of ['missing','duplicate','nan','market','previousClose','amount']){
  const data=fixture.commodities(NOW),row=data.list.find(q=>q.dm==='GC00Y');
  if(kind==='missing')data.list=data.list.filter(q=>q.dm!=='B00Y');
  if(kind==='duplicate'){data.list.push({...row});data.total++;}
  if(kind==='nan')row.p='110';if(kind==='market')row.sc=112;if(kind==='previousClose')row.zdf=(row.p/row.qrspj-1)*100;if(kind==='amount')row.zde=0;
  assert.throws(()=>core.parseResponse(data,NOW),undefined,kind);
 }
 const data=fixture.commodities(NOW);data.list.find(q=>q.dm==='GC00Y').p=0;assert.throws(()=>core.parseResponse(data,NOW));
});
test('商品：百分比两位小数四舍五入容差，不能强行修正源值',()=>{
 const data=fixture.commodities(NOW),q=data.list.find(q=>q.dm==='GC00Y');Object.assign(q,{p:103.335,zjsj:100,zdf:3.34,zde:3.335});
 assert.equal(core.parseResponse(data,NOW).quotes[0].change,3.34);q.zdf=3.35;assert.throws(()=>core.parseResponse(data,NOW),/口径不一致/);
});
test('商品：完整报价时间、只有时分秒、缺失、无效日期及未来时间分开处理',()=>{
 for(const value of [NOW-1000,Math.floor((NOW-1000)/1000),String(Math.floor((NOW-1000)/1000)),new Date(NOW-1000).toISOString()])assert.equal(core.quoteTime(value,NOW).timeStatus,'complete');
 const q=core.quoteTime('17:30:10',NOW);assert.equal(q.timeStatus,'incomplete');assert.equal(q.quoteAt,null);assert.equal(q.rawQuoteTime,'17:30:10');
 for(const raw of [undefined,null,''])assert.equal(core.quoteTime(raw,NOW).timeStatus,'missing');
 for(const raw of ['2026-10-15','2026-02-30T10:00:00Z','25:10:00','n/a',NOW+120000,NaN,-1])assert.equal(core.quoteTime(raw,NOW).timeStatus,'invalid',String(raw));
});
test('商品：进入一次、并发合并、30秒防重含重新载入，无定时轮询',async()=>{
 const h=controller();const first=h.c.refresh();assert.equal(h.c.refresh(),first);assert.equal(h.c.read().loading,true);await first;
 assert.equal(h.calls(),1);assert.equal(h.c.read().fromCache,false);assert.equal(h.options().credentials,'omit');assert.equal(h.options().cache,'no-store');assert.equal(h.options().mode,'cors');
 assert.deepEqual(await h.c.refresh(),{skipped:'cooldown'});h.advance(29999);await h.c.refresh();assert.equal(h.calls(),1);
 const reload=controller({storage:h.storage});assert.equal(reload.c.read().fromCache,true);await reload.c.refresh();assert.equal(reload.calls(),0);
 h.advance(1);await h.c.refresh();assert.equal(h.calls(),2);assert.equal(h.storage.data.get('unrelated'),'keep');assert.equal(h.storage.data.size,2);
});
test('商品：HTTP402/429和网络失败不重试，失败也有预算防重',async()=>{
 for(const status of [402,429,500,'network']){
  let calls=0;const h=controller({fetchImpl:async()=>{calls++;if(status==='network')throw Error('network');return{ok:false,status};}});
  assert.deepEqual(await h.c.refresh(),{ok:false});await h.c.refresh();assert.equal(calls,1);assert.equal(h.c.read().snapshot,null);assert.equal(h.c.read().loading,false);assert.ok(h.c.read().error);
 }
});
test('商品：刷新失败保留最后成功值、报价时间和获取时间，标缓存',async()=>{
 const h=controller();await h.c.refresh();const saved=structuredClone(h.c.read().snapshot);h.advance(30000);
 const failed=controller({storage:h.storage,now:()=>NOW+30000,fetchImpl:async()=>{throw Error('network');}});await failed.c.refresh();
 assert.equal(failed.c.read().fromCache,true);assert.deepEqual(failed.c.read().snapshot,saved);
 const persisted=JSON.parse(h.storage.data.get(core.CACHE_KEY));assert.deepEqual(persisted.snapshot,saved);assert.equal(persisted.lastAttemptAt,NOW+30000);
});
test('商品：离线、页面离开取消请求，迟到响应不覆盖缓存',async()=>{
 for(const action of ['offline','leave']){
  let resolve,signal;const h=controller({fetchImpl:async(_,opts)=>{signal=opts.signal;return new Promise(r=>{resolve=r;});}});
  const p=h.c.refresh();await Promise.resolve();h.c[action]();assert.equal(signal.aborted,true);resolve(response());assert.deepEqual(await p,{skipped:'cancelled'});assert.equal(h.c.read().snapshot,null);assert.equal(h.c.read().loading,false);
  if(action==='leave'){assert.deepEqual(await h.c.refresh(),{skipped:'leaving'});assert.deepEqual(await h.c.resume(),{skipped:'cooldown'});}
 }
 const h=controller();const p=h.c.refresh();h.c.leave();await p;assert.equal(h.calls(),0,'离开早于发起网络时不得再请求');
});
test('商品：超时中止，无重试，同步fetch异常不锁死请求状态',async()=>{
 let timer,signal;const h=controller({setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{},fetchImpl:(_,opts)=>{signal=opts.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))));}});
 const p=h.c.refresh();await Promise.resolve();timer();await p;assert.equal(signal.aborted,true);assert.match(h.c.read().error,/超时/);assert.equal(h.c.read().loading,false);
 const sync=controller({fetchImpl:()=>{throw Error('sync');}});await sync.c.refresh();sync.advance(30000);assert.deepEqual(await sync.c.refresh(),{ok:false});assert.equal(sync.c.read().loading,false);
});
test('商品：不兼容或损坏的旧缓存不覆盖，其他存储完全保留',async()=>{
 for(const raw of ['bad JSON','{"version":999}',JSON.stringify({version:1,lastAttemptAt:NOW,snapshot:{bad:true}})]){
  const storage=memory({[core.CACHE_KEY]:raw,atr:'saved',mapping:'saved'}),h=controller({storage});await h.c.refresh();
  assert.equal(storage.getItem(core.CACHE_KEY),raw);assert.equal(storage.getItem('atr'),'saved');assert.equal(storage.getItem('mapping'),'saved');assert.match(h.c.read().notice,/保留原记录/);assert.ok(h.c.read().snapshot);
 }
});
test('商品：存储写失败仍可临时显示；不接受伪造时间和单位的缓存',async()=>{
 const h=controller({storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});await h.c.refresh();assert.ok(h.c.read().snapshot);assert.match(h.c.read().notice,/无法保存/);
 const data=core.parseResponse(fixture.commodities(NOW),NOW);for(const field of ['unit','quoteAt','timeStatus','tradingDate']){const bad=structuredClone(data);bad.quotes[0][field]='tampered';assert.throws(()=>core.validateSnapshot(bad));}
});
