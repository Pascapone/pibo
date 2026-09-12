import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { boundedInteger, type DeadLetterInput, type BoundedDeadLetters, type InspectionBudget } from "./output-dead-letters.js";
import type { OutputIntegrityAudit } from "./output-integrity.js";

export type InspectionRequest = DeadLetterInput & { mode: "audit" | "dead-letters" };
export type BoundedAudit = OutputIntegrityAudit & { formatVersion: 2; budget: InspectionBudget };
export type PartialAudit = {
	resultType: "debug.integrity.output";
	formatVersion: 2;
	readOnly: true;
	health: { status: "unknown" };
	budget: InspectionBudget;
	scope: { piboSessionId?: string; since?: string; before?: string; limit: number };
	findings: [];
	summary: null;
};
export type InspectionResult = BoundedAudit | BoundedDeadLetters | PartialAudit;

/** A process (not a timer around synchronous SQLite) owns each read connection.
 * Resolve only after exit: cancellation has then closed even a native SQLite snapshot.
 * No maintenance metadata, store constructors, migrations or progress files are written.
 */
export async function runOutputInspection(input: InspectionRequest, options: {
	signal?: AbortSignal;
	onProgress?: (result: InspectionResult) => void;
} = {}): Promise<InspectionResult> {
	for (const key of ["since", "before"] as const) {
		if (input[key] && !Number.isFinite(Date.parse(input[key]!))) throw new Error(`${key} must be an ISO date`);
	}
	if (input.since && input.before && Date.parse(input.since) >= Date.parse(input.before)) throw new Error("since must be earlier than before");
	if (input.afterStream !== undefined) boundedInteger(input.afterStream, 1, Number.MAX_SAFE_INTEGER, "after-stream");
	if (input.beforeStream !== undefined) boundedInteger(input.beforeStream, 1, Number.MAX_SAFE_INTEGER, "before-stream");
	if (input.afterStream !== undefined && input.beforeStream !== undefined && input.afterStream >= input.beforeStream) throw new Error("after-stream must be less than before-stream");
	input = { ...input, ...(input.since ? { since: new Date(input.since).toISOString() } : {}), ...(input.before ? { before: new Date(input.before).toISOString() } : {}) };
	const timeoutMs = boundedInteger(input.timeoutMs, 1000, 3_600_000, "timeout-ms");
	const maxScan = boundedInteger(input.maxScan, 1000, 1_000_000, "max-scan");
	const limit = boundedInteger(input.limit, 50, 1000, "limit");
	const started = performance.now();
	let latest: InspectionResult = input.mode === "dead-letters" ? {
		resultType: "debug.persistence.dead-letters", formatVersion: 2, readOnly: true,
		scope: { piboSessionId: input.piboSessionId, since: input.since, before: input.before, limit },
		budget: { complete: false, elapsedMs: 0, scannedRows: 0, maxScan, timeoutMs, nextCursor: input.cursor },
		summary: { deadOutputJobs: null, returnedDeadLetters: 0, identityCollisions: 0, relatedIdentityCollisions: 0, countsScope: "page" },
		deadLetters: [], nextCommands: ["pibo debug persistence dead-letters --help"],
	} : {
		resultType: "debug.integrity.output", formatVersion: 2, readOnly: true, health: { status: "unknown" },
		scope: { piboSessionId: input.piboSessionId, since: input.since, before: input.before, limit },
		budget: { complete: false, elapsedMs: 0, scannedRows: 0, maxScan, timeoutMs }, findings: [], summary: null,
	};
	const runId = randomUUID();
	latest.budget.runId = runId;
	if (options.signal?.aborted) { latest.budget.reason = "cancelled"; return latest; }
	return new Promise((resolve, reject) => {
		let reason: "cancelled" | "time_limit" | undefined;
		let error: Error | undefined;
		let receivedResult = false;
		const child = fork(fileURLToPath(new URL("./output-inspection-worker.js", import.meta.url)), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
		const stop = (why: typeof reason) => { if (!reason) { reason = why; child.kill("SIGKILL"); } };
		const cancel = () => stop("cancelled");
		const timer = setTimeout(() => stop("time_limit"), timeoutMs);
		options.signal?.addEventListener("abort", cancel, { once: true });
		if (options.signal?.aborted) cancel();
		child.on("message", (message: { type: string; result?: InspectionResult; error?: string }) => {
			if (reason) return;
			if (message.result) { latest = message.result; latest.budget = { ...latest.budget, runId, workerPid: child.pid }; options.onProgress?.(latest); }
			if (message.type === "result") receivedResult = true;
			if (message.type === "error") error = new Error(message.error ?? "Output inspection failed");
		});
		child.on("error", (value) => { error = value; });
		child.on("exit", (code) => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", cancel);
			if (reason) {
				latest.budget = { ...latest.budget, complete: false, reason, elapsedMs: performance.now() - started };
				if (latest.resultType === "debug.integrity.output") latest = { ...latest, health: { status: "unknown" }, findings: [], summary: null };
				resolve(latest);
			} else if (error || code !== 0 || !receivedResult) reject(error ?? new Error(`Output inspection exited without result (${code})`));
			else { latest.budget.elapsedMs = performance.now() - started; resolve(latest); }
		});
		child.send({ ...input, timeoutMs, maxScan, limit });
	});
}
