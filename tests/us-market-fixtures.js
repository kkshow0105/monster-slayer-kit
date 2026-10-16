'use strict';
const core = require('../tools/us-market/market-core');
const sectors = ['Basic Materials','Communication Services','Consumer Cyclical','Consumer Defensive','Energy','Financial Services','Healthcare','Industrials','Real Estate','Technology','Utilities'];
const industries = ['Semiconductors','Biotechnology','Drug Manufacturers - General','Software - Application','Banks','Oil & Gas Integrated','New Untranslated Industry','Coal'];
function rows(kind, exchange, date) {
  return (kind === 'sector' ? sectors : industries).map((name, i) => ({ date, exchange, [kind]: name,
    averageChange: kind === 'sector' ? (i < (exchange === 'NYSE' ? 5 : 3) ? (i + 1) * 0.5 : -(i + 1) * 0.2) : (i === 6 ? 0 : i % 2 === 0 ? i + 0.126 : -i - 0.345) * (exchange === 'NYSE' ? 1.2 : 1) }));
}
function closes(symbol, date) { return [{ symbol, date, open: 130, close: 110, changePercent: -999 }, { symbol, date: core.previousSession(date), close: 100 }]; }
function snapshot(date = '2026-10-14') {
  return { version:1, tradingDate:date, updatedAt:'2026-10-15T04:00:00.000Z',source:'FMP',isProxy:false,
    datasets: Object.fromEntries(['sector','industry'].map(kind => [kind, core.EXCHANGES.flatMap(e => core.normalizeRows(rows(kind,e,date),kind,e,date))])),
    indices:Object.keys(core.INDEXES).map(s => core.indexFromCloses(closes(s,date),s,date)), calculation:{} };
}
function mockFetch(seen = []) {
  return async url => {
    seen.push({ endpoint:url.pathname, params:Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'apikey')) });
    const kind = url.pathname.includes('industry') ? 'industry' : 'sector';
    const data = url.pathname.endsWith('/full') ? closes(url.searchParams.get('symbol'), url.searchParams.get('to'))
      : rows(kind, url.searchParams.get('exchange'), url.searchParams.get('date'));
    return new Response(JSON.stringify(data), { status:200, headers:{'Content-Type':'application/json'} });
  };
}
function soxCsv() { return 'observation_date,NASDAQSOX\n2026-10-12,9000\n2026-10-13,10000\n2026-10-14,9500\n'; }
function sox() { return core.parseSoxCsv(soxCsv(),'2026-10-15T04:00:00.000Z'); }
function dailyCsv(symbol) { return 'observation_date,'+core.DAILY_SERIES[symbol].series+'\n2026-10-12,100\n2026-10-13,110\n2026-10-14,105\n'; }
function daily(symbol) { return core.parseDailyCsv(dailyCsv(symbol),'2026-10-15T04:00:00.000Z',symbol); }
// Deliberately synthetic: source values must never be used as formal market data.
function commodities(now=Date.now()) {
  const utime=Math.floor(now/1000)-600;
  const list=Array.from({length:24},(_,i)=>({dm:'MOCK'+i,sc:0}));
  list.splice(2,0,{dm:'GC00Y',sc:101,p:110,zjsj:100,zdf:10,zde:10,utime,qrspj:80,o:90});
  list.push({dm:'B00Y',sc:112,p:90,zjsj:100,zdf:-10,zde:-10,utime,qrspj:120,o:110});
  return {total:list.length,list};
}
function indexQuotes(at='2026-10-15T19:59:00Z') {
  // Synthetic values only; never sent to a third party or written to public-data.
  const defs=[['SPX',100,'标普500',121,110,10],['NDX',100,'纳斯达克',99,110,-10],['SOX',251,'费城半导体指数',10450,9500,10],['NBI',251,'纳斯达克生物科技指数',94.5,105,-10]];
  return {rc:0,data:{total:4,diff:defs.map(([f12,f13,f14,f2,f18,f3])=>({f12,f13,f14,f2,f18,f3,f124:Date.parse(at)/1000,f152:2}))}};
}
module.exports = { indexQuotes, commodities, rows, closes, snapshot, mockFetch, sox, soxCsv, daily, dailyCsv };
