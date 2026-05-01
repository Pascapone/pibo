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

function parseOptions(args: string[]): ParsedOptions {
	const parsed: ParsedOptions = { positionals: [], json: false, events: false, runningOnly: false, check: false };
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
		parsed.positionals.push(arg);
	}
	return parsed;
}

function printDebugDiscovery(): void {
	console.log(`pibo debug - inspect local Pibo data

Commands:
  db       Inspect and query local SQLite stores
  session  Inspect one Pibo Session by id or Chat URL
  trace    Rebuild the Chat Web trace view for one Pibo Session
  events   Inspect compact event payload fields for one Pibo Session

Next:
  pibo debug db
  pibo debug session <url-or-pibo-session-id>
  pibo debug trace <pibo-session-id> --running-only
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
	console.log(`pibo debug events - inspect compact event payload fields

Usage:
  pibo debug events <pibo-session-id> [--type name] [--fields a,b.c] [--limit n] [--json]

Examples:
  pibo debug events ps_... --type tool_execution_finished --fields toolName,toolCallId,result.details.status

Next:
  pibo debug events ps_... --limit 20
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
