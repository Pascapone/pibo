// Static module fixture host only. Managed by pibo preview, never a Chat server.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const port = Number(process.argv[2]);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Fixture port required');
const root = new URL('./', import.meta.url);
createServer((request, response) => {
 const pathname = new URL(request.url, 'http://localhost').pathname;
 const file = pathname === '/' || pathname === '/peer' ? 'index.html' : pathname === '/bundle.js' ? 'bundle.js' : null;
 if (!file || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
 try {
  response.writeHead(200, {'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(readFileSync(new URL(file, root)));
 } catch { response.writeHead(503); response.end('Fixture bundle unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`Owned module fixture listening on loopback:${port}`));
