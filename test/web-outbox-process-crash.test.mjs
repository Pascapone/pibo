import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { startWebOutboxProcessHost, webOutboxPaths } from "./fixtures/web-outbox-process-harness.mjs";

const crashBoundaries = [
	"before-v2-write",
	"after-v2-write",
	"after-reliability-append",
	"during-projection",
	"after-live-send-before-receipt",
	"after-receipt-before-checkpoint",
];

function runCrashWorker(directory, crashBoundary, piboSessionId, targetEventId) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [
			new URL("./fixtures/web-outbox-crash-worker.mjs", import.meta.url).pathname,
			directory,
			crashBoundary,
			piboSessionId,
			targetEventId,
		], { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (signal !== "SIGKILL") reject(new Error(`crash worker exited code=${code} signal=${signal}: ${stderr}`));
			else resolve({ stdout, stderr });
		});
	});
}

async function waitFor(predicate, message, timeoutMs = 3_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(message);
}

function flatten(nodes) {
	return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

for (const crashBoundary of crashBoundaries) {
	test(`real process crash recovers web outbox ${crashBoundary} with one render identity`, async () => {
		const directory = mkdtempSync(join(tmpdir(), `pibo-web-outbox-process-${crashBoundary}-`));
		const piboSessionId = `ps_process_${crashBoundary.replaceAll("-", "_")}`;
		const targetEventId = `process-${crashBoundary}`;
		const paths = webOutboxPaths(directory);
		let host;
		try {
			const crashed = await runCrashWorker(directory, crashBoundary, piboSessionId, targetEventId);
			assert.match(crashed.stdout, /"armed":true/);
			const before = new DatabaseSync(paths.dataStorePath, { readOnly: true });
			let rowBeforeRecovery;
			try {
				rowBeforeRecovery = before.prepare("SELECT stream_id, created_at, idempotency_key FROM event_log WHERE session_id = ? AND type = 'assistant_message'").get(piboSessionId);
			} finally {
				before.close();
			}
			const reliabilityBefore = new DatabaseSync(paths.reliabilityStorePath);
			try {
				const receipts = Number(reliabilityBefore.prepare("SELECT COUNT(*) AS count FROM pibo_delivery_receipts").get().count);
				assert.equal(receipts, crashBoundary === "after-receipt-before-checkpoint" ? 1 : 0);
				// Accelerate the normal lease-expiry transition after the owning process was SIGKILLed.
				reliabilityBefore.prepare("UPDATE pibo_jobs SET claim_expires_at = ? WHERE queue = 'output-persistence'")
					.run(new Date(Date.now() - 1_000).toISOString());
			} finally {
				reliabilityBefore.close();
			}

			host = await startWebOutboxProcessHost({ directory, piboSessionId });
			const trigger = await fetch(`${host.baseURL}/api/chat/sessions`, { headers: { "x-test-user": "user-1" } });
			assert.equal(trigger.status, 200);
			await waitFor(() => {
				const db = new DatabaseSync(paths.reliabilityStorePath, { readOnly: true });
				try {
					return Number(db.prepare("SELECT COUNT(*) AS count FROM pibo_jobs WHERE queue = 'output-persistence'").get().count) === 0;
				} finally {
					db.close();
				}
			}, `web outbox did not recover ${crashBoundary}`);

			const data = new DatabaseSync(paths.dataStorePath, { readOnly: true });
			let durable;
			try {
				const rows = data.prepare("SELECT stream_id, created_at, idempotency_key, session_sequence FROM event_log WHERE session_id = ? AND type = 'assistant_message'").all(piboSessionId);
				assert.equal(rows.length, 1);
				durable = rows[0];
				assert.ok(durable.stream_id > 0);
				assert.equal(Number.isNaN(Date.parse(durable.created_at)), false);
				assert.match(durable.idempotency_key, new RegExp(targetEventId));
				assert.equal(durable.session_sequence, 1);
				if (rowBeforeRecovery) {
					assert.equal(durable.stream_id, rowBeforeRecovery.stream_id);
					assert.equal(durable.created_at, rowBeforeRecovery.created_at);
					assert.equal(durable.idempotency_key, rowBeforeRecovery.idempotency_key);
				}
			} finally {
				data.close();
			}

			const reliability = new DatabaseSync(paths.reliabilityStorePath, { readOnly: true });
			try {
				const events = reliability.prepare("SELECT event_id, idempotency_key FROM pibo_event_stream WHERE topic = 'pibo.output' AND key = ?").all(piboSessionId);
				assert.equal(events.length, 1);
				assert.equal(events[0].event_id, durable.idempotency_key);
				assert.equal(events[0].idempotency_key, durable.idempotency_key);
				const receipt = reliability.prepare("SELECT delivery_id, projection FROM pibo_delivery_receipts").all();
				assert.deepEqual(receipt.map((row) => ({ ...row })), [{ delivery_id: durable.idempotency_key, projection: "chat-web-observable-v1" }]);
				assert.equal(Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_jobs WHERE queue = 'output-persistence'").get().count), 0);
				assert.equal(Number(reliability.prepare("SELECT COUNT(*) AS count FROM pibo_dead_jobs WHERE queue = 'output-persistence'").get().count), 0);
			} finally {
				reliability.close();
			}

			for (let reload = 0; reload < 2; reload += 1) {
				const traceResponse = await fetch(`${host.baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(piboSessionId)}`, { headers: { "x-test-user": "user-1" } });
				assert.equal(traceResponse.status, 200);
				const trace = await traceResponse.json();
				const rendered = flatten(trace.nodes).filter((node) => node.type === "assistant.message" && node.eventId === targetEventId);
				assert.equal(rendered.length, 1);
				assert.equal(rendered[0].output, `durable ${crashBoundary}`);
			}
		} finally {
			await host?.channel.stop?.();
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
