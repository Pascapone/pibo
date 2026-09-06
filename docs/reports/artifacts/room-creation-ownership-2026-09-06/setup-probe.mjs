import {readFile,writeFile} from 'node:fs/promises';
import {CdpClient} from '/opt/pibo-releases/3.4.1/node_modules/@pasko70/pibo/dist/tools/cdp-client.js';
const lease=JSON.parse(await readFile('/tmp/room-pibo2-lease.json','utf8'));
const origin=new URL(lease.publicUrl).origin;
const ts=await(await fetch('http://127.0.0.1:9223/json/list')).json();
const target=ts.find(t=>t.type==='page'&&new URL(t.url).origin===origin);if(!target)throw Error('Authenticate the assigned slot first');
const c=new CdpClient(target.webSocketDebuggerUrl);await c.connect();
const state={origin,rooms:[],sessions:[],turns:[]};
const waitFor=async(expression)=>{for(let i=0;i<150;i++){if(await c.evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Unmet browser condition: '+expression)};
try{
 await c.send('Emulation.setDeviceMetricsOverride',{width:1431,height:908,deviceScaleFactor:1,mobile:false});
 const setup=process.argv.includes('--resume')?JSON.parse(await readFile('/tmp/room-pibo2-ids.json','utf8')):await c.evaluate(`(async()=>{const post=async(path,data)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Error('Setup failed '+r.status);return body};const rooms=[];for(let i=0;i<2;i++)rooms.push((await post('/api/chat/rooms',{name:'Room ownership Spark '+Date.now()+' '+i})).room.id);const sessions=[];for(const roomId of[rooms[0],rooms[0],rooms[1]])sessions.push((await post('/api/chat/sessions',{roomId,profile:'rt-pi-spark'})).session.id);return{rooms,sessions}})()`);
 Object.assign(state,setup);await writeFile('/tmp/room-pibo2-ids.json',JSON.stringify(state,null,2));
 for(let i=0;i<state.sessions.length;i++){
  const id=state.sessions[i],room=state.rooms[i===2?1:0],marker='ROOM_TARGET_'+id;
  await c.send('Page.navigate',{url:origin+'/apps/chat/rooms/'+room+'/sessions/'+id+'?view=terminal&debugStreaming=1'});
  await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId===${JSON.stringify(id)} && !!document.querySelector('textarea:not(:disabled)')`);
  if(state.turns.some(turn=>turn.id===id)){await waitFor(`[...document.querySelectorAll('[data-pibo-debug="terminal-row"][data-row-kind="message.assistant"]')].some(r=>r.textContent.includes(${JSON.stringify(marker)}))`);continue;}
  const model=await c.evaluate(`(async()=>{const r=await fetch('/api/chat/status?piboSessionId=${id}');if(!r.ok)throw Error('Status failed');const s=await r.json();return s.activeModel})()`);
  if(model?.provider!=='openai-codex'||model.id!=='gpt-5.3-codex-spark')throw Error('Disallowed model: '+JSON.stringify(model));
  // Hold a JS reference to the evaluation promise; never retry an ambiguous accepted send.
  const submit=await c.evaluate(`window.__creationSubmit=(async()=>{const text=${JSON.stringify('Reply exactly '+marker+'. Use no tools.')};const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,30));if(input.value!==text)throw Error('Composer mismatch');document.querySelector('button[aria-label="Send message"]').click();return{at:new Date().toISOString(),text}})()`);
  state.turns.push({id,model,submit});await writeFile('/tmp/room-pibo2-ids.json',JSON.stringify(state,null,2));
  await waitFor(`[...document.querySelectorAll('[data-pibo-debug="terminal-row"][data-row-kind="message.assistant"]')].some(r=>r.textContent.includes(${JSON.stringify(marker)}))`);
 }
 console.log(JSON.stringify(state));
}finally{await writeFile('/tmp/room-pibo2-ids.json',JSON.stringify(state,null,2));c.close()}
