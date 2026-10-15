 'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const fixture=require('./us-market-fixtures'),core=require('../tools/us-market/market-core');
const {syncPublic,validatePublic,loadBundle}=require('../scripts/public-market-data');
const {buildSite}=require('../scripts/build-site');
const {atomicJson}=require('../scripts/collect-us-market');
const NOW=new Date('2026-10-15T04:30:00Z'),repo=path.resolve(__dirname,'..');
async function workspace(run){const root=await fs.mkdtemp(path.join(os.tmpdir(),'public-market-'));try{await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}}
async function source(root,dates=['2026-10-14']){
 const dir=path.join(root,'private');await fs.mkdir(path.join(dir,'snapshots'),{recursive:true});
 for(const date of dates){const data=fixture.snapshot(date);data.apiKey='mock-private-never-export';data.calculation={privateSetting:'mock-private-never-export'};data.indices[0].token='mock-private-never-export';data.datasets.sector[0].account='mock-private-never-export';await atomicJson(path.join(dir,'snapshots/'+date+'.json'),data);}
 await atomicJson(path.join(dir,'manifest.json'),{version:1,dates,latest:[...dates].sort().at(-1),private:'mock-private-never-export'});
 await atomicJson(path.join(dir,'sox.json'),{...fixture.sox(),apiKey:'mock-private-never-export'});
 await atomicJson(path.join(dir,'nbi.json'),{...fixture.daily('NBI'),token:'mock-private-never-export'});
 await atomicJson(path.join(dir,'requests.json'),{secret:'mock-private-never-export'});return dir;
}
async function prepare(root,dates){const sourceDir=await source(root,dates),dir=path.join(root,'public-data/us-market');await syncPublic({sourceDir,dir,now:NOW});return {sourceDir,dir,now:NOW};}
async function app(root){
 for(const name of ['assets','tools'])await fs.cp(path.join(repo,name),path.join(root,name),{recursive:true});
 for(const name of ['index.html','sw.js','manifest.webmanifest'])await fs.copyFile(path.join(repo,name),path.join(root,name));
}
const tree=async dir=>{const out={};for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isDirectory()){for(const [name,text]of Object.entries(await tree(path.join(dir,entry.name))))out[entry.name+'/'+name]=text;}else out[entry.name]=await fs.readFile(path.join(dir,entry.name),'utf8');}return out;};

test('公开导出：白名单字段、四指数、两交易所、只一真实来源日期、原始目录不变',async()=>workspace(async root=>{
 const sourceDir=await source(root),before=await tree(sourceDir),dir=path.join(root,'public-data/us-market');
 const result=await syncPublic({sourceDir,dir,now:NOW});assert.equal(result.requests,0);assert.deepEqual(result.dates,['2026-10-14']);assert.deepEqual(result.coverage.sector,{NASDAQ:11,NYSE:11});
 const bundle=await loadBundle(dir);assert.equal(Object.keys(bundle).length,5);assert.doesNotMatch(JSON.stringify(bundle),/mock-private|apiKey|token|account|requestsToday|budget/);
 assert.deepEqual(bundle['snapshots/2026-10-14.json'].indices.map(r=>r.symbol),['^GSPC','^IXIC']);assert.deepEqual(await tree(sourceDir),before);
 await validatePublic({dir,now:NOW});assert.deepEqual(core.soxForDate(bundle['sox.json'],'2026-10-14').status,'current');assert.equal(core.dailySeriesForDate(bundle['nbi.json'],'NBI','2026-10-14').status,'current');
}));
test('公开同步：重复运行零请求不改变文件，原始缺少旧日期也不删除公开历史',async()=>workspace(async root=>{
 const opts=await prepare(root,['2026-10-13','2026-10-14']),before=await tree(opts.dir);await syncPublic(opts);assert.deepEqual(await tree(opts.dir),before);
 await atomicJson(path.join(opts.sourceDir,'manifest.json'),{version:1,dates:['2026-10-14'],latest:'2026-10-14'});await syncPublic(opts);assert.deepEqual(await tree(opts.dir),before);
 const snapshot=JSON.parse(await fs.readFile(path.join(opts.sourceDir,'snapshots/2026-10-14.json'),'utf8'));snapshot.datasets.industry[0].change+=1;await atomicJson(path.join(opts.sourceDir,'snapshots/2026-10-14.json'),snapshot);
 await assert.rejects(syncPublic(opts),/已公开历史变化/);assert.deepEqual(await tree(opts.dir),before);
}));
test('新日期同步：追加有效记录、更新清单哈希、保留旧快照字节',async()=>workspace(async root=>{
 const opts=await prepare(root,['2026-10-13']),old=await fs.readFile(path.join(opts.dir,'snapshots/2026-10-13.json'),'utf8');
 await atomicJson(path.join(opts.sourceDir,'snapshots/2026-10-14.json'),fixture.snapshot());await atomicJson(path.join(opts.sourceDir,'manifest.json'),{version:1,dates:['2026-10-14'],latest:'2026-10-14'});
 const result=await syncPublic(opts);assert.deepEqual(result.dates,['2026-10-14','2026-10-13']);assert.equal(await fs.readFile(path.join(opts.dir,'snapshots/2026-10-13.json'),'utf8'),old);await validatePublic(opts);
}));
test('部署前拒绝：无清单、缺文件、JSON损坏、休市日、重复日、指数缺失、哈希或细分数据被删改',async()=>{
 for(const kind of ['empty','file','json','holiday','duplicate','index','sox','nbi','industry','extra-field','extra-file'])await workspace(async root=>{
  const opts=await prepare(root),manifest=path.join(opts.dir,'manifest.json'),snap=path.join(opts.dir,'snapshots/2026-10-14.json');
  if(kind==='empty')await atomicJson(manifest,{version:1,dates:[],latest:null});
  if(kind==='file')await fs.unlink(snap);if(kind==='json')await fs.writeFile(snap,'bad JSON');
  if(['holiday','duplicate'].includes(kind)){const m=JSON.parse(await fs.readFile(manifest));m.dates=kind==='holiday'?['2026-09-07']:['2026-10-14','2026-10-14'];m.latest=m.dates[0];await atomicJson(manifest,m);}
  if(['index','industry','extra-field'].includes(kind)){const s=JSON.parse(await fs.readFile(snap));if(kind==='index')s.indices.pop();if(kind==='industry')s.datasets.industry.splice(0,1);if(kind==='extra-field')s.password='mock-secret';await atomicJson(snap,s);}
  if(kind==='sox')await fs.unlink(path.join(opts.dir,'sox.json'));if(kind==='nbi')await atomicJson(path.join(opts.dir,'nbi.json'),{version:1,observations:[]});
  if(kind==='extra-file')await atomicJson(path.join(opts.dir,'requests.json'),{secret:'mock'});
  await assert.rejects(validatePublic(opts),undefined,kind);
 });
});
test('构建：仅已跟踪公开输入，URL沿用local-data；普通工具改动后行情仍完整，构建不更改源数据',async()=>workspace(async root=>{
 const opts=await prepare(root);await app(root);const original=await tree(opts.dir);
 await fs.mkdir(path.join(root,'local-data'),{recursive:true});await fs.writeFile(path.join(root,'local-data','secret.txt'),'mock-secret');await fs.writeFile(path.join(root,'.env'),'mock-secret');
 const first=await buildSite({root,now:NOW});assert.equal(first.requests,0);const output=path.join(root,'dist');assert.deepEqual(await tree(path.join(output,'local-data/us-market')),original);
 for(const name of ['scripts','tests','.git','.env','local-data/secret.txt','public-data'])await assert.rejects(fs.access(path.join(output,name)));
 await fs.appendFile(path.join(root,'tools/change-calculator/calculator.js'),'\n// mock unrelated edit\n');
 await buildSite({root,now:NOW});assert.deepEqual(await tree(path.join(output,'local-data/us-market')),original);assert.deepEqual(await tree(opts.dir),original);
 const generated=await fs.readFile(path.join(output,'tools/change-calculator/calculator.js'),'utf8');assert.match(generated,/mock unrelated edit/);
 await fs.unlink(path.join(opts.dir,'nbi.json'));await assert.rejects(buildSite({root,now:NOW}));assert.deepEqual(await tree(path.join(output,'local-data/us-market')),original,'校验失败不替换上个有效部署包');
}));
test('Git规则：公开文件可跟踪，私有目录/构建产物被忽略，Netlify构建入口固定',async()=>workspace(async root=>{
 await fs.copyFile(path.join(repo,'.gitignore'),path.join(root,'.gitignore'));
 execFileSync('git',['-c','init.defaultBranch=codex/fixture','init','--quiet'],{cwd:root});
 for(const file of ['public-data/us-market/manifest.json','public-data/us-market/snapshots/2026-10-14.json']){
  try{execFileSync('git',['check-ignore',file],{cwd:root,stdio:'pipe'});assert.fail('public data must not be ignored');}catch(e){assert.equal(e.status,1);}
 }
 for(const file of ['local-data/us-market/requests.json','.env','dist/index.html'])assert.ok(execFileSync('git',['check-ignore',file],{cwd:root}).length);
 const config=await fs.readFile(path.join(repo,'netlify.toml'),'utf8');assert.match(config,/command = "node scripts\/build-site.js"/);assert.match(config,/publish = "dist"/);
}));
