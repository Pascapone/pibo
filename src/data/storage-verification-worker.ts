import { DatabaseSync } from "node:sqlite";

const [path, mode, fixture] = process.argv.slice(2) as [string, "quick" | "full", string | undefined];
const started = Date.now();
const send = (message: Record<string, unknown>) => process.send?.(message);
let db: DatabaseSync | undefined;
try {
	send({ type: "progress", stage: "opened", elapsedMs: 0 });
	db = new DatabaseSync(path, { readOnly: true });
	db.exec("PRAGMA busy_timeout = 50");
	const pragma = mode === "full" ? "integrity_check" : "quick_check";
	send({ type: "progress", stage: pragma, elapsedMs: Date.now() - started });
	if (fixture === "native-long") {
		db.prepare("WITH RECURSIVE counter(value) AS (VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 1000000000) SELECT SUM(value) FROM counter").get();
	}
	const rows = db.prepare(`PRAGMA ${pragma}`).all() as Array<Record<string, unknown>>;
	const messages = rows.slice(0, 100).flatMap((row) => Object.values(row).map(String));
	send({ type: "result", ok: messages.length === 1 && messages[0] === "ok", messages, elapsedMs: Date.now() - started });
} catch (error) {
	send({ type: "error", message: error instanceof Error ? error.message.slice(0, 500) : "Verification failed", elapsedMs: Date.now() - started });
} finally {
	db?.close();
	process.disconnect?.();
}
