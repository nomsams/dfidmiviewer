// Tiny static server for local testing only (the app itself needs no server: open index.html directly).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const OUT = process.env.GV_OUT; // dev-only upload endpoint is OFF unless GV_OUT is set
http.createServer((req, res) => {
  if (OUT && req.method === 'POST' && req.url.startsWith('/__save')) { // dev-only: lets the browser hand generated files back for inspection
    const name = path.basename(new URL(req.url, 'http://x').searchParams.get('name') || 'out.bin'); fs.mkdirSync(OUT, { recursive: true });
    const ws = fs.createWriteStream(path.join(OUT, name)); req.pipe(ws); ws.on('finish', () => { res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok'); }); return;
  }
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(res);
}).listen(8123, '127.0.0.1', () => console.log('http://localhost:8123/ (localhost only)'));
