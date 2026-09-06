import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {CdpClient} from '/opt/pibo-releases/3.4.1/node_modules/@pasko70/pibo/dist/tools/cdp-client.js';
const ids=JSON.parse(await readFile('/tmp/room-edit-pibo2-ids.json','utf8')),rooms=ids.rooms,sessions=ids.sessions;
const target=(await(await fetch('http://127.0.0.1:9223/json/list')).json()).find(t=>t.type==='page'&&new URL(t.url).origin===ids.origin);assert.ok(target);
const c=new CdpClient(target.webSocketDebuggerUrl);await c.connect();
const results=process.argv.includes('--resume')?JSON.parse(await readFile('/tmp/room-edit-pibo2-acceptance.json','utf8')).results.filter(r=>r.pass):[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),wait=async expr=>{for(let i=0;i<180;i++){if(await c.evaluate(expr))return;await sleep(50)}throw Error('Unmet '+expr)};
const sid=`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId`;
async function click(selector,text){const expression=text?`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`:`document.querySelector(${JSON.stringify(selector)})`;const locate=()=>c.evaluate(`(()=>{const e=${expression};if(!e||e.disabled)throw Error('Missing pointer target '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Occluded '+${JSON.stringify(selector)});return{x,y}})()`);let p=await locate();await c.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await c.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');p=await locate();await c.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}
async function sidebar(){if(await c.evaluate(`!!document.querySelector('button[aria-label="Open sidebar"]')&&document.querySelector('[data-pibo-mobile-sidebar]')?.dataset.piboState!=='open'`)){await click('button[aria-label="Open sidebar"]');await wait(`document.querySelector('[data-pibo-mobile-sidebar]').getBoundingClientRect().left>=-1`)}}
async function closeSidebar(){if(await c.evaluate(`document.querySelector('[data-pibo-mobile-sidebar]')?.dataset.piboState==='open'`)){await click('button[aria-label="Close sidebar"]');await sleep(250)}}
async function roomClick(id){await sidebar();await click(`[data-pibo-debug="room-node"][data-pibo-room-id="${id}"] button`)}
async function sessionClick(id){await sidebar();await click(`[data-pibo-debug="session-row"][data-pibo-session-id="${id}"] button[aria-label^="Open session"]`);await wait(`${sid}==='${id}'`)}
async function menu(id,label){await sidebar();await click(`[data-pibo-debug="room-node"][data-pibo-room-id="${id}"] button[aria-label^="Actions for room"]`);await wait(`[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.trim()===${JSON.stringify(label)})`);await click('[role="menuitem"]',label)}
async function fill(selector,value){await click(selector);await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await c.send('Input.insertText',{text:value});}
async function edit(id,name,topic){await menu(id,'Edit Room');await fill(`[data-pibo-debug="room-node"][data-pibo-room-id="${id}"] input[aria-label^="Room name"]`,name);if(topic!==undefined)await fill(`[data-pibo-debug="room-node"][data-pibo-room-id="${id}"] input[aria-label^="Room topic"]`,topic);await click(`[data-pibo-debug="room-node"][data-pibo-room-id="${id}"] form button[type="submit"]`)}
async function navigate(room,id){await c.send('Page.navigate',{url:`${ids.origin}/apps/chat/rooms/${room}/sessions/${id}?view=terminal&debugStreaming=1`});await wait(`${sid}==='${id}'&&!!document.querySelector('button[aria-label="New Room"]')`)}
async function release(){await c.evaluate(`if(window.__edit){const s=window.__edit;window.fetch=s.original;s.release?.();s.releases.forEach(r=>r())}`)}

const result={at:new Date().toISOString(),created:[]};
async function readNavigation(room,id){return c.evaluate(`fetch('/api/chat/navigation?roomId=${room}&piboSessionId=${id}&markRead=false').then(async r=>{if(!r.ok)throw Error('Navigation '+r.status);return r.json()})`)}
async function workspace(value,topic){await menu(rooms[1],'Edit Room');await fill(`[data-pibo-debug="room-node"][data-pibo-room-id="${rooms[1]}"] input[aria-label^="Room workspace"]`,value);await fill(`[data-pibo-debug="room-node"][data-pibo-room-id="${rooms[1]}"] input[aria-label^="Room topic"]`,topic);await click(`[data-pibo-debug="room-node"][data-pibo-room-id="${rooms[1]}"] form button[type="submit"]`)}
try{
 await c.send('Emulation.setDeviceMetricsOverride',{width:1431,height:908,deviceScaleFactor:1,mobile:false});await navigate(rooms[0],sessions[0]);
 result.before=await readNavigation(rooms[1],sessions[2]);
 await workspace('/tmp','ROOM_EDIT_TOPIC');
 await wait(`fetch('/api/chat/navigation?roomId=${rooms[1]}&piboSessionId=${sessions[2]}&markRead=false').then(r=>r.json()).then(d=>d.room.workspace==='/tmp'&&d.room.topic==='ROOM_EDIT_TOPIC')`);
 assert.equal(await c.evaluate(sid),sessions[0]);result.changed=await readNavigation(rooms[1],sessions[2]);assert.equal(result.changed.session.workspace,result.before.session.workspace);
 await roomClick(rooms[1]);await wait(`${sid}==='${sessions[2]}'`);assert.equal(await c.evaluate(`document.querySelector('select[aria-label="Agent for new sessions"]').value`),'rt-pi-spark');
 await click('button[aria-label="New Session"]');await wait(`${sid}&&${sid}!=='${sessions[2]}'&&!!document.querySelector('textarea:not(:disabled)')`);const id=await c.evaluate(sid);result.created.push(id);
 result.newSession=await readNavigation(rooms[1],id);assert.equal(result.newSession.session.workspace,'/tmp');assert.equal(result.newSession.session.profile,'rt-pi-spark');
 const model=await c.evaluate(`fetch('/api/chat/status?piboSessionId=${id}').then(r=>r.json()).then(s=>s.activeModel)`);assert.equal(model.provider,'openai-codex');assert.equal(model.id,'gpt-5.3-codex-spark');result.model=model;
 await fill('textarea','Run pwd once. Reply with its output, then ROOM_EDIT_WORKSPACE_OK.');await click('button[aria-label="Send message"]');result.submittedAt=new Date().toISOString();await writeFile('/tmp/room-edit-pibo2-workspace.json',JSON.stringify(result,null,2));
 await wait(`[...document.querySelectorAll('[data-row-kind="message.assistant"]')].some(e=>e.textContent.includes('ROOM_EDIT_WORKSPACE_OK'))`);
 await workspace('','');await wait(`fetch('/api/chat/navigation?roomId=${rooms[1]}&piboSessionId=${id}&markRead=false').then(r=>r.json()).then(d=>!d.room.workspace&&!d.room.topic)`);
 result.cleared=await readNavigation(rooms[1],id);assert.equal(result.cleared.session.workspace,'/tmp');assert.equal(result.cleared.room.metadata.workspace,undefined);
 await click('button[aria-label="New Session"]');await wait(`${sid}&&${sid}!=='${id}'&&!!document.querySelector('textarea:not(:disabled)')`);const fallbackId=await c.evaluate(sid);result.created.push(fallbackId);result.fallback=await readNavigation(rooms[1],fallbackId);assert.equal(result.fallback.session.workspace,result.before.session.workspace);assert.equal(result.fallback.session.profile,'rt-pi-spark');
 result.pass=true;
}catch(e){result.error=String(e);throw e}finally{await writeFile('/tmp/room-edit-pibo2-workspace.json',JSON.stringify(result,null,2));c.close()}
