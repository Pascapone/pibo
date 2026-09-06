import {readFile,writeFile} from 'node:fs/promises';
import {CdpClient} from '/opt/pibo-releases/3.4.1/node_modules/@pasko70/pibo/dist/tools/cdp-client.js';
const ids=JSON.parse(await readFile('/tmp/creation-pibo2-ids.json','utf8'));
const targets=await(await fetch('http://127.0.0.1:9223/json/list')).json();
const c=new CdpClient(targets.find(t=>t.type==='page'&&new URL(t.url).origin===ids.origin).webSocketDebuggerUrl);await c.connect();
const results=[];
const click=async(selector)=>{const p=await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing pointer target');e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+b.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Pointer target occluded');return{x,y}})()`);await c.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
const waitFor=async(expression)=>{for(let i=0;i<100;i++){if(await c.evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Unmet condition '+expression)};
const sidebar=async()=>{await c.evaluate(`document.querySelector('button[aria-label="Open sidebar"]')?.click()`);await new Promise(r=>setTimeout(r,350))};
const release=()=>c.evaluate(`if(window.__creationAcceptance){window.fetch=window.__creationAcceptance.original;window.__creationAcceptance.release?.()}`);
try{for(const width of [1431,390])for(const scenario of ['session-before-refresh','other-room','browser-back','next-create']){
 await c.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:908,deviceScaleFactor:1,mobile:width===390});
 await c.send('Page.navigate',{url:ids.origin+'/apps/chat/rooms/'+ids.rooms[0]+'/sessions/'+ids.sessions[0]+'?view=terminal&debugStreaming=1'});
 await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId===${JSON.stringify(ids.sessions[0])} && !!document.querySelector('button[aria-label="New Session"]:not(:disabled)')`);
 await sidebar();
 await c.evaluate(`(()=>{const select=document.querySelector('select[aria-label="Agent for new sessions"]');if(![...select.options].some(o=>o.value==='rt-pi-spark'))throw Error('Spark profile missing');select.value='rt-pi-spark';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await new Promise(r=>setTimeout(r,80));
 await c.evaluate(`(()=>{
  if(document.querySelector('select[aria-label="Agent for new sessions"]').value!=='rt-pi-spark')throw Error('Wrong creation profile');
  const state={original:window.fetch,start:performance.now(),held:false,done:false,frames:[],requests:[],creations:[],phase:'create'};window.__creationAcceptance=state;
  state.pointerEvents=[];document.addEventListener('click',e=>{const button=e.target.closest('button');state.pointerEvents.push({ms:performance.now()-state.start,trusted:e.isTrusted,label:button?.getAttribute('aria-label')});});state.longTasks=[];state.observer=new PerformanceObserver(list=>state.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));state.observer.observe({type:'longtask',buffered:false});state.snapshot=()=>{const term=document.querySelector('[data-pibo-debug="compact-terminal-session-view"]'),box=term?.querySelector('[data-virtuoso-scroller]')?.getBoundingClientRect();const visible=[...document.querySelectorAll('[data-pibo-debug="terminal-row"][data-row-kind="message.assistant"]')].filter(r=>{const b=r.getBoundingClientRect();if(!box||getComputedStyle(r).visibility!=='visible'||b.bottom<=box.top||b.top>=box.bottom)return false;const hit=document.elementFromPoint((Math.max(b.left,box.left)+Math.min(b.right,box.right))/2,(Math.max(b.top,box.top)+Math.min(b.bottom,box.bottom))/2);return !!hit&&r.contains(hit)}).map(r=>r.textContent.trim());return{ms:performance.now()-state.start,phase:state.phase,session:term?.dataset.piboSessionId,path:location.pathname,disabled:document.querySelector('button[aria-label="New Session"]')?.disabled,visible}};
  window.fetch=async(...args)=>{const url=String(args[0]?.url||args[0]),method=args[1]?.method||'GET',entry={url,method,start:performance.now()-state.start};state.requests.push(entry);const r=await state.original.apply(window,args);entry.response=performance.now()-state.start;entry.status=r.status;if(url==='/api/chat/sessions'&&method==='POST'){const body=await r.clone().json();state.creations.push({session:body.session?.id,profile:body.session?.profile,ms:entry.response});}if(${JSON.stringify(scenario)}!=='ordinary'&&url.startsWith('/api/chat/bootstrap')&&!state.held){state.held=true;state.heldAt=performance.now()-state.start;await new Promise(resolve=>state.release=resolve);}return r;};
  const frame=()=>{if(state.done)return;state.frames.push(state.snapshot());requestAnimationFrame(frame)};requestAnimationFrame(frame);
 })()`);
 await click('button[aria-label="New Session"]');
 try{
  await waitFor(`window.__creationAcceptance.creations.length===1${scenario==='ordinary'?'':' && window.__creationAcceptance.held'}`);
  const created=await c.evaluate('window.__creationAcceptance.creations[0]');if(created.profile!=='rt-pi-spark')throw Error('Created wrong profile');
  await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId===${JSON.stringify(created.session)}`);
  if(['ordinary','untouched','next-create'].includes(scenario))await waitFor(`!!document.querySelector('button[aria-label="New Session"]:not(:disabled)')`);
  let expected=created.session,room=ids.rooms[0];
  if(scenario==='next-create'){
   await click('button[aria-label="New Session"]');await waitFor('window.__creationAcceptance.creations.length===2');
   const next=await c.evaluate('window.__creationAcceptance.creations[1]');if(next.profile!=='rt-pi-spark')throw Error('Wrong second profile');expected=next.session;
   await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId===${JSON.stringify(expected)}`);
  }else if(!['ordinary','untouched'].includes(scenario)){
   expected=scenario==='browser-back'?ids.sessions[0]:scenario==='other-room'?ids.sessions[2]:ids.sessions[1];room=scenario==='other-room'?ids.rooms[1]:ids.rooms[0];
   await c.evaluate(`window.__creationAcceptance.phase='intent';window.__creationAcceptance.intentAt=performance.now()-window.__creationAcceptance.start`);
   if(scenario==='browser-back'){
    await c.evaluate(`document.querySelector('button[aria-label="Close sidebar"]')?.click()`);
    const h=await c.send('Page.getNavigationHistory');await c.send('Page.navigateToHistoryEntry',{entryId:h.entries[h.currentIndex-1].id});
   }else{
    if(scenario==='other-room'){await click(`[data-pibo-debug="room-node"][data-pibo-room-id="${room}"] button`);await waitFor(`!!document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${expected}"]')`);await sidebar();}
    await click(`[data-pibo-debug="session-row"][data-pibo-session-id="${expected}"] button[aria-label^="Open session"]`);
   }
   await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId===${JSON.stringify(expected)}`);
   if(scenario==='session-after-refresh')await new Promise(r=>setTimeout(r,900));
  }
  await c.evaluate(`window.__creationAcceptance.phase='released';window.__creationAcceptance.releasedAt=performance.now()-window.__creationAcceptance.start`);
  await release();await new Promise(r=>setTimeout(r,1400));
  await c.evaluate(`document.querySelector('button[aria-label="Close sidebar"]')?.click()`);await new Promise(r=>setTimeout(r,350));
  const data=await c.evaluate(`(()=>{const s=window.__creationAcceptance;s.done=true;s.observer.disconnect();return{pointerEvents:s.pointerEvents,longTasks:s.longTasks,at:new Date().toISOString(),frames:s.frames,requests:s.requests,creations:s.creations,heldAt:s.heldAt,intentAt:s.intentAt,releasedAt:s.releasedAt,final:s.snapshot(),scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src)}})()`);
  results.push({width,scenario,expected,room,...data});
  if(data.final.session!==expected||!data.final.path.includes('/rooms/'+room+'/sessions/'+expected))throw Error('Selection stolen: '+JSON.stringify(data.final));
  if(!['ordinary','untouched','next-create'].includes(scenario)&&!data.final.visible.some(t=>t.includes('CREATION_TARGET_'+expected)||(expected===ids.sessions[0]&&(t.includes('PB_CREATION_TURN_COMPLETE')||t.includes('PB_CREATION_QUEUE_COMPLETE')))))throw Error('Correct real assistant marker is not viewport-visible');
  if(width===390&&scenario==='browser-back'){const shot=await c.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/creation-pibo2-pointer-mobile-back.png',Buffer.from(shot.data,'base64'));}
 }finally{await release();await c.evaluate('if(window.__creationAcceptance)window.__creationAcceptance.done=true');await writeFile('/tmp/creation-pibo2-pointer.json',JSON.stringify({ids,results},null,2));}
}
console.log(JSON.stringify(results.map(r=>({width:r.width,scenario:r.scenario,firstReal:r.frames.find(f=>f.session===r.creations[0].session)?.ms,firstReady:r.frames.find(f=>f.session===r.creations[0].session&&f.disabled===false)?.ms,heldAt:r.heldAt,correct:true}))));
}finally{c.close()}
