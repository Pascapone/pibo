import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { CapacityLease, RuntimeCapacity } from "./runtime-capacity.js";

/** Pi's request boundary releases before tool work, so parents cannot pin slots while awaiting children. */
export function createProviderCapacityExtension(capacity: RuntimeCapacity, room: string, nested = false): ExtensionFactory {
 return pi=>{
  let lease: CapacityLease|undefined;
  let removeAbort: (()=>void)|undefined;
  const release=()=>{removeAbort?.();removeAbort=undefined;lease?.release();lease=undefined;};
  pi.on("before_provider_request",async (_event,ctx)=>{
   // Retries replace a previous failed HTTP request, never overlap its reservation.
   release();
   const signal=ctx.signal;
   try {
    lease=await capacity.acquireProvider(ctx.model?.provider ?? "pi-unknown",room,signal,nested);
    if(signal?.aborted){release();return;}
    signal?.addEventListener("abort",release,{once:true});
    removeAbort=()=>signal?.removeEventListener("abort",release);
   } catch(error) {
    // Extension errors are observational in Pi. Abort explicitly so a rejected wait cannot send anyway.
    ctx.abort();throw error;
   }
  });
  pi.on("after_provider_response",event=>{if(event.status>=400)release();});
  pi.on("message_end",event=>{if(event.message.role === "assistant")release();});
  pi.on("agent_end",release);
  pi.on("session_shutdown",release);
 };
}
