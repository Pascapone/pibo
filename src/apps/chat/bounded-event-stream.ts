type Frame={value:Uint8Array;at:number};
/** Owns the only application queue; HWM zero prevents a second hidden stream queue. */
export class BoundedEventStream {
 readonly stream:ReadableStream<Uint8Array>;
 readonly writer:ReadableStreamDefaultController<Uint8Array>;
 private controller!:ReadableStreamDefaultController<Uint8Array>;
 private readonly queue:Frame[]=[];
 private bytes=0;private stopped=false;private finishing=false;
 private pendingPull?:()=>void;
 private capacityWaiter?: (ready:boolean)=>void;
 private readonly timer:ReturnType<typeof setInterval>;
 constructor(private readonly onClose:(reason:string)=>void,private readonly maximumBytes=2*1024*1024,private readonly maximumAgeMs=5000,private readonly maximumFrames=4096){
  this.stream=new ReadableStream<Uint8Array>({
   start:controller=>{this.controller=controller;},
   pull:()=>{
    const frame=this.queue.shift();
    if(frame){this.bytes-=frame.value.byteLength;this.controller.enqueue(frame.value);this.releaseCapacity();if(this.finishing&&!this.queue.length)this.stop("complete");return;}
    if(this.finishing||this.stopped){this.stop("complete");return;}
    return new Promise<void>(resolve=>{this.pendingPull=resolve;});
   },
   cancel:()=>this.stop("cancel"),
  },{highWaterMark:0});
  const self=this;
  this.writer={enqueue:value=>{this.enqueue(value);},close:()=>this.finish(),error:()=>this.stop("error"),get desiredSize(){return self.stopped?null:self.maximumBytes-self.bytes;}};
  this.timer=setInterval(()=>{if(this.queue.length&&performance.now()-this.queue[0]!.at>this.maximumAgeMs)this.stop("slow_age");},Math.min(1000,Math.max(5,maximumAgeMs/2)));this.timer.unref();
 }
 get closed(){return this.stopped||this.finishing;}
 private enqueue(value:Uint8Array):void {
  if(this.closed)return;
  if(value.byteLength>this.maximumBytes||this.bytes+value.byteLength>this.maximumBytes||this.queue.length>=this.maximumFrames){this.stop("slow_bytes");return;}
  if(this.pendingPull){const resolve=this.pendingPull;this.pendingPull=undefined;this.controller.enqueue(value);resolve();return;}
  this.queue.push({value,at:performance.now()});this.bytes+=value.byteLength;
 }
 async waitForCapacity():Promise<boolean>{if(this.closed)return false;if(this.bytes<this.maximumBytes/2)return true;return new Promise(resolve=>{this.capacityWaiter=resolve;});}
 private releaseCapacity(){if(this.bytes<this.maximumBytes/2){this.capacityWaiter?.(!this.closed);this.capacityWaiter=undefined;}}
 finish(){if(this.stopped)return;this.finishing=true;if(!this.queue.length)this.stop("complete");}
 fail(){this.stop("error");}
 private stop(reason:string){
  if(this.stopped)return;this.stopped=true;clearInterval(this.timer);this.queue.length=0;this.bytes=0;
  try{if(reason==="complete")this.controller.close();else if(reason!=="cancel")this.controller.error(Error("Event stream budget exhausted; reconnect using the last received cursor."));}catch{}
  this.pendingPull?.();this.pendingPull=undefined;this.capacityWaiter?.(false);this.capacityWaiter=undefined;this.onClose(reason);
 }
 status(){return {frames:this.queue.length,bytes:this.bytes,oldestAgeMs:this.queue.length?performance.now()-this.queue[0]!.at:0,closed:this.closed};}
}
