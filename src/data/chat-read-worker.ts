import { ChatReadStateService } from "../apps/chat/data/read-state-service.js";
import { DatabaseSync } from "node:sqlite";
import { ChatReadProjectionStore } from "./chat-read-projections.js";
import { parentPort, workerData, threadId } from "node:worker_threads";
import { PiboDataStore } from "./pibo-store.js";
import { boundedMessageBytes } from "./bounded-worker-client.js";
import { CHAT_READ_METHODS } from "./async-chat-reads.js";
import { ChatTimelineQueryService } from "../apps/chat/data/timeline-query-service.js";
import { ChatHistoryQueryService } from "../apps/chat/data/history-query-service.js";
if (!parentPort) throw Error("Chat reads require a worker");
const store = new PiboDataStore(workerData.path,{payloadRootDir:workerData.payloadRootDir,readOnly:true});
store.db.exec("PRAGMA busy_timeout=10");
// Timeline hydration must match the in-process default. A smaller worker budget silently replaces
// message bodies with their preview and StoredChatEvent carries no payload reference to recover them,
// so the same query would answer with less content than the fallback it replaced. The IPC bound stays
// owned by maxMessageBytes plus the bounded page-halving recovery in the event stream replay loop.
const services = {navigation:new ChatReadStateService(store),timeline:new ChatTimelineQueryService(store),history:new ChatHistoryQueryService(store,2*1024*1024)};
let operations=0;
const maintenanceDb=new DatabaseSync(workerData.path);maintenanceDb.exec("PRAGMA busy_timeout=10; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL");
const maintenance=new ChatReadProjectionStore(maintenanceDb);
let maintenanceFailures=0;let maintenanceDelay=25;
let maintenanceTimer:ReturnType<typeof setTimeout>|undefined;
function scheduleMaintenance(){
 if(maintenanceTimer)return;
 const state=maintenance.status();if(state.complete||state.paused)return;
 maintenanceTimer=setTimeout(()=>{maintenanceTimer=undefined;try{maintenance.step();maintenanceDelay=25;}catch{maintenanceFailures++;maintenanceDelay=Math.min(1000,maintenanceDelay*2);}scheduleMaintenance();},maintenanceDelay);
 maintenanceTimer.unref();
}
scheduleMaintenance();
parentPort.on("message", (request:{id:number;deadline:number;maxResultBytes:number;command:{group:keyof typeof services;method:string;args:unknown[]}}) => {
 try {
  if (performance.now() >= request.deadline) throw Object.assign(Error("Read deadline elapsed"),{code:"storage_deadline"});
  const {group,method,args}=request.command;
  if(String(group)==="maintenance"){
   if(method==="pause")maintenance.setPaused(true);
   else if(method==="resume"){maintenance.setPaused(false);scheduleMaintenance();}
   else if(method!=="status")throw Error("Unsupported maintenance operation");
   parentPort!.postMessage({id:request.id,value:{...maintenance.status(),failures:maintenanceFailures}});return;
  }
  if (!Object.hasOwn(services,group) || !(CHAT_READ_METHODS[group] as readonly string[]).includes(method)) throw Error("Unsupported read operation");
  const service=services[group] as unknown as Record<string,(...args:unknown[])=>unknown>;
  const value=service[method]!.apply(service,args);
  boundedMessageBytes(value,request.maxResultBytes);operations++;
  parentPort!.postMessage({id:request.id,value,worker:{pid:process.pid,threadId,operations,readOnly:true,maintenance:{...maintenance.status(),failures:maintenanceFailures}}});
 } catch(error) {
  const code=error && typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.startsWith("storage_") ? error.code : "storage_read_failed";
  parentPort!.postMessage({id:request.id,error:{code,message:"Bounded chat read failed; retry the page."}});
 }
});
parentPort.postMessage({ready:true,worker:{pid:process.pid,threadId,operations,readOnly:true,maintenance:{...maintenance.status(),failures:maintenanceFailures}}});
