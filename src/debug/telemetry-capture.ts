import {parseArgs} from "node:util";
import {join,dirname} from "node:path";
import {opendir} from "node:fs/promises";
import {resolveDebugStore} from "./stores.js";
import {startTelemetryCapture,inspectTelemetryCapture,finalizeTelemetryCapture,readTelemetryCapturePage} from "../data/telemetry-capture.js";
export async function runTelemetryCaptureCli(args:string[]):Promise<void>{
 const action=args[0];if(!action||args.includes("--help")||args.includes("-h")){console.log(`pibo debug telemetry capture - scoped provider metadata in isolated stores
Commands:
  start --session <ps_...> --owner <name> --duration-ms <n> --max-bytes <n> --max-rows <n>
  stop <capture-id>       Fence appends and finalize an independent closed archive
  list                   List up to 100 manifests without opening databases
  inspect <capture-id>   Read one manifest without opening its database
  page <capture-id> [--after <sequence>] [--limit <1..100>]
Limits: one active capture, at most one hour, 64 MiB logical data and 100000 rows per run.
Detail is allow-listed provider metadata only. Arbitrary provider bodies, credentials and prompts are excluded.
Stopping/finalizing is explicit; archived data is never opened by normal gateway reads.`);return;}
 const {values,positionals}=parseArgs({args:args.slice(1),allowPositionals:true,options:{session:{type:"string"},owner:{type:"string"},"duration-ms":{type:"string"},"max-bytes":{type:"string"},"max-rows":{type:"string"},after:{type:"string"},limit:{type:"string"},json:{type:"boolean"}}});
 const root=join(dirname(resolveDebugStore("pibo-data").path),"telemetry-captures");let result:unknown;
 if(action==="start")result=startTelemetryCapture(root,{sessionId:values.session??"",owner:values.owner??"",durationMs:Number(values["duration-ms"]),maxBytes:Number(values["max-bytes"]),maxRows:Number(values["max-rows"])});
 else if(action==="list"){const entries=[];let scanned=0,truncated=false;try{const directory=await opendir(root);for await(const entry of directory){if(++scanned>1000||entries.length>=100){truncated=true;break;}if(!entry.isDirectory()||!entry.name.startsWith("capture_"))continue;try{entries.push(inspectTelemetryCapture(root,entry.name));}catch{entries.push({id:entry.name,status:"manifest_unavailable"});}}}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}result={entries,truncated};}
 else {const id=positionals[0];if(!id)throw Error("Capture id is required");if(action==="stop")result=await finalizeTelemetryCapture(root,id);else if(action==="inspect")result=inspectTelemetryCapture(root,id);else if(action==="page")result=await readTelemetryCapturePage(root,id,Number(values.after??0),Number(values.limit??50));else throw Error("Unknown capture action; use capture --help");}
 console.log(JSON.stringify(result,null,2));
}
