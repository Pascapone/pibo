import {AsyncTelemetryMaintenance} from "../../data/async-telemetry-maintenance.js";
import {TelemetryMaintenance} from "../../data/telemetry-maintenance.js";
import type { PiboWebAppContext } from "../../web/types.js";
import type { PiboDataStore } from "../../data/pibo-store.js";
import {
	telemetryRetentionCutoff,
	type TelemetryRetentionSettings,
} from "../../core/telemetry-retention-settings.js";
import type { TelemetryRetentionClass, TelemetryPruneResult } from "../../data/telemetry-retention.js";

export type TelemetryRetentionRunResult = {
	cutoff: string;
	days: number;
	applied: boolean;
	results: TelemetryPruneResult[];
	rowsDeleted: number;
 completed?:boolean;
	bytesMatched: number;
};

export const TELEMETRY_RETENTION_CLASSES: TelemetryRetentionClass[] = [
	"live",
	"diagnostic",
	"provider_event",
	"payload_preview",
	"incident",
];

export const DEFAULT_TELEMETRY_RETENTION_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type TelemetryRetentionMaintenanceState = {
	lastCheckedAt?: number;
	running?: boolean;
 worker?:AsyncTelemetryMaintenance;
 failures?:number;
	disposed?: boolean;
	timer?: ReturnType<typeof setTimeout>;
};

export async function disposeTelemetryRetentionMaintenance(state: TelemetryRetentionMaintenanceState): Promise<void> {
	state.disposed = true;
	if (state.timer) clearTimeout(state.timer);
	state.timer = undefined;
	state.running = false;
 await state.worker?.close();state.worker=undefined;
}

export function pruneTelemetryOlderThan(input: {
	dataStore: PiboDataStore;
	days: number;
	now?: Date;
	apply?: boolean;
}): TelemetryRetentionRunResult {
	const cutoff = telemetryRetentionCutoff(input.days, input.now);
	const results:TelemetryPruneResult[]=[];
 for(const retentionClass of TELEMETRY_RETENTION_CLASSES){const result=input.dataStore.telemetry.prune({retentionClass,before:cutoff,apply:input.apply});results.push(result);if(result.completed===false)break;}
	return {
		cutoff,
		days: input.days,
		applied: input.apply === true,
		results,
        completed: results.every(result=>result.completed!==false),
		rowsDeleted: results.reduce((sum, result) => sum + result.rowsDeleted, 0),
		bytesMatched: results.reduce((sum, result) => sum + result.bytesMatched, 0),
	};
}

export function isTelemetryRetentionMaintenanceDue(input: {
	state: TelemetryRetentionMaintenanceState;
	now?: Date;
	intervalMs?: number;
}): boolean {
	if (input.state.running) return false;
	const now = input.now ?? new Date();
	const intervalMs = input.intervalMs ?? DEFAULT_TELEMETRY_RETENTION_MAINTENANCE_INTERVAL_MS;
	return !(input.state.lastCheckedAt && now.getTime() - input.state.lastCheckedAt < intervalMs);
}

export function maybeRunTelemetryRetentionMaintenance(input: {
	state: TelemetryRetentionMaintenanceState;
	dataStore: PiboDataStore;
	settings: TelemetryRetentionSettings;
	context: PiboWebAppContext;
	now?: Date;
	intervalMs?: number;
	onPruned?: (lastPrunedAt: string) => void;
}): void {
	if (input.state.disposed) return;
	if (!input.settings.enabled) return;
	if (input.state.running) return;
	const now = input.now ?? new Date();
	const intervalMs = input.intervalMs ?? DEFAULT_TELEMETRY_RETENTION_MAINTENANCE_INTERVAL_MS;
	if (input.state.lastCheckedAt && now.getTime() - input.state.lastCheckedAt < intervalMs) return;
	if (!isPersistentRetentionDue(input.settings.lastPrunedAt, now, intervalMs)) {
		input.state.lastCheckedAt = now.getTime();
		return;
	}
	input.state.lastCheckedAt = now.getTime();
	input.state.running = true;
 const cutoff=telemetryRetentionCutoff(input.settings.days,now);
 const local=input.dataStore.path===":memory:"?new TelemetryMaintenance(input.dataStore.db):undefined;
 const run=async()=>{
  try{
   if(input.state.disposed)return;
   if(local){if(!local.status()||local.status()?.status==="completed"||local.status()?.status==="cancelled")local.start(cutoff);local.step();}
   else if(!input.state.worker){input.state.worker=new AsyncTelemetryMaintenance(input.dataStore.path);await input.state.worker.command("start",cutoff);}
   const status=local?.status()??await input.state.worker!.command("status");
   if(input.state.disposed)return;
   if(status?.status==="completed"){input.onPruned?.(now.toISOString());input.state.running=false;await input.state.worker?.close();input.state.worker=undefined;return;}
   if(status?.status==="cancelled"||status?.status==="paused"){input.state.running=false;await input.state.worker?.close();input.state.worker=undefined;return;}
  }catch{input.state.failures=(input.state.failures??0)+1;await input.state.worker?.close();input.state.worker=undefined;}
  if(input.state.disposed)return;
  input.state.timer=setTimeout(()=>{input.state.timer=undefined;void run();},local?25:250);input.state.timer.unref?.();
 };
 input.state.timer=setTimeout(()=>{input.state.timer=undefined;void run();},0);input.state.timer.unref?.();
}

export function isPersistentRetentionDue(lastPrunedAt: string | undefined, now: Date, intervalMs: number): boolean {
	if (!lastPrunedAt) return true;
	const lastPrunedMs = Date.parse(lastPrunedAt);
	if (!Number.isFinite(lastPrunedMs)) return true;
	return now.getTime() - lastPrunedMs >= intervalMs;
}

export function hasActiveRuntimeWork(context: PiboWebAppContext): boolean {
	const statuses = context.channelContext.listSessionRuntimeStatuses?.()
		?? context.channelContext.listSessions?.().map((session) => context.channelContext.getSessionRuntimeStatus?.(session.id)).filter((status) => status !== undefined)
		?? [];
	return statuses.some((status) => Boolean(status?.processing || status?.streaming || (status?.queuedMessages ?? 0) > 0));
}

/** Explicit HTTP maintenance keeps SQL off the gateway and yields between every bounded batch. */
export async function pruneTelemetryOlderThanAsync(input:{dataStore:PiboDataStore;days:number;apply?:boolean;signal?:AbortSignal}):Promise<TelemetryRetentionRunResult> {
 if(input.dataStore.path===":memory:")return pruneTelemetryOlderThan(input);
 const cutoff=telemetryRetentionCutoff(input.days),worker=new AsyncTelemetryMaintenance(input.dataStore.path);
 const abort=()=>{void worker.close();};input.signal?.addEventListener("abort",abort,{once:true});
 try{
  if(input.signal?.aborted)throw Error("Maintenance request cancelled");
  if(!input.apply){const results=await worker.preview(cutoff);return {cutoff,days:input.days,applied:false,results,rowsDeleted:0,bytesMatched:results.reduce((n,r)=>n+r.bytesMatched,0),completed:true};}
  let status=await worker.command("start",cutoff);if(status?.status==="paused")status=await worker.command("resume");
  const until=Date.now()+30000;
  while(status?.status==="running"&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,100));status=await worker.command("status");}
  if(status?.status==="running")status=await worker.command("pause");
  return {cutoff:status?.cutoff??cutoff,days:input.days,applied:true,results:[],rowsDeleted:status?.deleted??0,bytesMatched:0,completed:status?.status==="completed"};
 }finally{input.signal?.removeEventListener("abort",abort);await worker.close();}
}
