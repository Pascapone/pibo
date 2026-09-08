import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const input = workerData as { path: string; mode: "quick" | "full" };
const started = Date.now();
let db: DatabaseSync | undefined;
try {
	parentPort?.postMessage({ type: "progress", stage: "opened", elapsedMs: 0 });
	db = new DatabaseSync(input.path, { readOnly: true });
	db.exec("PRAGMA busy_timeout = 50");
	const pragma = input.mode === "full" ? "integrity_check" : "quick_check";
	parentPort?.postMessage({ type: "progress", stage: pragma, elapsedMs: Date.now() - started });
	const rows = db.prepare(`PRAGMA ${pragma}`).all() as Array<Record<string, unknown>>;
	const messages = rows.slice(0, 100).flatMap((row) => Object.values(row).map(String));
	parentPort?.postMessage({ type: "result", ok: messages.length === 1 && messages[0] === "ok", messages, elapsedMs: Date.now() - started });
} catch (error) {
	parentPort?.postMessage({ type: "error", message: error instanceof Error ? error.message.slice(0, 500) : "Verification failed", elapsedMs: Date.now() - started });
} finally { db?.close(); }
