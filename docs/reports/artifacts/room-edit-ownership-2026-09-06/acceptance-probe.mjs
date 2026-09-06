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
const scenarios=['ordinary-background','ordinary-current','rename-session','rename-room','rename-back','rename-failure','rename-overlap','archive-session','archive-room','restore-room','warm-session','crossed-navigation','double-failure-older','double-failure-newer','rename-failure-archive'];
try{for(const width of [1431,390])for(const scenario of scenarios){
 if(results.some(r=>r.width===width&&r.scenario===scenario&&r.pass))continue;
 const result={width,scenario,at:new Date().toISOString()};results.push(result);const changedName=`EDIT_${width}_${scenario}`,secondName=`SECOND_${width}_${scenario}`;
 try{
 await c.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:908,deviceScaleFactor:1,mobile:width===390});
 if(scenario==='restore-room')await c.evaluate(`fetch('/api/chat/rooms/${rooms[0]}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({archived:true})}).then(r=>{if(!r.ok)throw Error('Setup restore')})`);
 if(scenario==='rename-back'){await navigate(rooms[1],sessions[2]);await roomClick(rooms[0]);await wait(`${sid}==='${sessions[0]}'`)}else await navigate(rooms[0],sessions[0]);
 if(scenario==='warm-session')for(const id of [sessions[1],sessions[0]]){await sessionClick(id);await sleep(1000)}
 await c.evaluate(`(()=>{
 const s={original:window.fetch,start:performance.now(),phase:'pending',held:false,releases:[],requests:[],frames:[],clicks:[],longTasks:[],done:false};window.__edit=s;
 s.visible=e=>{if(!e)return false;for(let a=e;a;a=a.parentElement){const style=getComputedStyle(a);if(style.visibility!=='visible'||style.display==='none'||Number(style.opacity)===0)return false}const r=e.getBoundingClientRect(),v=e.closest('[data-virtuoso-scroller]')?.getBoundingClientRect()||{top:0,left:0,right:innerWidth,bottom:innerHeight};const top=Math.max(r.top,v.top,0),bottom=Math.min(r.bottom,v.bottom,innerHeight),left=Math.max(r.left,v.left,0),right=Math.min(r.right,v.right,innerWidth);return bottom>top&&right>left&&e.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2))};
 s.snapshot=()=>({ms:performance.now()-s.start,phase:s.phase,path:location.pathname,session:${sid},newSessionEnabled:!!document.querySelector('button[aria-label="New Session"]:not(:disabled)'),rooms:[...document.querySelectorAll('[data-pibo-debug="room-node"]')].filter(e=>${JSON.stringify(rooms)}.includes(e.dataset.piboRoomId)).map(e=>({id:e.dataset.piboRoomId,name:e.querySelector('button span.truncate')?.textContent,visible:s.visible(e)})),markers:[...document.querySelectorAll('[data-row-kind="message.assistant"]')].filter(e=>s.visible(e)).map(e=>e.textContent.trim())});
 s.listener=e=>{const button=e.target.closest('button');s.clicks.push({ms:performance.now()-s.start,trusted:e.isTrusted,label:button?.getAttribute('aria-label'),submit:button?.type==='submit'&&!!button?.closest('form')})};document.addEventListener('click',s.listener,true);
 s.observer=new PerformanceObserver(l=>s.longTasks.push(...l.getEntries().map(e=>({start:e.startTime-s.start,duration:e.duration}))));s.observer.observe({type:'longtask',buffered:false});
 window.fetch=async(...args)=>{const url=String(args[0]?.url||args[0]),method=args[1]?.method||'GET',q={url,method,start:performance.now()-s.start};s.requests.push(q);
  if(method==='PATCH'&&url==='/api/chat/rooms/${rooms[0]}'){
   if(${scenario.startsWith('double-failure')}){q.injected=true;await new Promise(r=>s.releases.push(r));throw Error('INJECTED_DOUBLE_FAILURE')}
   if(${scenario==='rename-failure'||scenario==='rename-failure-archive'}&&!s.held){s.held=true;q.injected=true;await new Promise(r=>s.release=r);throw Error('INJECTED_ROOM_EDIT_FAILURE')}
   const response=await s.original.apply(window,args);q.response=performance.now()-s.start;q.status=response.status;q.room=(await response.clone().json()).room;
   if(${!scenario.startsWith('ordinary')&&!['crossed-navigation','restore-room','rename-failure','rename-failure-archive'].includes(scenario)}&&!s.held){s.held=true;await new Promise(r=>s.release=r)}return response;
  }
  const response=await s.original.apply(window,args);q.response=performance.now()-s.start;q.status=response.status;
  if(${scenario==='crossed-navigation'}&&url.startsWith('/api/chat/navigation')&&!s.held){s.held=true;q.capturedRoom=(await response.clone().json()).room;await new Promise(r=>s.release=r)}return response;
 };
 const tick=()=>{if(!s.done){s.frames.push(s.snapshot());requestAnimationFrame(tick)}};requestAnimationFrame(tick);
 })()`);
 result.initial=await c.evaluate('window.__edit.snapshot()');const initialName=result.initial.rooms.find(r=>r.id===rooms[0]).name;
 let expected=sessions[0],expectedRoom=rooms[0],expectedName=changedName,editedId=scenario==='ordinary-background'?rooms[1]:rooms[0];
 if(scenario==='crossed-navigation'){await sessionClick(sessions[1]);expected=sessions[1];await wait('!!window.__edit.release')}
 if(scenario.startsWith('archive')){await menu(rooms[0],'Archive Room');expectedName=initialName}
 else if(scenario==='restore-room'){await menu(rooms[0],'Restore Room');expectedName=initialName}
 else await edit(editedId,changedName);
 if(scenario.startsWith('double-failure')){
  await wait('window.__edit.releases.length===1');await edit(rooms[0],secondName);await wait('window.__edit.releases.length===2');
  const reverse=scenario.endsWith('newer');await c.evaluate(`window.__edit.releases[${reverse?1:0}]()`);await sleep(300);result.intermediate=await c.evaluate('window.__edit.snapshot()');assert.equal(result.intermediate.rooms.find(r=>r.id===rooms[0]).name,reverse?changedName:secondName);
  expectedName=initialName;await c.evaluate(`window.__edit.releases[${reverse?0:1}]()`);
 }else if(scenario.startsWith('ordinary')||scenario==='restore-room'||scenario==='crossed-navigation'){
  await wait('window.__edit.requests.some(q=>q.method==="PATCH"&&q.status===200)');await c.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 }else{
  await wait('!!window.__edit.release');
  if(scenario.endsWith('-session')){await sessionClick(sessions[1]);expected=sessions[1]}
  else if(scenario==='rename-room'||scenario==='archive-room'||scenario==='rename-failure'){await roomClick(rooms[1]);expected=sessions[2];expectedRoom=rooms[1];await wait(`${sid}==='${expected}'`)}
  else if(scenario==='rename-back'){await closeSidebar();const h=await c.send('Page.getNavigationHistory');await c.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});expected=sessions[2];expectedRoom=rooms[1];await wait(`${sid}==='${expected}'`)}
  if(scenario==='rename-overlap'){await edit(rooms[0],secondName);expectedName=secondName;await wait('window.__edit.requests.filter(q=>q.method==="PATCH"&&q.status===200).length===2')}
  if(scenario==='rename-failure'){await edit(rooms[1],secondName);expectedName=initialName;await wait('window.__edit.requests.some(q=>q.method==="PATCH"&&q.status===200)')}
  if(scenario==='rename-failure-archive'){await menu(rooms[0],'Archive Room');expectedName=initialName;await wait('window.__edit.requests.some(q=>q.method==="PATCH"&&q.status===200)')}
 }
 await closeSidebar();await wait(`window.__edit.snapshot().markers.some(t=>t.includes('ROOM_EDIT_TARGET_${expected}'))`);
 result.before=await c.evaluate('window.__edit.snapshot()');result.expected={session:expected,room:expectedRoom,editedId,name:expectedName};
 await c.evaluate("window.__edit.phase='released';window.__edit.releasedAt=performance.now()-window.__edit.start;window.__edit.release?.()");await sleep(1500);
 result.final=await c.evaluate('window.__edit.snapshot()');assert.equal(result.final.session,expected);assert.ok(result.final.path.includes(expectedRoom));
 const frames=await c.evaluate("window.__edit.frames.filter(f=>f.phase==='released')");assert.ok(frames.length>30);assert.ok(frames.every(f=>f.session===expected),'Wrong Session after settlement');
 await sidebar();const fieldState=await c.evaluate('window.__edit.snapshot()');assert.equal(fieldState.rooms.find(r=>r.id===editedId).name,expectedName);
 if(scenario==='rename-overlap'||scenario.startsWith('ordinary')||scenario==='crossed-navigation')assert.ok(frames.every(f=>f.rooms.find(r=>r.id===editedId)?.name===expectedName),'Saved name regressed');
 if(scenario==='rename-failure')assert.equal(fieldState.rooms.find(r=>r.id===rooms[1]).name,secondName);
 if(scenario.startsWith('archive')||scenario==='rename-failure-archive'){await menu(rooms[0],'Restore Room');await wait('window.__edit.requests.filter(q=>q.method==="PATCH"&&q.status===200).length>=2')}
 if(scenario==='warm-session'){await sessionClick(sessions[0]);await sleep(1100);await sidebar();result.warm=await c.evaluate('window.__edit.snapshot()');assert.equal(result.warm.rooms.find(r=>r.id===rooms[0]).name,expectedName)}
 await closeSidebar();if(scenario!=='warm-session')await wait(`window.__edit.snapshot().markers.some(t=>t.includes('ROOM_EDIT_TARGET_${expected}'))`);
 if(scenario==='ordinary-background'||scenario==='rename-back'){const p=await c.send('Page.captureScreenshot',{format:'png'});await writeFile(`/tmp/room-edit-pibo2-${width}-${scenario}.png`,Buffer.from(p.data,'base64'))}
 const requests=await c.evaluate('window.__edit.requests');assert.equal(requests.filter(q=>q.url.includes('/api/chat/bootstrap')).length,0);
 result.pass=true;console.log(JSON.stringify({width,scenario,pass:true}));
 }catch(e){result.error=String(e);throw e}finally{
  await release().catch(()=>{});result.evidence=await c.evaluate(`(()=>{const s=window.__edit;if(!s)return;s.done=true;s.observer.disconnect();document.removeEventListener('click',s.listener,true);return{frames:s.frames,requests:s.requests,clicks:s.clicks,longTasks:s.longTasks,releasedAt:s.releasedAt,scripts:[...document.scripts].map(e=>e.src).filter(Boolean)}})()`).catch(()=>null);
  await writeFile('/tmp/room-edit-pibo2-acceptance.json',JSON.stringify({ids,results},null,2));
  await c.evaluate(`fetch('/api/chat/rooms/${rooms[0]}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({archived:false})}).then(r=>{if(!r.ok)throw Error('Reset archive')})`).catch(()=>{});
 }
}}finally{c.close()}
