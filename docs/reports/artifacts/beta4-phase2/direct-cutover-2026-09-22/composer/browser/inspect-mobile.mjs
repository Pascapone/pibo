// Local CDP technical evidence for an owned static Composer module fixture.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('./',import.meta.url),dir=new URL('.',root);
const port=Number(readFileSync(new URL('port',root),'utf8'));
const cdp=readFileSync(new URL('isolated-cdp-url',root),'utf8').trim();
const targets=await (await fetch(cdp+'/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url===`http://127.0.0.1:${port}/`);
if(!target)throw Error('Owned static fixture target unavailable');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let id=0;const pending=new Map(),exceptions=[];
ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const task=pending.get(msg.id);if(task){pending.delete(msg.id);msg.error?task.reject(Error(JSON.stringify(msg.error))):task.resolve(msg.result)}return;}if(msg.method==='Runtime.exceptionThrown')exceptions.push(msg.params.exceptionDetails)});
function call(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));})}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
try{
 await call('Runtime.enable');await call('Network.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await new Promise(resolve=>setTimeout(resolve,300));
 const served=await evaluate('(async()=>{const response=await fetch("/bundle.js",{cache:"no-store"});const data=new Uint8Array(await response.arrayBuffer());return {status:response.status,sha256:[...new Uint8Array(await crypto.subtle.digest("SHA-256",data))].map(n=>n.toString(16).padStart(2,"0")).join("")}})()');
 const technical=await evaluate(`(()=>{const root=document.querySelector('[data-pibo-debug="composer"]');const panel=document.querySelector('[data-pibo-debug="composer-structured-attachments"]');const send=document.querySelector('[data-pibo-debug="composer-send"]');const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}};return {userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},root:rect(root),panel:rect(panel),send:rect(send),background:getComputedStyle(root).backgroundColor,probe:window.fixtureProbe?.()}})()`);
 const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 writeFileSync(new URL('mobile-headless-module.png',root),Buffer.from(shot.data,'base64'));
 const inputs={bundle:readFileSync(new URL('bundle.js',root)),css:readFileSync(new URL('app.css',root))};
 writeFileSync(new URL('mobile-technical.json',root),JSON.stringify({target:{id:target.id,url:target.url},technical,served,exceptions,inputs:{bundleSha256:createHash('sha256').update(inputs.bundle).digest('hex'),cssSha256:createHash('sha256').update(inputs.css).digest('hex')}},null,2)+'\n');
 if(served.status!==200||served.sha256!==createHash('sha256').update(inputs.bundle).digest('hex'))throw Error('Served fixture bundle differs from owned build');
 if(technical.document.scrollWidth>technical.document.clientWidth||technical.panel.right>technical.viewport.width+1)throw Error('Mobile composer overflows viewport');
 if(!technical.userAgent.includes('HeadlessChrome'))throw Error('Unexpected browser classification; inspect before labeling');
 if(technical.probe?.count!==1||technical.probe?.sent?.[0]?.text!==''||exceptions.length)throw Error('Fixture UI state or CDP exception mismatch');
 console.log('Headless module-fixture mobile layout and native-IDB note checked; NOT headed/product acceptance',technical.viewport,technical.document);
}finally{ws.close()}
