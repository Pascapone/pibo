import {DatabaseSync,backup} from "node:sqlite";
import {randomUUID,createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,statSync,openSync,closeSync,fsyncSync,createReadStream} from "node:fs";
import {join} from "node:path";
import type {TelemetryCommand} from "./telemetry-command.js";
type CaptureManifest={format:"pibo-telemetry-capture-v1";id:string;status:"active"|"stopped"|"archived";sessionId:string;owner:string;detail:"provider_metadata";createdAt:string;expiresAt:string;maxBytes:number;maxRows:number;rows:number;bytes:number;sha256?:string;archiveBytes?:number};
function validId(id:string){if(!/^capture_[a-f0-9-]{36}$/.test(id))throw Error("Invalid capture id");return id;}
function readJson(path:string){if(statSync(path).size>16384)throw Error("Capture manifest exceeds budget");return JSON.parse(readFileSync(path,"utf8"));}
function publish(path:string,value:unknown){const temp=path+".tmp";writeFileSync(temp,JSON.stringify(value)+"\n",{mode:0o600});const fd=openSync(temp,"r");try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);}
export function inspectTelemetryCapture(root:string,id:string):CaptureManifest {const m=readJson(join(root,validId(id),"manifest.json")) as CaptureManifest;if(m.format!=="pibo-telemetry-capture-v1"||m.id!==id)throw Error("Invalid capture manifest");return m;}
export function startTelemetryCapture(root:string,input:{sessionId:string;owner:string;durationMs:number;maxBytes:number;maxRows:number}):CaptureManifest {
 if(!input.sessionId.startsWith("ps_")||input.sessionId.length>128||!input.owner.trim()||input.owner.length>128||!Number.isSafeInteger(input.durationMs)||input.durationMs<1000||input.durationMs>3600000||!Number.isSafeInteger(input.maxBytes)||input.maxBytes<1024||input.maxBytes>64*1024*1024||!Number.isSafeInteger(input.maxRows)||input.maxRows<1||input.maxRows>100000)throw Error("Capture requires explicit session, owner, duration, byte and row limits");
 mkdirSync(root,{recursive:true,mode:0o700});const active=join(root,"active.json");const lock=openSync(active,"wx",0o600);
 const id=`capture_${randomUUID()}`,directory=join(root,id);
 const m:CaptureManifest={format:"pibo-telemetry-capture-v1",id,status:"active",sessionId:input.sessionId,owner:input.owner,detail:"provider_metadata",createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+input.durationMs).toISOString(),maxBytes:input.maxBytes,maxRows:input.maxRows,rows:0,bytes:0};
 try{mkdirSync(directory,{mode:0o700});const db=new DatabaseSync(join(directory,"active.sqlite"));try{db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA max_page_count=${Math.ceil((input.maxBytes+1048576)/4096)}; CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),status TEXT NOT NULL,rows INTEGER NOT NULL,bytes INTEGER NOT NULL);INSERT INTO state VALUES(1,'active',0,0);CREATE TABLE events(sequence INTEGER PRIMARY KEY,received_at TEXT NOT NULL,type TEXT NOT NULL,metadata_json TEXT NOT NULL);`);}finally{db.close();}publish(join(directory,"manifest.json"),m);writeFileSync(lock,JSON.stringify({id})+"\n");fsyncSync(lock);return m;}catch(error){try{unlinkSync(active);}catch{}throw error;}finally{closeSync(lock);}
}
/** One run-owned connection; scopes and limits are checked transactionally before every append. */
export class TelemetryCaptureWriter {
 private db?:DatabaseSync;private manifest?:CaptureManifest;private refreshAfter=0;private failures=0;private dropped=0;
 constructor(private readonly root:string){}
 status(){return {id:this.manifest?.id,rows:this.manifest?.rows,bytes:this.manifest?.bytes,expiresAt:this.manifest?.expiresAt,failures:this.failures,dropped:this.dropped};}
 close(){this.db?.close();this.db=undefined;this.manifest=undefined;}
 append(commands:readonly TelemetryCommand[]){
  try{
   if(Date.now()>=this.refreshAfter){this.refreshAfter=Date.now()+1000;const path=join(this.root,"active.json");if(!existsSync(path)){this.close();return;}const id=validId(readJson(path).id);if(this.manifest?.id!==id){this.close();const m=inspectTelemetryCapture(this.root,id);if(m.status!=="active")return;this.db=new DatabaseSync(join(this.root,id,"active.sqlite"));this.db.exec("PRAGMA busy_timeout=10; PRAGMA synchronous=FULL");this.manifest=m;}}
   const db=this.db,m=this.manifest;if(!db||!m)return;
   db.exec("BEGIN IMMEDIATE");try{const state=db.prepare("SELECT status,rows,bytes FROM state WHERE id=1").get() as {status:string;rows:number;bytes:number};if(state.status!=="active"){db.exec("COMMIT");this.close();return;}
    const insert=db.prepare("INSERT INTO events(received_at,type,metadata_json) VALUES(?,?,?)");let stopped=Date.now()>=Date.parse(m.expiresAt);
    for(const input of commands){if(input.recorder!=="runtime"||input.command.kind!=="pi"||input.command.piboSessionId!==m.sessionId)continue;
     const summary=input.command.summary;const metadata={piboSessionId:m.sessionId,eventType:summary.eventType.slice(0,256),byteSize:summary.byteSize,parseStatus:summary.parseStatus,normalizedType:summary.normalizedType?.slice(0,256),assistantEventType:summary.assistantEventType?.slice(0,128),messageEnded:summary.messageEnded};
     const json=JSON.stringify(metadata),bytes=Buffer.byteLength(json)+64;if(stopped||state.rows>=m.maxRows||state.bytes+bytes>m.maxBytes){stopped=true;this.dropped++;continue;}insert.run(new Date().toISOString(),summary.eventType.slice(0,256),json);state.rows++;state.bytes+=bytes;
    }
    if(state.rows>=m.maxRows||state.bytes>=m.maxBytes)stopped=true;
    db.prepare("UPDATE state SET rows=?,bytes=?,status=? WHERE id=1").run(state.rows,state.bytes,stopped?"stopped":"active");db.exec("COMMIT");m.rows=state.rows;m.bytes=state.bytes;if(stopped){publish(join(this.root,m.id,"manifest.json"),{...m,status:"stopped",rows:state.rows,bytes:state.bytes});this.close();}
   }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
  }catch{this.failures++;this.close();}
 }
}
export async function finalizeTelemetryCapture(root:string,id:string):Promise<CaptureManifest>{
 const m=inspectTelemetryCapture(root,id);if(m.status==="archived")return m;const directory=join(root,id),db=new DatabaseSync(join(directory,"active.sqlite"));
 try{db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN IMMEDIATE");db.exec("UPDATE state SET status='stopped' WHERE id=1");const state=db.prepare("SELECT rows,bytes FROM state WHERE id=1").get() as {rows:number;bytes:number};db.exec("COMMIT");publish(join(directory,"manifest.json"),{...m,...state,status:"stopped"});
  // The archive is a separate closed snapshot; stale active handles cannot mutate it.
  await backup(db,join(directory,"archive.sqlite"),{rate:128});
  const archiveFd=openSync(join(directory,"archive.sqlite"),"r");try{fsyncSync(archiveFd);}finally{closeSync(archiveFd);}
  const hash=createHash("sha256");let bytes=0;for await(const chunk of createReadStream(join(directory,"archive.sqlite"),{highWaterMark:65536})){bytes+=chunk.length;if(bytes>m.maxBytes+1048576)throw Error("Capture archive exceeds physical quota");hash.update(chunk);}
  const archived:CaptureManifest={...m,...state,status:"archived",sha256:hash.digest("hex"),archiveBytes:bytes};publish(join(directory,"manifest.json"),archived);
  const pointer=join(root,"active.json");if(existsSync(pointer)&&readJson(pointer).id===id)unlinkSync(pointer);return archived;
 }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
export async function readTelemetryCapturePage(root:string,id:string,after=0,limit=50){const m=inspectTelemetryCapture(root,id);if(m.status!=="archived")throw Error("Capture must be finalized before inspection");if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error("Invalid capture page budget");const path=join(root,id,"archive.sqlite"),hash=createHash("sha256");let bytes=0;for await(const chunk of createReadStream(path,{highWaterMark:65536})){bytes+=chunk.length;if(bytes>m.maxBytes+1048576)throw Error("Capture archive exceeds physical quota");hash.update(chunk);}if(hash.digest("hex")!==m.sha256||bytes!==m.archiveBytes)throw Error("Capture archive hash mismatch");const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare("SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT ?").all(after,limit);}finally{db.close();}}
