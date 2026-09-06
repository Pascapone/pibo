import {Session} from 'node:inspector';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {PiboDataStore} from '/workspace/dist/data/pibo-store.js';
import {PiboDataSessionStore} from '/workspace/dist/sessions/pibo-data-store.js';
import {PiboSessionRouter} from '/workspace/dist/core/session-router.js';
import {createWebHostChannel} from '/workspace/dist/web/channel.js';
const data=new PiboDataStore(':memory:');const store=new PiboDataSessionStore(data);
for(let i=0;i<511;i++)store.create({id:'ps_'+i,channel:'pibo.test',kind:'chat',profile:'base'});
const router=new PiboSessionRouter({persistSession:false,sessionStore:store});
let lists=0,gets=0;const list=store.list.bind(store),get=store.get.bind(store);store.list=()=>{lists++;return list()};store.get=(id)=>{gets++;return get(id)};
let count=1;const channel=createWebHostChannel({port:4918,gatewayMode:'prod',announce:false});
await channel.start({listSessionRuntimeStatuses:()=>Array.from({length:count},(_,i)=>({piboSessionId:'ps_'+i,processing:false,streaming:false,queuedMessages:0})),snapshotSignalSession:id=>router.snapshotSignalSession(id),listRuns:()=>[],getGatewayActions:()=>[],getWebApps:()=>[]});
const inspector=new Session();inspector.connect();const post=promisify(inspector.post).bind(inspector);
try{
 await(await fetch('http://127.0.0.1:4918/gateway/status')).json();
 await post('Profiler.enable');await post('Profiler.start');
 for(count of [1,10,29]){lists=gets=0;const start=performance.now();const response=await fetch('http://127.0.0.1:4918/gateway/status');const body=await response.json();console.log(JSON.stringify({count,ms:performance.now()-start,lists,gets,status:response.status,runtimes:body.runtimeStatuses.length}));}
 const {profile}=await post('Profiler.stop');await writeFile('/tmp/status-scaling-parent.cpuprofile',JSON.stringify(profile));
}finally{inspector.disconnect();await channel.stop();await router.disposeAll();data.close();}
