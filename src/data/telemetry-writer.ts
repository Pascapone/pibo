import type { TelemetryStore } from "./telemetry.js";
import { BoundedWorkerClient, boundedMessageBytes } from "./bounded-worker-client.js";
import { isTelemetryProgress, type TelemetryCommand } from "./telemetry-command.js";
export type AsyncTelemetryWriterOptions = {
 measure?:boolean; flushIntervalMs?:number; maxPendingOperations?:number; maxPendingBytes?:number; maxAgeMs?:number;
 onError?:(error:unknown)=>void;
};
type Pending={command?:TelemetryCommand;write?:()=>void;onError?: (error:unknown)=>void;bytes:number;at:number;sequence?:number};
/** Optional diagnostic projection. Product lifecycle/final events remain owned by the durable output outbox. */
export class AsyncTelemetryWriter {
 private client?:BoundedWorkerClient;
 private readonly path?:string;
 private restartAfter=0;
 private restarts=0;
 private readonly pending:Pending[]=[];
 private pendingBytes=0;
 private inFlight=0;
 private flushTimer?:ReturnType<typeof setTimeout>;
 private flushing?:Promise<void>;
 private closed=false;
 private readonly limit:number;
 private readonly byteLimit:number;
 private readonly ageLimit:number;
 private readonly interval:number;
 private accepted=0; private completed=0; private rejected=0; private failed=0; private expired=0;
 private batches=0; private maxBatchMs=0; private workerStats?:Record<string,unknown>;
 constructor(private readonly store:TelemetryStore,private readonly options:AsyncTelemetryWriterOptions={}) {
  this.limit=options.maxPendingOperations??1024;this.byteLimit=options.maxPendingBytes??4*1024*1024;
  this.ageLimit=options.maxAgeMs??2000;this.interval=options.flushIntervalMs??25;
  for(const n of [this.limit,this.byteLimit,this.ageLimit])if(!Number.isSafeInteger(n)||n<=0)throw Error("Telemetry budgets must be positive integers");
  if(!Number.isFinite(this.interval)||this.interval<0)throw Error("Invalid telemetry batching interval");
  this.path=store.databasePath;
  if(this.path)this.startWorker();
 }
 private startWorker():void {
  this.restartAfter=Date.now()+1000;
  this.client=new BoundedWorkerClient(new URL("./telemetry-worker.js",import.meta.url),{maxPending:1,maxPendingBytes:512*1024,maxMessageBytes:512*1024,maxAgeMs:this.ageLimit,workerOptions:{workerData:{path:this.path,measure:this.options.measure===true}}});
 }
 /** Compatibility for the local in-memory adapter only; closures never execute on a file-backed producer. */
 enqueue(write:()=>void,onError?:(error:unknown)=>void):boolean {
  if(this.client){this.reject(Error("File telemetry requires a structured command"),onError);return false;}
  return this.append({write,onError,bytes:64,at:performance.now()},false);
 }
 record(command:TelemetryCommand,fallback:()=>void,onError?:(error:unknown)=>void):boolean {
  try {
   const bytes=boundedMessageBytes(command,64*1024);
   return this.append({...(this.client?{command:structuredClone(command)}:{write:fallback}),bytes,onError,at:performance.now()},isTelemetryProgress(command));
  }catch(error){this.reject(error,onError);return false;}
 }
 private append(item:Pending,progress:boolean):boolean {
  const reserve=progress?Math.min(128,Math.floor(this.limit/4)):0;
  const reserveBytes=progress?Math.min(512*1024,Math.floor(this.byteLimit/4)):0;
  if(this.closed||this.pending.length+this.inFlight>=this.limit-reserve||this.pendingBytes+item.bytes>this.byteLimit-reserveBytes){
   this.reject(Error(this.closed?"Telemetry writer is closed":"Optional telemetry capacity exhausted"),item.onError);return false;
  }
  item.sequence=++this.accepted;this.pending.push(item);this.pendingBytes+=item.bytes;
  // Pressure only schedules asynchronous work; it never drains SQLite in the producer.
  this.schedule(this.pending.length>=64?0:this.interval);return true;
 }
 private schedule(delay:number):void {
  if(this.flushTimer||this.flushing||this.closed)return;
  this.flushTimer=setTimeout(()=>{this.flushTimer=undefined;void this.flush();},delay);this.flushTimer.unref?.();
 }
 async flush():Promise<void> {
  const target=this.accepted;
  if(this.flushTimer)clearTimeout(this.flushTimer);this.flushTimer=undefined;
  for(;;){
   if(this.flushing){await this.flushing;continue;}
   if(!this.pending.length || this.pending[0]!.sequence!>target)return;
   this.flushing=this.drain(target).finally(()=>{this.flushing=undefined;if(this.pending.length&&!this.closed)this.schedule(0);});
   await this.flushing;
  }
 }
 private async drain(target:number):Promise<void> {
  while(this.pending.length && this.pending[0]!.sequence!<=target){
   const batch:Pending[]=[];let bytes=0;
   while(this.pending.length && this.pending[0]!.sequence!<=target && batch.length<64 && bytes+this.pending[0]!.bytes<=256*1024){const item=this.pending.shift()!;bytes+=item.bytes;batch.push(item);}
   this.inFlight=batch.length;
   const live=batch.filter(item=>{if(performance.now()-item.at<=this.ageLimit)return true;this.expired++;return false;});
   let processed=live.length;
   try {
    if(live.length && this.client){
     if(this.client.status().closed && this.client.status().exited && Date.now()>=this.restartAfter){this.restarts++;this.startWorker();}
     // Startup consumes the same bounded queue age, without loading a second schema owner on the gateway thread.
     while(!this.client.status().ready&&!this.client.status().closed&&performance.now()-live[0]!.at<this.ageLimit)await new Promise(resolve=>setTimeout(resolve,5));
     const remainingAge=this.ageLimit-(performance.now()-live[0]!.at);
     if(remainingAge<Math.min(50,this.ageLimit/4)){this.expired+=live.length;}
     else {
      const result=await this.client.request<{processed:number;errors:number;ms:number;stats:Record<string,unknown>}>({commands:live.map(item=>item.command)},{priority:"background",timeoutMs:remainingAge});
      processed=result.processed;this.failed+=result.errors;this.completed+=processed-result.errors;
      this.maxBatchMs=Math.max(this.maxBatchMs,result.ms);this.workerStats=result.stats;this.batches++;
     }
    }else if(live.length){
     // Explicit in-memory test adapter uses the same bounded batches and asynchronous entry boundary.
     await new Promise<void>(resolve=>setImmediate(resolve));
     this.store.transaction(()=>{for(const item of live){try{item.write?.();this.completed++;}catch(error){this.failed++;this.report(error,item.onError);}}});this.batches++;
    }
   }catch(error){this.failed+=live.length;for(const item of live)this.report(error,item.onError);}
   const remaining=live.slice(processed);
   this.pending.unshift(...remaining);
   this.pendingBytes-=bytes-remaining.reduce((sum,item)=>sum+item.bytes,0);this.inFlight=0;
   if(remaining.length)await new Promise(resolve=>setTimeout(resolve,10));
  }
 }
 status(){return {mode:this.client?"worker":"in-memory",closed:this.closed,queued:this.pending.length,inFlight:this.inFlight,pendingBytes:this.pendingBytes,oldestAgeMs:this.pending.length?performance.now()-this.pending[0]!.at:0,accepted:this.accepted,restarts:this.restarts,completed:this.completed,rejected:this.rejected,failed:this.failed,expired:this.expired,batches:this.batches,maxBatchMs:this.maxBatchMs,worker:this.workerStats,transport:this.client?{ready:this.client.status().ready,closed:this.client.status().closed,exited:this.client.status().exited}:undefined,limits:{count:this.limit,bytes:this.byteLimit,ageMs:this.ageLimit,batchCount:64,batchBytes:256*1024,batchTimeMs:8}};}
 async dispose():Promise<void>{if(this.closed)return;this.closed=true;await this.flush();await this.client?.close();}
 private reject(error:unknown,handler?: (error:unknown)=>void):void{this.rejected++;this.report(error,handler);}
 private report(error:unknown,handler?: (error:unknown)=>void):void {try{handler?.(error);}catch{}if(handler!==this.options.onError)try{this.options.onError?.(error);}catch{}}
}
