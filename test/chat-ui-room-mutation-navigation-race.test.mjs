import {CdpClient} from '../dist/tools/cdp-client.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {writeFile} from 'node:fs/promises';
test('Room edits and archives preserve navigation and newer fields', {skip:!process.env.PIBO_TEST_CDP_URL}, async t=>{
const target=(await(await fetch(process.env.PIBO_TEST_CDP_URL+'/json/list')).json()).find(t=>t.type==='page'&&t.url.includes('/apps/chat'));
assert.ok(target,'Open the authenticated worker Chat before running this opt-in test');
const baseUrl=new URL(target.url).origin;
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
 for(const scenario of ['background-edit','rename-session','rename-room','rename-back','rename-failure','rename-overlap','archive-session','archive-room','warm-session']){
  await t.test(scenario,async()=>{
  const result={scenario};results.push(result);
  try{
   if(scenario==='rename-back'){await c.send('Page.navigate',{url:`${baseUrl}/apps/chat/rooms/${rooms[1].id}/sessions/${sessions[2]}?view=terminal`});await wait(`${sid}==='${sessions[2]}'`);await open(rooms[0].id);await wait(`${sid}==='${sessions[0]}'`)}else{await c.send('Page.navigate',{url:`${baseUrl}/apps/chat/rooms/${rooms[0].id}/sessions/${sessions[0]}?view=terminal`});await wait(`${sid}==='${sessions[0]}'`)}
   if(scenario==='archive-session'){
    await c.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${sessions[1]}"] button[aria-label^="Open session"]').click()`);await wait(`${sid}==='${sessions[1]}'`);
    await c.evaluate(`fetch('/api/chat/debug/streaming-fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({piboSessionId:'${sessions[1]}',deltas:['ROOM_MUTATION_archive-session_${sessions[1]}'],cadenceMs:10,traceSnapshots:true})}).then(r=>{if(!r.ok)throw Error('Fixture '+r.status)})`);
    await wait(`!![...document.querySelectorAll('[data-row-kind="message.assistant"]')].find(e=>e.textContent.includes('ROOM_MUTATION_archive-session_${sessions[1]}'))`);
    await c.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${sessions[0]}"] button[aria-label^="Open session"]').click()`);await wait(`${sid}==='${sessions[0]}'`);
   }
   result.initial=await c.evaluate(snapshot);
   if(scenario==='warm-session')for(const id of [sessions[1],sessions[0]]){await c.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${id}"] button[aria-label^="Open session"]').click()`);await wait(`${sid}==='${id}'`);await sleep(1000)}
   await c.evaluate(`(()=>{const state={original:window.fetch,held:false,requests:[],frames:[],done:false};window.__roomMutation=state;window.fetch=async(...args)=>{const url=String(args[0]?.url||args[0]),method=args[1]?.method||'GET',entry={url,method,at:performance.now(),body:method==='PATCH'?JSON.parse(args[1].body):undefined};state.requests.push(entry);if(url==='/api/chat/rooms/${rooms[0].id}'&&method==='PATCH'&&!state.held){state.held=true;${scenario==='rename-failure'?`await new Promise(r=>state.release=r);throw Error('INJECTED_PATCH_FAILURE');`:`const response=await state.original.apply(window,args);entry.response=performance.now();entry.status=response.status;await new Promise(r=>state.release=r);return response;`}}const response=await state.original.apply(window,args);entry.response=performance.now();entry.status=response.status;return response;}})()`);
   const targetRoom=scenario==='background-edit'?rooms[1].id:rooms[0].id;
   if(scenario.startsWith('archive'))await menu(targetRoom,'Archive Room');else await edit(targetRoom,'First '+scenario);
   let expected=scenario==='background-edit'?sessions[0]:scenario.endsWith('-session')?sessions[1]:scenario==='rename-overlap'?sessions[0]:sessions[2];
   if(scenario!=='background-edit'){
    await wait('!!window.__roomMutation.release');
    if(scenario.endsWith('-session'))await c.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${expected}"] button[aria-label^="Open session"]').click()`);
    else if(scenario==='rename-back'){const h=await c.send('Page.getNavigationHistory');await c.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id})}
    else if(scenario==='rename-overlap'){await edit(rooms[0].id,'Second settled');await wait("window.__roomMutation.requests.some(r=>r.method==='PATCH'&&r.body.name==='Second settled'&&r.response)");await sleep(250)}
    else {await open(rooms[1].id);await wait(`${sid}==='${sessions[2]}'`);if(scenario==='rename-failure'){await edit(rooms[1].id,'Concurrent survives');await sleep(400)}}
    await wait(`${sid}==='${expected}'`);
   }
   const marker='ROOM_MUTATION_'+scenario+'_'+expected;
   if(scenario!=='archive-session')await c.evaluate(`fetch('/api/chat/debug/streaming-fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({piboSessionId:'${expected}',deltas:['${marker}'],cadenceMs:10,traceSnapshots:true})}).then(r=>{if(!r.ok)throw Error('Fixture '+r.status)})`);
   const visible=`[...document.querySelectorAll('[data-row-kind="message.assistant"]')].some(e=>{if(!e.textContent.includes('${marker}'))return false;const r=e.getBoundingClientRect(),style=getComputedStyle(e),x=Math.max(0,r.left)+Math.min(100,r.width/2),y=Math.max(0,r.top)+Math.min(10,r.height/2);return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&style.visibility==='visible'&&style.opacity!=='0'&&e.contains(document.elementFromPoint(x,y))})`;
   await wait(visible);
   result.expected=expected;result.before=await c.evaluate(snapshot);
   await c.evaluate(`(()=>{const s=window.__roomMutation;s.releasedAt=performance.now();const tick=()=>{s.frames.push(${snapshot});if(!s.done)requestAnimationFrame(tick)};requestAnimationFrame(tick);s.release?.()})()`);await sleep(1600);result.after=await c.evaluate(snapshot);result.details=await c.evaluate('window.__roomMutation.done=true;({requests:window.__roomMutation.requests,frames:window.__roomMutation.frames})');result.pass=result.after.session===expected;
   assert.equal(result.after.session,expected);
   assert.ok(result.details.frames.every(frame=>frame.session===expected),'late mutation remounted a different Session');
   const name=(frame,id)=>frame.rooms.find(room=>room.id===id)?.text;
   const expectedName=scenario==='rename-overlap'?'Second settled':scenario==='rename-failure'?name(result.initial,rooms[0].id):scenario.startsWith('archive')?name(result.initial,rooms[0].id):'First '+scenario;
   const editedId=scenario==='background-edit'?rooms[1].id:rooms[0].id;
   assert.equal(name(result.after,editedId),expectedName);
   assert.ok(result.details.frames.every(frame=>name(frame,editedId)===expectedName),'edited field regressed after settlement');
   if(scenario==='rename-failure')assert.equal(name(result.after,rooms[1].id),'Concurrent survives');
   assert.equal(result.details.requests.filter(q=>q.url.includes('/api/chat/bootstrap')).length,0,'Room metadata needs no full bootstrap hydration');
   assert.equal(await c.evaluate(visible),true);result.visible=true;
   if(scenario==='warm-session'){const screenshot=await c.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/room-mutation-navigation.png',Buffer.from(screenshot.data,'base64'))}
   if(scenario==='warm-session'){
    const id=sessions[0];await c.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${id}"] button[aria-label^="Open session"]').click()`);await wait(`${sid}==='${id}'`);await sleep(1100);result.warmReturn=await c.evaluate(snapshot);assert.equal(name(result.warmReturn,editedId),expectedName,'warm navigation restored stale metadata');
   }
   result.backend=await c.evaluate(`(async()=>{const r=await fetch('/api/chat/navigation?roomId=${rooms[0].id}');return await r.json()})()`);
   console.log(JSON.stringify({scenario,pass:result.pass,expected,actual:result.after.session,requests:result.details.requests.map(q=>({url:q.url,status:q.status})),wrongFrames:result.details.frames.filter(f=>f.session!==expected).length}));
  }catch(error){result.error=String(error);throw error}finally{await release().catch(()=>{});await c.evaluate(`fetch('/api/chat/rooms/${rooms[0].id}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({archived:false})})`).catch(()=>{});}
  });
 }
 await t.test('navigation response crossing a completed Room edit is read again without stealing selection',async()=>{
  const result={scenario:'crossed-navigation'};results.push(result);
  try{
   await c.send('Page.navigate',{url:`${baseUrl}/apps/chat/rooms/${rooms[0].id}/sessions/${sessions[0]}?view=terminal`});await wait(`${sid}==='${sessions[0]}'`);
   await c.evaluate(`(()=>{const s={original:window.fetch,requests:[],frames:[],done:false};window.__roomMutation=s;window.fetch=async(...args)=>{const url=String(args[0]?.url||args[0]),method=args[1]?.method||'GET';const entry={url,method,at:performance.now()};s.requests.push(entry);const response=await s.original.apply(window,args);entry.response=performance.now();entry.status=response.status;if(url.startsWith('/api/chat/navigation')&&method==='GET'&&!s.held){s.held=true;await new Promise(r=>s.release=r)}return response}})()`);
   await c.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${sessions[1]}"] button[aria-label^="Open session"]').click()`);await wait(`${sid}==='${sessions[1]}'`);await wait('!!window.__roomMutation.release');
   await edit(rooms[0].id,'Crossed navigation stays fresh');
   await wait("window.__roomMutation.requests.some(q=>q.method==='PATCH'&&q.status===200)");
   await c.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   result.before=await c.evaluate(snapshot);assert.equal(result.before.session,sessions[1]);
   await c.evaluate(`(()=>{const s=window.__roomMutation;const tick=()=>{s.frames.push(${snapshot});if(!s.done)requestAnimationFrame(tick)};requestAnimationFrame(tick);s.release()})()`);
   await sleep(1600);result.after=await c.evaluate(snapshot);result.details=await c.evaluate('window.__roomMutation.done=true;({requests:window.__roomMutation.requests,frames:window.__roomMutation.frames})');
   assert.ok(result.details.frames.every(f=>f.session===sessions[1]));
   assert.ok(result.details.frames.every(f=>f.rooms.find(r=>r.id===rooms[0].id)?.text==='Crossed navigation stays fresh'));
   assert.ok(result.details.requests.filter(q=>q.url.startsWith('/api/chat/navigation')).length>=2,'crossed read must be refreshed');
   assert.equal(result.details.requests.filter(q=>q.url.includes('/api/chat/bootstrap')).length,0);
  }catch(e){result.error=String(e);throw e}finally{await release()}
 });
 for(const reverse of [false,true])await t.test(`overlapping rename failures (${reverse?'newer':'older'} response first)`,async()=>{
  const result={scenario:reverse?'double-failure-newer-first':'double-failure-older-first'};results.push(result);
  try{
   await c.send('Page.navigate',{url:`${baseUrl}/apps/chat/rooms/${rooms[0].id}/sessions/${sessions[0]}?view=terminal`});await wait(`${sid}==='${sessions[0]}'`);
   const initial=await c.evaluate(snapshot);const originalName=initial.rooms.find(r=>r.id===rooms[0].id).text;
   await c.evaluate(`(()=>{const s={original:window.fetch,releases:[]};window.__roomMutation=s;window.fetch=async(...args)=>{if(String(args[0])==='/api/chat/rooms/${rooms[0].id}'&&args[1]?.method==='PATCH'){await new Promise(r=>s.releases.push(r));throw Error('INJECTED_OVERLAPPING_PATCH_FAILURE')}return s.original.apply(window,args)}})()`);
   await edit(rooms[0].id,'First pending edit');await wait('window.__roomMutation.releases.length===1');
   await edit(rooms[0].id,'Second pending edit');await wait('window.__roomMutation.releases.length===2');
   await c.evaluate(`window.__roomMutation.releases[${reverse?1:0}]()`);await sleep(300);result.intermediate=await c.evaluate(snapshot);
   assert.equal(result.intermediate.rooms.find(r=>r.id===rooms[0].id).text,reverse?'First pending edit':'Second pending edit');
   await c.evaluate(`window.__roomMutation.releases[${reverse?0:1}]()`);await sleep(300);result.after=await c.evaluate(snapshot);
   assert.equal(result.after.rooms.find(r=>r.id===rooms[0].id).text,originalName);
   assert.equal(result.after.session,sessions[0]);
  }catch(e){result.error=String(e);throw e}finally{await c.evaluate('window.__roomMutation.releases?.forEach(r=>r())');await release()}
 });
}finally{
 await writeFile('/tmp/room-mutation-navigation.json',JSON.stringify({rooms,sessions,results},null,2));
 for(const room of rooms){await c.evaluate(`(async()=>{const current=await(await fetch('/api/chat/navigation?roomId=${room.id}')).json();const name=current.room?.name||${JSON.stringify(room.name)};for(const[method,body]of[['PATCH',{archived:true}],['DELETE',{confirmName:name}]]){const r=await fetch('/api/chat/rooms/${room.id}',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Cleanup '+r.status)}})()`).catch(e=>console.error(e))}c.close();
}

});
