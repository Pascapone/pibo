// Owned disposable module fixture. Start/stop ONLY through Pibo Preview CLI.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const port = Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Fixture port required');
const root=new URL('./',import.meta.url);
createServer((request,response)=>{
 const path=new URL(request.url,'http://localhost').pathname;
 const file=path==='/'?'index.html':path==='/bundle.js'?'bundle.js':path==='/app.css'?'app.css':null;
 if(!file||request.method!=='GET'){response.writeHead(404);response.end();return;}
 try{response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(readFileSync(new URL(file,root)));}
 catch{response.writeHead(503);response.end('Owned fixture file missing');}
}).listen(port,'127.0.0.1',()=>console.log(`Composer module fixture on loopback:${port}`));
