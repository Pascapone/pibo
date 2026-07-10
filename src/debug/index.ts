import { readFileSync } from "node:fs";
import { getPiboHome } from "../core/pibo-home.js";
import { resolveDebugStore, resolveDebugStores } from "./stores.js";

type ParsedOptions = {
	positionals: string[];
	json: boolean;
	events: boolean;
	runningOnly: boolean;
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
		if (args[0] === "jobs") {
			await runDebugJobs(args.slice(1));
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

async function runDebugResources(args: string[]): Promise<void> {
	if (args[0] === "--help" || args[0] === "-h") {
		printDebugResourcesDiscovery();
		return;
	}
	const options = parseOptions(args);
	const { collectGatewayResourceSnapshot, renderGatewayResourceSnapshotText } = await import("../core/gateway-resource-guard.js");
	const snapshot = await collectGatewayResourceSnapshot();
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

async function runDebugTelemetry(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugTelemetryDiscovery();
		return;
	}
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
	const parsed: ParsedOptions = { positionals: [], json: false, events: false, runningOnly: false, check: false, medium: false, destructive: false, apply: false, dryRun: false, full: false, noTruncate: false, plain: false, raw: false, payload: false, args: false, output: false, error: false, active: false, stale: false };
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

function compactRunRow(run: { runId: string; controllerPiboSessionId: string; status: string; toolName: string; completionPolicy: string; consumed: boolean; updatedAt: string; summary?: string }): Record<string, unknown> {
	return {
		runId: run.runId,
		piboSessionId: run.controllerPiboSessionId,
		status: run.status,
		toolName: run.toolName,
		policy: run.completionPolicy,
		consumed: run.consumed,
		updatedAt: run.updatedAt,
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
  db       Inspect and query local SQLite stores
  session  Inspect one Pibo Session by id or Chat URL
  summary  Show compact session diagnosis and drill-down commands
  messages List or show stored user/assistant messages
  final    Show the latest assistant message
  trace    Rebuild the Chat Web trace view for one Pibo Session
  events   Inspect compact event payload fields for one Pibo Session
  tool     Inspect one grouped tool call
  failures List failed tool calls and trace/session errors
  jobs     Inspect durable Pibo jobs and DLQ
  runs     Inspect durable yielded runs
  resources Show gateway memory reserve, related child processes, and heavy daemons
  signals  Inspect live session signal snapshots through Chat Web APIs
  telemetry Inspect runtime observability telemetry
  web      Inspect browser render state via CDP
  pty      Run and inspect interactive CLI/TUI commands under a PTY

Next:
  pibo debug db
  pibo debug summary <pibo-session-id>
  pibo debug final <pibo-session-id>
  pibo debug messages <pibo-session-id> list
  pibo debug trace <pibo-session-id> --running-only
  pibo debug events stream --topic pibo.output
  pibo debug resources --json
  pibo debug signals tree ps_...
  pibo debug telemetry sessions --active
  pibo debug web targets
  pibo debug pty run -- pibo tui:sessions --demo
`);
}

function printDebugResourcesDiscovery(): void {
	console.log(`pibo debug resources - inspect gateway resource guard state

Usage:
  pibo debug resources [--json]

Reports:
  Gateway RSS/heap headroom, host free-memory reserve, direct child processes, and known heavy local daemons such as ComfyUI or Unity when process listing is available.

Environment:
  PIBO_GATEWAY_RESOURCE_GUARD=warn|block|off
  PIBO_GATEWAY_MIN_FREE_MEMORY_BYTES=<bytes>
  PIBO_GATEWAY_MIN_HEAP_AVAILABLE_BYTES=<bytes>
  PIBO_GATEWAY_MAX_RSS_BYTES=<bytes>
  PIBO_GATEWAY_KNOWN_DAEMON_WARNING_RSS_BYTES=<bytes>

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

Inputs:
  ps_...
  /apps/chat/rooms/<roomId>/sessions/<piboSessionId>
  /apps/chat/sessions/<piboSessionId>

Next:
  pibo debug session ps_...
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

function printDebugTraceDiscovery(): void {
	console.log(`pibo debug trace - rebuild one Chat Web trace view

Usage:
  pibo debug trace <pibo-session-id> [--running-only] [--check] [--medium] [--json]
  pibo debug trace <pibo-session-id> show <node-id> [--json]

Output:
  Compact trace nodes from the same buildTraceView logic used by /api/chat/trace.
  --check adds consistency diagnostics for ids, parents, ordering, and links.

Next:
  pibo debug trace ps_... --check
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
