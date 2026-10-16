/* Only the two commodity cards and their controls. Stock close/history rendering stays independent. */
(() => {
  'use strict';
  const core=window.USCommodity,$=id=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const number=n=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fullTime=s=>new Date(s).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false});
  let storage;try{storage=localStorage;}catch{storage=null;}
  let started=false,cooldownTimer=null,viewingHistory=false;
  const controller=core.createController({storage,fetchImpl:(url,options)=>navigator.onLine===false?Promise.reject(new Error('offline')):fetch(url,options),onChange:()=>update()});
  function timeText(q){
    if(q.quoteAt){const text=fullTime(q.quoteAt);return text.slice(0,4)!==fullTime(new Date().toISOString()).slice(0,4)?text.slice(0,10):text.slice(5,16);}
    return q.timeStatus==='incomplete'?q.rawQuoteTime:q.timeStatus==='invalid'?'时间异常':'时间缺失';
  }
  function description(q){
    return q.quoteAt?'实际报价时间：'+fullTime(q.quoteAt)+'（北京时间）':'时间信息不完整；原始报价时间：'+(q.rawQuoteTime??'未提供')+'；完整日期未确认';
  }
  function cards(){
    const s=controller.read();
    return Object.entries(core.INSTRUMENTS).map(([symbol,def])=>{
      const q=s.snapshot?.quotes.find(q=>q.symbol===symbol),box=el('div','index-tile commodity-tile');box.dataset.symbol=symbol;box.dataset.status=q?(s.fromCache?'cached':'intraday'):'missing';
      box.title=def.name+' · '+symbol+'；当月连续行情，非固定月份合约；来源：东方财富；相对昨结算价涨跌'
        +(q?'；昨结：'+number(q.previousSettlement)+'；'+description(q)+'；获取时间：'+fullTime(s.snapshot.fetchedAt)+'（北京时间）；交易日字段未提供，不推断；'+(s.fromCache?'缓存行情':'盘中延迟行情'):'；暂无有效报价');
      const change=el('strong','index-change '+(q?q.change>0?'positive':q.change<0?'negative':'neutral':'neutral'),q?window.USMarket.percent(q.change):'暂无数据');
      const price=el('span','index-close');price.append(el('span','index-point',q?number(q.price):'—'),el('span','index-unit',def.unit));price.setAttribute('aria-label','价格 '+(q?number(q.price):'暂无数据')+(symbol==='GC00Y'?' 美元/金衡盎司':' 美元/桶'));
      const meta=el('span','index-meta');
      if(q){const kind=el('span','commodity-kind',s.fromCache?'缓存行情':'盘中延迟行情');const stamp=el(q.quoteAt?'time':'span','commodity-time',timeText(q));if(q.quoteAt)stamp.dateTime=q.quoteAt;stamp.title=description(q);meta.append(kind,stamp);if(s.fromCache||q.timeStatus!=='complete'||Date.now()-Date.parse(q.quoteAt)>20*60000)meta.classList.add('index-warning');}
      else meta.textContent=s.loading?'正在获取…':'暂无有效盘中报价';
      box.append(el('p','index-name',def.name),change,price,meta);return box;
    });
  }
  function update(){
    const s=controller.read();cards().forEach(card=>document.querySelector('.commodity-tile[data-symbol="'+card.dataset.symbol+'"]')?.replaceWith(card));
    const button=$('refresh-commodities');if(!button)return;
    button.disabled=s.loading||s.remaining>0;button.textContent=s.loading?'正在获取商品行情…':'刷新商品行情';button.setAttribute('aria-busy',String(s.loading));
    const incomplete=s.snapshot?.quotes.some(q=>q.timeStatus!=='complete');
    const old=s.snapshot?.quotes.some(q=>q.quoteAt&&Date.now()-Date.parse(q.quoteAt)>20*60000);
    const scope=viewingHistory?'商品为最近一次盘中报价，不属于所选历史日。':'盘中延迟行情独立于股票日期。';
    const message=s.loading?'正在获取黄金/原油；不刷新四个指数。':s.error||(s.snapshot?'仅更新黄金/原油；'+scope:'仅更新黄金/原油；首次进入自动获取一次。');
    const text=[message];
    if(viewingHistory&&(s.loading||s.error||!s.snapshot))text.push(scope);
    if(s.fromCache&&s.snapshot)text.push('当前显示缓存行情，报价时间见卡片。');
    if(incomplete)text.push('时间信息不完整，报价日期/新鲜度未确认。');else if(old)text.push('报价较旧，不能视为当前新行情。');
    if(!s.loading&&s.remaining>0)text.push('30秒防重，请稍后手动刷新。');if(s.notice)text.push(s.notice);
    $('commodity-status').textContent=text.join(' ');$('commodity-status').dataset.warning=String(!!(s.error||incomplete||old||s.notice));
    $('commodity-controls').dataset.state=s.loading?'loading':s.error?'error':s.remaining>0?'cooldown':'ready';
    clearTimeout(cooldownTimer);cooldownTimer=null;
    // Only update button/time labels; this timer never requests quotes.
    const nextUpdates=[s.remaining>0?s.remaining+10:Infinity];
    for(const q of s.snapshot?.quotes||[]){
      const untilOld=q.quoteAt?Date.parse(q.quoteAt)+20*60000-Date.now()+1:0;
      if(untilOld>0)nextUpdates.push(untilOld);
    }
    const nextUpdate=Math.min(...nextUpdates);
    if(!s.leaving&&Number.isFinite(nextUpdate))cooldownTimer=setTimeout(update,nextUpdate);
    const details=$('commodity-details');if(details){
      details.replaceChildren(el('p','help','商品为东方财富连续期货盘中延迟报价，涨跌幅基于昨结；不随股票历史日期切换。交易日字段未提供，不用报价日或采集日代填。'));
      for(const [symbol,def]of Object.entries(core.INSTRUMENTS)){
        const q=s.snapshot?.quotes.find(q=>q.symbol===symbol);details.append(el('p','help',def.name+' '+symbol+'：'+(q?'价格 '+number(q.price)+' '+def.unit+'；昨结 '+number(q.previousSettlement)+'；涨跌幅 '+window.USMarket.percent(q.change)+'；'+description(q)+'；获取时间：'+fullTime(s.snapshot.fetchedAt)+'（北京时间）；'+(s.fromCache?'缓存行情':'本次网络获取，仍为延迟行情'):'暂无有效盘中报价')));
      }
    }
  }
  function start(){if(started)return;started=true;update();controller.refresh();}
  $('refresh-commodities').addEventListener('click',()=>controller.refresh());
  window.addEventListener('offline',()=>controller.offline());
  window.addEventListener('pagehide',()=>{controller.leave();clearTimeout(cooldownTimer);cooldownTimer=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted&&started)controller.resume();});
  window.USCommodities={cards,start,setObservationDate:historical=>{viewingHistory=historical;update();}};
})();
