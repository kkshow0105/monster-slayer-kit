'use strict';
// Local loopback server. Only public application assets and approved market JSON routes are exposed.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
function createServer({ root = ROOT, dataDir = path.join(root, 'public-data/us-market'), basePath = '' } = {}) {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (basePath) { if (!pathname.startsWith(basePath + '/')) { response.writeHead(404).end(); return; } pathname = pathname.slice(basePath.length); }
      if (pathname.endsWith('/')) pathname += 'index.html';
      let file;
      if (/^\/local-data\/us-market\/(manifest\.json|status\.json|sox\.json|nbi\.json|brent\.json|snapshots\/\d{4}-\d{2}-\d{2}\.json)$/.test(pathname)) {
        file = path.resolve(dataDir, pathname.slice('/local-data/us-market/'.length));
        try { await fs.access(file); } catch (e) {
          if (e.code === 'ENOENT' && /\/(manifest|status|sox|nbi|brent)\.json$/.test(pathname)) {
            response.writeHead(200, { 'Content-Type': MIME['.json'] }).end(JSON.stringify(pathname.endsWith('manifest.json') ? { version:1, dates:[], latest:null } : /\/(sox|nbi|brent)\.json$/.test(pathname) ? { version:1, observations:[] } : { version:1, lastAttempt:null })); return;
          }
          throw e;
        }
      } else if (/^\/(index\.html|sw\.js|manifest\.webmanifest|(?:assets|tools)\/[a-zA-Z0-9_./-]+\.(?:html|css|js|json|svg|png))$/.test(pathname) && !pathname.split('/').some(s => s.startsWith('.'))) {
        file = path.resolve(root, '.' + pathname);
        if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      } else { response.writeHead(404).end(); return; }
      const realFile = await fs.realpath(file), allowedRoot = pathname.startsWith('/local-data/') ? await fs.realpath(dataDir) : await fs.realpath(root);
      if (!realFile.startsWith(allowedRoot + path.sep)) { response.writeHead(403).end(); return; }
      const body = await fs.readFile(realFile);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404).end(); }
  });
}
module.exports = { createServer };
if (require.main === module) {
  const portArg = process.argv.slice(2).find(a => /^--port=\d+$/.test(a));
  const port = portArg ? Number(portArg.slice(7)) : 3000;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口须为1024—65535');
  const server = createServer();
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? '端口已占用，请用--port指定其他端口。' : '本地服务启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`本地验收：http://127.0.0.1:${port}/tools/us-market/`));
}
