import type { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { inspectOutputDeadLetters } from "./output-dead-letters.js";
import { inspectOutputIntegrity } from "./output-integrity.js";
import type { InspectionRequest, InspectionResult, PartialAudit } from "./output-inspection-runner.js";

process.once("message", (input: InspectionRequest) => {
	const started = performance.now();
	const send = (type: string, result: InspectionResult) => process.send?.({ type, result });
	try {
		if (input.mode === "dead-letters") {
			send("result", inspectOutputDeadLetters(input, (result) => send("progress", result)));
		} else {
			const partial: PartialAudit = {
				resultType: "debug.integrity.output", formatVersion: 2, readOnly: true, health: { status: "unknown" },
				scope: { piboSessionId: input.piboSessionId, since: input.since, before: input.before, limit: Number(input.limit) },
				budget: { complete: false, elapsedMs: 0, scannedRows: 0, maxScan: input.maxScan!, timeoutMs: input.timeoutMs! },
				findings: [], summary: null,
			};
			class WorkLimit extends Error {}
			const sizes = new WeakMap<DatabaseSync, Map<string, number>>();
			const beforeQuery = (db: DatabaseSync, sql: string) => {
				let counts = sizes.get(db);
				if (!counts) { counts = new Map(); sizes.set(db, counts); }
				// Conservative upper bound for each physical table reference, not result rows.
				// COUNT's bounded preflight is charged too; scopes cannot hide historical scans.
				for (const table of ["event_log", "sessions", "pibo_jobs", "pibo_dead_jobs"]) {
					const references = [...sql.matchAll(new RegExp(`(?:FROM|JOIN)\\s+${table}\\b`, "gi"))].length;
					if (!references) continue;
					let count = counts.get(table);
					if (count === undefined) {
						const remaining = partial.budget.maxScan - partial.budget.scannedRows;
						if (remaining <= 0) throw new WorkLimit();
						count = Number((db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} LIMIT ?)`).get(remaining) as { n: number }).n);
						partial.budget.scannedRows += count;
						counts.set(table, count);
					}
					if (partial.budget.scannedRows + count * references > partial.budget.maxScan) throw new WorkLimit();
					partial.budget.scannedRows += count * references;
				}
				partial.budget.elapsedMs = performance.now() - started;
				send("progress", partial);
			};
			send("progress", partial);
			try {
				const audit = inspectOutputIntegrity({ ...input, beforeQuery });
				const returnedBytes = Buffer.byteLength(JSON.stringify(audit));
				if (returnedBytes > 1048576) {
					partial.budget.reason = "byte_limit";
					partial.budget.maxResultBytes = 1048576;
					send("result", partial);
				} else send("result", { ...audit, formatVersion: 2, budget: { ...partial.budget, complete: true, maxResultBytes: 1048576, returnedBytes, elapsedMs: performance.now() - started } });
			} catch (error) {
				if (!(error instanceof WorkLimit)) throw error;
				partial.budget.reason = "scan_limit";
				send("result", partial);
			}
		}
	} catch (error) {
		process.send?.({ type: "error", error: error instanceof Error ? error.message : "Inspection failed" });
	} finally { process.disconnect?.(); }
});
