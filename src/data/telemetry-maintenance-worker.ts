import {statSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {parentPort,workerData,threadId} from "node:worker_threads";
import {pruneTelemetryRetention} from "./telemetry-retention.js";
import {TelemetryMaintenance} from "./telemetry-maintenance.js";
if(!parentPort)throw Error("Maintenance requires a worker");
const db=new DatabaseSync(workerData.path);db.exec("PRAGMA busy_timeout=10; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
const maintenance=new TelemetryMaintenance(db);let timer:ReturnType<typeof setTimeout>|undefined,failures=0,delay=25;
let checkpointAfter=0,checkpoint:{durationMs:number;busy:number;logPages:number;checkpointedPages:number;walBytes:number;pendingSince?:number}|undefined;
function observeCheckpoint(){if(Date.now()<checkpointAfter)return;checkpointAfter=Date.now()+5000;const started=performance.now();const row=db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() as {busy:number;log:number;checkpointed:number};let walBytes=0;try{walBytes=statSync(workerData.path+"-wal").size;}catch{}checkpoint={durationMs:performance.now()-started,busy:row.busy,logPages:row.log,checkpointedPages:row.checkpointed,walBytes,pendingSince:row.log>row.checkpointed?(checkpoint?.pendingSince??Date.now()):undefined};}

function schedule(){if(timer||maintenance.status()?.status!=="running")return;timer=setTimeout(()=>{timer=undefined;try{maintenance.step();observeCheckpoint();delay=25;}catch{failures++;delay=Math.min(1000,delay*2);}schedule();},delay);timer.unref();}
parentPort.on("message",(request:{id:number;command:{action:"start"|"status"|"pause"|"resume"|"cancel"|"preview";cutoff?:string}})=>{
 try{const {action,cutoff}=request.command;
  const value=action==="preview"?["live","diagnostic","provider_event","payload_preview","incident"].map(retentionClass=>pruneTelemetryRetention(db,{retentionClass:retentionClass as import("./telemetry-retention.js").TelemetryRetentionClass,before:cutoff!,apply:false})):action==="start"?maintenance.start(cutoff!):action==="status"?maintenance.status():maintenance.control(action);
  if(action==="start"||action==="resume")schedule();parentPort!.postMessage({id:request.id,value:value??null,worker:{pid:process.pid,threadId,failures,delay,checkpoint,status:value}});
 }catch{parentPort!.postMessage({id:request.id,error:{code:"storage_maintenance_failed",message:"Telemetry maintenance command failed"}});}
});
parentPort.postMessage({ready:true,worker:{pid:process.pid,threadId,failures,delay,checkpoint,status:maintenance.status()}});
