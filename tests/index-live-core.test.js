 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../tools/us-market/index-live-core'),fixture=require('./us-market-fixtures');
const NOW=Date.parse('2026-10-16T00:30:00Z');
function store(){const data=new Map([['unrelated','keep']]);return {data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}
function response(body=fixture.indexQuotes()){return {ok:true,json:async()=>body};}
test('四指数普通JSON批量请求：固定身份、无密钥/JSONP/分页遗漏',()=>{
 const u=new URL(core.requestUrl());assert.equal(u.hostname,'push2.eastmoney.com');assert.equal(u.searchParams.get('secids'),'100.SPX,100.NDX,251.SOX,251.NBI');
 for(const k of ['cb','callback','apikey','token'])assert.equal(u.searchParams.has(k),false);
 const s=core.parseResponse(fixture.indexQuotes(),NOW);assert.deepEqual(s.quotes.map(q=>q.symbol),['^GSPC','^IXIC','SOX','NBI']);
 assert.equal(s.quotes[1].previousClose,110);assert.equal(s.quotes[1].change,-10);assert.equal(s.basis,'previousClose');assert.equal(s.kind,'delayed-index-quote');assert.deepEqual(core.validateSnapshot(s),s);
});
test('严格检查身份、昨收口径、空值、缺失、重复、时间及未来数据',()=>{
 const changes=[b=>b.rc=100,b=>b.data.diff.pop(),b=>b.data.diff[1]=b.data.diff[0],b=>b.data.diff[1].f14='纳斯达克100',b=>b.data.diff[0].f18=0,b=>b.data.diff[0].f2='121',b=>b.data.diff[0].f3=99,b=>b.data.diff[0].f124=0,b=>b.data.diff[0].f124=NOW/1000+1000];
 for(const change of changes){const b=fixture.indexQuotes();change(b);assert.throws(()=>core.parseResponse(b,NOW));}
 const s=core.parseResponse(fixture.indexQuotes(),NOW);s.quotes[0].quoteDate='2026-10-16';assert.throws(()=>core.validateSnapshot(s));
});
test('使用纽约交易时区：北京时间跨日、冬夏令时、非交易时段不假定交易日',()=>{
 for(const [at,day]of [['2026-10-15T20:00:00Z','2026-10-15'],['2026-12-01T21:00:00Z','2026-12-01']]){
  const s=core.parseResponse(fixture.indexQuotes(at),Date.parse(at)+60000);assert.equal(s.quotes[0].tradingDate,day);
 }
 const holiday=core.parseResponse(fixture.indexQuotes('2026-09-07T16:00:00Z'),NOW);assert.equal(holiday.quotes[0].tradingDate,null);
 const after=core.parseResponse(fixture.indexQuotes('2026-10-15T23:00:00Z'),NOW);assert.equal(after.quotes[0].tradingDate,null);
});
test('最新与历史隔离：不使用未来报价填历史，也不拿较早报价覆盖较新收盘',()=>{
 const s=core.parseResponse(fixture.indexQuotes(),NOW);
 assert.ok(core.forView(s,'^IXIC','2026-10-14','2026-10-14',NOW));
 assert.equal(core.forView(s,'^IXIC','2026-10-13','2026-10-14',NOW),null);
 assert.equal(core.forView(s,'^IXIC','2026-10-16','2026-10-16',NOW),null);
 assert.equal(core.forView(s,'^IXIC',null,null,Date.parse('2026-10-14T00:00Z')),null);
});
test('一次在途、跨页面30秒防重、无轮询、失败保留有效报价',async()=>{
 let time=NOW,calls=0,fail=false;const storage=store();let release;
 const c=core.createController({storage,now:()=>time,fetchImpl:async(u,o)=>{calls++;assert.equal(o.mode,'cors');assert.equal(o.credentials,'omit');if(fail)throw Error('network');await new Promise(r=>release=r);return response();}});
 const a=c.refresh(),b=c.refresh();assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);release();assert.equal((await a).ok,true);
 const original=c.read().snapshot;assert.equal((await c.refresh()).skipped,'cooldown');time+=29999;assert.equal((await c.refresh()).skipped,'cooldown');
 const reopened=core.createController({storage,now:()=>time,fetchImpl:()=>{throw Error('must not request')}});assert.equal(reopened.read().fromCache,true);assert.equal((await reopened.refresh()).skipped,'cooldown');
 time++;fail=true;assert.equal((await c.refresh()).ok,false);assert.deepEqual(c.read().snapshot,original);assert.equal(c.read().fromCache,true);assert.equal(calls,2);assert.equal(storage.data.get('unrelated'),'keep');
});
test('无效新数据和倒退报价不替换缓存；403/429不重试',async()=>{
 let time=NOW,calls=0,body=fixture.indexQuotes(),status=200;
 const c=core.createController({storage:store(),now:()=>time,fetchImpl:async()=>{calls++;return{ok:status===200,status,json:async()=>body}}});
 await c.refresh();const saved=c.read().snapshot;
 for(const mode of ['invalid','backward',403,429]){time+=30000;body=fixture.indexQuotes(mode==='backward'?'2026-10-14T20:00:00Z':undefined);status=typeof mode==='number'?mode:200;if(mode==='invalid')body.data.diff.pop();assert.equal((await c.refresh()).ok,false);assert.deepEqual(c.read().snapshot,saved);}
 assert.equal(calls,5);
});
test('页面离开、离线与超时取消请求，迟到结果不能覆盖',async()=>{
 let finish,signal,timeout;const c=core.createController({storage:store(),now:()=>NOW,setTimer:f=>{timeout=f;return 1},clearTimer:()=>{},fetchImpl:async(u,o)=>{signal=o.signal;return await new Promise(r=>finish=r)}});
 const pending=c.refresh();await Promise.resolve();c.leave();assert.equal(signal.aborted,true);finish(response());await pending;assert.equal(c.read().snapshot,null);assert.equal((await c.refresh()).skipped,'leaving');
 const resumed=c.resume();await Promise.resolve();assert.equal(resumed.skipped,undefined); // Promise resolves as cooldown, without a network request.
 assert.equal((await resumed).skipped,'cooldown');
 const d=core.createController({storage:store(),now:()=>NOW,setTimer:f=>{timeout=f;return 1},clearTimer:()=>{},fetchImpl:async(u,o)=>{signal=o.signal;return await new Promise(r=>finish=r)}});
 const p=d.refresh();await Promise.resolve();timeout();finish(response());assert.equal((await p).ok,false);assert.equal(d.read().snapshot,null);assert.match(d.read().error,/超时/);d.offline();assert.match(d.read().error,/离线/);
});
test('不兼容缓存保护原记录，写入失败仍可临时读取',async()=>{
 const storage=store();storage.setItem(core.CACHE_KEY,'{"version":999}');const before=storage.getItem(core.CACHE_KEY);
 const c=core.createController({storage,now:()=>NOW,fetchImpl:async()=>response()});await c.refresh();assert.equal(c.read().snapshot.quotes.length,4);assert.equal(storage.getItem(core.CACHE_KEY),before);assert.match(c.read().notice,/保留/);
 const d=core.createController({storage:{getItem:()=>null,setItem:()=>{throw Error('quota')}},now:()=>NOW,fetchImpl:async()=>response()});await d.refresh();assert.equal(d.read().snapshot.quotes.length,4);assert.match(d.read().notice,/无法保存/);
});

test('历史身份校验必须在替换和持久化新缓存前完成',async()=>{
 let time=NOW,reject=false;const storage=store();const c=core.createController({storage,now:()=>time,fetchImpl:async()=>response(),validateFresh:()=>{if(reject)throw Error('IXIC identity');}});
 await c.refresh();const saved=JSON.parse(storage.getItem(core.CACHE_KEY)).snapshot;time+=30000;reject=true;assert.equal((await c.refresh()).ok,false);assert.deepEqual(JSON.parse(storage.getItem(core.CACHE_KEY)).snapshot,saved);assert.equal(c.read().fromCache,true);
});
