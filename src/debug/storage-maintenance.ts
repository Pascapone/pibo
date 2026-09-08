import { parseArgs } from "node:util";
import { piboHomePath } from "../core/pibo-home.js";
import { checkpointStorage, inspectStorageStatus, maintainStorageRetention, verifyStorage } from "../data/storage-maintenance.js";
import { resolveDebugStore } from "./stores.js";

export async function runStorageMaintenanceCli(args: string[]): Promise<void> {
	const action = args[0];
	if (!action || args.includes("--help") || args.includes("-h")) { printHelp(); return; }
	const { values } = parseArgs({ args: args.slice(1), strict: true, options: {
		store: { type: "string" }, path: { type: "string" }, json: { type: "boolean" },
		"timeout-ms": { type: "string" }, full: { type: "boolean" }, quick: { type: "boolean" },
		apply: { type: "boolean" }, "dry-run": { type: "boolean" }, mode: { type: "string" },
		before: { type: "string" }, limit: { type: "string" }, "payload-root": { type: "string" },
		"database-warn-bytes": { type: "string" }, "wal-warn-bytes": { type: "string" }, "payload-warn-bytes": { type: "string" },
	} });
	if (values.apply && values["dry-run"]) throw new Error("Choose either --dry-run or --apply");
	const path = typeof values.path === "string" ? values.path : resolveStorePath(values.store);
	let result: unknown;
	if (action === "status" || action === "doctor") {
		result = inspectStorageStatus({ path, databaseWarnBytes: numberValue(values["database-warn-bytes"]), walWarnBytes: numberValue(values["wal-warn-bytes"]), payloadWarnBytes: numberValue(values["payload-warn-bytes"]) });
	} else if (action === "verify") {
		if (values.full && values.quick) throw new Error("Choose either --quick or --full");
		result = await verifyStorage({ path, mode: values.full ? "full" : "quick", timeoutMs: numberValue(values["timeout-ms"]) });
	} else if (action === "checkpoint") {
		const mode = values.mode ?? "passive";
		if (!new Set(["passive", "restart", "truncate"]).has(mode)) throw new Error("Checkpoint --mode must be passive, restart, or truncate");
		result = checkpointStorage({ path, mode: mode as "passive" | "restart" | "truncate", apply: values.apply });
	} else if (action === "retention") {
		if (typeof values.before !== "string") throw new Error("Storage retention requires --before <iso-date>");
		result = await maintainStorageRetention({ path, before: values.before, limit: numberValue(values.limit), apply: values.apply, payloadRoot: typeof values["payload-root"] === "string" ? values["payload-root"] : piboHomePath("payloads") });
	} else throw new Error(`Unknown storage action "${action}"; run pibo debug storage --help`);
	if (values.json) console.log(JSON.stringify(result, null, 2));
	else console.log(formatText(result));
}

function resolveStorePath(value: string | undefined): string {
	if (!value || value === "pibo-data") return resolveDebugStore("pibo-data").path;
	if (value === "reliability") return resolveDebugStore("reliability").path;
	throw new Error("--store must be pibo-data or reliability; use --path for another SQLite store");
}
function numberValue(value: string | undefined): number | undefined { if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid numeric value "${value}"`); return parsed; }
function formatText(value: unknown): string { const object = value as Record<string, unknown>; const lines = [`pibo debug storage ${String(object.resultType ?? "result").split(".").at(-1)}`]; for (const [key, item] of Object.entries(object)) { if (key === "resultType" || typeof item === "object") continue; lines.push(`${key}\t${String(item)}`); } if (Array.isArray(object.warnings)) lines.push(...object.warnings.map((warning) => `warning\t${String(warning)}`)); lines.push("", "Use --json for bounded row, size, projection, and progress detail."); return lines.join("\n"); }
function printHelp(): void { console.log(`pibo debug storage - bounded SQLite health and maintenance

Commands:
  status [--store pibo-data|reliability | --path <sqlite>] [--json]
  doctor [--store pibo-data|reliability | --path <sqlite>] [--json]
  verify [--quick|--full] [--timeout-ms <n>] [--store <name>|--path <sqlite>] [--json]
  checkpoint [--mode passive|restart|truncate] [--dry-run|--apply] [--store <name>|--path <sqlite>] [--json]
  retention --before <iso-date> [--limit <1..10000>] [--dry-run|--apply] [--payload-root <dir>] [--store <name>|--path <sqlite>] [--json]

Status is read-only and reports DB/WAL/SHM/payload size, pages/freelist, bounded row counts, payload-reference integrity, maintenance metadata, and degraded thresholds.
Verification runs in a cancellable worker. Timeout is partial and never healthy. Quick/full checks can still be I/O intensive; use backup verification or offline checks when the online budget is insufficient.
Checkpoint and retention default to dry-run. Apply is bounded and audited in the database maintenance sidecar. Retention deletes only eligible live_delta rows; chat messages, audit events, idempotency evidence, and referenced payloads are preserved.
`); }
