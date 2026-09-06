import {readFile,writeFile} from 'node:fs/promises';
import {CdpClient} from '/opt/pibo-releases/3.4.1/node_modules/@pasko70/pibo/dist/tools/cdp-client.js';
const ids=JSON.parse(await readFile('/tmp/viewport-real-ids.json','utf8'));
const targets=await(await fetch('http://127.0.0.1:9223/json/list')).json();
const client=new CdpClient(targets.find(t=>t.type==='page'&&t.url.includes('slot-01.pool')).webSocketDebuggerUrl);
await client.connect();const results=[];
try{for(const width of [1431,390]){
 await client.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600});
 await new Promise(r=>setTimeout(r,400));
 await client.evaluate(`window.__viewportAcceptance?.header?.remove(); document.querySelector('button[aria-label="Scroll to latest"]')?.click()`);await new Promise(r=>setTimeout(r,900));
 const before=await client.evaluate(`(()=>{
  const terminal=document.querySelector('[data-pibo-debug="compact-terminal-session-view"]');
  if(terminal?.dataset.piboSessionId!==${JSON.stringify(ids.a)}||!terminal.textContent.includes('PB_VIEWPORT_STREAM_COMPLETE'))throw Error('Wrong or incomplete real Session');
  const scroller=terminal.querySelector('[data-virtuoso-scroller]'),header=document.createElement('div');header.style.flex='0 0 0px';scroller.parentElement.parentElement.insertBefore(header,scroller.parentElement);
  const snap=()=>{const box=scroller.getBoundingClientRect();const rows=[...terminal.querySelectorAll('[data-pibo-debug="terminal-row"]')].filter(r=>{const b=r.getBoundingClientRect();return getComputedStyle(r).visibility==='visible'&&b.bottom>box.top&&b.top<box.bottom});return{height:scroller.clientHeight,scrollHeight:scroller.scrollHeight,top:scroller.scrollTop,gap:scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop,row:rows[0]?.dataset.rowId,offset:rows[0]?.getBoundingClientRect().top-box.top,detached:!!terminal.querySelector('button[aria-label="Scroll to latest"]')};};
  window.__viewportAcceptance={header,scroller,snap};return snap();})()`);
 if(before.gap>1)throw Error('Not initially following bottom: '+JSON.stringify(before));
 const shrink=await client.evaluate(`(async()=>{const s=window.__viewportAcceptance,frames=[],start=performance.now();s.header.style.flexBasis='30px';await new Promise(resolve=>{const tick=()=>{frames.push({ms:performance.now()-start,...s.snap()});if(performance.now()-start<400)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)});return frames})()`);
 if(shrink.at(-1).gap>1)throw Error('Viewport shrink stranded tail');
 await client.evaluate("window.__viewportAcceptance.header.style.flexBasis='0px'");await new Promise(r=>setTimeout(r,350));
 const point=await client.evaluate(`(()=>{const b=window.__viewportAcceptance.scroller.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}})()`);
 await client.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-450});await new Promise(r=>setTimeout(r,600));
 const detached=await client.evaluate('window.__viewportAcceptance.snap()');
 const resized=[];for(const height of [30,60,0]){await client.evaluate(`window.__viewportAcceptance.header.style.flexBasis='${height}px'`);await new Promise(r=>setTimeout(r,300));resized.push(await client.evaluate('window.__viewportAcceptance.snap()'));}
 if(!detached.detached||resized.some(s=>s.row!==detached.row||Math.abs(s.offset-detached.offset)>1||!s.detached))throw Error('Detached anchor changed');
 await client.evaluate(`(()=>{const s=window.__viewportAcceptance;s.wheelFrames=[s.snap().top];const start=performance.now();const tick=()=>{s.wheelFrames.push(s.snap().top);if(performance.now()-start<600)requestAnimationFrame(tick)};requestAnimationFrame(tick)})()`);
 await client.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-120});await client.evaluate("window.__viewportAcceptance.header.style.flexBasis='30px'");await new Promise(r=>setTimeout(r,750));
 const wheel=await client.evaluate('window.__viewportAcceptance.wheelFrames');const wheelDelta=wheel[0]-wheel.at(-1),kickback=Math.max(0,...wheel.slice(1).map((n,i)=>n-wheel[i]));
 results.push({width,before,shrink,detached,resized,wheel,wheelDelta,kickback});
 await client.evaluate('window.__viewportAcceptance.header.remove()');
 if(wheelDelta<100||kickback>1)throw Error('Wheel ownership failed: '+JSON.stringify({width,wheelDelta,kickback}));
}
}finally{await writeFile('/tmp/viewport-pibo2-interaction.json',JSON.stringify({at:new Date().toISOString(),ids,results},null,2));client.close()}
console.log(JSON.stringify(results.map(r=>({width:r.width,bottomGap:r.shrink.at(-1).gap,anchorDrift:Math.max(...r.resized.map(s=>Math.abs(s.offset-r.detached.offset))),wheelDelta:r.wheelDelta,kickback:r.kickback}))));
