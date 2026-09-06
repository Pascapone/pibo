import {CdpClient} from '/workspace/dist/tools/cdp-client.js';
import {writeFile} from 'node:fs/promises';
const target=(await(await fetch('http://127.0.0.1:43995/json/list')).json()).find(t=>t.type==='page'&&t.url.includes('/apps/chat'));
const c=new CdpClient(target.webSocketDebuggerUrl);await c.connect();const rooms=[],sessions=[],results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),wait=async(expr)=>{for(let i=0;i<140;i++){if(await c.evaluate(expr))return;await sleep(40)}throw Error('Unmet '+expr)};
const sid=`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId`;
const snapshot=`(()=>({session:${sid},path:location.pathname,rooms:[...document.querySelectorAll('[data-pibo-debug="room-node"]')].map(e=>({id:e.dataset.piboRoomId,state:e.dataset.piboState,text:e.textContent})),error:document.querySelector('[role="alert"]')?.textContent}))()`;
async function menu(roomId,label){await c.evaluate(`document.querySelector('[data-pibo-debug="room-node"][data-pibo-room-id="${roomId}"] button[aria-label^="Actions for room"]').click()`);await wait(`!![...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='${label}')`);await c.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='${label}').click()`)}
async function edit(roomId,name){await menu(roomId,'Edit Room');await wait(`!!document.querySelector('[data-pibo-room-id="${roomId}"] input')`);await c.evaluate(`(()=>{const e=document.querySelector('[data-pibo-room-id="${roomId}"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(name)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await c.evaluate(`document.querySelector('[data-pibo-room-id="${roomId}"] form').requestSubmit()`)}
async function open(roomId){await c.evaluate(`document.querySelector('[data-pibo-debug="room-node"][data-pibo-room-id="${roomId}"] button').click()`)}
const release=()=>c.evaluate('if(window.__roomMutation){window.fetch=window.__roomMutation.original;window.__roomMutation.release?.()}');
try{
 await c.send('Emulation.setDeviceMetricsOverride',{width:1431,height:908,deviceScaleFactor:1,mobile:false});
 for(let i=0;i<2;i++)rooms.push(await c.evaluate(`(async()=>{const r=await fetch('/api/chat/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Mutation '+Date.now()+' ${i}'})});return(await r.json()).room})()`));
 for(const room of [rooms[0],rooms[0],rooms[1]])sessions.push(await c.evaluate(`(async()=>{const r=await fetch('/api/chat/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId:'${room.id}'})});return(await r.json()).session.id})()`));
 for(const scenario of ['background-edit']){
  const result={scenario};results.push(result);
  try{
   if(scenario==='rename-back'){await c.send('Page.navigate',{url:`http://127.0.0.1:4788/apps/chat/rooms/${rooms[1].id}/sessions/${sessions[2]}?view=terminal`});await wait(`${sid}==='${sessions[2]}'`);await open(rooms[0].id);await wait(`${sid}==='${sessions[0]}'`)}else{await c.send('Page.navigate',{url:`http://127.0.0.1:4788/apps/chat/rooms/${rooms[0].id}/sessions/${sessions[0]}?view=terminal`});await wait(`${sid}==='${sessions[0]}'`)}
   await c.evaluate(`(()=>{const state={original:window.fetch,held:false,requests:[],frames:[],done:false};window.__roomMutation=state;window.fetch=async(...args)=>{const url=String(args[0]?.url||args[0]),method=args[1]?.method||'GET',entry={url,method,at:performance.now(),body:method==='PATCH'?JSON.parse(args[1].body):undefined};state.requests.push(entry);if(url==='/api/chat/rooms/${rooms[0].id}'&&method==='PATCH'&&!state.held){state.held=true;${scenario==='rename-failure'?`await new Promise(r=>state.release=r);throw Error('INJECTED_PATCH_FAILURE');`:`const response=await state.original.apply(window,args);entry.response=performance.now();entry.status=response.status;await new Promise(r=>state.release=r);return response;`}}const response=await state.original.apply(window,args);entry.response=performance.now();entry.status=response.status;return response;}})()`);
   const targetRoom=scenario==='background-edit'?rooms[1].id:rooms[0].id;
   if(scenario.startsWith('archive'))await menu(targetRoom,'Archive Room');else await edit(targetRoom,'First '+scenario);
   let expected=scenario==='background-edit'?sessions[0]:scenario==='rename-session'||scenario==='archive-session'?sessions[1]:scenario==='rename-overlap'?sessions[0]:sessions[2];
   if(scenario!=='background-edit'){
    await wait('!!window.__roomMutation.release');
    if(scenario.endsWith('-session'))await c.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${expected}"] button[aria-label^="Open session"]').click()`);
    else if(scenario==='rename-back'){const h=await c.send('Page.getNavigationHistory');await c.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id})}
    else if(scenario==='rename-overlap'){await edit(rooms[0].id,'Second settled');await wait("window.__roomMutation.requests.some(r=>r.method==='PATCH'&&r.body.name==='Second settled'&&r.response)");await sleep(250)}
    else {await open(rooms[1].id);await wait(`${sid}==='${sessions[2]}'`);if(scenario==='rename-failure'){await edit(rooms[1].id,'Concurrent survives');await sleep(400)}}
    await wait(`${sid}==='${expected}'`);
   }
   result.expected=expected;result.before=await c.evaluate(snapshot);
   await c.evaluate(`(()=>{const s=window.__roomMutation;s.releasedAt=performance.now();const tick=()=>{s.frames.push(${snapshot});if(!s.done)requestAnimationFrame(tick)};requestAnimationFrame(tick);s.release?.()})()`);await sleep(1600);result.after=await c.evaluate(snapshot);result.details=await c.evaluate('window.__roomMutation.done=true;({requests:window.__roomMutation.requests,frames:window.__roomMutation.frames})');result.pass=result.after.session===expected;
   result.staleObservedAt=await c.evaluate('performance.now()');
   for(let i=0;i<750;i++){if(await c.evaluate(`document.querySelector('[data-pibo-room-id="${rooms[1].id}"]').textContent.includes('First background-edit')`)){result.recoveredAt=await c.evaluate('performance.now()');break}await sleep(50)}
   result.recovery=await c.evaluate(snapshot);
   result.backend=await c.evaluate(`(async()=>{const r=await fetch('/api/chat/navigation?roomId=${rooms[0].id}');return await r.json()})()`);
   console.log(JSON.stringify({scenario,pass:result.pass,expected,actual:result.after.session,requests:result.details.requests.map(q=>({url:q.url,status:q.status})),wrongFrames:result.details.frames.filter(f=>f.session!==expected).length}));
  }catch(error){result.error=String(error);console.log(JSON.stringify(result))}finally{await release().catch(()=>{});await c.evaluate(`fetch('/api/chat/rooms/${rooms[0].id}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({archived:false})})`).catch(()=>{});}
 }
}finally{
 await writeFile('/tmp/room-mutation-natural-staleness.json',JSON.stringify({rooms,sessions,results},null,2));
 for(const room of rooms){await c.evaluate(`(async()=>{const current=await(await fetch('/api/chat/navigation?roomId=${room.id}')).json();const name=current.room?.name||${JSON.stringify(room.name)};for(const[method,body]of[['PATCH',{archived:true}],['DELETE',{confirmName:name}]]){const r=await fetch('/api/chat/rooms/${room.id}',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Cleanup '+r.status)}})()`).catch(e=>console.error(e))}c.close();
}
