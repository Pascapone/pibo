import { tsImport } from "tsx/esm/api";
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { emptyPluginTabset, openPluginTab, closePluginTab, updatePluginTab, availablePluginViews, SessionTabController, PluginHttpError, pluginTabDeepLink, parsePluginTabDeepLink } = await tsImport("../src/apps/chat-ui/src/plugins/session-tab-controller.ts", import.meta.url);
const { BrowserPluginHost, PluginArtifact, runPluginInputHooks, sessionPluginRequest } = await tsImport("../src/apps/chat-ui/src/plugins/browser-host.tsx", import.meta.url);
const { pluginConfigurationPath } = await tsImport("../src/apps/chat-ui/src/plugins/plugin-settings.tsx", import.meta.url);
const { recordedBuildNodes } = await tsImport("../src/apps/chat-ui/src/plugins/build-context-view.tsx", import.meta.url);
const { PluginManagement } = await tsImport("../src/apps/chat-ui/src/plugins/plugin-management.tsx", import.meta.url);
import { pluginBrowserRoute, pluginBrowserCatalog, handlePluginBrowserRoute } from '../dist/apps/chat/plugin-browser-routes.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fixture(session = 'ps_A') {
 const contribution = { id:'notes', kind:'view', scope:'agent', required:false, defaultEnabled:true, schemaVersion:1, context:{kind:'none',reason:'UI'}, view:{title:'Notes',exportName:'Notes',visibility:'session',instance:'singleton',mount:'unmount',stateSchemaVersion:1,subviews:[{id:'settings',title:'Settings',purpose:'settings',settingsScopes:['session']}]}};
 const installation = {pluginId:'example.notes',revision:'sha256:r1',version:'1.0.0',contentHash:'abc',state:'active',enabled:true,stateRevision:1,source:{kind:'builtin',name:'notes'},createdAt:'2026-09-12',manifest:{schemaVersion:1,id:'example.notes',name:'Notes',version:'1.0.0',sdk:'^1.0.0',entrypoints:{browser:'browser/entry.js'},contributions:[contribution]}};
 const catalog = pluginBrowserCatalog([installation], 1);
 const entry = {id:'example.notes/notes',pluginId:installation.pluginId,pluginRevision:installation.revision,contribution,config:{},required:false,selectionReason:'explicit',dependencyPath:[]};
 const plan = {schemaVersion:1,kind:'generation',piboSessionId:session,generation:'g1',catalogRevision:1,selectionRevision:1,runtime:{adapterId:'test',instanceId:'test',capabilities:{}},selection:{schemaVersion:1,plugins:[]},plugins:[],contributions:[entry],resources:[],configurations:[],pluginConfigurations:{},nodes:[],diagnostics:[],valid:true};
 return {contribution,installation,catalog,plan,entry};
}
function memoryTransport() {
 const records = new Map(); const writes = [];
 return { records,writes,read:async(id)=>structuredClone(records.get(id)??null),write:async(state,expected)=>{writes.push(structuredClone(state)); const old=records.get(state.piboSessionId); if ((old?.revision??0)!==expected) throw new PluginHttpError('conflict',409); const next=structuredClone({...state,revision:expected+1});records.set(state.piboSessionId,next);return next;} };
}
test('tabs require a session and effective pinned view, not just installation',()=>{
 const f=fixture(); assert.throws(()=>emptyPluginTabset('room_A'));
 assert.throws(()=>openPluginTab(emptyPluginTabset('ps_B'),f.plan,f.catalog,f.entry.id));
 assert.equal(availablePluginViews({...f.plan,contributions:[]},f.catalog).length,0);
 assert.throws(()=>openPluginTab(emptyPluginTabset('ps_A'),{...f.plan,contributions:[]},f.catalog,f.entry.id));
 assert.equal(availablePluginViews(f.plan,{...f.catalog,plugins:[{...f.catalog.plugins[0],revision:'r2'}]}).length,0);
});
test('same view deduplicates only within session; state and subview are retained',()=>{
 const a=fixture(); const b=fixture('ps_B'); let state=openPluginTab(emptyPluginTabset('ps_A'),a.plan,a.catalog,a.entry.id,{instanceId:'a'});
 state=updatePluginTab(state,'a',{state:{draft:'A'},subviewId:'settings'}); state=openPluginTab(state,a.plan,a.catalog,a.entry.id);
 assert.equal(state.tabs.length,1); assert.deepEqual(state.tabs[0].state,{draft:'A'});assert.equal(state.tabs[0].subviewId,'settings');
 const other=openPluginTab(emptyPluginTabset('ps_B'),b.plan,b.catalog,b.entry.id,{instanceId:'b'});assert.deepEqual(other.tabs[0].state,{}); assert.equal(other.tabs[0].piboSessionId,'ps_B');
});
test('multiple instance identities, close neighbor, and schema mismatch preserve saved state',()=>{
 const f=fixture();f.contribution.view.instance='multiple';let state=emptyPluginTabset('ps_A');
 state=openPluginTab(state,f.plan,f.catalog,f.entry.id,{instanceId:'a',instanceKey:'one'});state=openPluginTab(state,f.plan,f.catalog,f.entry.id,{instanceId:'b',instanceKey:'two'});state=openPluginTab(state,f.plan,f.catalog,f.entry.id,{instanceKey:'one'});assert.equal(state.tabs.length,2);assert.equal(state.activeTabId,'a');
 state=closePluginTab(state,'a');assert.equal(state.activeTabId,'b');assert.equal(state.tabs[0].stateSchemaVersion,1);
});
test('A→B→A / reload persists active tab, settings subview, independent state and layout',async()=>{
 const transport=memoryTransport(); const a=new SessionTabController('ps_A',transport); const b=new SessionTabController('ps_B',transport);await a.load();await b.load();
 const f=fixture();a.edit(state=>openPluginTab(state,f.plan,f.catalog,f.entry.id,{instanceId:'a',subviewId:'settings'}));a.edit(state=>({...updatePluginTab(state,'a',{state:{context:{filter:'a'},settings:{scope:'session'}}}),layout:{width:650}}));await a.flush();
 const bf=fixture('ps_B');b.edit(state=>openPluginTab(state,bf.plan,bf.catalog,bf.entry.id,{instanceId:'b'}));await b.flush();
 const restored=new SessionTabController('ps_A',transport);await restored.load();assert.deepEqual(restored.state,a.state);assert.equal(restored.state.activeTabId,'a');assert.deepEqual(b.state.tabs[0].state,{});
});
test('late A autosave stays A while B is selected; serialized edits are not lost',async()=>{
 const transport=memoryTransport();let release;const first=new Promise(resolve=>release=resolve);const realWrite=transport.write;let count=0;transport.write=async(...args)=>{if(!count++)await first;return realWrite(...args)};
 const a=new SessionTabController('ps_A',transport);const b=new SessionTabController('ps_B',transport);await a.load();await b.load();
 const f=fixture();a.edit(state=>openPluginTab(state,f.plan,f.catalog,f.entry.id,{instanceId:'a'}));a.edit(state=>updatePluginTab(state,'a',{state:{late:true}}));const bf=fixture('ps_B');b.edit(state=>openPluginTab(state,bf.plan,bf.catalog,bf.entry.id,{instanceId:'b'}));await b.flush();release();await a.flush();
 assert.equal(transport.records.get('ps_A').tabs[0].state.late,true);assert.deepEqual(transport.records.get('ps_B').tabs[0].state,{});assert.equal(a.state.revision,2);
});
test('two-browser CAS conflict preserves losing local state and never overwrites server',async()=>{
 const transport=memoryTransport();const a=new SessionTabController('ps_A',transport);const b=new SessionTabController('ps_A',transport);await a.load();await b.load();
 a.edit(state=>({...state,layout:{owner:'first'}}));await a.flush();b.edit(state=>({...state,layout:{owner:'second'}}));await b.flush();
 assert.equal(b.conflict,true);assert.equal(b.state.layout.owner,'second');assert.equal(transport.records.get('ps_A').layout.owner,'first');assert.throws(()=>b.edit(state=>state));await b.load();assert.equal(b.state.layout.owner,'first');
});
test('cross-session server responses and attempted tab movement are rejected',async()=>{
 const c=new SessionTabController('ps_A',{read:async()=>emptyPluginTabset('ps_B'),write:async()=>{throw Error('unexpected')}});await c.load();assert.equal(c.ready,false);assert.match(c.error.message,/cross-session/);
 const good=new SessionTabController('ps_A',memoryTransport());await good.load();assert.throws(()=>good.edit(()=>emptyPluginTabset('ps_B')));
});
test('deep links encode the owning session, tab and subview',()=>{
 const f=fixture();const tab=openPluginTab(emptyPluginTabset('ps_A'),f.plan,f.catalog,f.entry.id,{instanceId:'tab',subviewId:'settings'}).tabs[0];const link=parsePluginTabDeepLink(new URL(pluginTabDeepLink(tab),'http://test'));assert.equal(link.piboSessionId,'ps_A');assert.equal(link.instanceId,'tab');assert.equal(link.subviewId,'settings');assert.equal(parsePluginTabDeepLink(new URL('http://test?pluginView=example.notes/notes')),null);
});
test('configuration URL fixes app/agent/session target independently from tab ownership',()=>{
 assert.match(pluginConfigurationPath({scope:'session',pluginId:'notes',piboSessionId:'ps_A'}),/targetId=ps_A/);assert.match(pluginConfigurationPath({scope:'agent',pluginId:'notes',agentId:'agent'}),/scope=agent/);assert.match(pluginConfigurationPath({scope:'app',pluginId:'notes'}),/targetId=app/);
});
test('host imports only effective pinned browser modules and injects shared React/SDK',async()=>{
 const f=fixture();let calls=0;let shared;const host=new BrowserPluginHost(f.plan,f.catalog,async()=>{calls++;return {setup:(ctx)=>{shared=ctx;},Notes:()=>null}});await host.start();assert.equal(calls,1);assert.equal(typeof shared.React.useState,'function');assert.equal(shared.sdk.PLUGIN_SDK_VERSION,'1.0.0');assert.equal(host.views.size,1);await host.dispose();assert.equal(host.views.size,0);
 const disabled=new BrowserPluginHost({...f.plan,contributions:[]},f.catalog,async()=>{throw Error('must not import')});await disabled.start();assert.equal(disabled.errors.size,0);
});
test('AP11 Web Annotations history stays readable when its terminal renderer is missing',()=>{
 const envelope={schemaVersion:1,pluginId:'pibo.web-annotations',contributionId:'pibo.web-annotations/terminal',dataSchemaVersion:1,objectId:'ann_ap11',eventId:'evt_ap11',fallback:'Annotation ann_ap11: Retained review note'};
 const html=renderToStaticMarkup(React.createElement(PluginArtifact,{envelope,piboSessionId:'ps_A'}));
 assert.match(html,/data-plugin-fallback/);assert.match(html,/Annotation ann_ap11: Retained review note/);
});
test('uninstall planning keeps its confirmation UI mounted until a catalog-changing action',async()=>{
 const originalFetch=globalThis.fetch;let changed=0;let renderer;
 const installation={pluginId:'pibo.web-annotations',revision:'sha256:r1',version:'1.0.0',contentHash:'sha256:r1',state:'active',enabled:true,stateRevision:3,source:{kind:'builtin',name:'pibo.web-annotations'},createdAt:'2026-09-12T00:00:00Z',manifest:{schemaVersion:1,id:'pibo.web-annotations',name:'Annotations',version:'1.0.0',sdk:'^1.0.0',contributions:[]}};
 const operation={id:'op-1',pluginId:installation.pluginId,installationRevision:3,state:'prepared',expiresAt:'2026-09-12T00:05:00Z',impact:{sessions:1}};
 globalThis.fetch=async(input,init={})=>{const path=typeof input==='string'?input:new URL(input.url).pathname;if((init.method??'GET')==='GET'&&path==='/api/chat/plugins')return new Response(JSON.stringify({installations:[installation]}),{status:200,headers:{'content-type':'application/json'}});if(init.method==='POST'&&path.endsWith('/uninstall-plan'))return new Response(JSON.stringify(operation),{status:200,headers:{'content-type':'application/json'}});throw new Error(`unexpected request ${init.method??'GET'} ${path}`);};
 try {
  await act(async()=>{renderer=TestRenderer.create(React.createElement(PluginManagement,{onChanged:()=>{changed++;}}));await new Promise(resolve=>setTimeout(resolve,0));});
  const plan=renderer.root.findAllByType('button').find(button=>button.children.join('')==='Plan uninstall');assert.ok(plan);
  await act(async()=>{plan.props.onClick();await new Promise(resolve=>setTimeout(resolve,10));});
  assert.equal(changed,0);assert.equal(renderer.root.findByType('h3').children.join(''),'Operation prepared');
  const confirm=renderer.root.findAllByType('button').find(button=>button.children.join('')==='Confirm retained-data uninstall');assert.equal(confirm.props.disabled,true);
  assert.equal(renderer.root.findByType('input').props.value,'');
 } finally {await act(async()=>renderer?.unmount());globalThis.fetch=originalFetch;}
});
test('setup failure rolls back renderers, hooks and views',async()=>{
 const f=fixture();const host=new BrowserPluginHost(f.plan,f.catalog,async()=>({setup:(ctx)=>{ctx.registerRenderer(f.entry.id,1,()=>null);ctx.registerHook({descriptor:{id:f.entry.id,phase:'send',order:0,required:true,timeoutMs:100},run:()=>({action:'continue'})});throw Error('fixture failure');},Notes:()=>null}));await host.start();assert.equal(host.renderers.size,0);assert.equal(host.hooks.length,0);assert.match(host.errors.get('example.notes'),/fixture failure/);
});
test('undeclared executable browser registrations fail without affecting other owners',async()=>{
 const f=fixture();const host=new BrowserPluginHost(f.plan,f.catalog,async()=>({setup:(ctx)=>ctx.registerRenderer('other/renderer',1,()=>null),Notes:()=>null}));await host.start();assert.match(host.errors.get('example.notes'),/Undeclared/);assert.equal(host.renderers.size,0);
});
test('late module resolution after dispose never mounts executable contributions',async()=>{
 const f=fixture();let resolve;const loaded=new Promise(r=>resolve=r);const host=new BrowserPluginHost(f.plan,f.catalog,()=>loaded);const start=host.start();await host.dispose();resolve({Notes:()=>null});await start;assert.equal(host.views.size,0);
});
test('ordered input transforms retain provenance and exact session',async()=>{
 const seen=[];const make=(id,order)=>({descriptor:{id,phase:'send',order,required:true,timeoutMs:100},run:(value,ctx)=>{seen.push(ctx.piboSessionId);return {action:'transform',value:value+id,provenance:{description:id,inputRefs:[]}}}});
 const result=await runPluginInputHooks([make('test/b',2),make('test/a',1)],'send','', 'ps_A',new AbortController().signal);assert.equal(result.value,'test/atest/b');assert.deepEqual(seen,['ps_A','ps_A']);assert.equal(result.transformations.length,2);
});
test('input rejection, timeout and cancellation do not send fallback text',async()=>{
 const hook={descriptor:{id:'test/hook',phase:'paste',order:1,required:false,timeoutMs:5},run:()=>({action:'reject',reason:'denied'})};await assert.rejects(runPluginInputHooks([hook],'paste','x','ps_A',new AbortController().signal),/denied/);
 await assert.rejects(runPluginInputHooks([{...hook,run:()=>new Promise(()=>{})}],'paste','x','ps_A',new AbortController().signal),/timed out/);
 const abort=new AbortController();abort.abort(new Error('cancelled'));await assert.rejects(runPluginInputHooks([hook],'paste','x','ps_A',abort.signal),/cancelled/);
});
test('session request cannot escape plugin API namespace',()=>{
 const request=sessionPluginRequest('ps_A','notes',new AbortController().signal);assert.throws(()=>request('//evil.test'));assert.throws(()=>request('/../other'));assert.throws(()=>request('https://evil.test'));
});
test('catalog strips all server source paths, secrets and service objects',()=>{
 const f=fixture();f.installation.artifactPath='/secret/artifact';const serialized=JSON.stringify(pluginBrowserCatalog([f.installation],2));assert.doesNotMatch(serialized,/artifactPath|\/secret|stateRevision|source/);assert.equal(pluginBrowserRoute('/api/chat/plugin-browser/catalog','POST'),undefined);
});
test('asset serving uses immutable revision and denies traversal/symlink/backend escapes',async()=>{
 const f=fixture();const root=await mkdtemp(join(tmpdir(),'pibo-browser-assets-'));try {await mkdir(join(root,'browser'));await writeFile(join(root,'browser','entry.js'),'export const Notes=()=>null');await writeFile(join(root,'backend.js'),'secret');await symlink(join(root,'backend.js'),join(root,'browser','escape.js'));f.installation.artifactPath=root;
 const options={request:new Request('http://local'),installations:[f.installation],catalogRevision:1,assertSessionAccess:()=>{},getSessionPlan:async()=>{throw Error('no runtime read')}};
 const route={action:'asset',pluginId:f.installation.pluginId,revision:f.installation.revision,path:'browser/entry.js'};const response=await handlePluginBrowserRoute({...options,route});assert.equal(response.headers.get('Content-Type'),'text/javascript');assert.match(await response.text(),/export const/);
 for(const path of ['../backend.js','browser/escape.js','backend.js','browser/entry.ts']) await assert.rejects(handlePluginBrowserRoute({...options,route:{...route,path}}));await assert.rejects(handlePluginBrowserRoute({...options,route:{...route,revision:'stale'}}));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('session plan route checks access and never reads another session',async()=>{
 const f=fixture();const calls=[];const options={route:{action:'plan',piboSessionId:'ps_A'},request:new Request('http://local'),installations:[],catalogRevision:1,assertSessionAccess:(id)=>calls.push(['access',id]),getSessionPlan:async(id)=>{calls.push(['plan',id]);return {plan:f.plan}}};await handlePluginBrowserRoute(options);assert.deepEqual(calls,[['access','ps_A'],['plan','ps_A']]);await assert.rejects(handlePluginBrowserRoute({...options,getSessionPlan:async()=>({plan:fixture('ps_B').plan})}));
});
test('build evidence reads only saved nodes, never synthesizes current catalog nodes',()=>{
 assert.deepEqual(recordedBuildNodes({catalog:{plugins:['not evidence']}}),[]);const node={schemaVersion:1,id:'saved',status:'unknown',fallback:'saved evidence'};assert.deepEqual(recordedBuildNodes({nodes:[node]}),[node]);assert.deepEqual(recordedBuildNodes(null),[]);
});
