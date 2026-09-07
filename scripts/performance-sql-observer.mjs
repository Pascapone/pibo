// Explicit benchmark preload only. Do not load in a gateway or against private production stores.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {basename,join} from 'node:path';
import {threadId} from 'node:worker_threads';
const output=process.env.PIBO_SQL_MEASUREMENT_DIR;
if(!output)throw Error('A private benchmark measurement directory is required');
mkdirSync(output,{recursive:true});
const counters={};const connections=new WeakMap();const originalPrepare=DatabaseSync.prototype.prepare,originalExec=DatabaseSync.prototype.exec;
const bucket=db=>{let key=connections.get(db);if(!key){try{key=basename(originalPrepare.call(db,'PRAGMA database_list').all().find(r=>r.name==='main')?.file||'memory');}catch{key='unknown';}connections.set(db,key);}return counters[key]??=( {statements:{},changedRows:{},boundBytes:0,transactions:0,commits:0} );};
const bindingBytes=args=>args.reduce((sum,value)=>sum+(typeof value==='string'?Buffer.byteLength(value):ArrayBuffer.isView(value)?value.byteLength:value&&typeof value==='object'?Object.values(value).reduce((n,v)=>n+(typeof v==='string'?Buffer.byteLength(v):0),0):0),0);
DatabaseSync.prototype.prepare=function(sql){const statement=originalPrepare.call(this,sql),db=this;for(const method of ['run','get','all']){const original=statement[method].bind(statement);statement[method]=(...args)=>{if(sql.includes('measurement-only'))return original(...args);const b=bucket(db);const first=sql.trim().split(/\s/,1)[0].toLowerCase(),verb=['insert','update','delete','select'].includes(first)?first:'other';b.statements[verb]=(b.statements[verb]??0)+1;b.boundBytes+=bindingBytes(args);const result=original(...args);if(result?.changes!==undefined)b.changedRows[verb]=(b.changedRows[verb]??0)+Number(result.changes);return result;};}return statement;};
DatabaseSync.prototype.exec=function(sql){const b=bucket(this);if(/^\s*BEGIN\b/i.test(sql))b.transactions++;if(/^\s*COMMIT\b/i.test(sql))b.commits++;return originalExec.call(this,sql);};
const flush=()=>{const target=join(output,`${process.pid}-${threadId}.json`);writeFileSync(target+'.tmp',JSON.stringify({pid:process.pid,threadId,counters}));renameSync(target+'.tmp',target);};
setInterval(flush,10).unref();process.on('exit',flush);
