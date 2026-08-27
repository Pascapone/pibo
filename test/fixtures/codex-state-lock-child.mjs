#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createCodexAppServerStateLock } from "./codex-app-server-state-lock.mjs";

const [mode, statePath] = process.argv.slice(2);
if (!mode || !statePath) throw new Error("Expected a lock child mode and state path.");

const signalReady = (value) => process.stdout.write(`${value}\n`);
const block = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000);

if (mode === "hold-old-live") {
	const lock = createCodexAppServerStateLock(statePath);
	lock.withStateLock(() => {
		const owner = JSON.parse(readFileSync(lock.ownerPath, "utf8"));
		writeFileSync(lock.ownerPath, `${JSON.stringify({ ...owner, acquiredAt: Date.now() - 60_000 })}\n`, { mode: 0o600 });
		signalReady("ready");
		block();
	});
} else if ([
	"stall-before-owner-write",
	"stall-after-owner-write",
	"stall-after-owner-linked",
	"stall-after-owner-published",
].includes(mode)) {
	const hookName = {
		"stall-before-owner-write": "testOnlyBeforeOwnerWrite",
		"stall-after-owner-write": "testOnlyAfterOwnerWrite",
		"stall-after-owner-linked": "testOnlyAfterOwnerLinked",
		"stall-after-owner-published": "testOnlyAfterOwnerPublished",
	}[mode];
	const lock = createCodexAppServerStateLock(statePath, {
		[hookName]() {
			signalReady("ready");
			block();
		},
	});
	lock.withStateLock(() => {});
} else if (mode === "acquire-and-exit") {
	const lock = createCodexAppServerStateLock(statePath);
	lock.withStateLock(() => process.exit(23));
} else if (mode === "try-acquire" || mode === "try-ambiguous") {
	const lock = createCodexAppServerStateLock(statePath, {
		timeoutMs: 250,
		...(mode === "try-ambiguous" ? { testOnlyProbeOwner: () => "ambiguous" } : {}),
	});
	try {
		lock.withStateLock(() => signalReady("acquired"));
	} catch (error) {
		signalReady(`blocked:${error instanceof Error ? error.message : String(error)}`);
	}
} else if (mode === "successor-token") {
	const lock = createCodexAppServerStateLock(statePath);
	lock.withStateLock(() => {
		const owner = JSON.parse(readFileSync(lock.ownerPath, "utf8"));
		writeFileSync(lock.ownerPath, `${JSON.stringify({ ...owner, token: randomUUID() })}\n`, { mode: 0o600 });
	});
	signalReady(existsSync(lock.lockPath) ? "successor-preserved" : "successor-removed");
} else if (mode === "async-callback") {
	const lock = createCodexAppServerStateLock(statePath);
	try {
		lock.withStateLock(() => Promise.resolve());
		signalReady("async-accepted");
	} catch (error) {
		signalReady(`${error instanceof Error ? error.message : String(error)}:${existsSync(lock.lockPath) ? "lock-retained" : "lock-released"}`);
	}
} else {
	throw new Error(`Unknown lock child mode: ${mode}`);
}
