const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json','.woff2':'font/woff2'};
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || /[\\/]\.(git|codex|agents)([\\/]|$)/.test(file) || file.includes(path.sep+'node_modules'+path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'}); res.end(data); });
});
server.listen(Number(process.env.PORT) || 0, '127.0.0.1', () => console.log('Dice & Melody · http://127.0.0.1:' + server.address().port));
