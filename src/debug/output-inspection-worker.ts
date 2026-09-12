import { performance } from "node:perf_hooks";
import { inspectOutputDeadLetters } from "./output-dead-letters.js";
import { inspectOutputIntegrity, createOutputAuditWorkGuard, OutputAuditWorkLimitError } from "./output-integrity.js";
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
			const guard = createOutputAuditWorkGuard(partial.budget);
			let progressCount = 0;
			const beforeQuery: typeof guard = (db, sql) => {
				guard(db, sql);
				partial.budget.elapsedMs = performance.now() - started;
				if (progressCount++ < 31) send("progress", partial);
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
				if (!(error instanceof OutputAuditWorkLimitError)) throw error;
				partial.budget.reason = "scan_limit";
				send("result", partial);
			}
		}
	} catch (error) {
		process.send?.({ type: "error", error: error instanceof Error ? error.message : "Inspection failed" });
	} finally { process.disconnect?.(); }
});
