import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {CdpClient} from '/opt/pibo-releases/3.4.1/node_modules/@pasko70/pibo/dist/tools/cdp-client.js';
const ids=JSON.parse(await readFile('/tmp/room-pibo2-ids.json','utf8'));
const target=(await(await fetch('http://127.0.0.1:9223/json/list')).json()).find(t=>t.type==='page'&&new URL(t.url).origin===ids.origin);
assert.ok(target);const c=new CdpClient(target.webSocketDebuggerUrl);await c.connect();
const rooms=ids.rooms,sessions=[ids.sessions[0],ids.sessions[2]],results=process.argv.includes('--resume')?JSON.parse(await readFile('/tmp/room-pibo2-acceptance.json','utf8')).results.filter(r=>r.pass):[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(expression)=>{for(let i=0;i<180;i++){if(await c.evaluate(expression))return;await sleep(50)}throw Error('Unmet condition: '+expression)};
const sessionExpr=`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId`;
async function click(selector){const p=await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing/disabled pointer target');e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Pointer target occluded: '+${JSON.stringify(selector)});return{x,y}})()`);await c.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}
async function sidebar(){if(await c.evaluate(`!!document.querySelector('button[aria-label="Open sidebar"]') && document.querySelector('[data-pibo-mobile-sidebar]')?.dataset.piboState!=='open'`)){await click('button[aria-label="Open sidebar"]');await wait(`(()=>{const e=document.querySelector('[data-pibo-mobile-sidebar]');return !e||e.getBoundingClientRect().left>=-1})()`);}}
async function closeSidebar(){if(await c.evaluate(`!!document.querySelector('button[aria-label="Close sidebar"]') && document.querySelector('[data-pibo-mobile-sidebar]')?.dataset.piboState==='open'`)){await click('button[aria-label="Close sidebar"]');await sleep(300)}}
async function roomClick(id){await sidebar();await click(`[data-pibo-debug="room-node"][data-pibo-room-id="${id}"] button`)}
async function navigate(room,id){await c.send('Page.navigate',{url:`${ids.origin}/apps/chat/rooms/${room}/sessions/${id}?view=terminal&debugStreaming=1`});await wait(`${sessionExpr}==='${id}' && !!document.querySelector('button[aria-label="New Room"]:not(:disabled)')`)}
async function release(){await c.evaluate(`if(window.__roomAccept){window.fetch=window.__roomAccept.original;window.__roomAccept.release?.()}`)}
const scenarios=[{stage:'ordinary',action:'untouched',failure:false},...['untouched','other-room','browser-back'].flatMap(action=>[{stage:'post',action,failure:false},{stage:'post',action,failure:true}]),...['untouched','other-room','browser-back','next-room'].map(action=>({stage:'navigation',action,failure:false}))];
try{for(const width of [1431,390])for(const scenario of scenarios){
 if(results.some(r=>r.width===width&&JSON.stringify(r.scenario)===JSON.stringify(scenario)&&r.pass))continue;
 const result={width,scenario,at:new Date().toISOString()};results.push(result);
 await c.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:908,deviceScaleFactor:1,mobile:width===390});
 if(scenario.action==='browser-back'){await navigate(rooms[1],sessions[1]);await roomClick(rooms[0]);await wait(`${sessionExpr}==='${sessions[0]}' && location.pathname.includes('${rooms[0]}')`)}else await navigate(rooms[0],sessions[0]);
 await sidebar();
 try{
  await c.evaluate(`(()=>{
   const state={original:window.fetch,start:performance.now(),phase:'pending',created:[],held:false,frames:[],requests:[],clicks:[],longTasks:[],done:false};window.__roomAccept=state;
   state.visible=e=>{if(!e||getComputedStyle(e).visibility!=='visible')return false;const r=e.getBoundingClientRect(),s=e.closest('[data-virtuoso-scroller]')?.getBoundingClientRect()||{top:0,left:0,bottom:innerHeight,right:innerWidth};const top=Math.max(r.top,s.top),bottom=Math.min(r.bottom,s.bottom),left=Math.max(r.left,s.left),right=Math.min(r.right,s.right);return bottom>top&&right>left&&e.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2))};
   state.snapshot=()=>({ms:performance.now()-state.start,phase:state.phase,path:location.pathname,session:${sessionExpr},newRoomEnabled:!!document.querySelector('button[aria-label="New Room"]:not(:disabled)'),optimistic:[...document.querySelectorAll('[data-pibo-debug="room-node"]')].filter(e=>e.dataset.piboRoomId.startsWith('optimistic-room-')).map(e=>({id:e.dataset.piboRoomId,visible:state.visible(e)})),markers:[...document.querySelectorAll('[data-row-kind="message.assistant"]')].filter(e=>state.visible(e)).map(e=>e.textContent.trim())});
   state.listener=e=>{state.clicks.push({ms:performance.now()-state.start,trusted:e.isTrusted,label:e.target.closest('button')?.getAttribute('aria-label')});};document.addEventListener('click',state.listener,true);
   state.observer=new PerformanceObserver(list=>state.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));state.observer.observe({type:'longtask',buffered:false});
   window.fetch=async(...args)=>{
    const url=String(args[0]?.url||args[0]),method=args[1]?.method||'GET',entry={url,method,start:performance.now()-state.start};state.requests.push(entry);
    if(url==='/api/chat/rooms'&&method==='POST'){
     if(${scenario.failure}&&!state.held){state.held=true;entry.injectedFailure=true;await new Promise(resolve=>state.release=resolve);throw Error('INJECTED_ROOM_FAILURE')}
     const response=await state.original.apply(window,args);entry.response=performance.now()-state.start;entry.status=response.status;state.created.push((await response.clone().json()).room);
     if(${scenario.stage==='post'}&&!state.held){state.held=true;await new Promise(resolve=>state.release=resolve)}return response;
    }
    const response=await state.original.apply(window,args);entry.response=performance.now()-state.start;entry.status=response.status;
    if(${scenario.stage==='navigation'}&&!state.held&&url.startsWith('/api/chat/navigation')&&state.created[0]&&url.includes(state.created[0].id)){state.held=true;await new Promise(resolve=>state.release=resolve)}return response;
   };
   const frame=()=>{if(state.done)return;state.frames.push(state.snapshot());requestAnimationFrame(frame)};requestAnimationFrame(frame);
  })()`);
  await click('button[aria-label="New Room"]');
  if(scenario.stage==='ordinary')await wait(`window.__roomAccept.created.length===1 && location.pathname.includes(window.__roomAccept.created[0].id) && !!document.querySelector('button[aria-label="New Room"]:not(:disabled)')`);else await wait('!!window.__roomAccept.release');
  await sleep(300);result.pending=await c.evaluate('window.__roomAccept.snapshot()');
  const created=await c.evaluate('window.__roomAccept.created[0]');
  let expectedRoom=scenario.action==='untouched'?(scenario.failure?rooms[0]:created.id):rooms[1],expectedSession=scenario.action==='untouched'?(scenario.failure?sessions[0]:null):sessions[1];
  if(scenario.action==='browser-back'){await closeSidebar();const h=await c.send('Page.getNavigationHistory');await c.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id})}
  else if(scenario.action==='other-room')await roomClick(rooms[1]);
  if(scenario.action==='next-room'){
   await sidebar();await click('button[aria-label="New Room"]');await wait('window.__roomAccept.created.length===2');expectedRoom=await c.evaluate('window.__roomAccept.created[1].id');await wait(`location.pathname.includes('${expectedRoom}')&&${sessionExpr}?.startsWith('ps_')`);expectedSession=await c.evaluate(sessionExpr);
  }else if(scenario.action!=='untouched')await wait(`${sessionExpr}==='${expectedSession}'`);
  const expectsMarker=expectedSession&&sessions.includes(expectedSession)&&scenario.action!=='untouched';
  if(expectsMarker){await closeSidebar();await wait(`window.__roomAccept.snapshot().markers.some(text=>text.includes('ROOM_TARGET_${expectedSession}'))`)}
  result.expected={room:expectedRoom,session:expectedSession};result.before=await c.evaluate('window.__roomAccept.snapshot()');
  await c.evaluate(`window.__roomAccept.phase='released';window.__roomAccept.releasedAt=performance.now()-window.__roomAccept.start;window.fetch=window.__roomAccept.original;window.__roomAccept.release?.()`);await sleep(1400);
  await closeSidebar();
  result.final=await c.evaluate('window.__roomAccept.snapshot()');
  assert.ok(result.final.path.includes('/rooms/'+expectedRoom),'Late Room selection stole route');
  if(expectedSession){assert.equal(result.final.session,expectedSession);const wrong=await c.evaluate(`window.__roomAccept.frames.filter(f=>f.phase==='released'&&f.session!=='${expectedSession}').length`);assert.equal(wrong,0,'Wrong Session after release')}
  if(expectsMarker)assert.ok(result.final.markers.some(t=>t.includes('ROOM_TARGET_'+expectedSession)),'Actual assistant marker lost');
  if(scenario.stage==='post'&&scenario.action==='untouched')assert.ok(result.pending.optimistic.some(r=>r.visible),'Pending optimistic Room not visible');
  if(scenario.stage==='navigation')assert.ok(result.pending.newRoomEnabled,'Creation control blocked by hydration');
  assert.equal(result.final.optimistic.length,0,'Temporary Room remains');
  if(width===390&&scenario.action==='browser-back'&&!scenario.failure){const shot=await c.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/room-pibo2-mobile-'+scenario.stage+'.png',Buffer.from(shot.data,'base64'))}
  result.pass=true;
 }catch(error){result.error=String(error);throw error}finally{
  await release().catch(()=>{});
  result.evidence=await c.evaluate(`(()=>{const s=window.__roomAccept;if(!s)return null;s.done=true;s.observer.disconnect();document.removeEventListener('click',s.listener,true);return{frames:s.frames,requests:s.requests,created:s.created,clicks:s.clicks,longTasks:s.longTasks,releasedAt:s.releasedAt,scripts:[...document.scripts].filter(e=>e.src).map(e=>e.src)}})()`).catch(()=>null);
  await writeFile('/tmp/room-pibo2-acceptance.json',JSON.stringify({ids,results},null,2));
 }
}
console.log(JSON.stringify(results.map(r=>({width:r.width,scenario:r.scenario,pass:r.pass,post:r.evidence.requests.find(q=>q.method==='POST'),firstOptimistic:r.evidence.frames.find(f=>f.optimistic.some(r=>r.visible))?.ms,longTasks:r.evidence.longTasks.length}))));
}finally{c.close()}
