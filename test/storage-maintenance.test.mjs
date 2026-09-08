import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
		const partial = await verifyStorage({ path: f.path, mode: "full", timeoutMs: 20, testNativeLongRunning: true });
		assert.equal(partial.status, "partial"); assert.equal(partial.healthy, false); assert.equal(partial.reason, "timeout");
		assert.ok(partial.progress.some((item) => item.stage === "integrity_check"));
		assert.ok(partial.progress.some((item) => item.stage === "terminated"));
		assert.ok(Date.now() - partialStarted < 2000);
		f.store.db.prepare("INSERT INTO generated_large_store VALUES(zeroblob(16))").run();
		const complete = await verifyStorage({ path: f.path, mode: "quick", timeoutMs: 10_000 });
		assert.equal(complete.status, "complete"); assert.equal(complete.healthy, true); assert.ok(complete.progress.length >= 2);
	} finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("checkpoint and retention are dry-run by default; apply is bounded, audited, and retains orphan payloads", async () => {
	const f = fixture();
	try {
		const payload = f.store.payloads.writePayload({ value: "live payload ".repeat(2000), contentType: "text/plain", retentionClass: "live_delta" });
		f.store.eventLog.appendEvent({ sessionId: "ps_storage", sessionSequence: 1, topic: "pibo.output", type: "assistant_delta", source: "test", retentionClass: "live_delta", payloadRef: payload.id, createdAt: "2025-01-01T00:00:00Z" });
		f.store.eventLog.appendEvent({ sessionId: "ps_storage", sessionSequence: 2, topic: "pibo.output", type: "assistant_message", source: "test", idempotencyKey: "keep-idempotency", retentionClass: "chat_message", attributes: { inlinePayload: "keep" }, createdAt: "2025-01-01T00:00:00Z" });
		f.store.eventLog.appendEvent({ sessionId: "ps_storage", sessionSequence: 3, topic: "pibo.output", type: "assistant_delta", source: "test", idempotencyKey: "keep-live-delta-evidence", retentionClass: "live_delta", createdAt: "2025-01-01T00:00:00Z" });
		const plan = await maintainStorageRetention({ path: f.path, before: "2026-01-01T00:00:00Z", limit: 1, payloadRoot: f.payloadRoot });
		assert.equal(plan.mode, "dry-run"); assert.equal(plan.eligible, 1);
		assert.equal(plan.plan.find((item) => item.retentionClass === "trace_event").disposition, "deferred_requires_policy");
		assert.equal(f.store.eventLog.listEvents({ sessionId: "ps_storage" }).length, 3);
		const checkpointPlan = checkpointStorage({ path: f.path }); assert.equal(checkpointPlan.mutation, false);
		const applied = await maintainStorageRetention({ path: f.path, before: "2026-01-01T00:00:00Z", limit: 1, apply: true, payloadRoot: f.payloadRoot });
		assert.equal(applied.deleted, 1); assert.equal(applied.payloads.action, "report_only");
		assert.equal(applied.payloads.referenceState, "not_scanned_online"); assert.equal(applied.payloads.retainedMetadata, 1);
		assert.equal(f.store.payloads.readPayloadText(payload.id), "live payload ".repeat(2000));
		assert.ok(f.store.eventLog.findByIdempotencyKey("keep-idempotency"));
		assert.ok(f.store.eventLog.findByIdempotencyKey("keep-live-delta-evidence"));
		const audit = f.store.db.prepare("SELECT status, details_json FROM storage_maintenance_audit WHERE id = ?").get(applied.auditId);
		assert.equal(audit.status, "complete"); assert.equal(JSON.parse(audit.details_json).deleted, 1);
		const checkpoint = checkpointStorage({ path: f.path, mode: "passive", apply: true }); assert.equal(checkpoint.mutation, true);
		const status = inspectStorageStatus({ path: f.path }); assert.ok(status.last.retention); assert.ok(status.last.checkpoint);
	} finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("payload-reference status scans are explicitly bounded", () => {
	const f = fixture();
	try {
		const insert = f.store.db.prepare("INSERT INTO payloads (id, sha256, storage_kind, content_type, encoding, byte_size, retention_class, created_at) VALUES (?, ?, 'inline', 'text/plain', 'identity', 1, 'live_delta', '2025-01-01T00:00:00Z')");
		f.store.db.exec("BEGIN");
		try { for (let index = 0; index < 10_005; index += 1) insert.run(`sample-${index}`, `hash-${index}`); f.store.db.exec("COMMIT"); }
		catch (error) { f.store.db.exec("ROLLBACK"); throw error; }
		const started = Date.now(); const status = inspectStorageStatus({ path: f.path });
		assert.equal(status.payloads.rows, 10_000); assert.equal(status.payloads.rowsComplete, false);
		assert.equal(status.payloads.sampledRows, 1000); assert.equal(status.payloads.integrityComplete, false);
		assert.equal(status.sizes.payloadStoreSampleComplete, false); assert.ok(Date.now() - started < 2000);
	} finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("checkpoint refuses missing paths and invalid runtime modes", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-storage-checkpoint-"));
	try {
		const missing = join(root, "missing.sqlite");
		assert.throws(() => checkpointStorage({ path: missing, apply: true }), /does not exist/);
		assert.equal(existsSync(missing), false);
		const f = fixture(); try { assert.throws(() => checkpointStorage({ path: f.path, mode: "invalid", apply: true }), /mode must/); } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
	} finally { rmSync(root, { recursive: true, force: true }); }
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

test("payload size completeness follows the 1000-row byte sample, not the larger row count", () => {
 const f = fixture();
 try {
  const insert = f.store.db.prepare("INSERT INTO payloads (id, sha256, storage_kind, content_type, encoding, byte_size, retention_class, created_at) VALUES (?, ?, 'inline', 'text/plain', 'identity', 1, 'live_delta', '2025-01-01T00:00:00Z')");
  f.store.transaction(() => { for (let i = 0; i < 1001; i++) insert.run(`bounded-${i}`, `hash-${i}`); });
  const status = inspectStorageStatus({ path: f.path, payloadWarnBytes: 1001 });
  assert.equal(status.payloads.rowsComplete, true);
  assert.equal(status.payloads.rows, 1001);
  assert.equal(status.sizes.payloadStoreMetadataSample, 1000);
  assert.equal(status.sizes.payloadStoreSampleComplete, false);
  assert.ok(status.warnings.includes("payload_size_threshold_indeterminate"));
 } finally { f.store.close(); rmSync(f.root, { recursive: true, force: true }); }
});
