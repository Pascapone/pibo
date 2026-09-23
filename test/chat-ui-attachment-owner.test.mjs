import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
const execute = promisify(execFile);

test("login/session ownership closes previous drafts and never publishes a late open", async () => {
 await execute(process.execPath,["--import","tsx","--input-type=module","--eval",`
 import assert from 'node:assert/strict';
 import {ScopedIndexedAttachmentOwner} from './src/apps/chat-ui/src/attachments/core-attachment-owner.ts';
 let release;let closedA=0,closedB=0;
 const a={close(){closedA++}},b={close(){closedB++}};
 const owner=new ScopedIndexedAttachmentOwner(async ({ownerUserId})=>ownerUserId==='alice'?await new Promise(resolve=>{release=()=>resolve(a)}):b);
 const first=owner.select('alice','ps_one',{});
 const second=await owner.select('bob','ps_two',{});
 assert.equal(second,b);assert.equal(owner.current('bob','ps_two'),b);
 assert.equal(owner.current('alice','ps_one'),undefined);
 await assert.throws(()=>owner.assertCurrent('alice','ps_one',a),{code:'ATT_ACCESS_DENIED'});
 release();assert.equal(await first,undefined);assert.equal(closedA,1);
 owner.close();assert.equal(closedB,1);assert.equal(owner.current('bob','ps_two'),undefined);
 `],{cwd:process.cwd(),timeout:20_000,maxBuffer:1024*1024});
});
