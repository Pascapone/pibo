import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const directory=fileURLToPath(new URL('./',import.meta.url));
const label=process.argv[2];
if(!label||!/^[a-z0-9-]+$/.test(label)) throw new Error('Artifact label required');
const expectedCases=Number(process.argv[3]??15);
if(!Number.isSafeInteger(expectedCases)||expectedCases<1)throw new Error('Expected case count required');
const harnessArchive=directory+label+'-harness/';mkdirSync(harnessArchive);
const port=Number(readFileSync(directory+'port','utf8').trim());
const url=`http://127.0.0.1:${port}/`;
for(const file of ['validate.mjs','server.mjs','index.html','browser-shell.sh','bundle.js']) { copyFileSync(directory+file,harnessArchive+file); console.log('harness_sha256',file,createHash('sha256').update(readFileSync(directory+file)).digest('hex')); }
async function browser(...args){const result=await exec('bash',[directory+'browser-shell.sh',...args],{timeout:90000,maxBuffer:1024*1024});console.log('browser-use',...args,'\n'+result.stdout);if(result.stderr)console.log(result.stderr);if(/^error:/m.test(result.stdout))throw new Error(result.stdout.trim());return result.stdout;}
await browser('open',url);
await browser('wait','selector','button');
const state=await browser('state');
if(!state.includes('Run persistence fixtures'))throw new Error('Not the owned module fixture page');
const targets=await (await fetch('http://127.0.0.1:53355/json/list')).json();
const target=targets.find(t=>t.type==='page'&&t.url===url);
if(!target)throw new Error('Owned fixture CDP target not found');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
let seq=0;const pending=new Map();const technical={targetId:target.id,url,console:[],exceptions:[],network:[]};
ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const task=pending.get(data.id);if(task){pending.delete(data.id);data.error?task.reject(new Error(JSON.stringify(data.error))):task.resolve(data.result);}return;}if(data.method==='Runtime.exceptionThrown')technical.exceptions.push(data.params.exceptionDetails);if(data.method==='Runtime.consoleAPICalled')technical.console.push({type:data.params.type,args:data.params.args.map(v=>v.value??v.description)});if(data.method==='Network.responseReceived'&&data.params.response.url.startsWith(url))technical.network.push({url:data.params.response.url,status:data.params.response.status,mimeType:data.params.response.mimeType});});
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try{
 await cdp('Runtime.enable');await cdp('Network.enable');await cdp('Log.enable');
 technical.document=await evaluate('({url:location.href,origin:location.origin,ready:document.readyState,scripts:[...document.scripts].map(s=>s.src)})');
 technical.bundle=await evaluate('(async()=>{const response=await fetch("/bundle.js",{cache:"no-store"});const bytes=await response.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");return {status:response.status,bytes:bytes.byteLength,sha256:hash}})()');
 if(technical.bundle.status!==200||technical.bundle.sha256!==createHash('sha256').update(readFileSync(directory+'bundle.js')).digest('hex'))throw new Error('Served fixture bundle did not match the owned build');
 // Browser Use's CLI index cache rejected the previous fresh index. Pair a
 // new state with CDP geometry and use its supported viewport-coordinate click.
 await browser('state');
 const button=await evaluate('(()=>{const b=document.querySelector("button");const r=b.getBoundingClientRect();return {text:b.textContent,disabled:b.disabled,x:r.x+r.width/2,y:r.y+r.height/2}})()');
 if(button.disabled||button.text!=="Run persistence fixtures")throw new Error('Owned fixture button changed');
 await browser('click',String(Math.round(button.x)),String(Math.round(button.y)));
 const deadline=Date.now()+90000;let result;
 while(Date.now()<deadline){const status=await evaluate('({results:window.fixtureResults,failure:window.fixtureFailure,title:document.title})');if(status.failure)throw new Error(status.failure);if(status.results){result=status.results;break;}await new Promise(resolve=>setTimeout(resolve,100));}
 if(!result)throw new Error('Module fixture timed out');
 technical.summary=result;
 writeFileSync(directory+label+'.json',JSON.stringify(technical,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
 await browser('state');await browser('screenshot',directory+label+'.png');
 if(result.fail!==0||result.pass!==expectedCases)throw new Error(`Expected ${expectedCases} passing real-browser module cases; got ${result.pass}/${result.fail}`);
 if(technical.exceptions.length)throw new Error('Uncaught browser exception observed');
 console.log(`PASS: ${expectedCases} real-browser module cases, including separate-tab CAS; no application/authentication/Composer acceptance.`);
}finally{writeFileSync(directory+label+'-technical.json',JSON.stringify(technical,null,2)+'\n');ws.close();}
