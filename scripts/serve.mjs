import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function serve() {
  const root = path.resolve('dist');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') { res.writeHead(302, { Location: '/sprechen/' }); res.end(); return; }
      if (!url.pathname.startsWith('/sprechen/')) { res.writeHead(404); res.end(); return; }
      const relative = decodeURIComponent(url.pathname.slice('/sprechen/'.length));
      let file = path.resolve(root, relative || 'index.html');
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      let exists = false;
      try { exists = (await stat(file)).isFile(); } catch {}
      if (!exists) {
        if (req.headers.accept?.includes('text/html') && !path.extname(relative)) file = path.join(root, 'index.html');
        else { res.writeHead(404); res.end(); return; }
      }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/sprechen/' });
      res.end(await readFile(file));
    } catch { res.writeHead(500); res.end('Preview error'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, base: origin + '/sprechen' };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Preview: ${(await serve()).base}/today`);
