export type RuntimeInitializationTiming = { sessionId: string; waitMs: number; totalMs: number; phases: Record<string,number>; outcome: "ready" | "failed" };
export type RuntimeCapacityStatus = ReturnType<RuntimeCapacity["snapshot"]> & {
 activeRuntimes: number; initializingRuntimes: number; recentInitializations: RuntimeInitializationTiming[];
};
export type CapacityLease = { release(): void };
export type RuntimeCapacityOptions = {
 coldStarts?: number; providerTurns?: number; providerTurnsPerRoom?: number;
 maxWaiting?: number; maxWaitMs?: number; maxRuntimes?: number;
};

export function resolveRuntimeCapacityOptions(env: NodeJS.ProcessEnv = process.env): Required<RuntimeCapacityOptions> {
 const read=(name:string,fallback:number)=>{
  if(!env[name]?.trim())return fallback;
  const n=Number(env[name]);if(!Number.isSafeInteger(n)||n<1)throw new Error(`${name} must be a positive integer.`);return n;
 };
 return {
  coldStarts:read("PIBO_GATEWAY_MAX_COLD_STARTS",2),providerTurns:read("PIBO_GATEWAY_MAX_PROVIDER_TURNS",10),
  providerTurnsPerRoom:read("PIBO_GATEWAY_MAX_PROVIDER_TURNS_PER_ROOM",5),maxWaiting:read("PIBO_GATEWAY_MAX_RUNTIME_WAITERS",64),
  maxWaitMs:read("PIBO_GATEWAY_MAX_RUNTIME_WAIT_MS",60_000),maxRuntimes:read("PIBO_GATEWAY_MAX_ACTIVE_RUNTIMES",32),
 };
}

type Waiter = {
 room: string; reserved: boolean; queuedAt: number; resolve(lease: CapacityLease): void; reject(error: Error): void;
 cleanup(): void;
};

/** Bounded room round-robin. Cancellation removes a waiter without consuming a slot. */
export class FairCapacityPool {
 private readonly rooms = new Map<string, Waiter[]>();
 private readonly activeRooms = new Map<string, number>();
 private active = 0;
 private generalActive = 0;
 private readonly generalRooms = new Map<string,number>();
 private waiting = 0;
 private closed = false;
 constructor(private readonly limit: number, private readonly perRoom: number,
  private readonly maxWaiting: number, private readonly maxWaitMs: number, private readonly reserved = 0) {
  if(!Number.isSafeInteger(reserved)||reserved<0||reserved>=limit)throw new Error("Reserved capacity must leave at least one normal slot.");
  for (const n of [limit,perRoom,maxWaiting,maxWaitMs]) if (!Number.isSafeInteger(n)||n<1) throw new Error("Capacity limits must be positive integers.");
 }
 acquire(room: string, signal?: AbortSignal, reserved = false): Promise<CapacityLease> {
  if(this.closed) return Promise.reject(capacityError("Runtime capacity is closed."));
  if(signal?.aborted) return Promise.reject(signal.reason ?? capacityError("Capacity wait cancelled."));
  if(this.waiting>=this.maxWaiting-(reserved?0:Math.min(this.reserved,this.maxWaiting-1))) return Promise.reject(capacityError("Runtime capacity wait queue is full."));
  return new Promise((resolve,reject)=>{
   let timer: ReturnType<typeof setTimeout>;
   const cancel=()=>{
    const queue=this.rooms.get(room);const index=queue?.indexOf(waiter) ?? -1;
    if(index<0) return;
    queue!.splice(index,1);this.waiting--;if(!queue!.length)this.rooms.delete(room);
    waiter.cleanup();reject(signal?.aborted ? signal.reason : capacityError("Runtime capacity wait deadline exceeded."));this.drain();
   };
   const waiter: Waiter={room,reserved,queuedAt:Date.now(),resolve,reject,cleanup:()=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);}};
   const queue=this.rooms.get(room)??[];queue.push(waiter);this.rooms.set(room,queue);this.waiting++;
   timer=setTimeout(cancel,this.maxWaitMs);timer.unref?.();signal?.addEventListener("abort",cancel,{once:true});
   this.drain();
  });
 }
 snapshot() {
  let oldest=0;for(const queue of this.rooms.values()) oldest=Math.max(oldest,Date.now()-queue[0]!.queuedAt);
  return {active:this.active,waiting:this.waiting,limit:this.limit,perRoom:this.perRoom,reserved:this.reserved,maxWaiting:this.maxWaiting,maxWaitMs:this.maxWaitMs,oldestWaitMs:oldest};
 }
 close(): void {
  this.closed=true;
  for(const queue of this.rooms.values())for(const waiter of queue){waiter.cleanup();waiter.reject(capacityError("Runtime capacity is closed."));}
  this.rooms.clear();this.waiting=0;
 }
 private drain(): void {
  while(!this.closed && this.active<this.limit){
   const eligible=(waiter:Waiter)=>(this.activeRooms.get(waiter.room)??0)<this.perRoom && (waiter.reserved ||
    (this.generalActive<this.limit-this.reserved && (this.generalRooms.get(waiter.room)??0)<this.perRoom-Math.min(this.reserved,1,this.perRoom-1)));
   const entry=[...this.rooms].find(([,queue])=>queue.some(eligible));
   if(!entry)return;
   const [room,queue]=entry;const [waiter]=queue.splice(queue.findIndex(eligible),1);
   this.rooms.delete(room);if(queue.length)this.rooms.set(room,queue);
   if(!waiter!.reserved){this.generalActive++;this.generalRooms.set(room,(this.generalRooms.get(room)??0)+1);}
   this.waiting--;this.active++;this.activeRooms.set(room,(this.activeRooms.get(room)??0)+1);waiter!.cleanup();
   let released=false;
   waiter!.resolve({release:()=>{
    if(released)return;released=true;this.active--;
    if(!waiter!.reserved){this.generalActive--;const general=this.generalRooms.get(room)!-1;if(general)this.generalRooms.set(room,general);else this.generalRooms.delete(room);}
    const count=this.activeRooms.get(room)!-1;if(count)this.activeRooms.set(room,count);else this.activeRooms.delete(room);
    this.drain();
   }});
  }
 }
}
export class RuntimeCapacity {
 readonly starts: FairCapacityPool;
 readonly maxRuntimes: number;
 private readonly providers=new Map<string,FairCapacityPool>();
 private closed=false;
 private readonly options: Required<RuntimeCapacityOptions>;
 constructor(options: RuntimeCapacityOptions={}) {
  this.options={...resolveRuntimeCapacityOptions(),...options};
  for(const n of Object.values(this.options))if(!Number.isSafeInteger(n)||n<1)throw new Error("Runtime capacity limits must be positive integers.");
  this.maxRuntimes=this.options.maxRuntimes;
  this.starts=new FairCapacityPool(this.options.coldStarts,1,this.options.maxWaiting,this.options.maxWaitMs);
 }
 async acquireProvider(provider: string,room: string,signal?: AbortSignal, nested = false): Promise<CapacityLease> {
  if(this.closed)throw capacityError("Runtime capacity is closed.");
  let pool=this.providers.get(provider);
  if(!pool){
   if(this.providers.size>=64)throw capacityError("Active provider capacity registry is full.");
   pool=new FairCapacityPool(this.options.providerTurns,this.options.providerTurnsPerRoom,this.options.maxWaiting,this.options.maxWaitMs,Math.min(2,this.options.providerTurns-1));
   this.providers.set(provider,pool);
  }
  try {
   const lease=await pool.acquire(room,signal,nested);
   return {release:()=>{lease.release();this.removeIdleProvider(provider,pool!);}};
  } catch(error){this.removeIdleProvider(provider,pool);throw error;}
 }
 snapshot(){return {coldStarts:this.starts.snapshot(),maxRuntimes:this.maxRuntimes,providers:[...this.providers].map(([provider,pool])=>({provider,...pool.snapshot()}))};}
 close(){this.closed=true;this.starts.close();for(const pool of this.providers.values())pool.close();this.providers.clear();}
 private removeIdleProvider(provider:string,pool:FairCapacityPool){const state=pool.snapshot();if(!state.active&&!state.waiting&&this.providers.get(provider)===pool)this.providers.delete(provider);}
}
function capacityError(message:string): Error {return Object.assign(new Error(message),{code:"runtime_capacity_unavailable"});}
