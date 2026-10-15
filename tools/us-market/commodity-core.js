/* Eastmoney intraday quotes only; independent of the stock-close/history cache. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.USCommodity=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CACHE_KEY='monster-slayer-kit:us-market:commodities:v1';
  const COOLDOWN=30000, SOURCE='Eastmoney';
  const INSTRUMENTS={
    GC00Y:{name:'COMEX黄金',market:101,unit:'USD/oz',sourceUrl:'https://quote.eastmoney.com/globalfuture/GC00Y.html'},
    B00Y:{name:'布伦特原油',market:112,unit:'USD/bbl',sourceUrl:'https://quote.eastmoney.com/globalfuture/B00Y.html'}
  };
  function requestUrl(){
    const url=new URL('https://futsseapi.eastmoney.com/list/COMEX,NYMEX,COBOT,SGX,NYBOT,LME,MDEX,TOCOM,IPE');
    // Public website selector, not a user secret or a grant of data-use rights.
    const params={orderBy:'dm',sort:'desc',pageSize:'2000',pageIndex:'0',token:'58b2fa8f54638b60b87d69b31969089c',field:'dm,sc,name,p,zsjd,zde,zdf,f152,o,h,l,zjsj,vol,wp,np,ccl,utime,qrspj,rz',blockName:'callback'};
    Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));return url.href;
  }
  function quoteTime(raw,fetchedAt){
    const value=typeof raw==='number'?(Number.isFinite(raw)?raw:String(raw)):typeof raw==='string'?raw.slice(0,80):raw==null?null:'[invalid]';
    if(value===null||value==='')return{rawQuoteTime:value,quoteAt:null,timeStatus:'missing'};
    let ms=null;
    if(typeof value==='number'&&Number.isInteger(value))ms=value<1e12?value*1000:value;
    else if(typeof value==='string'&&/^\d{10}(?:\d{3})?$/.test(value))ms=value.length===10?Number(value)*1000:Number(value);
    else if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)){
      const [year,month,day]=value.slice(0,10).split('-').map(Number),check=new Date(Date.UTC(year,month-1,day));
      if(check.getUTCFullYear()===year&&check.getUTCMonth()===month-1&&check.getUTCDate()===day)ms=Date.parse(value);
    }
    else if(typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value))return{rawQuoteTime:value,quoteAt:null,timeStatus:'incomplete'};
    if(!Number.isFinite(ms)||ms<Date.UTC(2000,0,1)||ms>fetchedAt+60000)return{rawQuoteTime:value,quoteAt:null,timeStatus:'invalid'};
    return{rawQuoteTime:value,quoteAt:new Date(ms).toISOString(),timeStatus:'complete'};
  }
  function normalize(row,symbol,now){
    const def=INSTRUMENTS[symbol];
    if(!row||row.dm!==symbol||row.sc!==def.market||![row.p,row.zjsj,row.zdf,row.zde].every(n=>typeof n==='number'&&Number.isFinite(n))||row.p<=0||row.zjsj<=0)throw new Error(def.name+'报价或昨结无效');
    const calculated=(row.p/row.zjsj-1)*100;
    if(Math.abs(calculated-row.zdf)>0.0051||Math.abs(row.p-row.zjsj-row.zde)>0.011)throw new Error(def.name+'涨跌幅与昨结口径不一致');
    return{symbol,market:def.market,unit:def.unit,price:row.p,previousSettlement:row.zjsj,change:row.zdf,calculatedChange:calculated,changeAmount:row.zde,...quoteTime(row.utime,now),tradingDate:null};
  }
  function parseResponse(data,now=Date.now()){
    if(!data||!Array.isArray(data.list)||data.list.length>2000||!Number.isInteger(data.total)||data.total<data.list.length)throw new Error('商品行情列表格式无效');
    const quotes=Object.keys(INSTRUMENTS).map(symbol=>{
      const rows=data.list.filter(r=>r?.dm===symbol);
      if(rows.length!==1)throw new Error(INSTRUMENTS[symbol].name+'缺失或重复；未追加分页请求');
      return normalize(rows[0],symbol,now);
    });
    return{version:1,source:SOURCE,kind:'intraday-continuous-futures',basis:'previousSettlement',fetchedAt:new Date(now).toISOString(),quotes};
  }
  function validateSnapshot(value){
    if(!value||value.version!==1||value.source!==SOURCE||value.kind!=='intraday-continuous-futures'||value.basis!=='previousSettlement'||!Array.isArray(value.quotes)||value.quotes.length!==2||typeof value.fetchedAt!=='string'||!Number.isFinite(Date.parse(value.fetchedAt)))throw new Error('商品缓存格式不兼容');
    const now=Date.parse(value.fetchedAt);
    if(now<Date.UTC(2000,0,1))throw new Error('商品缓存获取时间无效');
    const quotes=Object.keys(INSTRUMENTS).map(symbol=>{
      const found=value.quotes.filter(q=>q?.symbol===symbol);
      if(found.length!==1)throw new Error('商品缓存代码无效');const q=found[0];
      const checked=normalize({dm:q.symbol,sc:q.market,p:q.price,zjsj:q.previousSettlement,zdf:q.change,zde:q.changeAmount,utime:q.rawQuoteTime},symbol,now);
      if(q.unit!==checked.unit||q.tradingDate!==null||q.quoteAt!==checked.quoteAt||q.timeStatus!==checked.timeStatus)throw new Error('商品缓存时间或单位无效');
      return checked;
    });
    return{version:1,source:SOURCE,kind:value.kind,basis:value.basis,fetchedAt:value.fetchedAt,quotes};
  }
  function createController({fetchImpl,storage,now=Date.now,onChange=()=>{},timeout=12000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
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
      }catch{writable=false;notice='商品缓存无法读取，已保留原记录；本次只临时显示。';}
    }
    function persist(){
      if(!storage||!writable)return;
      try{storage.setItem(CACHE_KEY,JSON.stringify({version:1,lastAttemptAt,snapshot}));}
      catch{writable=false;notice='商品行情无法保存离线副本，原有其他数据未改变。';}
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
          if(!response.ok)throw new Error('商品接口 HTTP '+response.status+'，未自动重试。');
          const body=await response.json();
          if(id!==generation||leaving)return{skipped:'cancelled'};
          if(signal.aborted)throw new Error('timeout');
          let fresh;try{fresh=parseResponse(body,now());}catch(e){throw new Error('商品数据校验失败：'+e.message);}
          snapshot=fresh;fromCache=false;error='';persist();return{ok:true};
        }catch(e){
          if(id!==generation||leaving)return{skipped:'cancelled'};
          fromCache=!!snapshot;
          error=signal.aborted?'商品请求超时，请稍后手动刷新。':(e.message?.startsWith('商品')?e.message:'商品请求失败，请检查网络或跨域访问；未自动重试。');
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
    function offline(){cancel('当前离线；商品行情使用最后成功的缓存。');}
    return{read,refresh,leave,resume,offline};
  }
  return{CACHE_KEY,COOLDOWN,SOURCE,INSTRUMENTS,requestUrl,quoteTime,parseResponse,validateSnapshot,createController};
});
