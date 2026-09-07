import {dirname,join} from "node:path";
import {TelemetryCaptureWriter} from "./telemetry-capture.js";
import { statSync } from "node:fs";
import { parentPort, workerData, threadId } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { TelemetryStore } from "./telemetry.js";
import type { TelemetryCommand } from "./telemetry-command.js";
import { PiboRuntimeTelemetryRecorder } from "../core/runtime-telemetry.js";
import { PiboProviderTelemetryRecorder } from "../core/provider-telemetry.js";
const db=new DatabaseSync((workerData as {path:string}).path);
db.exec("PRAGMA busy_timeout=10; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
const store=new TelemetryStore(db);
const capture=new TelemetryCaptureWriter(join(dirname(workerData.path),"telemetry-captures"));
const captureTimer=setInterval(()=>capture.append([]),1000);captureTimer.unref();
const measured=Boolean(workerData.measure);let currentKind="startup";
const measurements:Record<string,{operations:number;sql:Record<string,number>;executionMs:number}>={};
if(measured){
 const prepare=db.prepare.bind(db);
 db.prepare=(sql:string)=>{
  const statement=prepare(sql);
  for(const method of ["run","get","all"] as const){
   const original=statement[method].bind(statement);
   (statement as unknown as Record<string,unknown>)[method]=(...args:unknown[])=>{
    const kind=measurements[currentKind];const verb=sql.trim().split(/\s/,1)[0]!.toLowerCase();
    if(kind){const label=["insert","update","delete","select"].includes(verb)?verb:"other";kind.sql[label]=(kind.sql[label]??0)+1;}
    return (original as (...values:unknown[])=>unknown)(...args);
   };
  }
  return statement;
 };
}

let errors=0;let transactions=0;let operations=0;let busy=0;
const runtimes=new Map<string,PiboRuntimeTelemetryRecorder>();
function runtimeFor(input:Extract<TelemetryCommand,{recorder:"runtime"}>){
 const key=`${input.providerEventMode}:${input.progressFlushIntervalMs}`;
 let runtime=runtimes.get(key);
 if(!runtime){if(runtimes.size>=4)runtimes.delete(runtimes.keys().next().value!);runtime=new PiboRuntimeTelemetryRecorder(store,()=>{errors++;},{providerEventMode:"aggregate",progressFlushIntervalMs:input.progressFlushIntervalMs});runtimes.set(key,runtime);}
 return runtime;
}
parentPort!.on("message",(request:{id:number;command:{commands:TelemetryCommand[]};deadline:number})=>{
 const started=performance.now();let processed=0;const initialErrors=errors;
 try {
  if(request.command.commands.length>64)throw Error("Telemetry batch count exceeded");
  if(started>request.deadline)throw Error("Telemetry batch expired");
  try {
   store.transaction(()=>{
    for(const input of request.command.commands){
     if(processed && performance.now()-started>=8)break;
     currentKind=input.recorder === "runtime" && input.command.kind === "output" ? input.command.event.type : `${input.recorder}.${input.command.kind}`;
     if(measured && !measurements[currentKind]){if(Object.keys(measurements).length>=32)currentKind="other";measurements[currentKind]??={operations:0,sql:{},executionMs:0};}
     const operationStart=performance.now();
     if(input.recorder==="runtime")runtimeFor(input).executeTelemetryCommand(input.command);
     else new PiboProviderTelemetryRecorder({store,session:input.session,model:input.model,onError:()=>{errors++;}}).executeTelemetryCommand(input.command);
     if(measured){measurements[currentKind]!.operations++;measurements[currentKind]!.executionMs+=performance.now()-operationStart;}
     processed++;
    }
   });transactions++;operations+=processed;
  }catch(error){runtimes.clear();if(error instanceof Error && /busy|locked/i.test(error.message)){busy++;processed=0;}else throw error;}
  if(processed)capture.append(request.command.commands.slice(0,processed));
  const result={processed,errors:Math.min(processed,errors-initialErrors),ms:performance.now()-started,stats:{pid:process.pid,threadId,capture:capture.status(),transactions,operations,busy,rssBytes:process.memoryUsage.rss(),heapUsedBytes:process.memoryUsage().heapUsed,synchronous:"FULL",...(measured?{measurements,walBytes:(()=>{try{return statSync(workerData.path+"-wal").size;}catch{return 0;}})()}:{})}};
  parentPort!.postMessage({id:request.id,value:result});
 }catch {parentPort!.postMessage({id:request.id,error:{code:"telemetry_failed",message:"Optional telemetry batch failed"}});}
});
parentPort!.postMessage({ready:true,worker:{pid:process.pid,threadId,kind:"telemetry"}});
