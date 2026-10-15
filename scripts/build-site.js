 'use strict';
// Netlify builds from tracked public inputs only. No collection, staging or source-data writes.
const fs=require('node:fs/promises'),path=require('node:path');
const {validatePublic,ROOT}=require('./public-market-data');
const PUBLIC_FILES=['index.html','sw.js','manifest.webmanifest'];
async function copyAssets(from,to){
 await fs.mkdir(to,{recursive:true});
 for(const entry of await fs.readdir(from,{withFileTypes:true})){
  if(entry.isSymbolicLink())throw Error('发布目录不允许符号链接');
  if(entry.isDirectory())await copyAssets(path.join(from,entry.name),path.join(to,entry.name));
  else if(/\.(html|css|js|json|svg|png)$/.test(entry.name))await fs.copyFile(path.join(from,entry.name),path.join(to,entry.name));
 }
}
async function buildSite({root=ROOT,now=new Date()}={}){
 root=path.resolve(root);
 const data=path.join(root,'public-data/us-market'),checked=await validatePublic({dir:data,now});
 const stage=await fs.mkdtemp(path.join(root,'.site-build-')),output=path.join(root,'dist');
 try{
  for(const name of PUBLIC_FILES)await fs.copyFile(path.join(root,name),path.join(stage,name));
  for(const name of ['assets','tools'])await copyAssets(path.join(root,name),path.join(stage,name));
  const published=path.join(stage,'local-data/us-market');await fs.mkdir(path.join(published,'snapshots'),{recursive:true});
  for(const name of checked.files)await fs.copyFile(path.join(data,name),path.join(published,name));
  await validatePublic({dir:published,now});
  const sw=await fs.readFile(path.join(stage,'sw.js'),'utf8');
  const shell=sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);if(!shell)throw Error('PWA静态资源清单缺失');
  for(const item of shell[1].matchAll(/'\.\/([^']+)'/g))await fs.access(path.join(stage,item[1]));
  await fs.writeFile(path.join(stage,'_headers'),'/sw.js\n  Cache-Control: no-cache\n/local-data/us-market/*\n  Cache-Control: public, max-age=0, must-revalidate\n');
  // Only this disposable directory is replaced; no tracked market history is touched.
  try{const st=await fs.lstat(output);if(st.isSymbolicLink()||!st.isDirectory())throw Error('dist不是普通构建目录，停止覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(path.dirname(output)!==root||path.basename(output)!=='dist')throw Error('构建输出路径异常');
  await fs.rm(output,{recursive:true,force:true});await fs.rename(stage,output);
  return {output,latest:checked.latest,dates:checked.dates,marketFiles:checked.files.length,requests:0};
 }catch(e){await fs.rm(stage,{recursive:true,force:true});throw e;}
}
module.exports={buildSite};
if(require.main===module)buildSite().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('构建终止：'+e.message);process.exitCode=1;});
