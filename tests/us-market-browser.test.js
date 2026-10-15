'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = require('../scripts/serve-local');
const { atomicJson } = require('../scripts/collect-us-market');
const core = require('../tools/us-market/market-core');
const fixture = require('./us-market-fixtures');
const MAP='monster-slayer-kit:us-market:mappings:v1';
const root=path.resolve(__dirname,'..');
async function setup(run, basePath='', contextOptions={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'us-market-browser-'));
  await fs.mkdir(path.join(dir,'snapshots'));
  for(const date of ['2026-10-13','2026-10-14'])await atomicJson(path.join(dir,'snapshots',date+'.json'),fixture.snapshot(date));
  await atomicJson(path.join(dir,'manifest.json'),{version:1,dates:['2026-10-14','2026-10-13'],latest:'2026-10-14'});
  await atomicJson(path.join(dir,'status.json'),{version:1,lastAttempt:{success:true,date:'2026-10-14'}});
  await atomicJson(path.join(dir,'sox.json'),fixture.sox());
  for(const symbol of ['NBI','BRENT'])await atomicJson(path.join(dir,symbol.toLowerCase()+'.json'),fixture.daily(symbol));
  const server=createServer({root,dataDir:dir,basePath});
  let nextVersion=false; const localDataRequests=[];
  const original=server.listeners('request')[0];server.removeAllListeners('request');
  server.on('request',async(req,res)=>{
    if(req.url.includes('/local-data/us-market/'))localDataRequests.push(req.url);
    if(req.url.split('?')[0]===basePath+'/sw.js'){
      const source=await fs.readFile(path.join(root,'sw.js'),'utf8');
      res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'}).end(source.replace(/const APP_VERSION = '[^']+';/,`const APP_VERSION = '${nextVersion?'v1.4.0-test':'v1.3.0-test'}';`));return;
    }
    original(req,res);
  });
  // Windows can allocate an ephemeral port blocked by Chromium (observed: 5061).
  const blockedPorts=new Set([1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
  for(let attempt=0;;attempt++){
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=server.address().port;if(port>=1024&&!blockedPorts.has(port))break;
    await new Promise(resolve=>server.close(resolve));if(attempt>=9)throw Error('未能分配浏览器可用的测试端口');
  }
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,...contextOptions});
    let forbidden=0,commodityHandler=null; const commodityRequests=[];
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).hostname==='futsseapi.eastmoney.com'){
        commodityRequests.push(route.request().url());
        return commodityHandler?commodityHandler(route):route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture.commodities())});
      }
      if(new URL(route.request().url()).hostname!=='127.0.0.1'){forbidden++;return route.abort();}return route.continue();
    });
    const origin='http://127.0.0.1:'+server.address().port+basePath;
    const page=await context.newPage(), errors=[],consoleErrors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await run({page,context,origin,dir,consoleErrors,commodityRequests,localDataRequests,setCommodityMock:handler=>{commodityHandler=handler;},upgrade:()=>{nextVersion=true;}});
    assert.deepEqual(errors,[]);assert.equal(forbidden,0,'browser must not call any real external API; Eastmoney is fulfilled by Mock');
    await context.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
}
async function ready(page,origin){await page.goto(origin+'/tools/us-market/');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state!=='loading');}
async function layout(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const small=await page.locator('input,select').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&parseFloat(getComputedStyle(n).fontSize)<16&&n.id!=='history-date').map(n=>n.id));assert.deepEqual(small,[]);}
test('Mock真实浏览器：涨跌分组、5种模式、历史切换、手机/桌面布局、无外部请求', {timeout:120000},async()=>setup(async({page,origin,consoleErrors})=>{
  await ready(page,origin); const data=fixture.snapshot();
  assert.equal(await page.locator('button[data-kind="sector"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#market-board .market-row').count(),11);
  assert.match(await page.locator('.source-basis').textContent(),/FMP交易所行业平均涨跌幅/);
  assert.equal(await page.locator('#focus-strip .focus-button').count(),6);
  for(const kind of ['sector','industry'])for(const exchange of kind==='sector'?['NASDAQ','NYSE']:['both','NASDAQ','NYSE']){
    await page.locator('[data-kind="'+kind+'"]').click();await page.locator('button[data-exchange="'+exchange+'"]').click();
    const expected=core.rank(data.datasets[kind],exchange,kind==='sector'?Infinity:5);
    for(const side of ['up','down','flat']){
      const actual=await page.locator('#'+side+'-list .market-row').evaluateAll(rows=>rows.map(r=>({name:r.dataset.name,exchange:r.dataset.exchange,change:Number(r.dataset.change)})));
      assert.deepEqual(actual,kind==='industry'&&side==='flat'?expected.flat.slice(0,5):expected[side]);
    }
  }
  assert.equal(await page.locator('#market-board .etf-tags').count(),0);
  assert.equal(await page.locator('#indices .index-change').first().textContent(),'+10.00%');
  for(const width of [320,375,390,430,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const kind of ['sector','industry']){
      await page.locator('[data-kind="'+kind+'"]').click();await layout(page);
      const up=await page.locator('.up-board').boundingBox(),down=await page.locator('.down-board').boundingBox();
      assert.ok(down.y>=up.y+up.height-1,'上涨和下跌始终上下排列');
      if(kind==='sector')assert.equal(await page.locator('#market-board .market-row').count(),11);
      if(process.env.MARKET_SCREENSHOT_DIR&&(width===390||width===1440)){
        await fs.mkdir(process.env.MARKET_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.MARKET_SCREENSHOT_DIR,'market-mock-'+kind+'-'+width+'.png'),fullPage:true});
      }
    }
  }
  await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');assert.match(await page.locator('#data-status').textContent(),/历史快照/);
  await page.locator('#history-date').selectOption('2026-10-14');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');
  assert.deepEqual(consoleErrors,[]);
}));

test('详情共用本机映射：增删编辑立即同步、刷新恢复、旧数据保护', {timeout:120000},async()=>setup(async({page,origin})=>{
  await ready(page,origin);await page.evaluate(()=>{localStorage.setItem('unrelated','keep');localStorage.setItem('monster-slayer-kit:atr-plans:v1','preserve-atr');});
  await page.locator('button[data-kind="industry"]').click();await page.locator('button[data-exchange="NASDAQ"]').click();
  const row=page.locator('#up-list .market-row[data-name="Semiconductors"] .row-button');
  await row.click();assert.match(await page.locator('#detail-etfs').textContent(),/半导体ETF/);
  assert.equal(await page.locator('#detail-original').textContent(),'Semiconductors');assert.equal(await page.locator('#detail-exchange').textContent(),'NASDAQ');
  await page.locator('#detail-edit summary').click();assert.equal(await page.locator('#edit-name').inputValue(),'Semiconductors');
  assert.equal(await page.locator('#mapping-form').count(),1);
  await page.locator('#edit-zh').fill('自定义半导体');await page.locator('#edit-etfs .etf-editor-row button').first().click();
  await page.locator('#add-etf').click();await page.locator('#edit-etfs input').last().fill('自定义观察方向');await page.locator('#save-mapping').click();
  assert.match(await page.locator('#mapping-message').textContent(),/已保存/);
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),MAP);assert.equal(saved.entries['industry|Semiconductors'].etfs.length,2);
  assert.deepEqual(saved.entries['industry|Semiconductors'].etfs[1],{id:'custom',relation:'direct',name:'自定义观察方向'});
  assert.equal(await page.locator('#detail-title').textContent(),'自定义半导体');assert.match(await page.locator('#detail-etfs').textContent(),/自定义观察方向/);
  assert.equal(await page.locator('#detail-etfs .etf-tag').last().locator('code').count(),0);
  await page.locator('#close-detail').click();assert.match(await row.textContent(),/自定义半导体/);assert.doesNotMatch(await row.textContent(),/自定义观察方向|ETF/);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');
  await page.locator('button[data-kind="industry"]').click();await page.locator('button[data-exchange="NASDAQ"]').click();await row.click();
  assert.equal(await page.locator('#detail-title').textContent(),'自定义半导体');assert.match(await page.locator('#detail-etfs').textContent(),/自定义观察方向/);
  await page.locator('#detail-edit summary').click();assert.equal(await page.locator('#edit-zh').inputValue(),'自定义半导体');
  await page.locator('#reset-mapping').click();assert.equal(await page.locator('#edit-zh').inputValue(),'半导体');assert.equal(await page.locator('#detail-title').textContent(),'半导体');assert.doesNotMatch(await page.locator('#detail-etfs').textContent(),/自定义观察方向/);
  await page.keyboard.press('Escape');await page.locator('#industry-detail').waitFor({state:'hidden'});
  await page.locator('#mapping-panel summary').click();assert.equal(await page.locator('#mapping-panel #mapping-form').count(),1);
  assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('unrelated'),localStorage.getItem('monster-slayer-kit:atr-plans:v1')]),['keep','preserve-atr']);
  await page.evaluate(key=>localStorage.setItem(key,'{"version":999,"entries":{}}'),MAP);await page.reload();await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');
  await page.locator('#mapping-panel summary').click();assert.equal(await page.locator('#save-mapping').isDisabled(),true);assert.equal(await page.evaluate(key=>localStorage.getItem(key),MAP),'{"version":999,"entries":{}}');
}));

test('异常/过期/未知分类和缺日：不采用无效数据、不伪造历史', {timeout:120000},async()=>setup(async({page,origin,dir})=>{
  const data=fixture.snapshot();data.datasets.industry.find(r=>r.name==='New Untranslated Industry'&&r.exchange==='NASDAQ').change=100;
  await atomicJson(path.join(dir,'snapshots/2026-10-14.json'),data);
  await atomicJson(path.join(dir,'status.json'),{version:1,lastAttempt:{success:false,date:'2026-10-15',message:'HTTP 429'}});
  await ready(page,origin);await page.locator('button[data-kind="industry"]').click();assert.match(await page.locator('#up-list').textContent(),/未译行业/);assert.match(await page.locator('#up-list').textContent(),/New Untranslated Industry/);await page.locator('#up-list .market-row').first().locator('button').click();assert.match(await page.locator('#detail-etfs').textContent(),/暂无对应ETF/);await page.locator('#close-detail').click();assert.match(await page.locator('#data-status').textContent(),/数据过期.*采集失败/);
  await atomicJson(path.join(dir,'manifest.json'),{version:1,dates:['2026-09-07'],latest:'2026-09-07'});await page.reload();await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');assert.match(await page.locator('#data-status').textContent(),/保存副本/);assert.equal(await page.locator('#history-date option[value="2026-09-07"]').count(),0);
}));
test('根路径和子路径PWA：手动更新仅刷新一次、离线可读、数据保留', {timeout:120000},async()=>{
  for(const basePath of ['','/preview'])await setup(async({page,context,origin,upgrade})=>{
    await ready(page,origin);await page.evaluate(async()=>{await navigator.serviceWorker.ready;localStorage.setItem('unrelated','keep');await caches.open('unrelated-cache');});
    await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);assert.equal(await page.locator('#pwa-update').isVisible(),false);
    await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');await page.locator('#history-date').selectOption('2026-10-14');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');
    upgrade();await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
    await page.locator('#pwa-update button').waitFor({state:'visible'});assert.equal(await page.locator('[data-app-version]').textContent(),'要你命3000 · v1.3.0-test');
    let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
    await page.locator('#pwa-update button').click();await page.waitForFunction(()=>document.querySelector('[data-app-version]').textContent.includes('v1.4.0-test'));
    assert.equal(navigations,1);assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated')),'keep');assert.ok(await page.evaluate(async()=>(await caches.keys()).includes('unrelated-cache')));
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');assert.match(await page.locator('#data-status').textContent(),/保存副本/);assert.equal(await page.locator('.index-tile[data-symbol="SOX"] .index-change').textContent(),'-5.00%');assert.equal(await page.locator('.index-tile[data-symbol="NBI"] .index-point').textContent(),'105.00');assert.equal(await page.locator('.index-tile[data-symbol="B00Y"] .index-point').textContent(),'90.00');
    await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');
    await context.setOffline(false);
    const cacheNames=await page.evaluate(async()=>caches.keys());assert.equal(cacheNames.filter(n=>n.includes('monster-slayer-kit:')).length,1);
  },basePath);
});
test('本地服务不暴露密钥配置、采集脚本、日志或Git目录', {timeout:120000},async()=>setup(async({origin})=>{
  for(const file of ['/.env','/.git/config','/scripts/collect-us-market.js','/local-data/us-market/requests.json','/local-data/us-market/sox-requests.json','/local-data/us-market/nbi-requests.json','/local-data/us-market/brent-requests.json','/local-data/us-market/dev7-source-requests.json','/local-data/us-market/dev8-source-requests.json','/local-data/us-market/protected-files.json','/tests/us-market-fixtures.js'])assert.equal((await fetch(origin+file)).status,404,file);
  assert.equal((await fetch(origin+'/tools/us-market/mappings.json')).status,200);
}));

test('大行业下钻：真实相关分类、交易所身份、筛选清除与返回总览', {timeout:120000},async()=>setup(async({page,origin})=>{
  await ready(page,origin);
  await page.locator('.market-row[data-name="Healthcare"] button').click();assert.match(await page.locator('#detail-industries').textContent(),/生物科技/);await page.locator('#detail-related').click();
  assert.equal(await page.locator('#related-filter').inputValue(),'Healthcare');
  assert.equal(await page.locator('button[data-kind="industry"]').getAttribute('aria-pressed'),'true');
  const config=JSON.parse(await fs.readFile(path.join(root,'tools/us-market/mappings.json'),'utf8'));
  for(const exchange of ['NASDAQ','NYSE','both']){
    await page.locator('button[data-exchange="'+exchange+'"]').click();
    const expected=core.rank(core.relatedIndustries(fixture.snapshot().datasets.industry,'Healthcare',config.industry),exchange);
    for(const side of ['up','down'])assert.deepEqual(await page.locator('#'+side+'-list .market-row').evaluateAll(rows=>rows.map(r=>({name:r.dataset.name,exchange:r.dataset.exchange,change:Number(r.dataset.change)}))),expected[side]);
  }
  await page.locator('#related-filter').selectOption('Technology');assert.match(await page.locator('#scope-label').textContent(),/信息科技相关细分/);
  await page.locator('#related-filter').selectOption('');assert.match(await page.locator('#breadth').textContent(),/16 条/);
  await page.locator('#back-overview').click();assert.equal(await page.locator('#market-board .market-row').count(),11);
  await page.getByRole('button',{name:'查看科技相关细分行业',exact:true}).click();assert.equal(await page.locator('#related-filter').inputValue(),'Technology');
  await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');assert.equal(await page.locator('#related-filter').inputValue(),'Technology');
}));
test('上下分组含持平：最深跌幅优先、统一左起比例尺、主榜精简、整行可访问详情', {timeout:120000},async()=>setup(async({page,origin,dir})=>{
  const data=fixture.snapshot();data.datasets.sector.find(r=>r.exchange==='NASDAQ'&&r.name==='Utilities').change=0;
  await atomicJson(path.join(dir,'snapshots/2026-10-14.json'),data);await ready(page,origin);
  const expected=core.rank(data.datasets.sector,'NASDAQ',Infinity);
  assert.match(await page.locator('#breadth').textContent(),/涨 3 \/ 跌 7 \/ 平 1/);
  assert.equal(await page.locator('#flat-group').isVisible(),true);assert.equal(await page.locator('#flat-list .market-row').count(),1);
  const values=await page.locator('#down-list .market-row').evaluateAll(rows=>rows.map(r=>Number(r.dataset.change)));
  assert.deepEqual(values,[...values].sort((a,b)=>a-b));assert.ok(values[0]<values.at(-1));
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});await layout(page);
    const rows=await page.locator('#market-board .market-row').evaluateAll(nodes=>nodes.map(r=>{
      const b=r.querySelector('.change-bar').getBoundingClientRect(),f=r.querySelector('.bar-fill').getBoundingClientRect();
      const n=r.querySelector('.row-name').getBoundingClientRect(),p=r.querySelector('.row-change').getBoundingClientRect();
      return {change:Number(r.dataset.change),bar:{left:b.left,width:b.width},fill:{left:f.left,width:f.width},nameCenter:(n.top+n.bottom)/2,percentCenter:(p.top+p.bottom)/2,color:getComputedStyle(r.querySelector('.bar-fill')).backgroundColor};
    }));
    const max=Math.max(...[...expected.up,...expected.down].map(r=>Math.abs(r.change)));
    for(const r of rows){
      assert.ok(Math.abs(r.nameCenter-r.percentCenter)<3,'名称与涨跌幅同一行');
      assert.ok(Math.abs(r.fill.width/r.bar.width-Math.abs(r.change)/max)<0.005,'两组使用同一实际像素比例尺');
      assert.ok(Math.abs(r.fill.left-r.bar.left)<1.1,'所有条形从左向右');
      if(r.change)assert.equal(r.color,r.change>0?'rgb(176, 62, 57)':'rgb(20, 122, 85)');
    }
    if(width>700)assert.ok((await page.locator('#market-board').boundingBox()).height<620,'11行桌面榜单紧凑');
    assert.equal(await page.locator('#market-board .etf-tags').count(),0);
    assert.doesNotMatch(await page.locator('#market-board').textContent(),/ETF|直接行业对应|间接关联/);
    const row=page.locator('#up-list .market-row').first().locator('button');
    await row.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#industry-detail').isVisible(),true);await layout(page);
    assert.equal(await page.locator('#detail-title').textContent(),'可选消费');assert.ok(await page.locator('#detail-etfs code').count()>0);
    await page.locator('#detail-edit summary').click();await layout(page);await page.keyboard.press('Escape');
  }
}));

test('速览和完整榜单随交易所同步，现有科创50关联仍为间接', {timeout:120000},async()=>setup(async({page,origin})=>{
  await ready(page,origin);const data=fixture.snapshot();
  const focusNames=['Technology','Healthcare','Consumer Cyclical','Consumer Defensive','Energy','Financial Services'];
  for(const exchange of ['NASDAQ','NYSE']){
    await page.locator('button[data-exchange="'+exchange+'"]').click();
    const values=await page.locator('#focus-strip .focus-button strong').allTextContents();
    assert.deepEqual(values,focusNames.map(name=>core.percent(data.datasets.sector.find(r=>r.name===name&&r.exchange===exchange).change)));
    assert.ok((await page.locator('#market-board .market-row').evaluateAll(rows=>rows.map(r=>r.dataset.exchange))).every(e=>e===exchange));
    assert.equal(await page.locator('#market-board .market-row').count(),11);
  }
  await page.locator('#market-board .market-row[data-name="Technology"] button').click();assert.match(await page.locator('#detail-etfs').textContent(),/588000.*间接关联/);
}));


test('浅色主题复用首页及计算器变量、卡片、字体及选中态', {timeout:120000},async()=>setup(async({page,origin})=>{
  // The unchanged currency calculator also uses a local Mock in this style comparison.
  await page.route('https://api.frankfurter.dev/**',route=>{
    const base=route.request().url().includes('/JPY/')?'JPY':'USD';
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({date:'2026-10-14',base,quote:'CNY',rate:base==='JPY'?0.05:7})});
  });
  await page.goto(origin+'/');
  const design=await page.locator('.tool-card').first().evaluate(n=>{const c=getComputedStyle(n),b=getComputedStyle(document.body);return {background:c.backgroundColor,border:c.borderColor,radius:c.borderRadius,font:b.fontFamily,canvas:b.backgroundColor};});
  for(const url of ['/tools/change-calculator/','/tools/currency-converter/','/tools/atr-calculator/']){
    await page.goto(origin+url);assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),design.canvas);
  }
  await ready(page,origin);
  const market=await page.locator('#indices').evaluate(n=>{const c=getComputedStyle(n),b=getComputedStyle(document.body);return {background:c.backgroundColor,border:c.borderColor,radius:c.borderRadius,font:b.fontFamily,canvas:b.backgroundColor};});
  assert.deepEqual(market,design);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
  const selected=await page.locator('button[data-kind="sector"]').evaluate(n=>{const c=getComputedStyle(n);return [c.color,c.borderColor,c.backgroundColor];});
  assert.deepEqual(selected,['rgb(45, 95, 210)','rgb(45, 95, 210)','rgb(234, 240, 255)']);
}));

test('旧本机映射优先、多页面同步、保存失败不覆盖，始终只有一份映射', {timeout:120000},async()=>setup(async({page,context,origin})=>{
  const original={version:1,entries:{'sector|Technology':{zh:'我的科技',etfs:[{id:'custom',name:'我的科技方向',relation:'indirect'}]},'industry|Semiconductors':{zh:'保留半导体',etfs:[]}}};
  await page.goto(origin+'/');await page.evaluate(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key:MAP,data:original});
  await ready(page,origin);await page.locator('#market-board .market-row[data-name="Technology"] button').click();
  assert.equal(await page.locator('#detail-title').textContent(),'我的科技');assert.match(await page.locator('#detail-etfs').textContent(),/我的科技方向.*间接关联/);
  assert.doesNotMatch(await page.locator('#detail-etfs').textContent(),/588000/);
  const other=await context.newPage();await other.goto(origin+'/');
  const changed=structuredClone(original);changed.entries['sector|Technology']={zh:'另一页面科技',etfs:[]};
  await other.evaluate(({key,data})=>localStorage.setItem(key,JSON.stringify(data)),{key:MAP,data:changed});
  await page.waitForFunction(()=>document.querySelector('#detail-title').textContent==='另一页面科技');
  assert.equal(await page.locator('#edit-name').inputValue(),'Technology');assert.equal(await page.locator('#edit-kind').inputValue(),'sector');
  assert.match(await page.locator('#detail-etfs').textContent(),/暂无对应ETF/);
  await page.locator('#detail-edit summary').click();await page.locator('#edit-zh').fill('不能保存的科技');
  await page.evaluate(key=>{const native=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('full','QuotaExceededError');return native.call(this,k,v);};},MAP);
  await page.locator('#save-mapping').click();assert.match(await page.locator('#mapping-message').textContent(),/未能保存/);
  assert.equal(await page.locator('#detail-title').textContent(),'另一页面科技');
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),MAP),changed);
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('us-market:mappings'))),[MAP]);
  assert.equal(await page.locator('#mapping-form').count(),1);await other.close();
}));


test('六指标卡片：百分比优先、单位正确、桌面6列手机2×3、历史日期对应', {timeout:120000},async()=>setup(async({page,origin,consoleErrors})=>{
  await ready(page,origin);
  assert.equal(await page.locator('#indices .index-tile').count(),6);
  const sox=page.locator('.index-tile[data-symbol="SOX"]');
  assert.deepEqual((await page.locator('.index-meta').allTextContents()).slice(0,4),['','','','']);assert.equal(await page.locator('.index-delay').count(),0);assert.doesNotMatch((await page.locator('.index-tile').allTextContents()).slice(0,4).join(''),/FMP|FRED|2026-10/);
  assert.equal(await sox.locator('.index-change').textContent(),'-5.00%');assert.equal(await sox.locator('.index-close').textContent(),'9,500.00');
  assert.match(await sox.getAttribute('title'),/Philadelphia Semiconductor Index.*SOX.*Nasdaq via FRED.*2026-10-14.*2026-10-13.*获取时间/);
  assert.match(await page.locator('#indices-note').textContent(),/FMP（标普\/纳指）.*FRED\/Nasdaq.*SOX.*NBI.*Copyright © 2025, NASDAQ, Inc\..*东方财富/);
  for(const width of [320,375,390,430,700,768,1440]){
    await page.setViewportSize({width,height:900});await layout(page);
    const columns=await page.locator('#indices').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length);assert.equal(columns,width<=1000?2:6);
    const cards=await page.locator('.index-tile').evaluateAll(nodes=>nodes.map(n=>{
      const r=n.getBoundingClientRect(),p=n.querySelector('.index-change'),q=n.querySelector('.index-close'),name=n.querySelector('.index-name'),ps=getComputedStyle(p),qs=getComputedStyle(q),ns=getComputedStyle(n);
      const text=document.createRange();text.selectNodeContents(name);const nr=text.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,primarySize:parseFloat(ps.fontSize),primaryWeight:Number(ps.fontWeight),secondarySize:parseFloat(qs.fontSize),variant:ps.fontVariantNumeric,primaryColor:ps.color,pointColor:qs.color,percent:p.textContent,pY:p.getBoundingClientRect().y,pointY:q.getBoundingClientRect().y,padding:ns.padding,nameWidth:nr.width,contentWidth:n.clientWidth-parseFloat(ns.paddingLeft)-parseFloat(ns.paddingRight)};
    }));
    for(const c of cards){assert.ok(Math.abs(c.width-cards[0].width)<1);assert.ok(Math.abs(c.height-cards[0].height)<1);assert.ok(c.primarySize>=26&&c.primarySize<=30);assert.ok(c.primaryWeight>=700);assert.ok(c.secondarySize>=14&&c.secondarySize<=16);assert.match(c.variant,/tabular-nums/);assert.ok(c.pY<c.pointY);assert.equal(c.padding,cards[0].padding);assert.ok(c.nameWidth<=c.contentWidth+1,'名称与SOX代码不溢出');assert.equal(c.primaryColor,c.percent==='暂无数据'?'rgb(104, 117, 139)':c.percent.startsWith('-')?'rgb(20, 122, 85)':'rgb(176, 62, 57)');assert.equal(c.pointColor,'rgb(104, 117, 139)');}
    assert.equal(cards[0].y,cards[1].y);assert.ok(width<=1000?cards[2].y>cards[0].y&&cards[4].y>cards[2].y:cards.every(c=>c.y===cards[0].y));
  }
  await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');
  assert.equal(await sox.locator('.index-close').textContent(),'10,000.00');assert.equal(await sox.locator('.index-change').textContent(),'+11.11%');assert.equal(await sox.locator('.index-meta').textContent(),'');assert.equal(await sox.locator('.index-delay').count(),0);
  assert.deepEqual(consoleErrors,[]);
}));

test('SOX缺失、更新滞后及前收盘缺失：不伪造、不跨日冒充、FMP数据不受影响', {timeout:120000},async()=>{
  for(const mode of ['missing','stale','incomplete'])await setup(async({page,origin,dir})=>{
    if(mode==='missing')await fs.unlink(path.join(dir,'sox.json'));
    else {const data=fixture.sox();data.observations=data.observations.filter(r=>r.date!==(mode==='stale'?'2026-10-14':'2026-10-13'));await atomicJson(path.join(dir,'sox.json'),data);}
    await ready(page,origin);const sox=page.locator('.index-tile[data-symbol="SOX"]');
    assert.equal(await page.locator('#indices .index-tile').count(),6);assert.equal(await page.locator('.index-tile[data-symbol="^GSPC"] .index-change').textContent(),'+10.00%');
    if(mode==='stale'){assert.equal(await sox.locator('.index-meta').textContent(),'数据延迟2026-10-13');assert.equal(await sox.locator('.index-delay').textContent(),'数据延迟');assert.equal(await sox.locator('.index-change').textContent(),'+11.11%');}
    else {assert.equal(await sox.locator('.index-change').textContent(),mode==='incomplete'?'—':'暂无数据');assert.equal(await sox.locator('.index-point').textContent(),mode==='incomplete'?'9,500.00':'—');assert.equal(await sox.locator('.index-delay').count(),0);if(mode==='incomplete')assert.match(await sox.getAttribute('title'),/缺少前一有效交易期价格/);}
    await page.setViewportSize({width:320,height:844});await layout(page);
  });
});


test('FMP指数逐项延迟、缺失和未来值隔离，历史切换自动重新判断', {timeout:120000},async()=>{
  const cases=[...Object.keys(core.ACTIVE_INDEXES).map(symbol=>({mode:'stale',symbol})),{mode:'missing',symbol:'^GSPC'},{mode:'future',symbol:'^IXIC'},{mode:'sox-future',symbol:'SOX'}];
  for(const {mode,symbol} of cases)await setup(async({page,origin,dir})=>{
    const data=fixture.snapshot();
    if(mode==='stale'||mode==='future'){
      const date=mode==='stale'?'2026-10-13':'2026-10-15';
      data.indices[data.indices.findIndex(r=>r.symbol===symbol)]=core.indexFromCloses(fixture.closes(symbol,date),symbol,date);
    } else if(mode==='missing')data.indices=data.indices.filter(r=>r.symbol!==symbol);
    else await atomicJson(path.join(dir,'sox.json'),core.parseSoxCsv('observation_date,NASDAQSOX\n2026-10-15,12000\n2026-10-16,13000\n','2026-10-17T04:00:00Z'));
    // A recent download timestamp must never turn an older trading date into current data.
    data.updatedAt='2026-10-16T04:00:00Z';await atomicJson(path.join(dir,'snapshots/2026-10-14.json'),data);
    await ready(page,origin);const card=page.locator('.index-tile[data-symbol="'+symbol+'"]');
    assert.equal(await page.locator('#market-board .market-row').count(),11);
    if(mode==='stale'){
      assert.equal(await card.locator('.index-delay').textContent(),'数据延迟');assert.equal(await card.locator('.index-meta').textContent(),'数据延迟2026-10-13');
      assert.equal(await card.locator('.index-change').textContent(),'+10.00%');
      assert.equal(await page.locator('.index-tile[data-symbol="SOX"] .index-delay').count(),0);
    }else{assert.equal(await card.locator('.index-change').textContent(),'暂无数据');assert.equal(await card.locator('.index-delay').count(),0);assert.doesNotMatch(await card.textContent(),/2026-10-15|2026-10-16/);}
    for(const [other] of Object.entries(core.ACTIVE_INDEXES))if(other!==symbol)assert.equal(await page.locator('.index-tile[data-symbol="'+other+'"] .index-change').textContent(),'+10.00%');
    await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');
    if(symbol!=='SOX'){assert.equal(await card.locator('.index-change').textContent(),'+10.00%');assert.equal(await card.locator('.index-delay').count(),0);assert.equal(await card.locator('.index-meta').textContent(),'');}
    await page.locator('#history-date').selectOption('2026-10-14');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');assert.equal(await card.locator('.index-delay').count(),mode==='stale'?1:0);
  });
});

test('延迟标签和实际日期可读，六指标手机与电脑紧凑布局', {timeout:120000},async()=>setup(async({page,origin,dir})=>{
  const data=fixture.snapshot();const symbol='^IXIC';
  const old=core.indexFromCloses([{symbol,date:'2026-10-13',close:51621.48},{symbol,date:'2026-10-12',close:51000}],symbol,'2026-10-13');
  data.indices[data.indices.findIndex(r=>r.symbol===symbol)]=old;await atomicJson(path.join(dir,'snapshots/2026-10-14.json'),data);
  const sox=fixture.sox();sox.observations.pop();await atomicJson(path.join(dir,'sox.json'),sox);await ready(page,origin);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});await layout(page);
    const boxes=await page.locator('.index-tile').evaluateAll(nodes=>nodes.map(n=>{
      const c=n.getBoundingClientRect(),p=n.querySelector('.index-point').getBoundingClientRect(),badge=n.querySelector('.index-delay'),meta=n.querySelector('.index-meta');
      const range=document.createRange();range.selectNodeContents(meta);const text=range.getBoundingClientRect();const b=badge?.getBoundingClientRect();
      return {width:c.width,height:c.height,bottom:c.bottom,pointRight:p.right,pointBottom:p.bottom,badgeLeft:b?.left,badgeTop:b?.top,badgeBottom:b?.bottom,metaTop:text.top,metaBottom:text.bottom,metaRight:text.right,cardRight:c.right,delayed:!!badge};
    }));
    for(const c of boxes){assert.ok(c.height<=100,'卡片比dev.6紧凑');assert.ok(Math.abs(c.width-boxes[0].width)<1);if(c.delayed){assert.ok(c.badgeTop>=c.pointBottom-1,'标签位于价格下方');assert.ok(c.metaTop>=c.pointBottom-1,'实际日期位于卡片底部');assert.ok(c.metaBottom<c.bottom,'两行日期在原卡片范围内');assert.ok(c.metaRight<c.cardRight);}}
    if(process.env.MARKET_SCREENSHOT_DIR){await fs.mkdir(process.env.MARKET_SCREENSHOT_DIR,{recursive:true});await page.locator('#indices').screenshot({path:path.join(process.env.MARKET_SCREENSHOT_DIR,'dev7-delayed-'+width+'.png')});}
  }
}));


test('六指标顺序及单位、独立连续期货口径，旧现货/道琼斯历史保留', {timeout:120000},async()=>setup(async({page,origin,dir})=>{
 const legacy=fixture.daily('BRENT');await page.addInitScript(data=>localStorage.setItem('monster-slayer-kit:us-market:snapshots:v1',JSON.stringify({version:1,snapshots:{},extras:{BRENT:data}})),legacy);
 await atomicJson(path.join(dir,'nbi.json'),core.parseDailyCsv('observation_date,NASDAQNBI\n2026-10-12,100\n2026-10-14,105\n','2026-10-15T04:00:00Z','NBI'));
 await ready(page,origin);
 assert.deepEqual(await page.locator('.index-tile').evaluateAll(nodes=>nodes.map(n=>n.dataset.symbol)),['^GSPC','^IXIC','SOX','NBI','GC00Y','B00Y']);
 assert.doesNotMatch(await page.locator('#indices').textContent(),/道琼斯/);
 const nbi=page.locator('.index-tile[data-symbol="NBI"]'),brent=page.locator('.index-tile[data-symbol="B00Y"]'),gold=page.locator('.index-tile[data-symbol="GC00Y"]');
 assert.equal(await nbi.locator('.index-point').textContent(),'105.00');assert.equal(await nbi.locator('.index-change').textContent(),'—');
 assert.equal(await brent.locator('.index-change').textContent(),'-10.00%');assert.equal(await gold.locator('.index-change').textContent(),'+10.00%');
 assert.equal(await brent.locator('.index-unit').textContent(),'USD/bbl');assert.equal(await gold.locator('.index-unit').textContent(),'USD/oz');
 assert.match(await brent.getAttribute('title'),/B00Y.*当月连续行情，非固定月份合约.*昨结算价/);assert.doesNotMatch(await brent.locator('.index-close').getAttribute('aria-label'),/指数|点位/);
 await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');assert.equal(await nbi.locator('.index-point').textContent(),'100.00');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('monster-slayer-kit:us-market:snapshots:v1')));assert.ok(saved.extras.NBI);assert.ok(saved.extras.BRENT);assert.equal(saved.snapshots['2026-10-14'].indices.length,3,'旧道琼斯历史原样保留');
}));


test('商品浏览器Mock：自动一次、手动刷新、防重、无轮询；股票和行业DOM保持不变', {timeout:120000},async()=>setup(async({page,origin,commodityRequests})=>{
 await page.clock.install();await ready(page,origin);assert.equal(commodityRequests.length,1);
 await page.evaluate(()=>{localStorage.setItem('calculator-existing','preserved');});
 const firstFour=await page.locator('.index-tile').evaluateAll(ns=>ns.slice(0,4).map(n=>n.innerHTML)),board=await page.locator('#market-board').innerHTML();
 const gold=page.locator('.commodity-tile[data-symbol="GC00Y"]');assert.equal(await gold.locator('.index-change').textContent(),'+10.00%');assert.match(await gold.locator('.index-meta').textContent(),/盘中延迟行情/);
 const cache=await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)));assert.equal(cache.snapshot.quotes[0].tradingDate,null);assert.ok(cache.snapshot.quotes[0].rawQuoteTime);assert.ok(cache.snapshot.fetchedAt);
 assert.equal(await page.locator('#refresh-commodities').isDisabled(),true);await page.clock.fastForward(31000);assert.equal(commodityRequests.length,1,'解锁计时器不能采集');
 await page.locator('#refresh-commodities').click();await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state!=='loading');assert.equal(commodityRequests.length,2);
 await page.clock.fastForward(600000);assert.equal(commodityRequests.length,2,'页面打开后无自动轮询');
 assert.deepEqual(await page.locator('.index-tile').evaluateAll(ns=>ns.slice(0,4).map(n=>n.innerHTML)),firstFour);assert.equal(await page.locator('#market-board').innerHTML(),board);
 const before=await gold.innerHTML();await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');assert.equal(await gold.innerHTML(),before);assert.equal(commodityRequests.length,2,'历史不请求商品');
 assert.match(await page.locator('#commodity-details').textContent(),/交易日字段未提供/);assert.equal(await page.evaluate(()=>localStorage.getItem('calculator-existing')),'preserved');
}));

test('商品浏览器Mock：加载期间禁用、并发合并，失败保留旧值并明确缓存', {timeout:120000},async()=>setup(async({page,origin,setCommodityMock,commodityRequests})=>{
 await page.clock.install();await ready(page,origin);
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot);
 await page.clock.fastForward(31000);
 let release;setCommodityMock(async route=>{await new Promise(r=>{release=r;});await route.fulfill({status:503,body:'unavailable'});});
 await page.locator('#refresh-commodities').click();await page.waitForFunction(()=>document.querySelector('#refresh-commodities').getAttribute('aria-busy')==='true');
 await page.evaluate(()=>{document.querySelector('#refresh-commodities').dispatchEvent(new Event('click'));});assert.equal(commodityRequests.length,2);
 assert.equal(await page.locator('#refresh-commodities').isDisabled(),true);release();await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state==='error');
 assert.match(await page.locator('#commodity-status').textContent(),/HTTP 503.*缓存行情/);assert.equal(await page.locator('.commodity-tile[data-status="cached"]').count(),2);
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot);assert.deepEqual(after,before);
 assert.equal(await page.locator('.commodity-tile[data-symbol="B00Y"] .index-change').textContent(),'-10.00%');
 await page.clock.fastForward(60000);assert.equal(commodityRequests.length,2,'失败不重试');
}));

test('商品浏览器Mock：缺失/时分秒/无效/未来时间保守标记，缺品种不追加请求', {timeout:120000},async()=>{
 for(const mode of ['time-only','missing-time','invalid-time','future-time','missing-symbol','wrong-basis'])await setup(async({page,origin,setCommodityMock,commodityRequests})=>{
  setCommodityMock(route=>{const data=fixture.commodities(),q=data.list.find(q=>q.dm==='GC00Y');
   if(mode==='time-only')q.utime='17:30:00';if(mode==='missing-time')delete q.utime;if(mode==='invalid-time')q.utime='25:99:99';if(mode==='future-time')q.utime=Math.floor(Date.now()/1000)+86400;
   if(mode==='missing-symbol')data.list=data.list.filter(q=>q.dm!=='B00Y');if(mode==='wrong-basis')q.zdf=1;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await ready(page,origin);assert.equal(commodityRequests.length,1);
  const gold=page.locator('.commodity-tile[data-symbol="GC00Y"]');
  if(['missing-symbol','wrong-basis'].includes(mode)){assert.equal(await gold.locator('.index-change').textContent(),'暂无数据');assert.match(await page.locator('#commodity-status').textContent(),/缺失|口径不一致/);}
  else{assert.equal(await gold.locator('.index-change').textContent(),'+10.00%');assert.equal(await gold.locator('time').count(),0);assert.match(await page.locator('#commodity-status').textContent(),/时间信息不完整/);assert.match(await gold.getAttribute('title'),/完整日期未确认/);}
 });
});

test('商品浏览器Mock：重新打开30秒防重、离线缓存、退出取消及PWA动态请求不入缓存', {timeout:120000},async()=>setup(async({page,context,origin,commodityRequests,setCommodityMock})=>{
 await page.clock.install();await ready(page,origin);await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-14');assert.equal(commodityRequests.length,1);assert.equal(await page.locator('.commodity-tile[data-status="cached"]').count(),2);
 await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('#commodity-status').textContent.includes('离线'));assert.match(await page.locator('.commodity-tile').first().textContent(),/缓存行情/);
 await page.clock.fastForward(31000);await page.locator('#refresh-commodities').click();await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state==='error');assert.equal(commodityRequests.length,1,'离线不发实际请求');
 await context.setOffline(false);await page.clock.fastForward(31000);
 let release;setCommodityMock(async route=>{await new Promise(r=>{release=r;});try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture.commodities())});}catch{}});
 await page.locator('#refresh-commodities').click();await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state==='loading');
 const last=await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await page.locator('#refresh-commodities').getAttribute('aria-busy'),'false');release();
 await page.clock.fastForward(120000);assert.equal(commodityRequests.length,2);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot),last);
 const keys=await page.evaluate(async()=>{const keys=[];for(const name of await caches.keys())for(const r of await(await caches.open(name)).keys())keys.push(r.url);return keys;});
 assert.ok(keys.some(k=>k.endsWith('/commodity-core.js')));assert.ok(keys.some(k=>k.endsWith('/commodity-ui.js')));assert.ok(keys.every(k=>!k.includes('eastmoney.com')));
}));

test('商品浏览器Mock：320—430px两列三行/桌面六列，报价时间可读无溢出', {timeout:120000},async()=>setup(async({page,origin})=>{
 await ready(page,origin);
 for(const width of [320,360,375,390,414,430,1024,1440]){
  await page.setViewportSize({width,height:900});await layout(page);
  const boxes=await page.locator('.index-tile').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,overflow:n.scrollWidth>n.clientWidth};}));
  for(const b of boxes){assert.ok(Math.abs(b.width-boxes[0].width)<1);assert.ok(Math.abs(b.height-boxes[0].height)<1);assert.ok(!b.overflow,'卡片内容不溢出 '+width);assert.ok(b.height<=100);}
  assert.equal(boxes[0].y,boxes[1].y);assert.ok(width<=1000?boxes[2].y>boxes[0].y&&boxes[4].y>boxes[2].y:boxes.every(b=>b.y===boxes[0].y));
  const meta=await page.locator('.commodity-tile .index-meta').evaluateAll(ns=>ns.map(n=>{const p=n.parentElement.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(n);const t=range.getBoundingClientRect();return {ok:t.right<=p.right&&t.bottom<=p.bottom};}));assert.ok(meta.every(m=>m.ok),'报价时间在卡片内 '+width);
  if(process.env.MARKET_SCREENSHOT_DIR&&[320,390,1440].includes(width)){await fs.mkdir(process.env.MARKET_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.MARKET_SCREENSHOT_DIR,'dev9-commodity-mock-'+width+'.png'),fullPage:true});}
 }
}));


test('最终验收：网络断连保留最后报价/原始时间，恢复联网仍明确缓存且不自动采集', {timeout:120000},async()=>setup(async({page,context,origin,commodityRequests,setCommodityMock})=>{
 await page.clock.install();await ready(page,origin);
 const original=await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot);
 await page.clock.fastForward(31000);setCommodityMock(route=>route.abort('failed'));
 await page.locator('#refresh-commodities').click();await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state==='error');
 assert.match(await page.locator('#commodity-status').textContent(),/请求失败.*缓存行情/);assert.equal(await page.locator('.commodity-tile[data-status="cached"]').count(),2);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot),original);
 await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('#commodity-status').textContent.includes('离线'));
 const count=commodityRequests.length;await context.setOffline(false);await page.clock.fastForward(60000);
 assert.equal(commodityRequests.length,count,'恢复联网不自动采集');assert.equal(await page.locator('.commodity-tile[data-status="cached"]').count(),2);
 for(const q of original.quotes){const card=page.locator('.commodity-tile[data-symbol="'+q.symbol+'"]');assert.equal(await card.locator('time').getAttribute('datetime'),q.quoteAt);assert.match(await card.textContent(),/缓存行情/);}
}));

test('最终验收：新获取的旧报价和页面久开均提示过旧，无自动行情刷新', {timeout:120000},async()=>setup(async({page,origin,commodityRequests,setCommodityMock})=>{
 await page.clock.install();setCommodityMock(route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture.commodities(Date.now()-3600000))}));
 await ready(page,origin);assert.match(await page.locator('#commodity-status').textContent(),/报价较旧，不能视为当前新行情/);
 assert.equal(await page.locator('.commodity-tile .index-warning').count(),2);assert.doesNotMatch(await page.locator('.commodity-tile').first().textContent(),/实时行情|最新行情/);
 await page.clock.fastForward(31000);setCommodityMock(route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture.commodities())}));
 await page.locator('#refresh-commodities').click();await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state!=='loading');assert.doesNotMatch(await page.locator('#commodity-status').textContent(),/报价较旧/);
 const count=commodityRequests.length;await page.clock.fastForward(11*60000);assert.match(await page.locator('#commodity-status').textContent(),/报价较旧/);assert.equal(commodityRequests.length,count,'标签变旧也不采集');
}));

test('最终验收：密集点击和30秒边界严格防重，不触发FMP/FRED或本地收盘数据重读', {timeout:120000},async()=>setup(async({page,origin,commodityRequests,localDataRequests})=>{
 const fixed=Date.parse('2026-10-15T10:00:00Z');await page.clock.install({time:fixed});await page.clock.pauseAt(fixed+1000);await ready(page,origin);
 const reads=localDataRequests.length;
 const spam=()=>page.evaluate(()=>{for(let i=0;i<50;i++)document.querySelector('#refresh-commodities').dispatchEvent(new Event('click'));});
 await spam();assert.equal(commodityRequests.length,1);await page.clock.fastForward(29999);await spam();assert.equal(commodityRequests.length,1,'29999ms仍不能再次采集');
 await page.clock.fastForward(12);await page.locator('#refresh-commodities').click();await page.waitForFunction(()=>document.querySelector('#commodity-controls').dataset.state!=='loading');await spam();assert.equal(commodityRequests.length,2);
 assert.equal(localDataRequests.length,reads,'商品刷新不重新读取股票收盘JSON');
 assert.equal(await page.locator('#updated-at').textContent(),'美股收盘数据更新：2026/10/15 12:00:00（北京时间）');
}));

test('最终验收：历史日期独立股票/商品时间，往返切换不修改报价、不请求外部接口', {timeout:120000},async()=>setup(async({page,origin,commodityRequests})=>{
 await ready(page,origin);const cards=await page.locator('.commodity-tile').evaluateAll(ns=>ns.map(n=>n.innerHTML));
 const snapshot=await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot);
 for(const date of ['2026-10-13','2026-10-14','2026-10-13']){
  await page.locator('#history-date').selectOption(date);await page.waitForFunction(date=>document.querySelector('#trading-date').textContent===date,date);
  assert.deepEqual(await page.locator('.commodity-tile').evaluateAll(ns=>ns.map(n=>n.innerHTML)),cards);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot),snapshot);
  const text=await page.locator('#commodity-status').textContent();if(date==='2026-10-13')assert.match(text,/最近一次盘中报价，不属于所选历史日/);else assert.doesNotMatch(text,/不属于所选历史日/);
  assert.match(await page.locator('#updated-at').textContent(),/^美股收盘数据更新：/);
 }
 assert.equal(commodityRequests.length,1);
 for(const width of [320,390,430,1440]){await page.setViewportSize({width,height:900});await layout(page);}
}));

test('最终验收：北京时间跨午夜/跨年，报价原日期与获取日期分开，浏览器时区不决定报价日', {timeout:120000},async()=>{
 for(const [now,quote,display,full]of [
  ['2026-10-15T16:01:00Z','2026-10-15T15:59:40Z','10-15 23:59','2026-10-15 23:59:40'],
  ['2026-10-15T16:05:00Z','2026-10-15T16:01:40Z','10-16 00:01','2026-10-16 00:01:40'],
  ['2026-12-31T16:01:00Z','2026-12-31T15:59:40Z','2026-12-31','2026-12-31 23:59:40']
 ])await setup(async({page,origin,setCommodityMock})=>{
  await page.clock.install({time:Date.parse(now)});
  setCommodityMock(route=>{const data=fixture.commodities();for(const q of data.list)if(q.dm==='GC00Y'||q.dm==='B00Y')q.utime=Date.parse(quote)/1000;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
  await ready(page,origin);
  for(const symbol of ['GC00Y','B00Y']){const card=page.locator('.commodity-tile[data-symbol="'+symbol+'"]');assert.equal(await card.locator('time').textContent(),display);assert.equal(await card.locator('time').getAttribute('datetime'),new Date(quote).toISOString());assert.ok((await card.getAttribute('title')).includes('实际报价时间：'+full+'（北京时间）'));}
  const data=await page.evaluate(()=>JSON.parse(localStorage.getItem(USCommodity.CACHE_KEY)).snapshot);assert.equal(data.quotes[0].tradingDate,null);assert.notEqual(data.fetchedAt,data.quotes[0].quoteAt);
 },'',{timezoneId:'America/Los_Angeles'});
});


test('共享行情首次加载错误：404、网络失败、损坏JSON、空清单分别明确提示，不伪造数据', {timeout:120000},async()=>{
 for(const mode of ['404','network','json','empty'])await setup(async({page,origin})=>{
  await page.route('**/local-data/us-market/manifest.json',route=>mode==='network'?route.abort('failed'):route.fulfill({status:mode==='404'?404:200,contentType:'application/json',body:mode==='json'?'bad JSON':JSON.stringify({version:1,dates:[],latest:null})}));
  await page.goto(origin+'/tools/us-market/');await page.waitForFunction(()=>document.querySelector('#data-status').textContent.startsWith('美股收盘行情不可用：'));
  const text=await page.locator('#data-status').textContent();assert.match(text,/当前设备没有有效离线副本/);assert.match(text,mode==='404'?/文件缺失.*404/:mode==='network'?/网络不可用/:mode==='json'?/JSON损坏/:/历史清单为空/);
  assert.equal(await page.locator('#trading-date').textContent(),'—');assert.equal(await page.locator('#market-board .market-row').count(),0);
 });
});
test('共享行情损坏/缺失：保留离线副本并说明原因，空清单也不能抹掉缓存', {timeout:120000},async()=>{
 for(const mode of ['404','json','empty'])await setup(async({page,origin})=>{
  await ready(page,origin);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('monster-slayer-kit:us-market:snapshots:v1')).snapshots['2026-10-14']);
  await page.route('**/local-data/us-market/manifest.json',route=>route.fulfill({status:mode==='404'?404:200,contentType:'application/json',body:mode==='json'?'bad JSON':JSON.stringify({version:1,dates:[],latest:null})}));
  await ready(page,origin);assert.match(await page.locator('#data-status').textContent(),/读取失败.*保存副本/);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('monster-slayer-kit:us-market:snapshots:v1')).snapshots['2026-10-14']),before);assert.equal(await page.locator('#market-board .market-row').count(),11);
 });
});
test('公开清单存在但快照损坏：明确错误，不将无数据冒充已保留行情', {timeout:120000},async()=>setup(async({page,origin})=>{
 await page.route('**/local-data/us-market/snapshots/2026-10-14.json',route=>route.fulfill({status:200,contentType:'application/json',body:'not json'}));
 await page.goto(origin+'/tools/us-market/');await page.waitForFunction(()=>document.querySelector('#data-status').textContent.startsWith('无法读取2026-10-14'));
 assert.match(await page.locator('#data-status').textContent(),/JSON损坏.*没有有效离线副本/);assert.equal(await page.locator('#trading-date').textContent(),'—');
 await page.locator('#history-date').selectOption('2026-10-13');await page.waitForFunction(()=>document.querySelector('#trading-date').textContent==='2026-10-13');assert.equal(await page.locator('#market-board .market-row').count(),11);
}));


test('单个补充指数文件异常：其他行情继续显示、明确原因，无副本时不冒称缓存', {timeout:120000},async()=>{
 for(const symbol of ['SOX','NBI'])await setup(async({page,origin})=>{
  await page.route('**/local-data/us-market/'+symbol.toLowerCase()+'.json',route=>route.fulfill({status:symbol==='SOX'?404:200,contentType:'application/json',body:'not json'}));
  await ready(page,origin);assert.equal(await page.locator('#trading-date').textContent(),'2026-10-14');assert.equal(await page.locator('#market-board .market-row').count(),11);
  const title=await page.locator('.index-tile[data-symbol="'+symbol+'"]').getAttribute('title');assert.match(title,/当前设备无有效副本/);assert.doesNotMatch(title,/使用已保存副本/);
  assert.match(await page.locator('#data-status').textContent(),symbol==='SOX'?/SOX：行情文件缺失.*404/:/NBI：JSON损坏/);assert.equal(await page.locator('#data-status').getAttribute('data-warning'),'true');
 });
});
