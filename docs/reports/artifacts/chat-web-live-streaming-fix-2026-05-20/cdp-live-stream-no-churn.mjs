import http from 'node:http';
import fs from 'node:fs/promises';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const arg=(n,f)=>{const p=`--${n}=`; const a=process.argv.find(v=>v.startsWith(p)); return a?a.slice(p.length):f};
const get=(url)=>new Promise((resolve,reject)=>{http.get(url,res=>{let d=''; res.setEncoding('utf8'); res.on('data',c=>d+=c); res.on('end',()=>resolve(d));}).on('error',reject)});
const cdp=arg('cdp','http://127.0.0.1:56663');
const base=arg('base','http://127.0.0.1:4788');
const sid=arg('sid');
const out=arg('out','/tmp/live-stream-no-churn-result.json');
if(!sid) throw new Error('--sid is required');
const targets=JSON.parse(await get(`${cdp}/json/list`));
const page=targets.find(t=>t.type==='page');
const ws=new WebSocket(page.webSocketDebuggerUrl.replace('localhost','127.0.0.1'));
let id=1; const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',reject,{once:true});});
const send=(method,params={})=>new Promise((resolve,reject)=>{const call=id++; pending.set(call,{resolve,reject}); ws.send(JSON.stringify({id:call,method,params}));});
const evalJs=async(expr,awaitPromise=false)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise,returnByValue:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value;};
await send('Page.enable'); await send('Runtime.enable');
const source=`(()=>{const state=window.__piboLiveFix={eventSources:[],fetches:[]}; const Native=window.EventSource; let seq=0; const rec=(x)=>state.eventSources.push({t:Date.now(),hidden:document.hidden,visibilityState:document.visibilityState,...x}); function Wrapped(url,init){const eventSourceId=++seq; const u=String(url); const es=new Native(url,init); rec({kind:'construct',id:eventSourceId,url:u,readyState:es.readyState}); es.addEventListener('open',()=>rec({kind:'open',id:eventSourceId,url:u,readyState:es.readyState})); es.addEventListener('error',()=>rec({kind:'error',id:eventSourceId,url:u,readyState:es.readyState})); es.addEventListener('pibo',(ev)=>rec({kind:'message:pibo',id:eventSourceId,url:u,lastEventId:ev.lastEventId,readyState:es.readyState})); const close=es.close.bind(es); es.close=()=>{rec({kind:'close',id:eventSourceId,url:u,readyState:es.readyState}); return close();}; return es;} Wrapped.prototype=Native.prototype; Object.setPrototypeOf(Wrapped,Native); window.EventSource=Wrapped; const nativeFetch=window.fetch.bind(window); window.fetch=async(...args)=>{const url=String(args[0]?.url??args[0]); state.fetches.push({t:Date.now(),kind:'fetch',url}); return nativeFetch(...args);};})();`;
await send('Page.addScriptToEvaluateOnNewDocument',{source});
await send('Page.navigate',{url:`${base}/api/auth/sign-in/social`});
await wait(1200);
await send('Page.navigate',{url:`${base}/apps/chat/sessions/${sid}`});
await wait(3500);
for(let i=0;i<5;i++){
  await evalJs(`fetch('/api/chat/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({piboSessionId:${JSON.stringify(sid)},action:'status'})}).then(r=>r.text())`, true);
  await wait(400);
}
await wait(2500);
const result=JSON.parse(await evalJs(`JSON.stringify({url:location.href,text:document.body.innerText.slice(0,1500),state:window.__piboLiveFix})`));
const live=result.state.eventSources.filter(e=>e.url?.includes('/api/chat/events?')&&e.url.includes('mode=live'));
const counts=live.reduce((m,e)=>{m[e.kind]=(m[e.kind]||0)+1; return m;},{});
const output={sid, at:new Date().toISOString(), result, live, counts, passed:(counts.construct===1 && !counts.close)};
await fs.writeFile(out, JSON.stringify(output,null,2));
if(!output.passed){console.error(JSON.stringify(output.counts)); process.exit(1);}
ws.close();
