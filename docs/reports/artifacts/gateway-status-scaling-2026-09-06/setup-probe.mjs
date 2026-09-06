import{readFile,writeFile}from'node:fs/promises';
import{execFileSync}from'node:child_process';
import{CdpClient}from'/opt/pibo-releases/3.4.1/node_modules/@pasko70/pibo/dist/tools/cdp-client.js';
const lease=JSON.parse(await readFile('/tmp/status-scaling-lease.json'));const origin=new URL(lease.publicUrl).origin;
const targets=await(await fetch('http://127.0.0.1:9223/json/list')).json();const c=new CdpClient(targets.find(t=>t.type==='page'&&new URL(t.url).origin===origin).webSocketDebuggerUrl);await c.connect();
const file='/tmp/status-scaling-pibo2-ids.json';const state=process.argv.includes('--resume')?JSON.parse(await readFile(file)):{origin,sessions:[],models:[],samples:[]};
const status=()=>JSON.parse(execFileSync('ssh',['-o','BatchMode=yes','31.70.66.85',`docker exec ${lease.containerName} node --input-type=module -e 'const p=process.env.PIBO_GATEWAY_WEB_PORT||4788;const t=performance.now();const r=await fetch(\`http://127.0.0.1:\${p}/gateway/status\`,{signal:AbortSignal.timeout(20000)});const body=await r.json();console.log(JSON.stringify({at:new Date().toISOString(),ms:performance.now()-t,status:r.status,body}));'`],{encoding:'utf8'}));
try{
 if(!state.room){state.room=await c.evaluate(`(async()=>{const r=await fetch('/api/chat/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Status scaling Spark '+Date.now()})});const b=await r.json();if(!r.ok)throw Error('Room setup failed');return b.room.id})()`);await writeFile(file,JSON.stringify(state,null,2));}
 for(const count of[1,10,29]){
  while(state.sessions.length<count){const id=await c.evaluate(`(async()=>{const r=await fetch('/api/chat/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId:${JSON.stringify(state.room)},profile:'rt-pi-spark'})});const b=await r.json();if(!r.ok||b.session.profile!=='rt-pi-spark')throw Error('Session setup failed');return b.session.id})()`);state.sessions.push(id);await writeFile(file,JSON.stringify(state,null,2));
   const model=await c.evaluate(`window.__activation=(async()=>{const r=await fetch('/api/chat/status?piboSessionId=${id}');const b=await r.json();if(!r.ok)throw Error('Status failed');return b.activeModel})()`,30000);if(model?.provider!=='openai-codex'||model.id!=='gpt-5.3-codex-spark')throw Error('Wrong model');state.models.push({id,model});await writeFile(file,JSON.stringify(state,null,2));}
  if(state.samples.some(s=>s.count===count))continue;
  const samples=Array.from({length:3},status);for(const s of samples){if(s.status!==200||s.body.runtimeStatuses.length!==count)throw Error('Unexpected runtime count');if(s.body.runtimeStatuses.some(s=>s.processing||s.streaming||s.queuedMessages))throw Error('Unexpected active work');}
  state.samples.push({count,samples});await writeFile(file,JSON.stringify(state,null,2));console.log(JSON.stringify({count,ms:samples.map(s=>s.ms)}));
 }
}finally{await writeFile(file,JSON.stringify(state,null,2));c.close()}
