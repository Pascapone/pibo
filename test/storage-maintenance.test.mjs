import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { checkpointStorage, inspectStorageStatus, maintainStorageRetention, verifyStorage } from "../dist/data/storage-maintenance.js";

const execFileAsync = promisify(execFile);
const cli = resolve("dist/bin/pibo.js");
function fixture() { const root = mkdtempSync(join(tmpdir(), "pibo-storage-maintenance-")); const path = join(root, "pibo.sqlite"), payloadRoot = join(root, "payloads"); const store = new PiboDataStore(path, { payloadRootDir: payloadRoot }); return { root, path, payloadRoot, store }; }

test("bounded storage status and verification report positive, partial, and WAL-pressure state without blocking writers", async () => {
	const f = fixture();
	try {
		f.store.db.exec("PRAGMA wal_autocheckpoint=0; CREATE TABLE generated_large_store(value BLOB)");
		const insert = f.store.db.prepare("INSERT INTO generated_large_store VALUES(zeroblob(65536))");
		for (let index = 0; index < 64; index += 1) insert.run();
		const status = inspectStorageStatus({ path: f.path, walWarnBytes: 1 });
		assert.equal(status.readOnly, true); assert.equal(status.health, "degraded"); assert.equal(status.wal.pressure, true);
		assert.ok(status.rows.find((row) => row.name === "generated_large_store").boundedCount >= 64);
		const partialStarted = Date.now();
		const partial = await verifyStorage({ path: f.path, mode: "full", timeoutMs: 1 });
		assert.equal(partial.status, "partial"); assert.equal(partial.healthy, false); assert.ok(Date.now() - partialStarted < 1000);
		f.store.db.prepare("INSERT INTO generated_large_store VALUES(zeroblob(16))").run();
		const complete = await verifyStorage({ path: f.path, mode: "quick", timeoutMs: 10_000 });
		assert.equal(complete.status, "complete"); assert.equal(complete.healthy, true); assert.ok(complete.progress.length >= 2);
	} finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("checkpoint and retention are dry-run by default; apply is bounded and reconciles only newly released payloads", async () => {
	const f = fixture();
	try {
		const payload = f.store.payloads.writePayload({ value: "live payload ".repeat(2000), contentType: "text/plain", retentionClass: "live_delta" });
		f.store.eventLog.appendEvent({ sessionId: "ps_storage", sessionSequence: 1, topic: "pibo.output", type: "assistant_delta", source: "test", retentionClass: "live_delta", payloadRef: payload.id, createdAt: "2025-01-01T00:00:00Z" });
		f.store.eventLog.appendEvent({ sessionId: "ps_storage", sessionSequence: 2, topic: "pibo.output", type: "assistant_message", source: "test", idempotencyKey: "keep-idempotency", retentionClass: "chat_message", attributes: { inlinePayload: "keep" }, createdAt: "2025-01-01T00:00:00Z" });
		const plan = await maintainStorageRetention({ path: f.path, before: "2026-01-01T00:00:00Z", limit: 1, payloadRoot: f.payloadRoot });
		assert.equal(plan.mode, "dry-run"); assert.equal(plan.eligible, 1);
		assert.equal(plan.plan.find((item) => item.retentionClass === "trace_event").disposition, "deferred_requires_policy");
		assert.equal(f.store.eventLog.listEvents({ sessionId: "ps_storage" }).length, 2);
		const checkpointPlan = checkpointStorage({ path: f.path }); assert.equal(checkpointPlan.mutation, false);
		const applied = await maintainStorageRetention({ path: f.path, before: "2026-01-01T00:00:00Z", limit: 1, apply: true, payloadRoot: f.payloadRoot });
		assert.equal(applied.deleted, 1); assert.equal(applied.payloads.removedMetadata, 1);
		assert.ok(f.store.eventLog.findByIdempotencyKey("keep-idempotency"));
		const checkpoint = checkpointStorage({ path: f.path, mode: "passive", apply: true }); assert.equal(checkpoint.mutation, true);
		const status = inspectStorageStatus({ path: f.path }); assert.ok(status.last.retention); assert.ok(status.last.checkpoint);
	} finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("real temporary-store CLI exposes status, bounded verification, dry-run retention, and explicit checkpoint apply", async () => {
	const f = fixture();
	try { f.store.close();
		const run = async (args) => JSON.parse((await execFileAsync(process.execPath, [cli, "debug", "storage", ...args], { timeout: 15_000 })).stdout);
		const status = await run(["status", "--path", f.path, "--json"]); assert.equal(status.resultType, "storage.status");
		const verification = await run(["verify", "--quick", "--timeout-ms", "10000", "--path", f.path, "--json"]); assert.equal(verification.status, "complete");
		const retention = await run(["retention", "--before", "2020-01-01T00:00:00Z", "--path", f.path, "--json"]); assert.equal(retention.mode, "dry-run");
		const checkpoint = await run(["checkpoint", "--apply", "--mode", "passive", "--path", f.path, "--json"]); assert.equal(checkpoint.mutation, true);
	} finally { try { f.store.close(); } catch {} rmSync(f.root, { recursive: true, force: true }); }
});
