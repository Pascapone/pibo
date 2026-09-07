import type {DatabaseSync} from "node:sqlite";
export const TELEMETRY_MAINTENANCE_SCHEMA=`CREATE TABLE IF NOT EXISTS telemetry_maintenance_job (
 id INTEGER PRIMARY KEY CHECK(id=1),retention_scope TEXT,cutoff TEXT NOT NULL,status TEXT NOT NULL,table_index INTEGER NOT NULL DEFAULT 0,class_index INTEGER NOT NULL DEFAULT 0,cursor_time TEXT NOT NULL DEFAULT '',cursor_row INTEGER NOT NULL DEFAULT 0,
 scanned INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,protected INTEGER NOT NULL DEFAULT 0,batches INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL
);`;
const CLASSES=["live","diagnostic","provider_event","payload_preview","incident"] as const;
/** A live owner updates the job on every bounded batch, so a stale stamp proves it stopped. */
export const TELEMETRY_MAINTENANCE_OWNER_LEASE_MS=30_000;
const TABLES=[
 {name:"telemetry_provider_events",time:"received_at",status:false},
 {name:"telemetry_tool_calls",time:"updated_at",status:true},
 {name:"telemetry_provider_requests",time:"updated_at",status:true},
 {name:"telemetry_phases",time:"updated_at",status:true},
 {name:"telemetry_turns",time:"updated_at",status:true},
] as const;
export type TelemetryMaintenanceStatus={retention_scope:string|null;cutoff:string;status:"running"|"paused"|"cancelled"|"completed";table_index:number;class_index:number;cursor_time:string;cursor_row:number;scanned:number;deleted:number;protected:number;batches:number;updated_at:string};
/** Only optional telemetry rows are eligible. No product, receipt, retry or payload deletion. */
export class TelemetryMaintenance {
 constructor(private readonly db:DatabaseSync){}
 status():TelemetryMaintenanceStatus|undefined{return this.db.prepare("SELECT * FROM telemetry_maintenance_job WHERE id=1").get() as TelemetryMaintenanceStatus|undefined;}
 start(cutoff:string,retentionScope?:string):TelemetryMaintenanceStatus {
  if(retentionScope&&!CLASSES.includes(retentionScope as typeof CLASSES[number]))throw Error("Invalid maintenance retention scope");
  if(!Number.isFinite(Date.parse(cutoff)))throw Error("Invalid telemetry cutoff");
  const existing=this.status();if(existing&&(existing.status==="running"||existing.status==="paused")){
   if(existing.retention_scope===(retentionScope??null))return existing;
   // A different scope only conflicts while its owner still steps the job. A persisted job whose
   // owner stopped updating it is reclaimable, so one narrow manual prune that outlived its process
   // cannot disable automatic retention permanently.
   if(Date.now()-Date.parse(existing.updated_at)<TELEMETRY_MAINTENANCE_OWNER_LEASE_MS)throw Error("Another retention scope is already running");
  }
  this.db.prepare(`INSERT INTO telemetry_maintenance_job(id,cutoff,status,updated_at,retention_scope,class_index) VALUES(1,?,'running',?,?,?)
   ON CONFLICT(id) DO UPDATE SET cutoff=excluded.cutoff,status='running',table_index=0,retention_scope=excluded.retention_scope,class_index=excluded.class_index,cursor_time='',cursor_row=0,scanned=0,deleted=0,protected=0,batches=0,updated_at=excluded.updated_at`).run(cutoff,new Date().toISOString(),retentionScope??null,retentionScope?CLASSES.indexOf(retentionScope as typeof CLASSES[number]):0);return this.status()!;
 }
 control(action:"pause"|"resume"|"cancel"):TelemetryMaintenanceStatus|undefined {
  const status=action==="pause"?"paused":action==="resume"?"running":"cancelled";
  this.db.prepare("UPDATE telemetry_maintenance_job SET status=?,updated_at=? WHERE id=1 AND status IN ('running','paused')").run(status,new Date().toISOString());return this.status();
 }
 step(options:{rows?:number;milliseconds?:number}={}):TelemetryMaintenanceStatus|undefined {
  const limit=options.rows??128,budget=options.milliseconds??4;
  if(!Number.isSafeInteger(limit)||limit<1||limit>512||!Number.isFinite(budget)||budget<=0||budget>20)throw Error("Invalid maintenance batch budget");
  if(this.status()?.status!=="running")return this.status();
  this.db.exec("BEGIN IMMEDIATE");
  try{
   const state=this.status()!;if(state.status!=="running"){this.db.exec("COMMIT");return state;}
   const spec=TABLES[state.table_index]!;
   const rows=this.db.prepare(`SELECT rowid AS cursor_row,${spec.time} AS cursor_time,pibo_session_id,turn_id ${spec.name!=="telemetry_turns"?",provider_request_id":""} ${spec.status?',status':''} FROM ${spec.name}
    WHERE retention_class=? AND (${spec.time},rowid)>(?,?) AND ${spec.time}<? ORDER BY ${spec.time},rowid LIMIT ?`).all(CLASSES[state.class_index]!,state.cursor_time,state.cursor_row,state.cutoff,limit) as Array<{cursor_row:number;cursor_time:string;pibo_session_id:string|null;turn_id:string|null;provider_request_id?:string|null;status?:string}>;
   const activeSession=this.db.prepare("SELECT 1 FROM sessions WHERE id=? AND status='running'");
   const activeTurn=this.db.prepare("SELECT 1 FROM telemetry_turns WHERE turn_id=? AND status IN ('queued','running')");
   const activeProvider=this.db.prepare("SELECT 1 FROM telemetry_provider_requests p WHERE p.provider_request_id=? AND (p.status NOT IN ('completed','error','aborted','timeout') OR EXISTS (SELECT 1 FROM telemetry_turns t WHERE t.turn_id=p.turn_id AND t.status IN ('queued','running'))) ");
   const remove=this.db.prepare(`DELETE FROM ${spec.name} WHERE rowid=? AND ${spec.time}=?`);
   const started=performance.now();let scanned=0,deleted=0,protectedRows=0;let cursorTime=state.cursor_time,cursorRow=state.cursor_row;
   for(const row of rows){
    const terminal=!spec.status||["ok","completed","error","aborted","timeout"].includes(row.status??"");
    if(!terminal||(row.pibo_session_id&&activeSession.get(row.pibo_session_id))||(row.turn_id&&activeTurn.get(row.turn_id))||(row.provider_request_id&&activeProvider.get(row.provider_request_id)))protectedRows++;
    else deleted+=Number(remove.run(row.cursor_row,row.cursor_time).changes);
    scanned++;cursorTime=row.cursor_time;cursorRow=row.cursor_row;if(performance.now()-started>=budget)break;
   }
   let tableIndex=state.table_index,classIndex=state.class_index;let status:TelemetryMaintenanceStatus["status"]=state.status;
   if(scanned===rows.length&&rows.length<limit){cursorTime="";cursorRow=0;if(state.retention_scope){tableIndex++;}else{classIndex++;if(classIndex>=CLASSES.length){classIndex=0;tableIndex++;}}if(tableIndex>=TABLES.length)status="completed";}
   this.db.prepare(`UPDATE telemetry_maintenance_job SET table_index=?,class_index=?,cursor_time=?,cursor_row=?,status=?,scanned=scanned+?,deleted=deleted+?,protected=protected+?,batches=batches+1,updated_at=? WHERE id=1`).run(tableIndex,classIndex,cursorTime,cursorRow,status,scanned,deleted,protectedRows,new Date().toISOString());
   this.db.exec("COMMIT");return this.status();
  }catch(error){this.db.exec("ROLLBACK");throw error;}
 }
}
