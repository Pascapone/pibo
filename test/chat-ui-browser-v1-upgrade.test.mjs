import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("first Chat UI upgrade snapshots desktopTabs v1 before posting once and retains the source", async () => {
	const script = `
		import assert from "node:assert/strict";
		const source = JSON.stringify({version:1,tabs:[{id:"bound",target:{kind:"plugin-view",piboSessionId:"ps_a",viewId:"test.notes/view",title:"Notes"}}],activeTabId:"bound"});
		const values = new Map([["pibo.chat.desktopTabs.v1", source]]);
		globalThis.localStorage = { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
		let requests = 0;
		globalThis.fetch = async (path, init) => {
			requests += 1;
			assert.equal(path, "/api/chat/plugins/migrate-browser-v1");
			assert.equal(JSON.parse(init.body).source, source);
			return new Response(JSON.stringify({sourceHash:"hash",backupRetained:true,migratedSessions:["ps_a"],alreadyAppliedSessions:[],unresolved:[],blocked:[]}), {status:200,headers:{"content-type":"application/json"}});
		};
		const migration = await import("./src/apps/chat-ui/src/plugins/browser-v1-upgrade.ts");
		assert.equal(values.get(migration.BROWSER_V1_SOURCE_BACKUP_KEY), source);
		const first = await migration.migrateBrowserV1TabsOnce();
		const second = await migration.migrateBrowserV1TabsOnce();
		assert.equal(requests, 1);
		assert.deepEqual(second, first);
		assert.equal(migration.readBrowserV1UpgradeReport().sourceHash, "hash");
		assert.equal(values.get(migration.BROWSER_V1_SOURCE_BACKUP_KEY), source);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd(), maxBuffer: 2 * 1024 * 1024 });
});


test("a failed upgrade request can retry without losing the originally captured browser source", async () => {
	const script = `
		import assert from "node:assert/strict";
		const source = JSON.stringify({version:1,tabs:[]});
		const values = new Map([["pibo.chat.desktopTabs.v1", source]]);
		globalThis.localStorage = { getItem(key) { return values.get(key) ?? null; }, setItem(key,value) { values.set(key,value); } };
		let requests = 0;
		globalThis.fetch = async (path,init) => {
			requests++;
			assert.equal(JSON.parse(init.body).source,source);
			if(requests === 1) return new Response("temporarily unavailable",{status:503});
			return new Response(JSON.stringify({sourceHash:"hash",backupRetained:true,migratedSessions:[],alreadyAppliedSessions:[],unresolved:[],blocked:[]}),{status:200});
		};
		const migration = await import("./src/apps/chat-ui/src/plugins/browser-v1-upgrade.ts");
		await assert.rejects(migration.migrateBrowserV1TabsOnce());
		assert.equal(migration.readBrowserV1UpgradeReport(),null);
		values.set("pibo.chat.desktopTabs.v1","changed by UI");
		const result = await migration.migrateBrowserV1TabsOnce();
		assert.equal(result.sourceHash,"hash");
		assert.equal(requests,2);
		assert.equal(values.get(migration.BROWSER_V1_SOURCE_BACKUP_KEY),source);
	`;
	await execFileAsync(process.execPath,["--import","tsx","--input-type=module","--eval",script],{cwd:process.cwd(),maxBuffer:2*1024*1024});
});
