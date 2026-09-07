import {parseArgs} from "node:util";
import {createStorageBackup,readStorageBackupManifest,verifyStorageBackup,restoreStorageBackup} from "../data/storage-backup.js";
export async function runStorageBackupCli(args:string[]):Promise<void>{
 const action=args[0];if(!action||args.includes("--help")||args.includes("-h")){console.log(`pibo debug backup - explicit SQLite snapshot and payload backup
Commands:
  create   --source <sqlite> --payload-root <dir> --destination <new-dir>
           [--resume] [--max-bytes <n>] [--max-payloads <n>] [--max-ms <n>] [--max-wal-growth <n>]
  inspect  --archive <dir>                    Read the manifest only
  verify   --archive <dir>                    Verify database and all payload hashes
  restore  --archive <dir> --destination <new-dir>
Defaults: 1 GiB data, 100000 payloads, 60000 ms and 64 MiB extra source WAL per create attempt. Resume preserves the original snapshot.
Each archive contains one database snapshot. Product and reliability snapshots are separate cuts.
No source deletion, vacuum, or overwrite of an existing restore destination.`);return;}
 const {values}=parseArgs({args:args.slice(1),options:{source:{type:"string"},"payload-root":{type:"string"},destination:{type:"string"},archive:{type:"string"},resume:{type:"boolean"},"max-bytes":{type:"string"},"max-payloads":{type:"string"},"max-ms":{type:"string"},"max-wal-growth":{type:"string"},json:{type:"boolean"}}});
 const required=(name:keyof typeof values)=>{const value=values[name];if(typeof value!=="string"||!value)throw Error(`Missing --${name}`);return value;};
 let result:unknown;
 if(action==="create")result=await createStorageBackup({source:required("source"),payloadRoot:required("payload-root"),destination:required("destination"),resume:values.resume,maxBytes:values["max-bytes"]?Number(values["max-bytes"]):undefined,maxPayloads:values["max-payloads"]?Number(values["max-payloads"]):undefined,maxMilliseconds:values["max-ms"]?Number(values["max-ms"]):undefined,maxWalGrowthBytes:values["max-wal-growth"]?Number(values["max-wal-growth"]):undefined});
 else if(action==="inspect")result=await readStorageBackupManifest(required("archive"));
 else if(action==="verify")result=await verifyStorageBackup(required("archive"),AbortSignal.timeout(60000));
 else if(action==="restore")result=await restoreStorageBackup(required("archive"),required("destination"),AbortSignal.timeout(60000));
 else throw Error("Unknown backup action; use backup --help");console.log(JSON.stringify(result,null,2));
}
