import { DatabaseSync } from "node:sqlite";
import { PiboReliabilityStore } from "../../dist/reliability/store.js";

const [databasePath, workerId, mode, delayText = "0", leaseText = "60"] = process.argv.slice(2);
if (!databasePath || !workerId || !mode) {
	throw new Error("usage: output-retry-multiprocess-worker.mjs <db> <worker> <heartbeat|stale> [delay-ms] [lease-ms]");
}

const delayMs = Number(delayText);
const leaseMs = Number(leaseText);
const store = new PiboReliabilityStore(databasePath);
const claimed = store.claimRecoverableJob("job_multiprocess", workerId, leaseMs);
if (!claimed) {
	process.stdout.write(`${JSON.stringify({ workerId, claimed: false })}\n`);
	store.close();
	process.exit(0);
}

process.stdout.write(`${JSON.stringify({ workerId, claimed: true, claimToken: claimed.claimToken })}\n`);
let heartbeat;
if (mode === "heartbeat") {
	heartbeat = setInterval(() => {
		store.heartbeat(claimed.jobId, workerId, leaseMs, claimed.claimToken);
	}, Math.max(5, Math.floor(leaseMs / 4)));
}

await new Promise((resolve) => setTimeout(resolve, delayMs));
if (heartbeat) clearInterval(heartbeat);

const sink = new DatabaseSync(databasePath);
sink.exec("CREATE TABLE IF NOT EXISTS observable_output_effects (delivery_id TEXT PRIMARY KEY, delivered_by TEXT NOT NULL)");
sink.prepare("INSERT OR IGNORE INTO observable_output_effects (delivery_id, delivered_by) VALUES (?, ?)").run("delivery:multiprocess", workerId);
sink.close();

const acked = store.ack(claimed.jobId, workerId, claimed.claimToken);
process.stdout.write(`${JSON.stringify({ workerId, acked, claimToken: claimed.claimToken })}\n`);
store.close();
