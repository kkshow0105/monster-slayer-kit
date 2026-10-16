/* Anonymous Eastmoney index quotes; never written to the close/history snapshots. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./market-core'):root.USMarket);if(typeof module==='object'&&module.exports)module.exports=api;else root.USIndexLive=api;})(typeof globalThis!=='undefined'?globalThis:this,function(market){
  'use strict';
  const CACHE_KEY='monster-slayer-kit:us-market:index-quotes:v1',COOLDOWN=30000;
  // Eastmoney's legacy 100.NDX is its Composite feed, verified against both 2026-10-13/14 IXIC closes.
  // This is NOT the Nasdaq-100. Keep the canonical application identity ^IXIC separate.
  const INSTRUMENTS={
    '^GSPC':{secid:'100.SPX',code:'SPX',name:'标普500'},
    '^IXIC':{secid:'100.NDX',code:'NDX',name:'纳斯达克'},
    SOX:{secid:'251.SOX',code:'SOX',name:'费城半导体指数'},
    NBI:{secid:'251.NBI',code:'NBI',name:'纳斯达克生物科技指数'}
  };
  function requestUrl(){
    const url=new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
    Object.entries({secids:Object.values(INSTRUMENTS).map(d=>d.secid).join(','),fields:'f12,f13,f14,f2,f3,f18,f124,f152',fltt:'2',invt:'2'}).forEach(([k,v])=>url.searchParams.set(k,v));
    return url.href; // JSON fetch only: no cb, JSONP, key, cookie or identity headers.
  }
  function normalize(row,symbol,now){
    const d=INSTRUMENTS[symbol];
    if(!row||row.f12!==d.code||row.f13!==Number(d.secid.split('.')[0])||row.f14!==d.name)throw Error(d.name+'身份不匹配');
    if(![row.f2,row.f18,row.f3,row.f124].every(n=>typeof n==='number'&&Number.isFinite(n))||row.f2<=0||row.f18<=0||!Number.isInteger(row.f124))throw Error(d.name+'价格或时间无效');
    const change=(row.f2/row.f18-1)*100;
    if(Math.abs(change-row.f3)>0.0051)throw Error(d.name+'涨跌幅与昨收不一致');
    const ms=row.f124*1000;
    if(ms<Date.UTC(2000,0,1)||ms>now+60000)throw Error(d.name+'报价时间无效或来自未来');
    const quoteAt=new Date(ms).toISOString();
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(p=>[p.type,p.value]));
    const quoteDate=parts.year+'-'+parts.month+'-'+parts.day,minutes=Number(parts.hour)*60+Number(parts.minute);
    // f124 is a timestamp, not a separate exchange-session field. Only identify regular-session quotes.
    const tradingDate=market.isTradingDay(quoteDate)&&minutes>=570&&minutes<=975?quoteDate:null;
    return{symbol,secid:d.secid,price:row.f2,previousClose:row.f18,change:row.f3,calculatedChange:change,quoteAt,quoteDate,tradingDate};
  }
  function parseResponse(body,now=Date.now()){
    const rows=body?.data?.diff;
    if(body?.rc!==0||!Array.isArray(rows)||rows.length!==4)throw Error('四指数响应缺失或格式无效');
    const quotes=Object.keys(INSTRUMENTS).map(symbol=>{
      const d=INSTRUMENTS[symbol],found=rows.filter(r=>r?.f12===d.code&&r.f13===Number(d.secid.split('.')[0]));
      if(found.length!==1)throw Error(d.name+'缺失或重复');return normalize(found[0],symbol,now);
    });
    return{version:1,source:'Eastmoney',kind:'delayed-index-quote',basis:'previousClose',fetchedAt:new Date(now).toISOString(),quotes};
  }
  function validateSnapshot(s){
    if(!s||s.version!==1||s.source!=='Eastmoney'||s.kind!=='delayed-index-quote'||s.basis!=='previousClose'||!Array.isArray(s.quotes)||s.quotes.length!==4||typeof s.fetchedAt!=='string'||!Number.isFinite(Date.parse(s.fetchedAt)))throw Error('指数缓存格式无效');
    const checked=parseResponse({rc:0,data:{diff:s.quotes.map(q=>({f12:INSTRUMENTS[q.symbol]?.code,f13:Number(q.secid?.split('.')[0]),f14:INSTRUMENTS[q.symbol]?.name,f2:q.price,f18:q.previousClose,f3:q.change,f124:Date.parse(q.quoteAt)/1000}))}},Date.parse(s.fetchedAt));
    for(const q of checked.quotes){const old=s.quotes.find(r=>r.symbol===q.symbol);if(old.secid!==q.secid||old.quoteDate!==q.quoteDate||old.tradingDate!==q.tradingDate)throw Error('指数缓存日期或身份无效');}
    return checked;
  }
  function forView(snapshot,symbol,selectedDate,latestDate,now=Date.now()){
    if(selectedDate&&selectedDate!==latestDate)return null; // Never put latest quotes into historical views.
    const q=snapshot?.quotes.find(q=>q.symbol===symbol);
    if(!q||Date.parse(q.quoteAt)>now+60000||(selectedDate&&q.quoteDate<selectedDate))return null;
    return q;
  }
  function createController({fetchImpl,storage,now=Date.now,onChange=()=>{},validateFresh=()=>{},timeout=12000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
    let snapshot=null,fromCache=false,lastAttemptAt=null,loading=false,error='',notice='',inflight=null,abort=null,deadline=null,generation=0,leaving=false,writable=true;
    function readStored(){
      try{
        const raw=storage?.getItem(CACHE_KEY);if(!raw)return;
        const data=JSON.parse(raw);
        if(data.version!==1||!(data.lastAttemptAt===null||Number.isFinite(data.lastAttemptAt))||data.lastAttemptAt>now()+60000)throw new Error('format');
        const cached=data.snapshot===null?null:validateSnapshot(data.snapshot);
        if(cached&&Date.parse(cached.fetchedAt)>now()+60000)throw new Error('future cache');
        if(cached&&(!snapshot||Date.parse(cached.fetchedAt)>Date.parse(snapshot.fetchedAt))){snapshot=cached;fromCache=true;}
        lastAttemptAt=Math.max(lastAttemptAt??-Infinity,data.lastAttemptAt??-Infinity);if(lastAttemptAt===-Infinity)lastAttemptAt=null;
      }catch{writable=false;notice='美股指数缓存无法读取，已保留原记录；本次只临时显示。';}
    }
    function persist(){
      if(!storage||!writable)return;
      try{storage.setItem(CACHE_KEY,JSON.stringify({version:1,lastAttemptAt,snapshot}));}
      catch{writable=false;notice='美股指数行情无法保存离线副本，原有其他数据未改变。';}
    }
    function read(){return{snapshot,fromCache,loading,error,notice,lastAttemptAt,remaining:lastAttemptAt===null?0:Math.max(0,COOLDOWN-(now()-lastAttemptAt)),leaving};}
    function notify(){onChange(read());}
    readStored();
    function refresh(){
      if(leaving)return Promise.resolve({skipped:'leaving'});
      if(inflight)return inflight;
      readStored();if(read().remaining>0){notify();return Promise.resolve({skipped:'cooldown'});}
      const id=++generation;lastAttemptAt=now();loading=true;error='';persist();abort=new AbortController();const signal=abort.signal;
      deadline=setTimer(()=>abort?.abort(),timeout);notify();
      inflight=Promise.resolve().then(async()=>{
        try{
          if(id!==generation||leaving)return{skipped:'cancelled'};
          const response=await fetchImpl(requestUrl(),{mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',signal});
          if(!response.ok)throw new Error('美股指数接口 HTTP '+response.status+'，未自动重试。');
          const body=await response.json();
          if(id!==generation||leaving)return{skipped:'cancelled'};
          if(signal.aborted)throw new Error('timeout');
          let fresh;try{fresh=parseResponse(body,now());validateFresh(fresh);}catch(e){throw new Error('美股指数数据校验失败：'+e.message);}
          if(snapshot&&fresh.quotes.some(q=>Date.parse(q.quoteAt)<Date.parse(snapshot.quotes.find(old=>old.symbol===q.symbol).quoteAt)))throw Error('美股指数报价倒退，保留最后有效数据');
          snapshot=fresh;fromCache=false;error='';persist();return{ok:true};
        }catch(e){
          if(id!==generation||leaving)return{skipped:'cancelled'};
          fromCache=!!snapshot;
          error=signal.aborted?'美股指数请求超时，请稍后手动刷新。':(e.message?.startsWith('美股指数')?e.message:'美股指数请求失败，请检查网络或跨域访问；未自动重试。');
          return{ok:false};
        }finally{
          if(id===generation){clearTimer(deadline);deadline=null;abort=null;loading=false;inflight=null;notify();}
        }
      });return inflight;
    }
    function cancel(message=''){
      generation++;abort?.abort();abort=null;clearTimer(deadline);deadline=null;inflight=null;loading=false;fromCache=!!snapshot;if(message)error=message;notify();
    }
    function leave(){leaving=true;cancel();}
    function resume(){leaving=false;notify();return refresh();}
    function offline(){cancel('当前离线；美股指数行情使用最后成功的缓存。');}
    return{read,refresh,leave,resume,offline};
  }
  return{CACHE_KEY,COOLDOWN,INSTRUMENTS,requestUrl,normalize,parseResponse,validateSnapshot,forView,createController};
});
