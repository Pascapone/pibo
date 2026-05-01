import { resolveDebugStore, resolveDebugStores } from "./stores.js";

type ParsedOptions = {
	positionals: string[];
	json: boolean;
	events: boolean;
	runningOnly: boolean;
	check: boolean;
	limit?: string;
	type?: string;
	fields?: string[];
	topic?: string;
	key?: string;
	retention?: string;
	after?: string;
	before?: string;
	queue?: string;
	destructive: boolean;
};

export async function runDebugCli(argv = process.argv): Promise<void> {
	try {
		const args = argv.slice(2);
		if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
			printDebugDiscovery();
			return;
		}
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
		if (args[0] === "events") {
			await runDebugEvents(args.slice(1));
			return;
		}
		if (args[0] === "jobs") {
			await runDebugJobs(args.slice(1));
			return;
		}
		if (args[0] === "runs") {
			await runDebugRuns(args.slice(1));
			return;
		}
		throw new Error(`Unknown pibo debug command "${args[0]}". Run pibo debug --help.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

async function runDebugDb(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugDbDiscovery();
		return;
	}
	const command = args[0];
	const options = parseOptions(args.slice(1));
	if (command === "stores") {
		const stores = resolveDebugStores();
		if (options.json) {
			console.log(JSON.stringify({ stores }, null, 2));
			return;
		}
		console.log(["store\tpath\texists\tdescription", ...stores.map((store) => `${store.name}\t${store.defaultPath}\t${store.exists}\t${store.description}`)].join("\n"));
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
	const { formatDebugSessionSummary, inspectDebugSession } = await import("./session.js");
	const summary = inspectDebugSession(input, {
		sessions: resolveDebugStore("sessions"),
		chat: resolveDebugStore("chat"),
	}, {
		events: options.events,
		limit: options.limit,
	});
	if (options.json) console.log(formatJson(summary));
	else console.log(formatDebugSessionSummary(summary));
}

async function runDebugTrace(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugTraceDiscovery();
		return;
	}
	const options = parseOptions(args);
	const piboSessionId = options.positionals[0];
	if (!piboSessionId) throw new Error("pibo debug trace requires <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugTrace, inspectDebugTrace } = await import("./trace.js");
	const result = await inspectDebugTrace(piboSessionId, {
		sessions: resolveDebugStore("sessions"),
		chat: resolveDebugStore("chat"),
	}, {
		runningOnly: options.runningOnly,
		check: options.check,
	});
	if (options.json) console.log(formatJson(result));
	else console.log(formatDebugTrace(result));
}

async function runDebugEvents(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugEventsDiscovery();
		return;
	}
	if (args[0] === "stream") {
		const options = parseOptions(args.slice(1));
		const { formatJson, formatRows } = await import("./sql.js");
		const { PiboReliabilityStore } = await import("../reliability/store.js");
		const store = resolveDebugStore("reliability");
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.defaultPath}`);
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
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.defaultPath}`);
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
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.defaultPath}`);
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
		if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.defaultPath}`);
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
	const piboSessionId = options.positionals[0];
	if (!piboSessionId) throw new Error("pibo debug events requires <pibo-session-id>");
	const { formatJson } = await import("./sql.js");
	const { formatDebugEvents, inspectDebugEvents } = await import("./events.js");
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
	if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.defaultPath}`);
	const reliability = new PiboReliabilityStore(store.path);
	try {
		if (command === "list") {
			const jobs = reliability.listJobs({ queue: options.queue, limit: options.limit ? Number(options.limit) : undefined });
			if (options.json) console.log(formatJson({ jobs }));
			else console.log(formatRows(jobs.map(compactJobRow)));
			return;
		}
		if (command === "dead") {
			const jobs = reliability.listDead({ queue: options.queue, limit: options.limit ? Number(options.limit) : undefined });
			if (options.json) console.log(formatJson({ jobs }));
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
	if (!store.exists) throw new Error(`Debug store "reliability" not found at ${store.defaultPath}`);
	const reliability = new PiboReliabilityStore(store.path);
	try {
		if (command === "list") {
			const piboSessionId = options.positionals[0];
			if (!piboSessionId) throw new Error("pibo debug runs list requires <pibo-session-id>");
			const runs = reliability.listRuns({ ownerPiboSessionId: piboSessionId, includeConsumed: true, includeDetached: true });
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

function parseOptions(args: string[]): ParsedOptions {
	const parsed: ParsedOptions = { positionals: [], json: false, events: false, runningOnly: false, check: false, destructive: false };
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
		if (arg === "--check") {
			parsed.check = true;
			continue;
		}
		if (arg === "--children") {
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
		if (arg === "--after") {
			const value = args[index + 1];
			if (!value) throw new Error("--after requires a value");
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

function compactJobRow(job: { jobId: string; queue: string; state: string; runAt: string; attempts: number; maxAttempts: number; workerId?: string; lastError?: string }): Record<string, unknown> {
	return {
		jobId: job.jobId,
		queue: job.queue,
		state: job.state,
		runAt: job.runAt,
		attempts: `${job.attempts}/${job.maxAttempts}`,
		workerId: job.workerId,
		lastError: job.lastError,
	};
}

function compactDeadJobRow(job: { jobId: string; queue: string; attempts: number; maxAttempts: number; deadAt: string; deadReason: string; lastError?: string }): Record<string, unknown> {
	return {
		jobId: job.jobId,
		queue: job.queue,
		attempts: `${job.attempts}/${job.maxAttempts}`,
		deadAt: job.deadAt,
		deadReason: job.deadReason,
		lastError: job.lastError,
	};
}

function compactRunRow(run: { runId: string; ownerPiboSessionId: string; status: string; toolName: string; completionPolicy: string; consumed: boolean; updatedAt: string; summary?: string }): Record<string, unknown> {
	return {
		runId: run.runId,
		piboSessionId: run.ownerPiboSessionId,
		status: run.status,
		toolName: run.toolName,
		policy: run.completionPolicy,
		consumed: run.consumed,
		updatedAt: run.updatedAt,
		summary: run.summary,
	};
}

function payloadType(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const candidate = payload as { type?: unknown };
	return typeof candidate.type === "string" ? candidate.type : undefined;
}

function printDebugDiscovery(): void {
	console.log(`pibo debug - inspect local Pibo data

Commands:
  db       Inspect and query local SQLite stores
  session  Inspect one Pibo Session by id or Chat URL
  trace    Rebuild the Chat Web trace view for one Pibo Session
  events   Inspect compact event payload fields for one Pibo Session
  jobs     Inspect durable Pibo jobs and DLQ
  runs     Inspect durable yielded runs

Next:
  pibo debug db
  pibo debug session <url-or-pibo-session-id>
  pibo debug trace <pibo-session-id> --running-only
  pibo debug events stream --topic pibo.output
`);
}

function printDebugDbDiscovery(): void {
	console.log(`pibo debug db - inspect local SQLite stores

Stores:
  sessions  .pibo/pibo-sessions.sqlite
  chat      .pibo/web-chat.sqlite
  agents    .pibo/chat-agents.sqlite
  auth      .pibo/auth.sqlite
  bindings  .pibo/session-bindings.sqlite
  reliability .pibo/pibo-events.sqlite

Commands:
  stores               List known stores and paths
  tables <store>       List tables only
  schema <store>       List tables and columns
  query <store> <sql>  Run read-only SQL

Next:
  pibo debug db schema sessions
  pibo debug db query sessions "select id, profile from pibo_sessions limit 5"
`);
}

function printDebugSessionDiscovery(): void {
	console.log(`pibo debug session - inspect one Pibo Session

Usage:
  pibo debug session <url-or-pibo-session-id> [--events] [--limit n] [--json]

Inputs:
  ps_...
  /apps/chat/rooms/<roomId>/sessions/<piboSessionId>
  /apps/chat/sessions/<piboSessionId>

Next:
  pibo debug session ps_...
`);
}

function printDebugTraceDiscovery(): void {
	console.log(`pibo debug trace - rebuild one Chat Web trace view

Usage:
  pibo debug trace <pibo-session-id> [--running-only] [--check] [--json]

Output:
  Compact trace nodes from the same buildTraceView logic used by /api/chat/trace.
  --check adds consistency diagnostics for ids, parents, ordering, and links.

Next:
  pibo debug trace ps_... --check
  pibo debug trace ps_... --running-only
`);
}

function printDebugEventsDiscovery(): void {
	console.log(`pibo debug events - inspect compact event payload fields and Pibo event streams

Usage:
  pibo debug events <pibo-session-id> [--type name] [--fields a,b.c] [--limit n] [--json]
  pibo debug events stream [--topic topic] [--after stream_id] [--limit n] [--json]
  pibo debug events stats [--topic topic] [--session pibo-session-id] [--retention class] [--json]
  pibo debug events prune --topic topic --retention class --before iso-date [--limit n] [--destructive] [--json]
  pibo debug events consumers [--json]

Examples:
  pibo debug events ps_... --type tool_execution_finished --fields toolName,toolCallId,result.details.status

Next:
  pibo debug events ps_... --limit 20
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

Next:
  pibo debug jobs list --queue runs
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
