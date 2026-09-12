import { readFileSync } from "node:fs";
import { getPiboHome } from "../core/pibo-home.js";
import { resolveDebugStore, resolveDebugStores } from "./stores.js";

type ParsedOptions = {
	positionals: string[];
	json: boolean;
	events: boolean;
	runningOnly: boolean;
	nativeHistory: boolean;
	check: boolean;
	medium: boolean;
	limit?: string;
	type?: string;
	fields?: string[];
	field?: string;
	topic?: string;
	key?: string;
	retention?: string;
	after?: string;
	before?: string;
	queue?: string;
	destructive: boolean;
	apply: boolean;
	dryRun: boolean;
	store?: string;
	maxBytes?: string;
	from?: string;
	bytes?: string;
	full: boolean;
	noTruncate: boolean;
	plain: boolean;
	raw: boolean;
	payload: boolean;
	args: boolean;
	output: boolean;
	error: boolean;
	active: boolean;
	stale: boolean;
	thresholdMs?: string;
	cookie?: string;
	authHeader?: string;
};

export async function runDebugCli(argv = process.argv): Promise<void> {
	try {
		const args = argv.slice(2);
		if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
			printDebugDiscovery();
			return;
		}
		if(args[0]==="backup"){const {runStorageBackupCli}=await import("./storage-backup.js");await runStorageBackupCli(args.slice(1));return;}
		if(args[0]==="message-queue"){await runDebugMessageQueue(args.slice(1));return;}
		if(args[0]==="storage"){const {runStorageMaintenanceCli}=await import("./storage-maintenance.js");await runStorageMaintenanceCli(args.slice(1));return;}
		if (args[0] === "db") {
			await runDebugDb(args.slice(1));
			return;
		}
		if (args[0] === "session") {
			await runDebugSession(args.slice(1));
			return;
		}
		if (args[0] === "trace") {
			await runDebugTrace(args.slice(1));
			return;
		}
		if (args[0] === "cache") {
			await runDebugCache(args.slice(1));
			return;
		}
		if (args[0] === "summary") {
			await runDebugSummary(args.slice(1));
			return;
		}
		if (args[0] === "messages") {
			await runDebugMessages(args.slice(1));
			return;
		}
		if (args[0] === "final") {
			await runDebugFinal(args.slice(1));
			return;
		}
		if (args[0] === "tool") {
			await runDebugTool(args.slice(1));
			return;
		}
		if (args[0] === "failures") {
			await runDebugFailures(args.slice(1));
			return;
		}
		if (args[0] === "events") {
			await runDebugEvents(args.slice(1));
			return;
		}
		if (args[0] === "agents") {
			const { runDebugAgentsCli } = await import("./agents.js");
			await runDebugAgentsCli(args.slice(1));
			return;
		}
		if (args[0] === "jobs") {
			await runDebugJobs(args.slice(1));
			return;
		}
		if (args[0] === "integrity") {
			await runDebugIntegrity(args.slice(1));
			return;
		}
		if (args[0] === "persistence") {
			await runDebugPersistence(args.slice(1));
			return;
		}
		if (args[0] === "repair") {
			await runDebugRepair(args.slice(1));
			return;
		}
		if (args[0] === "runs") {
			await runDebugRuns(args.slice(1));
			return;
		}
		if (args[0] === "resources") {
			await runDebugResources(args.slice(1));
			return;
		}
		if (args[0] === "signals") {
			await runDebugSignals(args.slice(1));
			return;
		}
		if (args[0] === "telemetry") {
			await runDebugTelemetry(args.slice(1));
			return;
		}
		if (args[0] === "web") {
			const { runDebugWeb } = await import("./web.js");
			await runDebugWeb(args.slice(1));
			return;
		}
		if (args[0] === "pty") {
			const { runDebugPty } = await import("./pty.js");
			await runDebugPty(args.slice(1));
			return;
		}
		throw new Error(`Unknown pibo debug command "${args[0]}". Run pibo debug --help.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

async function runDebugMessageQueue(args:string[]):Promise<void>{
	if(!args.length||args[0]==="--help"||args[0]==="-h"){
		console.log(`pibo debug message-queue - inspect and conservatively reconcile durable messages

Commands:
  inspect --session <ps_...> [--after-stream <n>] [--before-terminal-stream <n>] [--json]
  reconcile <cmd_...> --mark-failed [--cancel-successors] [--dry-run|--apply] [--json]
  reconcile <cmd_...> --confirm-completed [--confirm-without-evidence <cmd_...>] [--dry-run|--apply] [--json]

Safety:
  Dry-run is the default. --apply mutates the exact command transactionally.
  Replay is unsupported: this command never executes a message or repeats side effects.
  /clear only cancels unstarted runtime/queue work; it does not reconcile an interrupted durable predecessor.

Next:
  pibo debug message-queue inspect --session <pibo-session-id>`);return;
	}
	const command=args[0],json=args.includes("--json");
	const value=(flag:string)=>{const index=args.indexOf(flag);if(index<0)return undefined;const result=args[index+1];if(!result||result.startsWith("--"))throw new Error(`${flag} requires a value`);return result;};
	const {PiboDataStore}=await import("../data/pibo-store.js");const descriptor=resolveDebugStore("pibo-data");if(!descriptor.exists)throw new Error(`Pibo data store not found at ${descriptor.path}`);
	const mutating=command==="reconcile"&&args.includes("--apply");
	const store=new PiboDataStore(descriptor.path,{readOnly:!mutating});
	try{
		const module=await import("./message-queue.js");
		if(command==="inspect"){
			const sessionId=value("--session");if(!sessionId)throw new Error("message-queue inspect requires --session <pibo-session-id>");
			const parseStream=(flag:string)=>{const raw=value(flag);if(raw===undefined)return undefined;const parsed=Number(raw);if(!Number.isSafeInteger(parsed)||parsed<1)throw new Error(`${flag} requires a positive integer stream id`);return parsed;};
			const result=module.inspectMessageQueue(store,{sessionId,afterStreamId:parseStream("--after-stream"),beforeTerminalStreamId:parseStream("--before-terminal-stream")});if(json)console.log(JSON.stringify(result,null,2));else console.log(module.formatMessageQueueInspection(result));return;
		}
		if(command==="reconcile"){
			const commandId=args[1];if(!commandId||commandId.startsWith("--"))throw new Error("message-queue reconcile requires an exact <cmd_...> ID");
			if(args.includes("--replay"))throw new Error("Replay is unsupported because provider and tool side effects cannot be proven idempotent. Choose --mark-failed or --confirm-completed.");
			const decisions=[args.includes("--mark-failed")?"mark-failed":undefined,args.includes("--confirm-completed")?"confirm-completed":undefined].filter(Boolean) as Array<"mark-failed"|"confirm-completed">;
			if(decisions.length!==1)throw new Error("Choose exactly one decision: --mark-failed or --confirm-completed");
			if(args.includes("--apply")&&args.includes("--dry-run"))throw new Error("Choose either --dry-run or --apply");
			const known=new Set(["--json","--mark-failed","--confirm-completed","--cancel-successors","--dry-run","--apply","--confirm-without-evidence","--cancel-successor"]);
			for(let index=2;index<args.length;index++){const item=args[index];if(!item.startsWith("--"))continue;if(!known.has(item))throw new Error(`Unknown message-queue reconciliation option "${item}"`);if(item==="--confirm-without-evidence"||item==="--cancel-successor")index++;}
			const cancelSuccessorIds:string[]=[];for(let index=0;index<args.length;index++)if(args[index]==="--cancel-successor"){const id=args[index+1];if(!id)throw new Error("--cancel-successor requires a command ID");cancelSuccessorIds.push(id);}
			const result=module.reconcileMessageCommand(store,{commandId,decision:decisions[0]!,apply:args.includes("--apply"),confirmWithoutEvidence:value("--confirm-without-evidence"),cancelSuccessors:args.includes("--cancel-successors"),cancelSuccessorIds});
			if(json)console.log(JSON.stringify({...result,nextCommands:[result.nextAction]},null,2));else console.log(module.formatMessageQueueReconciliation(result));return;
		}
		throw new Error(`Unknown pibo debug message-queue command "${command}". Run pibo debug message-queue --help.`);
	}finally{store.close();}
}

async function runDebugIntegrity(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugIntegrityDiscovery();
		return;
	}
	if (args[0] !== "output") {
		throw new Error(`Unknown pibo debug integrity command "${args[0]}". Run pibo debug integrity --help.`);
	}
	if (args[1] === "--help" || args[1] === "-h") {
		printDebugIntegrityDiscovery();
		return;
	}
	await runOutputPersistenceInspection(args.slice(1), { allowPositionalSession: true, deadLettersOnly: false });
}

async function runDebugPersistence(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugPersistenceDiscovery();
		return;
	}
	const command = args[0];
	if (command !== "audit" && command !== "dead-letters") {
		throw new Error(`Unknown pibo debug persistence command "${command}". Run pibo debug persistence --help.`);
	}
	if (args[1] === "--help" || args[1] === "-h") {
		if (command === "audit") printDebugPersistenceAuditHelp();
		else printDebugPersistenceDeadLettersHelp();
		return;
	}
	await runOutputPersistenceInspection(args.slice(1), {
		allowPositionalSession: false,
		deadLettersOnly: command === "dead-letters",
	});
}

async function runOutputPersistenceInspection(
	args: string[],
	mode: { allowPositionalSession: boolean; deadLettersOnly: boolean },
): Promise<void> {
	validateOutputPersistenceInspectionArgs(args, mode.allowPositionalSession);
	const budgetFlags = new Set(["--max-scan", "--timeout-ms", "--cursor", "--after-stream", "--before-stream"]);
	const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
	const options = parseOptions(args.filter((arg, index) => !budgetFlags.has(arg) && !budgetFlags.has(args[index - 1])));
	if (!mode.deadLettersOnly && ["--cursor", "--after-stream", "--before-stream"].some((flag) => args.includes(flag))) throw new Error("Cursor and stream bounds apply only to dead-letters; audit lifecycle time bounds apply to complete groups");
	if (options.after && !Number.isFinite(Date.parse(options.after))) throw new Error("--since must be an ISO date");
	if (options.before && !Number.isFinite(Date.parse(options.before))) throw new Error("--before must be an ISO date");
	if (options.after && options.before && Date.parse(options.after) >= Date.parse(options.before)) {
		throw new Error("--since must be earlier than --before");
	}
	const { formatJson } = await import("./sql.js");
	const { formatOutputIntegrityAudit } = await import("./output-integrity.js");
	const { runOutputInspection } = await import("./output-inspection-runner.js");
	const { boundedInteger } = await import("./output-dead-letters.js");
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	try {
	const result = await runOutputInspection({
		mode: mode.deadLettersOnly ? "dead-letters" : "audit",
		maxScan: value("--max-scan") === undefined ? undefined : boundedInteger(value("--max-scan"), 1000, 1_000_000, "max-scan"),
		timeoutMs: value("--timeout-ms") === undefined ? undefined : boundedInteger(value("--timeout-ms"), 1000, 3_600_000, "timeout-ms"),
		cursor: value("--cursor"),
		afterStream: value("--after-stream") === undefined ? undefined : boundedInteger(value("--after-stream"), 1, Number.MAX_SAFE_INTEGER, "after-stream"),
		beforeStream: value("--before-stream") === undefined ? undefined : boundedInteger(value("--before-stream"), 1, Number.MAX_SAFE_INTEGER, "before-stream"),
		dataStore: resolveDebugStore("pibo-data"),
		reliabilityStore: resolveDebugStore("reliability"),
		piboSessionId: options.key ?? (mode.allowPositionalSession ? options.positionals[0] : undefined),
		since: options.after,
		before: options.before,
		limit: options.limit,
	}, { signal: controller.signal });
	if (options.json) console.log(formatJson(result));
	else {
		if (result.resultType === "debug.integrity.output" && result.summary) console.log(formatOutputIntegrityAudit(result));
		else if (result.resultType === "debug.persistence.dead-letters") console.log([
			"pibo debug persistence dead-letters", "readOnly\ttrue", `returnedDeadLetters\t${result.deadLetters.length}`, "countsScope\tpage (global total not computed)",
			...result.deadLetters.map((item) => [item.jobId, item.piboSessionId ?? "-", item.eventId ?? "-", item.identityCollision, item.relatedIdentityCollision ?? "unknown"].join("\t")),
		].join("\n"));
		else console.log("pibo debug persistence audit\nreadOnly\ttrue\nhealth\tunknown (incomplete audit)");
		console.log([`complete\t${result.budget.complete}`, `reason\t${result.budget.reason ?? "-"}`, `workRows\t${result.budget.scannedRows}/${result.budget.maxScan}`, `elapsedMs\t${result.budget.elapsedMs.toFixed(1)}/${result.budget.timeoutMs}`, ...(result.budget.nextCursor ? [`nextCursor\t${result.budget.nextCursor}`] : [])].join("\n"));
	}
	} finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}

function validateOutputPersistenceInspectionArgs(args: string[], allowPositionalSession: boolean): void {
	const valueOptions = new Set(["--session", "--since", "--before", "--limit", "--max-scan", "--timeout-ms", "--cursor", "--after-stream", "--before-stream"]);
	let positionalCount = 0;
	let hasSessionOption = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") continue;
		if (arg === "--apply" || arg === "--dry-run") {
			throw new Error(`Output persistence inspection is read-only; ${arg} is not supported`);
		}
		if (valueOptions.has(arg)) {
			const value = args[index + 1];
			if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
			if (arg === "--session") hasSessionOption = true;
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown output persistence inspection option "${arg}"`);
		}
		positionalCount += 1;
	}
	if (!allowPositionalSession && positionalCount > 0) {
		throw new Error("Use --session <pibo-session-id> to scope persistence inspection");
	}
	if (allowPositionalSession && positionalCount > 1) {
		throw new Error("Use at most one positional Pibo Session ID");
	}
	if (allowPositionalSession && hasSessionOption && positionalCount > 0) {
		throw new Error("Use either a positional Pibo Session ID or --session, not both");
	}
}

async function runDebugRepair(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugRepairDiscovery();
		return;
	}
	if (args[0] === "output-collision") {
		if (args[1] === "--help" || args[1] === "-h") { printDebugRepairDiscovery(); return; }
		const jobIndex = args.indexOf("--job");
		const jobId = jobIndex >= 0 ? args[jobIndex + 1] : undefined;
		if (!jobId || jobId.startsWith("-")) throw new Error("pibo debug repair output-collision requires --job <dead-job-id>");
		const allowed = new Set(["--job", jobId, "--json", "--dry-run", "--apply", "--keep-existing"]);
		const unknown = args.slice(1).find((arg) => !allowed.has(arg));
		if (unknown) throw new Error(`Unknown output collision repair option "${unknown}"`);
		if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("Choose either --dry-run or --apply");
		const { repairOutputCollision } = await import("./output-collision-repair.js");
		const result = repairOutputCollision({ dataStore: resolveDebugStore("pibo-data"), reliabilityStore: resolveDebugStore("reliability"), jobId, apply: args.includes("--apply"), keepExisting: args.includes("--keep-existing") });
		console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : [
			"pibo debug repair output-collision", `mode\t${result.mode}`, `job\t${result.jobId}`, `decision\t${result.decision}`,
			`applied\t${result.applied}`, `idempotent\t${result.idempotent}`, `transcript\t${result.projections.transcript}`,
			`trace\t${result.projections.trace}`, `navigation\t${result.projections.navigation}`, `command\t${result.projections.command}`,
			...(result.auditStreamId ? [`audit\t${result.auditStreamId}`] : []), "", ...result.warnings.map((warning) => `warning\t${warning}`),
		].join("\n"));
		return;
	}
	if (args[0] !== "output") {
		throw new Error(`Unknown pibo debug repair command "${args[0]}". Run pibo debug repair --help.`);
	}
	if (args[1] === "--help" || args[1] === "-h") {
		printDebugRepairDiscovery();
		return;
	}
	const repairArgs = args.slice(1);
	validateOutputRepairArgs(repairArgs);
	const options = parseOptions(repairArgs);
	if (options.apply && options.dryRun) throw new Error("Choose either --dry-run or --apply");
	if (options.destructive) throw new Error("Use --apply for output repair; --destructive is not supported");
	if (options.after && !Number.isFinite(Date.parse(options.after))) throw new Error("--since must be an ISO date");
	if (options.before && !Number.isFinite(Date.parse(options.before))) throw new Error("--before must be an ISO date");
	if (options.after && options.before && Date.parse(options.after) >= Date.parse(options.before)) {
		throw new Error("--since must be earlier than --before");
	}
	if (options.key && options.positionals.length > 1) throw new Error("With --session, provide at most one positional <event-id>");
	const piboSessionId = options.key ?? options.positionals[0];
	const eventId = options.key ? options.positionals[0] : options.positionals[1];
	if (!piboSessionId) throw new Error("pibo debug repair output requires a session id or --session <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const {
		formatOutputTurnRepair,
		readOutputRepairAdapterEvidence,
		repairOutputTurn,
		repairOutputTurns,
	} = await import("./output-repair.js");
	const store = resolveDebugStore("pibo-data");
	const reliabilityStore = resolveDebugStore("reliability");
	const adapterEvidence = await readOutputRepairAdapterEvidence({ store, piboSessionId });
	const result = eventId
		? repairOutputTurn({ store, reliabilityStore, piboSessionId, eventId, adapterEvidence, apply: options.apply })
		: repairOutputTurns({
			store,
			reliabilityStore,
			piboSessionId,
			since: options.after,
			before: options.before,
			limit: options.limit,
			adapterEvidence,
			apply: options.apply,
		});
	if (options.json) console.log(formatJson(result));
	else console.log(formatOutputTurnRepair(result));
}

function validateOutputRepairArgs(args: string[]): void {
	const valueOptions = new Set(["--session", "--since", "--before", "--limit"]);
	const flagOptions = new Set(["--json", "--dry-run", "--apply", "--destructive"]);
	const seen = new Set<string>();
	const positionals: string[] = [];
	let hasSessionOption = false;
	let hasScopeOption = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (flagOptions.has(arg)) {
			if (seen.has(arg)) throw new Error(`Output repair option ${arg} may only be provided once`);
			seen.add(arg);
			continue;
		}
		if (valueOptions.has(arg)) {
			if (seen.has(arg)) throw new Error(`Output repair option ${arg} may only be provided once`);
			const value = args[index + 1];
			if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
			seen.add(arg);
			if (arg === "--session") hasSessionOption = true;
			else hasScopeOption = true;
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) throw new Error(`Unknown output repair option "${arg}"`);
		positionals.push(arg);
	}
	if (hasSessionOption) {
		if (positionals.length > 1) throw new Error("With --session, provide at most one positional <event-id>");
	} else if (positionals.length !== 2) {
		throw new Error("Exact output repair requires <pibo-session-id> <event-id>; use --session for scoped repair");
	}
	if (hasScopeOption && positionals.length > 0) {
		throw new Error("--since, --before, and --limit are only supported for scoped repair without an <event-id>");
	}
}

async function runDebugResources(args: string[]): Promise<void> {
	if (args[0] === "--help" || args[0] === "-h") {
		printDebugResourcesDiscovery();
		return;
	}
	const options = parseOptions(args);
	const { collectGatewayResourceSnapshot, renderGatewayResourceSnapshotText } = await import("../core/gateway-resource-guard.js");
	const { loadPiboGatewaySettings } = await import("../core/gateway-settings.js");
	const snapshot = await collectGatewayResourceSnapshot({ gatewaySettings: loadPiboGatewaySettings() });
	if (options.json) console.log(JSON.stringify(snapshot, null, 2));
	else console.log(renderGatewayResourceSnapshotText(snapshot));
}

async function runDebugDb(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugDbDiscovery();
		return;
	}
	const command = args[0];
	const options = parseOptions(args.slice(1));
	if (command === "stores") {
		const unknownOption = options.positionals.find((value) => value.startsWith("-"));
		if (unknownOption) throw new Error(`Unknown option "${unknownOption}" for pibo debug db stores. Run pibo debug db --help.`);
		if (options.positionals.length > 0) throw new Error("pibo debug db stores accepts no positional arguments. Run pibo debug db --help.");
		const stores = resolveDebugStores();
		if (options.json) {
			console.log(JSON.stringify({ stores }, null, 2));
			return;
		}
		console.log(["store\tpath\texists\tdescription", ...stores.map((store) => `${store.name}\t${store.path}\t${store.exists}\t${store.description}`)].join("\n"));
		return;
	}
	const storeName = options.positionals[0];
	if (!storeName) throw new Error(`pibo debug db ${command} requires <store>`);
	const store = resolveDebugStore(storeName);
	if (command === "tables") {
		const { formatJson, listTables } = await import("./sql.js");
		const tables = listTables(store);
		if (options.json) console.log(formatJson({ store: store.name, path: store.path, tables }));
		else console.log(tables.length ? tables.join("\n") : "tables: 0");
		return;
	}
	if (command === "schema") {
		const { formatJson, getStoreSchema } = await import("./sql.js");
		const tables = getStoreSchema(store);
		if (options.json) {
			console.log(formatJson({ store: store.name, path: store.path, tables }));
			return;
		}
		console.log(formatSchemaText(tables));
		return;
	}
	if (command === "query") {
		const { formatJson, formatRows, runReadOnlyQuery } = await import("./sql.js");
		const sql = options.positionals.slice(1).join(" ");
		const result = runReadOnlyQuery(store, sql, { limit: options.limit });
		if (options.json) console.log(formatJson(result));
		else console.log(formatRows(result.rows, { limited: result.limited }));
		return;
	}
	throw new Error(`Unknown pibo debug db command "${command}". Run pibo debug db --help.`);
}

async function runDebugSession(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugSessionDiscovery();
		return;
	}
	const options = parseOptions(args);
	const input = options.positionals[0];
	if (!input) throw new Error("pibo debug session requires <url-or-pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const stores = {
		sessions: resolveDebugStore("sessions"),
		chat: resolveDebugStore("chat"),
	};
	const { formatDebugSessionRuntime, formatDebugSessionSummary, inspectDebugSession, inspectDebugSessionRuntime } = await import("./session.js");
	if (options.positionals[1] === "runtime") {
		const result = inspectDebugSessionRuntime(input, stores);
		if (options.json) console.log(formatJson(result));
		else console.log(formatDebugSessionRuntime(result));
		return;
	}
	const summary = inspectDebugSession(input, stores, {
		events: options.events,
		limit: options.limit,
	});
	if (options.json) console.log(formatJson(summary));
	else console.log(formatDebugSessionSummary(summary));
}

async function runDebugSummary(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugSummaryDiscovery();
		return;
	}
	const options = parseOptions(args);
	const input = options.positionals[0];
	if (!input) throw new Error("pibo debug summary requires <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugSummary, inspectDebugSummary } = await import("./summary.js");
	const result = await inspectDebugSummary(input, { sessions: resolveDebugStore("sessions"), chat: resolveDebugStore("chat") });
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugSummary(result));
}

async function runDebugMessages(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugMessagesDiscovery();
		return;
	}
	const options = parseOptions(args);
	const piboSessionId = options.positionals[0];
	const command = options.positionals[1] ?? "list";
	if (!piboSessionId) throw new Error("pibo debug messages requires <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugMessageShow, formatDebugMessagesList, inspectDebugMessageShow, inspectDebugMessagesList } = await import("./messages.js");
	if (command === "list") {
		const result = inspectDebugMessagesList(piboSessionId, resolveDebugStore("chat"), { limit: options.limit });
		if (options.json) console.log(formatJson(result));
		else console.log(formatDebugMessagesList(result));
		return;
	}
	if (command === "show") {
		const selector = options.positionals[2];
		if (!selector) throw new Error("pibo debug messages <pibo-session-id> show requires <selector>");
		const result = inspectDebugMessageShow(piboSessionId, resolveDebugStore("chat"), selector, detailOptions(options));
		if (options.json) console.log(formatJson(result));
		else console.log(formatDebugMessageShow(result, { plain: options.plain }));
		return;
	}
	throw new Error(`Unknown pibo debug messages command "${command}". Run pibo debug messages --help.`);
}

async function runDebugFinal(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugFinalDiscovery();
		return;
	}
	const options = parseOptions(args);
	const piboSessionId = options.positionals[0];
	if (!piboSessionId) throw new Error("pibo debug final requires <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugMessageShow, inspectDebugMessageShow } = await import("./messages.js");
	const result = inspectDebugMessageShow(piboSessionId, resolveDebugStore("chat"), "assistant:last", { ...detailOptions(options), final: true });
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugMessageShow(result, { plain: options.plain, final: true }));
}

async function runDebugTool(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugToolDiscovery();
		return;
	}
	const options = parseOptions(args);
	const piboSessionId = options.positionals[0];
	const toolCallId = options.positionals[1];
	if (!piboSessionId || !toolCallId) throw new Error("pibo debug tool requires <pibo-session-id> <tool-call-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugTool, inspectDebugTool } = await import("./tools.js");
	const result = inspectDebugTool(piboSessionId, resolveDebugStore("chat"), toolCallId, { ...detailOptions(options), args: options.args, output: options.output, error: options.error });
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugTool(result, { args: options.args, output: options.output, error: options.error }));
}

async function runDebugFailures(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugFailuresDiscovery();
		return;
	}
	const options = parseOptions(args);
	const piboSessionId = options.positionals[0];
	if (!piboSessionId) throw new Error("pibo debug failures requires <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugFailures, inspectDebugFailures } = await import("./failures.js");
	const result = await inspectDebugFailures(piboSessionId, { sessions: resolveDebugStore("sessions"), chat: resolveDebugStore("chat") }, { limit: options.limit });
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugFailures(result));
}

async function runDebugSignals(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugSignalsDiscovery();
		return;
	}
	const command = args[0];
	const options = parseOptions(args.slice(1));
	const piboSessionId = options.positionals[0];
	if ((command !== "session" && command !== "tree") || !piboSessionId) {
		throw new Error("pibo debug signals requires session <pibo-session-id> or tree <root-pibo-session-id>");
	}
	const baseUrl = process.env.PIBO_GATEWAY_URL ?? process.env.PIBO_WEB_URL;
	if (!baseUrl) throw new Error("Set PIBO_GATEWAY_URL to inspect live signal state through Chat Web APIs.");
	const url = new URL(`/api/chat/signals/${command}/${encodeURIComponent(piboSessionId)}`, baseUrl);
	const headers = new Headers();
	if (options.cookie) headers.set("cookie", readCookieHeaderFile(options.cookie));
	if (options.authHeader) headers.set("authorization", options.authHeader);
	const response = await fetch(url, { headers });
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) throw new Error(payload && typeof payload === "object" && "error" in payload ? String(payload.error) : `Request failed: ${response.status}`);
	if (options.json) {
		const { formatJson } = await import("./sql.js");
		console.log(formatJson(payload));
	} else {
		console.log(formatSignalSnapshotText(payload as any));
	}
}

async function runDebugTelemetryMaintenance(args:string[]):Promise<void>{
 if(!args.length||args.includes("--help")||args.includes("-h")){console.log(`pibo debug telemetry maintenance - bounded optional diagnostic cleanup
Commands:
  status                         Read the durable job and progress
  start --before <iso> --apply    Start a job; no deletion until step or gateway worker
  step --apply                   Execute at most 128 rows / 4 ms cooperatively
  pause --apply                  Pause between batches
  resume --apply                 Mark the paused job ready
  cancel --apply                 Cancel without undoing committed batches
Use --json for structured output. Product history, receipts and payload files are excluded.`);return;}
 const action=args[0];if(!["status","start","step","pause","resume","cancel"].includes(action!))throw Error("Unknown maintenance action; use maintenance --help");
 const options=parseOptions(args.slice(1));if(action!=="status"&&!options.apply)throw Error("Maintenance mutations require --apply; inspect status first");
 const store=resolveDebugStore("pibo-data");if(!store.exists)throw Error("Pibo data store is missing");
 const {DatabaseSync}=await import("node:sqlite");const {TelemetryMaintenance}=await import("../data/telemetry-maintenance.js");
 const db=new DatabaseSync(store.path,{readOnly:action==="status"});db.exec("PRAGMA busy_timeout=10; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
 try{const maintenance=new TelemetryMaintenance(db);
  const result=action==="status"?maintenance.status():action==="start"?maintenance.start(options.before??""):action==="step"?maintenance.step():maintenance.control(action as "pause"|"resume"|"cancel");
  console.log(JSON.stringify(result??{status:"not_started"},null,options.json?2:undefined));
 }finally{db.close();}
}

async function runDebugTelemetry(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugTelemetryDiscovery();
		return;
	}
	if(args[0]==="maintenance"){await runDebugTelemetryMaintenance(args.slice(1));return;}
 if(args[0]==="capture"){const {runTelemetryCaptureCli}=await import("./telemetry-capture.js");await runTelemetryCaptureCli(args.slice(1));return;}
	const command = args[0];
	const options = parseOptions(args.slice(1));
	const { formatJson } = await import("./sql.js");
	const {
		formatTelemetryProvider,
		formatTelemetryProviderEvents,
		formatTelemetryProviderPayload,
		formatTelemetryPrune,
		formatTelemetrySession,
		formatTelemetrySessions,
		formatTelemetryStale,
		formatTelemetryStats,
		formatTelemetryTool,
		formatTelemetryTurn,
		inspectTelemetryProvider,
		inspectTelemetryProviderEvents,
		inspectTelemetryProviderPayload,
		inspectTelemetryPrune,
		inspectTelemetrySession,
		inspectTelemetrySessions,
		inspectTelemetryStale,
		inspectTelemetryStats,
		inspectTelemetryTool,
		inspectTelemetryTurn,
	} = await import("./telemetry.js");
	const store = resolveDebugStore("pibo-data");
	if (command === "sessions") {
		const result = inspectTelemetrySessions(store, { limit: options.limit, active: options.active, stale: options.stale });
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetrySessions(result));
		return;
	}
	if (command === "session") {
		const piboSessionId = options.positionals[0];
		if (!piboSessionId) throw new Error("pibo debug telemetry session requires <pibo-session-id>");
		const result = inspectTelemetrySession(store, piboSessionId, { limit: options.limit });
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetrySession(result));
		return;
	}
	if (command === "turn") {
		const turnIdOrEventId = options.positionals[0];
		if (!turnIdOrEventId) throw new Error("pibo debug telemetry turn requires <turn-id-or-event-id>");
		const result = inspectTelemetryTurn(store, turnIdOrEventId, { limit: options.limit, events: options.events });
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetryTurn(result));
		return;
	}
	if (command === "provider") {
		const providerRequestId = options.positionals[0];
		if (!providerRequestId) throw new Error("pibo debug telemetry provider requires <provider-request-id>");
		const subcommand = options.positionals[1];
		if (subcommand === "events") {
			const result = inspectTelemetryProviderEvents(store, providerRequestId, { limit: options.limit, after: options.after, fields: options.fields });
			if (options.json) console.log(formatJson(result));
			else console.log(formatTelemetryProviderEvents(result));
			return;
		}
		if (subcommand === "payload") {
			const payloadRef = options.positionals[2];
			if (!payloadRef) throw new Error("pibo debug telemetry provider <provider-request-id> payload requires <preview-or-event-summary-id>");
			const result = inspectTelemetryProviderPayload(store, providerRequestId, payloadRef);
			if (options.json) console.log(formatJson(result));
			else console.log(formatTelemetryProviderPayload(result));
			return;
		}
		if (subcommand) throw new Error(`Unknown pibo debug telemetry provider subcommand "${subcommand}". Run pibo debug telemetry --help.`);
		const result = inspectTelemetryProvider(store, providerRequestId);
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetryProvider(result));
		return;
	}
	if (command === "tool") {
		const toolCallId = options.positionals[0];
		if (!toolCallId) throw new Error("pibo debug telemetry tool requires <tool-call-id>");
		const result = inspectTelemetryTool(store, toolCallId);
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetryTool(result));
		return;
	}
	if (command === "stale") {
		const result = inspectTelemetryStale(store, { limit: options.limit, thresholdMs: options.thresholdMs });
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetryStale(result));
		return;
	}
	if (command === "stats") {
		const result = inspectTelemetryStats(store, { retention: options.retention });
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetryStats(result));
		return;
	}
	if (command === "prune") {
		const result = inspectTelemetryPrune(store, { retention: options.retention, before: options.before, apply: options.apply });
		if (options.json) console.log(formatJson(result));
		else console.log(formatTelemetryPrune(result));
		return;
	}
	throw new Error(`Unknown pibo debug telemetry command "${command}". Run pibo debug telemetry --help.`);
}

async function runDebugCache(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugCacheDiscovery();
		return;
	}
	const options = parseOptions(args);
	const piboSessionId = options.positionals[0];
	if (!piboSessionId) throw new Error("pibo debug cache requires <pibo-session-id>");
	if (options.positionals.length > 1) throw new Error("pibo debug cache accepts one <pibo-session-id>. Run pibo debug cache --help.");
	const limit = options.limit === undefined ? undefined : Number(options.limit);
	if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)) throw new Error("--limit must be an integer from 1 to 200");
	const stores = { sessions: resolveDebugStore("sessions"), chat: resolveDebugStore("chat") };
	const { formatJson } = await import("./sql.js");
	const { formatDebugCache, inspectDebugCache } = await import("./cache.js");
	const result = await inspectDebugCache(piboSessionId, stores, { limit });
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugCache(result));
}

async function runDebugTrace(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugTraceDiscovery();
		return;
	}
	const options = parseOptions(args);
	const piboSessionId = options.positionals[0];
	if (!piboSessionId) throw new Error("pibo debug trace requires <pibo-session-id>");
	const stores = {
		sessions: resolveDebugStore("sessions"),
		chat: resolveDebugStore("chat"),
	};
	const { formatJson } = await import("./sql.js");
	const { formatDebugTrace, formatDebugTraceNode, inspectDebugTrace, inspectDebugTraceNode } = await import("./trace.js");
	if (options.positionals[1] === "show") {
		const nodeId = options.positionals[2];
		if (!nodeId) throw new Error("pibo debug trace <pibo-session-id> show requires <node-id>");
		const result = await inspectDebugTraceNode(piboSessionId, stores, nodeId);
		if (options.json) console.log(formatJson(result));
		else console.log(formatDebugTraceNode(result));
		return;
	}
	const result = await inspectDebugTrace(piboSessionId, stores, {
		runningOnly: options.runningOnly,
		check: options.check,
		nativeHistory: options.nativeHistory,
	});
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugTrace(result, { medium: options.medium }));
}

async function runDebugEvents(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugEventsDiscovery();
		return;
	}
	if (args[0] === "compact-deltas") {
		const options = parseOptions(args.slice(1));
		const { formatJson } = await import("./sql.js");
		const { formatDeltaCompaction, runDeltaCompaction } = await import("./delta-compaction.js");
		const result = runDeltaCompaction({
			apply: options.apply,
			store: options.store,
			session: options.key,
			json: options.json,
		});
		if (options.json) console.log(formatJson(result));
		else console.log(formatDeltaCompaction(result));
		return;
	}
	if (args[0] === "stream") {
		const options = parseOptions(args.slice(1));
		const { formatJson, formatRows } = await import("./sql.js");
		const { PiboReliabilityStore } = await import("../reliability/store.js");
		const store = resolveDebugStore("reliability");
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.path}`);
		const reliability = new PiboReliabilityStore(store.path);
		try {
			const events = reliability.list({
				topic: options.topic,
				afterStreamId: options.after ? Number(options.after) : undefined,
				limit: options.limit ? Number(options.limit) : undefined,
			});
			if (options.json) console.log(formatJson({ events }));
			else console.log(formatRows(events.map(compactEventRow)));
		} finally {
			reliability.close();
		}
		return;
	}
	if (args[0] === "stats") {
		const options = parseOptions(args.slice(1));
		const { formatJson, formatRows } = await import("./sql.js");
		const { PiboReliabilityStore } = await import("../reliability/store.js");
		const store = resolveDebugStore("reliability");
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.path}`);
		const reliability = new PiboReliabilityStore(store.path);
		try {
			const counts = reliability.countEvents({
				topic: options.topic,
				key: options.key,
				retentionClass: options.retention,
			});
			if (options.json) console.log(formatJson({ counts }));
			else console.log(formatRows(counts));
		} finally {
			reliability.close();
		}
		return;
	}
	if (args[0] === "prune") {
		const options = parseOptions(args.slice(1));
		const { formatJson, formatRows } = await import("./sql.js");
		const { PiboReliabilityStore } = await import("../reliability/store.js");
		const store = resolveDebugStore("reliability");
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.path}`);
		if (!options.topic || !options.retention || !options.before) {
			throw new Error("pibo debug events prune requires --topic, --retention, and --before");
		}
		const reliability = new PiboReliabilityStore(store.path);
		try {
			const deleted = reliability.prune({
				topic: options.topic,
				retentionClass: options.retention,
				before: options.before,
				limit: options.limit ? Number(options.limit) : undefined,
				destructive: options.destructive,
			});
			const result = {
				topic: options.topic,
				retentionClass: options.retention,
				before: options.before,
				destructive: options.destructive,
				deleted,
			};
			if (options.json) console.log(formatJson(result));
			else console.log(formatRows([result]));
		} finally {
			reliability.close();
		}
		return;
	}
	if (args[0] === "consumers") {
		const options = parseOptions(args.slice(1));
		const { formatJson, formatRows } = await import("./sql.js");
		const { PiboReliabilityStore } = await import("../reliability/store.js");
		const store = resolveDebugStore("reliability");
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.path}`);
		const reliability = new PiboReliabilityStore(store.path);
		try {
			const consumers = reliability.listConsumers();
			if (options.json) console.log(formatJson({ consumers }));
			else console.log(formatRows(consumers));
		} finally {
			reliability.close();
		}
		return;
	}
	const options = parseOptions(args);
	let piboSessionId = options.positionals[0];
	let command = options.positionals[1] ?? "list";
	if (piboSessionId === "list") {
		piboSessionId = options.positionals[1];
		command = "list";
	}
	if (!piboSessionId) throw new Error("pibo debug events requires <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugEventShow, formatDebugEvents, inspectDebugEventShow, inspectDebugEvents } = await import("./events.js");
	if (command === "show") {
		const selector = options.positionals[2];
		if (!selector) throw new Error("pibo debug events <pibo-session-id> show requires <stream-id-or-event-id>");
		const result = inspectDebugEventShow(piboSessionId, resolveDebugStore("chat"), selector, { ...detailOptions(options), payload: options.payload, raw: options.raw, field: options.field });
		if (!result.event) process.exitCode = 1;
		if (options.json) console.log(formatJson(result));
		else console.log(formatDebugEventShow(result));
		return;
	}
	if (command !== "list") throw new Error(`Unknown pibo debug events command "${command}". Run pibo debug events --help.`);
	const result = inspectDebugEvents(piboSessionId, resolveDebugStore("chat"), {
		type: options.type,
		fields: options.fields,
		limit: options.limit,
	});
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugEvents(result));
}

async function runDebugJobs(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugJobsDiscovery();
		return;
	}
	const command = args[0];
	const options = parseOptions(args.slice(1));
	const { formatJson, formatRows } = await import("./sql.js");
	const { PiboReliabilityStore } = await import("../reliability/store.js");
	const store = resolveDebugStore("reliability");
	if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.path}`);
	const reliability = new PiboReliabilityStore(store.path);
	try {
		if (command === "list") {
			const jobs = reliability.inspectJobs({ queue: options.queue, limit: options.limit ? Number(options.limit) : undefined });
			if (options.json) console.log(formatJson({ jobs: jobs.map(observableJobRow) }));
			else console.log(formatRows(jobs.map(compactJobRow)));
			return;
		}
		if (command === "dead") {
			const jobs = reliability.listDead({ queue: options.queue, limit: options.limit ? Number(options.limit) : undefined });
			if (options.json) console.log(formatJson({ jobs: jobs.map(observableDeadJobRow) }));
			else console.log(formatRows(jobs.map(compactDeadJobRow)));
			return;
		}
		if (command === "replay") {
			const jobId = options.positionals[0];
			if (!jobId) throw new Error("pibo debug jobs replay requires <job-id>");
			const job = reliability.requeueDead(jobId);
			if (options.json) console.log(formatJson({ job }));
			else console.log(formatRows([compactJobRow(job)]));
			return;
		}
		if (command === "reconcile-runs") {
			if (options.apply === options.dryRun) {
				throw new Error("pibo debug jobs reconcile-runs requires exactly one of --dry-run or --apply");
			}
			const result = reliability.reconcileOrphanRunJobs({ apply: options.apply });
			const output = {
				checkedAt: result.checkedAt,
				mode: result.apply ? "apply" : "dry-run",
				candidateCount: result.candidates.length,
				moved: result.moved,
				jobs: result.candidates.map(observableJobRow),
			};
			if (options.json) console.log(formatJson(output));
			else {
				console.log(formatRows([{ checkedAt: output.checkedAt, mode: output.mode, candidateCount: output.candidateCount, moved: output.moved }]));
				if (result.candidates.length) console.log(formatRows(result.candidates.map(compactJobRow)));
			}
			return;
		}
		throw new Error(`Unknown pibo debug jobs command "${command}". Run pibo debug jobs --help.`);
	} finally {
		reliability.close();
	}
}

async function runDebugRuns(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugRunsDiscovery();
		return;
	}
	const command = args[0];
	const options = parseOptions(args.slice(1));
	const { formatJson, formatRows } = await import("./sql.js");
	const { PiboReliabilityStore } = await import("../reliability/store.js");
	const store = resolveDebugStore("reliability");
	if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.path}`);
	const reliability = new PiboReliabilityStore(store.path);
	try {
		if (command === "list") {
			const piboSessionId = options.positionals[0];
			if (!piboSessionId) throw new Error("pibo debug runs list requires <pibo-session-id>");
			const runs = reliability.listRuns({ controllerPiboSessionId: piboSessionId, includeConsumed: true, includeDetached: true });
			if (options.json) console.log(formatJson({ runs }));
			else console.log(formatRows(runs.map(compactRunRow)));
			return;
		}
		if (command === "inspect") {
			const runId = options.positionals[0];
			if (!runId) throw new Error("pibo debug runs inspect requires <run-id>");
			const run = reliability.getRun(runId);
			if (!run) throw new Error(`Unknown run "${runId}"`);
			if (options.json) console.log(formatJson({ run }));
			else console.log(formatRows([compactRunRow(run)]));
			return;
		}
		throw new Error(`Unknown pibo debug runs command "${command}". Run pibo debug runs --help.`);
	} finally {
		reliability.close();
	}
}

function readCookieHeaderFile(path: string): string {
	const content = readFileSync(path, "utf8").trim();
	const cookies = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			const normalized = line.startsWith("#HttpOnly_") ? line.slice("#HttpOnly_".length) : line;
			if (normalized.startsWith("#")) return [];
			const fields = normalized.split("\t");
			if (fields.length >= 7) return [`${fields[5]}=${fields[6]}`];
			return [normalized];
		});
	if (cookies.length === 0) throw new Error(`Cookie file "${path}" does not contain any cookies`);
	return cookies.join("; ");
}

function parseOptions(args: string[]): ParsedOptions {
	const parsed: ParsedOptions = { positionals: [], json: false, events: false, runningOnly: false, nativeHistory: false, check: false, medium: false, destructive: false, apply: false, dryRun: false, full: false, noTruncate: false, plain: false, raw: false, payload: false, args: false, output: false, error: false, active: false, stale: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") {
			parsed.json = true;
			continue;
		}
		if (arg === "--events") {
			parsed.events = true;
			continue;
		}
		if (arg === "--running-only") {
			parsed.runningOnly = true;
			continue;
		}
		if (arg === "--native-history") {
			parsed.nativeHistory = true;
			continue;
		}
		if (arg === "--check") {
			parsed.check = true;
			continue;
		}
		if (arg === "--medium") {
			parsed.medium = true;
			continue;
		}
		if (arg === "--full") {
			parsed.full = true;
			continue;
		}
		if (arg === "--no-truncate") {
			parsed.noTruncate = true;
			continue;
		}
		if (arg === "--plain") {
			parsed.plain = true;
			continue;
		}
		if (arg === "--raw") {
			parsed.raw = true;
			continue;
		}
		if (arg === "--payload") {
			parsed.payload = true;
			continue;
		}
		if (arg === "--args") {
			parsed.args = true;
			continue;
		}
		if (arg === "--output") {
			parsed.output = true;
			continue;
		}
		if (arg === "--error") {
			parsed.error = true;
			continue;
		}
		if (arg === "--children" || arg === "--tool-output") {
			continue;
		}
		if (arg === "--limit") {
			const value = args[index + 1];
			if (!value) throw new Error("--limit requires a value");
			parsed.limit = value;
			index += 1;
			continue;
		}
		if (arg === "--type") {
			const value = args[index + 1];
			if (!value) throw new Error("--type requires a value");
			parsed.type = value;
			index += 1;
			continue;
		}
		if (arg === "--fields") {
			const value = args[index + 1];
			if (!value) throw new Error("--fields requires a value");
			parsed.fields = value.split(",").map((field) => field.trim()).filter(Boolean);
			index += 1;
			continue;
		}
		if (arg === "--field") {
			const value = args[index + 1];
			if (!value) throw new Error("--field requires a value");
			parsed.field = value;
			index += 1;
			continue;
		}
		if (arg === "--topic") {
			const value = args[index + 1];
			if (!value) throw new Error("--topic requires a value");
			parsed.topic = value;
			index += 1;
			continue;
		}
		if (arg === "--key" || arg === "--session") {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a value`);
			parsed.key = value;
			index += 1;
			continue;
		}
		if (arg === "--retention") {
			const value = args[index + 1];
			if (!value) throw new Error("--retention requires a value");
			parsed.retention = value;
			index += 1;
			continue;
		}
		if (arg === "--after" || arg === "--since") {
			const value = args[index + 1];
			if (!value) throw new Error(`${arg} requires a value`);
			parsed.after = value;
			index += 1;
			continue;
		}
		if (arg === "--before") {
			const value = args[index + 1];
			if (!value) throw new Error("--before requires a value");
			parsed.before = value;
			index += 1;
			continue;
		}
		if (arg === "--destructive") {
			parsed.destructive = true;
			continue;
		}
		if (arg === "--apply") {
			parsed.apply = true;
			continue;
		}
		if (arg === "--dry-run") {
			parsed.dryRun = true;
			continue;
		}
		if (arg === "--active") {
			parsed.active = true;
			continue;
		}
		if (arg === "--stale") {
			parsed.stale = true;
			continue;
		}
		if (arg === "--cookie") {
			const value = args[index + 1];
			if (!value) throw new Error("--cookie requires a path");
			parsed.cookie = value;
			index += 1;
			continue;
		}
		if (arg === "--auth-header") {
			const value = args[index + 1];
			if (!value) throw new Error("--auth-header requires a value");
			parsed.authHeader = value;
			index += 1;
			continue;
		}
		if (arg === "--threshold-ms") {
			const value = args[index + 1];
			if (!value) throw new Error("--threshold-ms requires a value");
			parsed.thresholdMs = value;
			index += 1;
			continue;
		}
		if (arg === "--store") {
			const value = args[index + 1];
			if (!value) throw new Error("--store requires a value");
			parsed.store = value;
			index += 1;
			continue;
		}
		if (arg === "--max-bytes") {
			const value = args[index + 1];
			if (!value) throw new Error("--max-bytes requires a value");
			parsed.maxBytes = value;
			index += 1;
			continue;
		}
		if (arg === "--from") {
			const value = args[index + 1];
			if (!value) throw new Error("--from requires a value");
			parsed.from = value;
			index += 1;
			continue;
		}
		if (arg === "--bytes") {
			const value = args[index + 1];
			if (!value) throw new Error("--bytes requires a value");
			parsed.bytes = value;
			index += 1;
			continue;
		}
		if (arg === "--queue") {
			const value = args[index + 1];
			if (!value) throw new Error("--queue requires a value");
			parsed.queue = value;
			index += 1;
			continue;
		}
		parsed.positionals.push(arg);
	}
	return parsed;
}

function detailOptions(options: ParsedOptions): { maxBytes?: string; from?: string; bytes?: string; noTruncate?: boolean; full?: boolean } {
	return {
		maxBytes: options.maxBytes,
		from: options.from,
		bytes: options.bytes,
		noTruncate: options.noTruncate,
		full: options.full,
	};
}

function compactEventRow(event: { streamId: number; topic: string; key?: string; eventId: string; createdAt: string; retentionClass: string; payload: unknown }): Record<string, unknown> {
	return {
		streamId: event.streamId,
		topic: event.topic,
		key: event.key,
		eventId: event.eventId,
		type: payloadType(event.payload),
		createdAt: event.createdAt,
		retentionClass: event.retentionClass,
	};
}

function compactJobRow(job: { jobId: string; queue: string; state: string; payload: unknown; runAt: string; attempts: number; maxAttempts: number; workerId?: string; claimExpiresAt?: string; claimExpired?: boolean; missingRunRecord?: boolean; effectiveLiveness?: string; lastError?: string }): Record<string, unknown> {
	const correlation = outputPersistenceJobCorrelation(job.payload);
	return {
		jobId: job.jobId,
		queue: job.queue,
		state: job.state,
		runAt: job.runAt,
		attempts: `${job.attempts}/${job.maxAttempts}`,
		piboSessionId: correlation.piboSessionId,
		eventId: correlation.eventId,
		phase: correlation.phase,
		workerId: job.workerId,
		claimExpiresAt: job.claimExpiresAt,
		claimExpired: job.claimExpired,
		missingRunRecord: job.missingRunRecord,
		effectiveLiveness: job.effectiveLiveness,
		lastError: job.lastError,
	};
}

function compactDeadJobRow(job: { jobId: string; queue: string; payload: unknown; attempts: number; maxAttempts: number; deadAt: string; deadReason: string; lastError?: string }): Record<string, unknown> {
	const correlation = outputPersistenceJobCorrelation(job.payload);
	return {
		jobId: job.jobId,
		queue: job.queue,
		attempts: `${job.attempts}/${job.maxAttempts}`,
		piboSessionId: correlation.piboSessionId,
		eventId: correlation.eventId,
		phase: correlation.phase,
		deadAt: job.deadAt,
		deadReason: job.deadReason,
		lastError: job.lastError,
	};
}

function observableJobRow(job: Parameters<typeof compactJobRow>[0]): Record<string, unknown> {
	return { ...compactJobRow(job), attempts: job.attempts, maxAttempts: job.maxAttempts };
}

function observableDeadJobRow(job: Parameters<typeof compactDeadJobRow>[0]): Record<string, unknown> {
	return { ...compactDeadJobRow(job), attempts: job.attempts, maxAttempts: job.maxAttempts };
}

function outputPersistenceJobCorrelation(payload: unknown): { piboSessionId?: string; eventId?: string; phase?: string } {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
	const envelope = payload as Record<string, unknown>;
	const state = envelope.state;
	let phase: string | undefined;
	if (state && typeof state === "object" && !Array.isArray(state)) {
		const deliveries = (state as Record<string, unknown>).deliveries;
		if (Array.isArray(deliveries) && deliveries.length) {
			const rows = deliveries.filter((delivery): delivery is Record<string, unknown> => !!delivery && typeof delivery === "object" && !Array.isArray(delivery));
			if (rows.length === deliveries.length) {
				if (rows.every((delivery) => delivery.sideEffectsDelivered === true || delivery.persisted === true)) phase = "delivered";
				else if (rows.every((delivery) => delivery.reliabilityDelivered === true)) phase = "side-effects";
				else if (rows.every((delivery) => delivery.v2 !== undefined)) phase = "reliability";
				else phase = "v2";
			}
		}
	}
	return {
		...(typeof envelope.piboSessionId === "string" ? { piboSessionId: envelope.piboSessionId } : {}),
		...(typeof envelope.eventId === "string" ? { eventId: envelope.eventId } : {}),
		...(phase ? { phase } : {}),
	};
}

function compactRunRow(run: { runId: string; controllerPiboSessionId: string; status: string; toolName: string; completionPolicy: string; consumed: boolean; updatedAt: string; summary?: string; timeoutMs?: number; timeoutAt?: string; timeoutPhase?: string; serviceWarning?: string; resources?: { isolationMode?: string; unitName?: string; minimumHostAvailableBytes?: number; peakMemoryFullPsiAvg10?: number; peakIoFullPsiAvg10?: number; limitReason?: string; cgroup?: { memoryPeakBytes?: number; memoryMaxBytes?: number; tasksPeak?: number; ioReadBytes?: number; ioWriteBytes?: number } } }): Record<string, unknown> {
	return {
		runId: run.runId,
		piboSessionId: run.controllerPiboSessionId,
		status: run.status,
		toolName: run.toolName,
		policy: run.completionPolicy,
		consumed: run.consumed,
		updatedAt: run.updatedAt,
		timeoutMs: run.timeoutMs,
		timeoutAt: run.timeoutAt,
		timeoutPhase: run.timeoutPhase,
		serviceWarning: run.serviceWarning,
		isolation: run.resources?.isolationMode,
		resourceUnit: run.resources?.unitName,
		resourceLimitReason: run.resources?.limitReason,
		minimumHostAvailableBytes: run.resources?.minimumHostAvailableBytes,
		peakMemoryFullPsiAvg10: run.resources?.peakMemoryFullPsiAvg10,
		peakIoFullPsiAvg10: run.resources?.peakIoFullPsiAvg10,
		memoryPeakBytes: run.resources?.cgroup?.memoryPeakBytes,
		memoryMaxBytes: run.resources?.cgroup?.memoryMaxBytes,
		tasksPeak: run.resources?.cgroup?.tasksPeak,
		ioReadBytes: run.resources?.cgroup?.ioReadBytes,
		ioWriteBytes: run.resources?.cgroup?.ioWriteBytes,
		summary: run.summary,
	};
}

function formatSignalSnapshotText(snapshot: { rootPiboSessionId?: string; version?: number; sessions?: Record<string, any>; nodes?: Record<string, any> }): string {
	const sessions = Object.values(snapshot.sessions ?? {});
	const nodes = Object.values(snapshot.nodes ?? {});
	const activeNodes = nodes.filter((node: any) => ["queued", "starting", "running", "streaming", "waiting", "blocked", "retrying", "compacting", "pausing"].includes(node.status));
	const errors = sessions.filter((session: any) => session.hasError || session.hasErrorDescendant);
	return [
		`root\t${snapshot.rootPiboSessionId ?? "unknown"}`,
		`version\t${snapshot.version ?? 0}`,
		`sessions\t${sessions.length}`,
		`nodes\t${nodes.length}`,
		`active_nodes\t${activeNodes.length}`,
		`error_sessions\t${errors.length}`,
		...sessions.map((session: any) => `${session.piboSessionId}\tlocal=${session.localStatus}\taggregate=${session.aggregateStatus}\tphase=${session.phase ?? "-"}\tactive=${session.isTreeActive}`),
	].join("\n");
}

function payloadType(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const candidate = payload as { type?: unknown };
	return typeof candidate.type === "string" ? candidate.type : undefined;
}

function printDebugDiscovery(): void {
	console.log(`pibo debug - inspect local Pibo data

Commands:
  backup   Create, verify or restore an explicit SQLite and payload snapshot
  message-queue Inspect or reconcile interrupted durable message commands
  storage  Bounded SQLite status, verification, checkpoint, and retention
  db       Inspect and query local SQLite stores
  session  Inspect one Pibo Session by id or Chat URL
  summary  Show compact session diagnosis and drill-down commands
  messages List or show stored user/assistant messages
  final    Show the latest assistant message
  trace    Rebuild the Chat Web trace view for one Pibo Session
  cache    Summarize provider-reported cache usage for one Pibo Session
  events   Inspect compact event payload fields for one Pibo Session
  agents   Inspect delegated child agents and their persisted activity
  tool     Inspect one grouped tool call
  failures List failed tool calls and trace/session errors
  jobs     Inspect durable Pibo jobs and DLQ
  persistence Audit output persistence and related dead letters
  integrity Compatibility alias for output persistence audit
  repair   Dry-run or apply explicit persisted-output repairs
  runs     Inspect durable yielded runs
  resources Show gateway memory reserve, related child processes, and heavy daemons
  signals  Inspect live session signal snapshots through Chat Web APIs
  telemetry Inspect runtime observability telemetry
  web      Inspect browser render state via CDP
  pty      Run and inspect interactive CLI/TUI commands under a PTY

Next:
  pibo debug storage status --json
  pibo debug db
  pibo debug summary <pibo-session-id>
  pibo debug final <pibo-session-id>
  pibo debug messages <pibo-session-id> list
  pibo debug trace <pibo-session-id> --running-only
  pibo debug cache <pibo-session-id>
  pibo debug events stream --topic pibo.output
  pibo debug persistence
  pibo debug repair output <pibo-session-id> <event-id> --dry-run
  pibo debug agents <parent-session-id> list
  pibo debug resources --json
  pibo debug signals tree ps_...
  pibo debug telemetry sessions --active
  pibo debug web targets
  pibo debug pty run -- pibo tui:sessions --demo
`);
}

function printDebugIntegrityDiscovery(): void {
	console.log(`pibo debug integrity - compatibility alias for output persistence audit

Usage:
  pibo debug integrity output [<pibo-session-id>] [--since <iso-date>] [--before <iso-date>] [--limit n] [--json]

Next:
  pibo debug persistence audit --help
`);
}

function printDebugPersistenceDiscovery(): void {
	console.log(`pibo debug persistence - inspect persisted output without changing it

Commands:
  audit         Audit output lifecycle, identity, queue, and trace-status integrity
  dead-letters  List output-persistence dead letters with collision relationships

Next:
  pibo debug persistence audit --help
  pibo debug persistence dead-letters --help
`);
}

function printDebugPersistenceAuditHelp(): void {
	console.log(`pibo debug persistence audit - read-only output integrity audit

Usage:
  pibo debug persistence audit [--session <pibo-session-id>] [--since <iso-date>] [--before <iso-date>] [--limit n] [--json]

Reports:
  Incomplete or invalid turn, reasoning, and tool lifecycles; identity collisions; reused output keys; session/trace-status mismatches; and pending or dead output-persistence jobs.

Budgets (formatVersion 2):
  --limit n          Detail results, default 50 (max 1000); not a work limit
  --max-scan n       Conservative row-visit allowance, default 1000 (max 1000000)
  --timeout-ms n     Hard reader process lifetime, default 1000 (max 3600000)
  Full counts/JSON grouping happen only within explicit budgets. Exceeding a budget returns
  health=unknown, summary=null. Increase the budget explicitly to restart a deep audit.
  Lifecycle time scope applies to MAX(created_at) of whole groups, never clipped events.
  Ctrl-C terminates the reader; audit never writes or migrates either store.

Next:
  pibo debug persistence audit --json
  pibo debug persistence audit --session ps_... --since 2026-08-01T00:00:00Z --json
  pibo debug persistence dead-letters
`);
}

function printDebugPersistenceDeadLettersHelp(): void {
	console.log(`pibo debug persistence dead-letters - read-only output dead-letter inspection

Usage:
  pibo debug persistence dead-letters [--session <pibo-session-id>] [--since <iso-date>] [--before <iso-date>] [--limit n] [--json]

Reports:
  Output-persistence dead letters, permanent collision failures, and dead letters related to persisted collision diagnostics.
  Unknown relationships are omitted; an incomplete page is not an absence-of-errors result.

Budgets (formatVersion 2):
  --limit n          Returned findings, default 50 (max 1000)
  --max-scan n       Candidate and relationship rows, default 1000 (max 1000000)
  --timeout-ms n     Hard process lifetime, default 1000
  --cursor token     Resume stable job-ID keyset, bound to store/session/time/stream scope
  --after-stream n   Relationship stream lower bound (exclusive)
  --before-stream n  Relationship stream upper bound (exclusive)
  Counts describe this page only; global total is null. Sparse scopes consume scan budget.
  Pages are live reads, not a cross-page snapshot; concurrent inserts behind the cursor need a new traversal.
  Ctrl-C kills the reader and closes its snapshot before returning the last checkpoint.

Next:
  pibo debug persistence dead-letters --json
  pibo debug persistence audit --json
`);
}

function printDebugRepairDiscovery(): void {
	console.log(`pibo debug repair - explicitly repair persisted output

Usage:
  pibo debug repair output <pibo-session-id> <event-id> [--dry-run|--apply] [--json]
  pibo debug repair output --session <pibo-session-id> [--since <iso-date>] [--before <iso-date>] [--limit n] [--dry-run|--apply] [--json]
  pibo debug repair output-collision --job <dead-job-id> [--dry-run] [--json]
  pibo debug repair output-collision --job <dead-job-id> --apply --keep-existing [--json]

Behavior:
  Dry-run is the default. --apply is required for every mutation.
  Repair requires exactly one persisted message start, an inactive turn, no terminal event, and unambiguous evidence.
  Evidence is limited to Reliability payloads, Pibo Product History, and exact adapter-history turn matches.
  Repair never invents assistant content. Without an exact Reliability terminal, only a completed assistant record can justify message_finished.
  Every applied terminal writes a pibo.output.repair_applied audit event in the same transaction.
  Repair does not delete or replay pending or dead output-persistence jobs.
  Collision dry-run reports transcript, trace, navigation, and command projection state.
  Collision apply requires --keep-existing, records an idempotent audit, and never compares or replays conflicting bodies or side effects.

Next:
  pibo debug repair output ps_... <event-id> --dry-run --json
  pibo debug repair output --session ps_... --before 2026-08-31T00:00:00Z --dry-run --json
  pibo debug repair output ps_... <event-id> --apply --json
  pibo debug jobs dead --queue output-persistence
`);
}

function printDebugResourcesDiscovery(): void {
	console.log(`pibo debug resources - inspect gateway resource guard state

Usage:
  pibo debug resources [--json]

Reports:
  Gateway RSS/heap headroom, host free-memory reserve, direct child processes, and known heavy local daemons such as ComfyUI or Unity when process listing is available.

Environment:
  PIBO_GATEWAY_RESOURCE_GUARD=block|warn|off (default: block)
  PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES=<bytes>
  PIBO_GATEWAY_MIN_HEAP_AVAILABLE_BYTES=<bytes>
  PIBO_GATEWAY_MAX_RSS_BYTES=<bytes>
  PIBO_GATEWAY_KNOWN_DAEMON_WARNING_RSS_BYTES=<bytes>
  PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS=<count> (default: 50)
  PIBO_SESSION_CONCURRENT_YIELDED_RUNS=<count> (default: 10)
  PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES=<bytes> (default: 2147483648)

Web settings:
  Settings -> Concurrency persists overrides that apply to new yielded runs immediately.

Next:
  pibo debug resources --json
  pibo compute health --json
`);
}

function printDebugSignalsDiscovery(): void {
	console.log(`pibo debug signals - inspect live Session Signal snapshots

Usage:
  pibo debug signals session <pibo-session-id> [--json] [--cookie <path>]
  pibo debug signals tree <root-pibo-session-id> [--json] [--cookie <path>]

Environment:
  PIBO_GATEWAY_URL=http://127.0.0.1:4788

Auth:
  --cookie <path> reads a Cookie header value from a local file.
  --auth-header <value> sends an Authorization header. Values are not printed.

Next:
  pibo debug signals tree ps_...
`);
}

function printDebugTelemetryDiscovery(): void {
	console.log(`pibo debug telemetry - inspect bounded runtime observability telemetry

Usage:
  pibo debug telemetry sessions [--active] [--stale] [--limit n] [--json]
  pibo debug telemetry session <pibo-session-id> [--limit n] [--json]
  pibo debug telemetry turn <turn-id-or-event-id> [--events] [--limit n] [--json]
  pibo debug telemetry provider <provider-request-id> [--json]
  pibo debug telemetry provider <provider-request-id> events [--after seq] [--fields a,b] [--limit n] [--json]
  pibo debug telemetry provider <provider-request-id> payload <preview-or-event-summary-id> [--json]
  pibo debug telemetry tool <tool-call-id> [--json]
  pibo debug telemetry stale [--threshold-ms n] [--limit n] [--json]
  pibo debug telemetry stats [--retention class] [--json]
  pibo debug telemetry prune --retention class --before iso-date [--dry-run|--apply] [--json]

Commands:
  sessions  List recent, active, or stale telemetry sessions
  session   Show compact session telemetry and next turn/provider/tool commands
  turn      Show a phase timeline for one turn or event id
  provider  Show provider request summary, event pages, and preview-unavailable diagnostics
  tool      Show tool-call argument and execution telemetry
  stale     List read-only stale active work
  stats     Show telemetry retention counts and byte estimates
  prune     Dry-run telemetry retention cleanup unless --apply is explicit
  maintenance  Inspect or control bounded cleanup; use maintenance --help
  capture   Scope provider detail and inspect inert archives; use capture --help

Next:
  pibo debug telemetry sessions --active
  pibo debug telemetry session ps_...
  pibo debug telemetry turn turn_...
  pibo debug telemetry provider pr_... events --limit 20
`);
}

function printDebugDbDiscovery(): void {
	console.log(`pibo debug db - inspect local SQLite stores

Stores:
  home        ${getPiboHome()}
  pibo-data   pibo.sqlite        unified sessions, rooms, events, messages, observations, navigation, stats
  sessions    pibo.sqlite        V2 alias for session metadata
  chat        pibo.sqlite        V2 alias for Chat Web data
  agents      chat-agents.sqlite
  auth        auth.sqlite
  bindings    session-bindings.sqlite
  reliability pibo-events.sqlite

Commands:
  stores               List known stores and paths
  tables <store>       List tables only
  schema <store>       List tables and columns
  query <store> <sql>  Run read-only SQL

Next:
  pibo debug db schema pibo-data
  pibo debug db query pibo-data "select id, profile from sessions limit 5"
`);
}

function printDebugSessionDiscovery(): void {
	console.log(`pibo debug session - inspect one Pibo Session

Usage:
  pibo debug session <url-or-pibo-session-id> [--events] [--limit n] [--json]
  pibo debug session <url-or-pibo-session-id> runtime [--json]

Inputs:
  ps_...
  /apps/chat/rooms/<roomId>/sessions/<piboSessionId>
  /apps/chat/sessions/<piboSessionId>

Next:
  pibo debug session ps_...
  pibo debug session ps_... runtime
`);
}

function printDebugSummaryDiscovery(): void {
	console.log(`pibo debug summary - compact diagnosis with drill-down commands

Usage:
  pibo debug summary <pibo-session-id> [--json]

Next:
  pibo debug final ps_...
  pibo debug failures ps_...
  pibo debug messages ps_... list
`);
}

function printDebugMessagesDiscovery(): void {
	console.log(`pibo debug messages - list or show stored chat messages

Usage:
  pibo debug messages <pibo-session-id> list [--limit n] [--json]
  pibo debug messages <pibo-session-id> show <selector> [--full|--no-truncate] [--from n --bytes n] [--max-bytes n] [--plain] [--json]

Selectors:
  1, last, assistant:last, user:last, stream:<stream-id>, msg:<event-id>

Next:
  pibo debug messages ps_... list
  pibo debug messages ps_... show assistant:last --full
`);
}

function printDebugFinalDiscovery(): void {
	console.log(`pibo debug final - show the latest assistant message

Usage:
  pibo debug final <pibo-session-id> [--max-bytes n] [--from n --bytes n] [--no-truncate] [--plain] [--json]

Note:
  Full messages may contain private data. Use --no-truncate intentionally.

Next:
  pibo debug final ps_...
  pibo debug final ps_... --no-truncate
`);
}

function printDebugToolDiscovery(): void {
	console.log(`pibo debug tool - inspect one grouped tool call

Usage:
  pibo debug tool <pibo-session-id> <tool-call-id> [--args|--output|--error] [--no-truncate] [--json]

Next:
  pibo debug failures ps_...
  pibo debug tool ps_... call_... --output --no-truncate
`);
}

function printDebugFailuresDiscovery(): void {
	console.log(`pibo debug failures - list failed tool calls and trace/session errors

Usage:
  pibo debug failures <pibo-session-id> [--limit n] [--json]

Next:
  pibo debug failures ps_...
  pibo debug tool ps_... <tool-call-id> --output
`);
}

function printDebugCacheDiscovery(): void {
	console.log(`pibo debug cache - summarize provider-reported cache usage

Usage:
  pibo debug cache <pibo-session-id> [--limit n] [--json]

Reports:
  Per-inference input, cache-read, cache-write and uncached token counts.
  Warns when large consecutive requests move from mostly cached to mostly uncached input.
  Provider metrics cannot identify the cause of a cache-read drop.

Next:
  pibo debug cache ps_... --json
  pibo debug trace ps_... --medium
  pibo debug events ps_... --type assistant_usage --fields inputTokens,cacheReadTokens,cacheWriteTokens,totalTokens
`);
}

function printDebugTraceDiscovery(): void {
	console.log(`pibo debug trace - rebuild one Chat Web trace view

Usage:
  pibo debug trace <pibo-session-id> [--running-only] [--check] [--medium] [--native-history] [--json]
  pibo debug trace <pibo-session-id> show <node-id> [--json]

Output:
  Compact trace nodes from Pibo product history and normalized events.
  --native-history explicitly asks the selected adapter for harness-native history.
  --check adds consistency diagnostics for ids, parents, ordering, and links.

Next:
  pibo debug trace ps_... --check
  pibo debug trace ps_... --native-history --check
  pibo debug trace ps_... --medium
  pibo debug trace ps_... show <node-id>
`);
}

function printDebugEventsDiscovery(): void {
	console.log(`pibo debug events - inspect compact event payload fields and Pibo event streams

Usage:
  pibo debug events <pibo-session-id> [list] [--type name] [--fields a,b.c] [--limit n] [--json]
  pibo debug events <pibo-session-id> show <stream-id-or-event-id> [--payload|--raw] [--field path] [--no-truncate] [--json]
  pibo debug events stream [--topic topic] [--after stream_id] [--limit n] [--json]
  pibo debug events stats [--topic topic] [--session pibo-session-id] [--retention class] [--json]
  pibo debug events prune --topic topic --retention class --before iso-date [--limit n] [--destructive] [--json]
  pibo debug events compact-deltas [--dry-run|--apply] [--store pibo-data|chat|reliability] [--session ps_...] [--json]
  pibo debug events consumers [--json]

Examples:
  pibo debug events ps_... --type tool_execution_finished --fields toolName,toolCallId,result.details.status
  pibo debug events ps_... show 356910 --field attributes_json.inlinePayload

Next:
  pibo debug events ps_... --limit 20
  pibo debug events ps_... show <stream-id> --payload
  pibo debug events stats --topic pibo.output --retention live_delta
  pibo debug events stream --topic pibo.output --after 123
`);
}

function printDebugJobsDiscovery(): void {
	console.log(`pibo debug jobs - inspect durable Pibo jobs

Usage:
  pibo debug jobs list [--queue queue] [--limit n] [--json]
  pibo debug jobs dead [--queue queue] [--limit n] [--json]
  pibo debug jobs replay <job-id> [--json]
  pibo debug jobs reconcile-runs (--dry-run|--apply) [--json]

Next:
  pibo debug jobs list --queue runs
  pibo debug jobs reconcile-runs --dry-run
  pibo debug jobs dead --queue runs
`);
}

function printDebugRunsDiscovery(): void {
	console.log(`pibo debug runs - inspect durable yielded runs

Usage:
  pibo debug runs list <pibo-session-id> [--json]
  pibo debug runs inspect <run-id> [--json]

Next:
  pibo debug runs list ps_...
`);
}

function formatSchemaText(tables: Array<{ name: string; columns: Array<{ name: string; type: string; notNull: boolean; primaryKey: boolean }> }>): string {
	if (tables.length === 0) return "tables: 0";
	const lines: string[] = [];
	for (const table of tables) {
		lines.push(table.name);
		for (const column of table.columns) {
			const flags = [column.notNull ? "not-null" : "", column.primaryKey ? "pk" : ""].filter(Boolean).join(",");
			lines.push(`  ${column.name}\t${column.type}${flags ? `\t${flags}` : ""}`);
		}
	}
	return lines.join("\n");
}
