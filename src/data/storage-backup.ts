import {DatabaseSync,backup} from "node:sqlite";
import {createHash} from "node:crypto";
import {createReadStream,createWriteStream,statSync} from "node:fs";
import {mkdir,open,readFile,rename,stat,copyFile} from "node:fs/promises";
import {basename,dirname,resolve,relative,join,isAbsolute} from "node:path";
import {createGunzip} from "node:zlib";
import {pipeline} from "node:stream/promises";

type Manifest={format:"pibo-storage-backup-v1";status:"snapshot"|"payloads"|"complete";source:string;payloadRoot:string;createdAt:string;databaseSha256?:string;databaseBytes?:number;payloadCount:number;payloadBytes:number;cursor:string;maxBytes:number;maxPayloads:number;catalogSha256?:string};
type PayloadRow={id:string;storage_path:string|null;sha256:string;encoding:string;byte_size:number;status:string};
type CatalogRow={id:string;path:string;sha256:string;storedSha256:string;bytes:number;encoding:string;contentBytes:number};
const MANIFEST="manifest.json",CATALOG="payloads.jsonl",DATABASE="snapshot.sqlite";
function ownedPath(root:string,path:string):string {const target=resolve(root,path),rel=relative(resolve(root),target);if(isAbsolute(path)||rel===".."||rel.startsWith("../")||rel.startsWith("..\\"))throw Error("Backup path escapes its directory");return target;}
async function syncFile(path:string){const file=await open(path,"r");try{await file.sync();}finally{await file.close();}}
async function publishManifest(root:string,manifest:Manifest){const temp=join(root,MANIFEST+".tmp"),file=await open(temp,"w",0o600);try{await file.writeFile(JSON.stringify(manifest)+"\n");await file.sync();}finally{await file.close();}await rename(temp,join(root,MANIFEST));await syncFile(root);}
export async function readStorageBackupManifest(root:string):Promise<Manifest>{const path=join(root,MANIFEST);if((await stat(path)).size>16384)throw Error("Backup manifest exceeds budget");const m=JSON.parse(await readFile(path,"utf8")) as Manifest;if(m.format!=="pibo-storage-backup-v1"||!["snapshot","payloads","complete"].includes(m.status)||!Number.isSafeInteger(m.maxBytes)||!Number.isSafeInteger(m.maxPayloads))throw Error("Unsupported backup manifest");return m;}
async function digest(path:string,maximum:number,encoding?:string,signal?:AbortSignal):Promise<{sha256:string;bytes:number}>{const input=createReadStream(path,{highWaterMark:65536,signal});const stream=encoding==="gzip"?input.pipe(createGunzip()):input;let bytes=0;const hash=createHash("sha256");try{for await(const chunk of stream){signal?.throwIfAborted();bytes+=chunk.length;if(bytes>maximum)throw Error("Backup byte quota exceeded");hash.update(chunk);}return {sha256:hash.digest("hex"),bytes};}finally{input.destroy();stream.destroy();}}

/** Explicit offline operator operation. The SQLite online-backup API includes committed WAL data. */
export async function createStorageBackup(input:{source:string;payloadRoot:string;destination:string;resume?:boolean;maxBytes?:number;maxPayloads?:number;maxMilliseconds?:number;maxWalGrowthBytes?:number;signal?:AbortSignal;onProgress?:(value:{stage:string;copied:number})=>void}):Promise<Manifest>{
 const milliseconds=input.maxMilliseconds??60000;if(!Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>3600000)throw Error("Invalid backup time quota");const timeout=AbortSignal.timeout(milliseconds);input={...input,signal:input.signal?AbortSignal.any([input.signal,timeout]):timeout};
 const root=resolve(input.destination),source=resolve(input.source),payloadRoot=resolve(input.payloadRoot),deadline=Date.now()+(input.maxMilliseconds??60000);
 const check=()=>{input.signal?.throwIfAborted();if(Date.now()>deadline)throw Error("Backup time budget exhausted; resume explicitly");};
 let manifest:Manifest;
 if(input.resume){manifest=await readStorageBackupManifest(root);if(manifest.source!==source||manifest.payloadRoot!==payloadRoot)throw Error("Backup resume source does not match manifest");}
 else {const maxBytes=input.maxBytes??1024*1024*1024,maxPayloads=input.maxPayloads??100000;if(!Number.isSafeInteger(maxBytes)||maxBytes<4096||!Number.isSafeInteger(maxPayloads)||maxPayloads<1||maxPayloads>1000000)throw Error("Invalid backup quota");await mkdir(root,{mode:0o700});manifest={format:"pibo-storage-backup-v1",status:"snapshot",source,payloadRoot,createdAt:new Date().toISOString(),payloadCount:0,payloadBytes:0,cursor:"",maxBytes,maxPayloads};await publishManifest(root,manifest);}
 if(manifest.status==="complete"){await verifyStorageBackup(root,input.signal);return manifest;}
 if(manifest.status==="snapshot"){
  check();const walBytes=()=>{try{return statSync(source+"-wal").size;}catch{return 0;}};const initialWalBytes=walBytes(),maxWalGrowth=input.maxWalGrowthBytes??64*1024*1024;if(!Number.isSafeInteger(maxWalGrowth)||maxWalGrowth<0)throw Error("Invalid WAL growth quota");const db=new DatabaseSync(source,{readOnly:true});const temporary=join(root,DATABASE+".partial");
  try{db.exec("PRAGMA busy_timeout=10; BEGIN");const pages=db.prepare("PRAGMA page_count").get()!.page_count as number,pageSize=db.prepare("PRAGMA page_size").get()!.page_size as number;if(pages*pageSize>manifest.maxBytes)throw Error("Database exceeds backup byte quota");
   await backup(db,temporary,{rate:128,progress:({totalPages,remainingPages})=>{check();if(walBytes()-initialWalBytes>maxWalGrowth)throw Error("Backup WAL growth quota exceeded; source snapshot released");if(totalPages*pageSize>manifest.maxBytes)throw Error("Database exceeds backup byte quota");input.onProgress?.({stage:"snapshot",copied:(totalPages-remainingPages)*pageSize});}});
  }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
  await syncFile(temporary);await rename(temporary,join(root,DATABASE));const hash=await digest(join(root,DATABASE),manifest.maxBytes,undefined,input.signal);manifest.databaseSha256=hash.sha256;manifest.databaseBytes=hash.bytes;manifest.status="payloads";await publishManifest(root,manifest);
 }
 const database=join(root,DATABASE);if((await digest(database,manifest.maxBytes,undefined,input.signal)).sha256!==manifest.databaseSha256)throw Error("Backup snapshot hash changed");
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  if(db.prepare("PRAGMA quick_check").get()!.quick_check!=="ok")throw Error("Backup SQLite integrity check failed");
  // Rebuild the small cursor from the fsynced catalog, including a file published before a crash.
  let count=0,bytes=0,cursor="";const catalog=join(root,CATALOG);
  const catalogFile=await open(catalog,"a+",0o600);try{const size=(await catalogFile.stat()).size;if(size){const tail=Buffer.alloc(Math.min(8192,size));await catalogFile.read(tail,0,tail.length,size-tail.length);if(tail.at(-1)!==10){const newline=tail.lastIndexOf(10);if(newline<0&&size>8192)throw Error("Invalid partial backup catalog");await catalogFile.truncate(newline<0?0:size-tail.length+newline+1);await catalogFile.sync();}}}finally{await catalogFile.close();}
  for await(const row of catalogRows(catalog,manifest.maxPayloads)){check();if(row.id<=cursor)throw Error("Backup catalog order is invalid");const hash=await digest(ownedPath(join(root,"payloads"),row.path),manifest.maxBytes,undefined,input.signal);if(hash.sha256!==row.storedSha256||hash.bytes!==row.bytes)throw Error("Backup payload changed");count++;bytes+=row.bytes;cursor=row.id;}
  manifest.payloadCount=count;manifest.payloadBytes=bytes;manifest.cursor=cursor;
  const hasPayloads=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payloads'").get());
  while(hasPayloads){check();const rows=db.prepare("SELECT id,storage_path,sha256,encoding,byte_size,status FROM payloads WHERE id>? ORDER BY id LIMIT 128").all(manifest.cursor) as PayloadRow[];if(!rows.length)break;
   for(const row of rows){check();if(!row.storage_path||row.status!=="committed")throw Error("Snapshot contains unavailable payload metadata");if(manifest.payloadCount>=manifest.maxPayloads)throw Error("Backup payload count quota exceeded");
    const sourcePath=ownedPath(payloadRoot,row.storage_path),target=ownedPath(join(root,"payloads"),row.storage_path),size=(await stat(sourcePath)).size;
    if((manifest.databaseBytes??0)+manifest.payloadBytes+size>manifest.maxBytes)throw Error("Backup byte quota exceeded");
    await mkdir(dirname(target),{recursive:true,mode:0o700});const temporary=target+".partial";await pipeline(createReadStream(sourcePath,{highWaterMark:65536}),createWriteStream(temporary,{mode:0o600}),{signal:input.signal});
    const raw=await digest(temporary,manifest.maxBytes,undefined,input.signal),content=await digest(temporary,row.byte_size,row.encoding,input.signal);if(content.sha256!==row.sha256||content.bytes!==row.byte_size)throw Error("Source payload failed content verification");
    await syncFile(temporary);await rename(temporary,target);await syncFile(dirname(target));
    const entry:CatalogRow={id:row.id,path:row.storage_path,sha256:row.sha256,storedSha256:raw.sha256,bytes:raw.bytes,encoding:row.encoding,contentBytes:row.byte_size};
    const file=await open(catalog,"a",0o600);try{await file.writeFile(JSON.stringify(entry)+"\n");await file.sync();}finally{await file.close();}
    manifest.payloadCount++;manifest.payloadBytes+=raw.bytes;manifest.cursor=row.id;input.onProgress?.({stage:"payloads",copied:manifest.payloadCount});
   }
   await publishManifest(root,manifest);
  }
  manifest.catalogSha256=(await digest(catalog,Math.max(1024,manifest.maxPayloads*4096),undefined,input.signal)).sha256;manifest.status="complete";await publishManifest(root,manifest);return manifest;
 }finally{db.close();}
}
async function* catalogRows(path:string,maximum:number):AsyncGenerator<CatalogRow>{
 const stream=createReadStream(path,{highWaterMark:65536,encoding:"utf8"});let count=0,pending="";
 const parse=(line:string)=>{if(line.length>4096||++count>maximum)throw Error("Backup catalog exceeds quota");const row=JSON.parse(line) as CatalogRow;if(typeof row.id!=="string"||typeof row.path!=="string"||!Number.isSafeInteger(row.bytes)||row.bytes<0)throw Error("Invalid backup catalog row");return row;};
 try{for await(const chunk of stream){pending+=chunk;let newline:number;while((newline=pending.indexOf("\n"))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);yield parse(line);}if(pending.length>4096)throw Error("Backup catalog line exceeds quota");}if(pending)throw Error("Incomplete backup catalog line");}finally{stream.destroy();}
}

export async function verifyStorageBackup(root:string,signal?:AbortSignal):Promise<{payloads:number;bytes:number}>{
 const m=await readStorageBackupManifest(root);if(m.status!=="complete")throw Error("Backup is incomplete");
 if((await digest(join(root,DATABASE),m.maxBytes,undefined,signal)).sha256!==m.databaseSha256||(await digest(join(root,CATALOG),Math.max(1024,m.maxPayloads*4096),undefined,signal)).sha256!==m.catalogSha256)throw Error("Backup manifest hash mismatch");
 const db=new DatabaseSync(join(root,DATABASE),{readOnly:true});let payloads=0,bytes=m.databaseBytes??0,previousId="";
 try{if(db.prepare("PRAGMA quick_check").get()!.quick_check!=="ok")throw Error("Backup database failed verification");
  const hasPayloads=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payloads'").get());
  for await(const row of catalogRows(join(root,CATALOG),m.maxPayloads)){signal?.throwIfAborted();if(row.id<=previousId)throw Error("Backup catalog order is invalid");previousId=row.id;const metadata=hasPayloads?db.prepare("SELECT sha256,storage_path,byte_size FROM payloads WHERE id=?").get(row.id):undefined;if(!metadata||metadata.sha256!==row.sha256||metadata.storage_path!==row.path||metadata.byte_size!==row.contentBytes)throw Error("Catalog does not match snapshot");const path=ownedPath(join(root,"payloads"),row.path);const raw=await digest(path,m.maxBytes,undefined,signal),content=await digest(path,row.contentBytes,row.encoding,signal);if(raw.sha256!==row.storedSha256||raw.bytes!==row.bytes||content.sha256!==row.sha256||content.bytes!==row.contentBytes)throw Error("Backup payload hash mismatch");payloads++;bytes+=raw.bytes;if(bytes>m.maxBytes)throw Error("Backup exceeds byte quota");}
  const expected=hasPayloads?Number(db.prepare("SELECT COUNT(*) AS count FROM payloads").get()!.count):0;if(payloads!==expected||payloads!==m.payloadCount)throw Error("Backup payload coverage mismatch");return {payloads,bytes};
 }finally{db.close();}
}
export async function restoreStorageBackup(root:string,destination:string,signal?:AbortSignal):Promise<{database:string;payloadRoot:string}>{
 await verifyStorageBackup(root,signal);const m=await readStorageBackupManifest(root),name=basename(m.source);if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name))throw Error("Unsafe restored database name");await mkdir(destination,{mode:0o700});const payloadRoot=join(destination,"payloads"),database=join(destination,name);
 for await(const row of catalogRows(join(root,CATALOG),m.maxPayloads)){signal?.throwIfAborted();const target=ownedPath(payloadRoot,row.path);await mkdir(dirname(target),{recursive:true,mode:0o700});await copyFile(ownedPath(join(root,"payloads"),row.path),target);await syncFile(target);}
 await copyFile(join(root,DATABASE),database);await syncFile(database);await syncFile(destination);return {database,payloadRoot};
}
