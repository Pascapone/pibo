import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { formatWatch, inferWatchFlickers } from "../dist/debug/web.js";

const execFileAsyncRaw = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function execFileAsync(file, args, options = {}) {
	const piboHome = options.cwd ? join(options.cwd, ".pibo") : undefined;
	return execFileAsyncRaw(file, args, {
		...options,
		env: {
			...process.env,
			...options.env,
			...(piboHome ? { PIBO_HOME: piboHome } : {}),
		},
	});
}

test("pibo debug web watch rejects action flags", async () => {
	await assert.rejects(
		execFileAsync("node", [cliPath, "debug", "web", "watch", "--preset", "app", "--act"]),
		(error) => {
			assert.match(error.stderr, /Action flags are only supported by scenarios/);
			assert.match(error.stderr, /pibo debug web scenario new-session --act/);
			return true;
		},
	);
});

test("web render flicker detection does not match a removal to an earlier add", () => {
	const opt = makeWatchNode("session-row:opt", { "data-pibo-session-id": "opt" });
	const real = makeWatchNode("session-row:real", { "data-pibo-session-id": "real" });
	const flickers = inferWatchFlickers([
		{ t: 1, source: "dom", kind: "added", target: opt.identity, node: opt },
		{ t: 61, source: "dom", kind: "removed", target: opt.identity, node: opt },
		{ t: 122, source: "dom", kind: "added", target: real.identity, node: real },
	]);
	const output = flickers.join("\n");
	assert.match(output, /transient node within 60ms: session-row:opt added then removed/);
	assert.match(output, /remove\/add within 61ms: session-row:opt -> session-row:real/);
	assert.doesNotMatch(output, /session-row:opt -> session-row:opt/);
});

test("web render watch reports final snapshot deltas when no mutation events were captured", () => {
	const before = makeWatchSnapshot([]);
	const after = makeWatchSnapshot([makeWatchNode("session-row:ps_new", { "data-pibo-session-id": "ps_new" })]);
	const output = formatWatch(
		{
			kind: "watch",
			createdAt: "2026-05-16T00:00:00.000Z",
			url: "file:///fixture.html",
			title: "Fixture",
			scope: "#container",
			durationMs: 1000,
			rootFound: true,
			events: [],
			before,
			after,
			omitted: { events: 0, nodes: 0, depth: 0, budget: false },
		},
		{ id: "target", url: "file:///fixture.html", title: "Fixture" },
	);
	assert.match(output, /no mutation events captured; final snapshot differs/);
	assert.match(output, /\+ session-row:ps_new/);
	assert.doesNotMatch(output, /no changes/);
});

test("pibo debug help stays progressive", async () => {
	const root = await execFileAsync("node", [cliPath, "debug", "--help"]);
	assert.match(root.stdout, /pibo debug - inspect local Pibo data/);
	assert.match(root.stdout, /pibo debug db/);
	assert.match(root.stdout, /pibo debug trace/);
	assert.match(root.stdout, /pibo debug telemetry/);
	assert.doesNotMatch(root.stdout, /pibo_sessions/);

	const telemetry = await execFileAsync("node", [cliPath, "debug", "telemetry", "--help"]);
	assert.match(telemetry.stdout, /pibo debug telemetry - inspect bounded runtime observability telemetry/);
	assert.match(telemetry.stdout, /sessions\s+List recent, active, or stale telemetry sessions/);
	assert.match(telemetry.stdout, /session\s+Show compact session telemetry/);
	assert.match(telemetry.stdout, /turn\s+Show a phase timeline/);
	assert.match(telemetry.stdout, /provider\s+Show provider request summary/);
	assert.doesNotMatch(telemetry.stdout, /telemetry_turns/);

	const db = await execFileAsync("node", [cliPath, "debug", "db", "--help"]);
	assert.match(db.stdout, /pibo debug db - inspect local SQLite stores/);
	assert.match(db.stdout, /pibo-data\s+pibo\.sqlite/);
	assert.match(db.stdout, /query <store> <sql>/);
	assert.doesNotMatch(db.stdout, /CREATE TABLE/);
	assert.doesNotMatch(db.stdout, /web-chat\.sqlite/);
	assert.doesNotMatch(db.stdout, /pibo-sessions\.sqlite/);
});

test("pibo debug telemetry lists sessions and drills into session and turn summaries", async () => {
	const cwd = await makeDebugFixture();
	try {
		const sessions = await execFileAsync("node", [cliPath, "debug", "telemetry", "sessions", "--active", "--limit", "5"], { cwd });
		assert.match(sessions.stdout, /pibo debug telemetry sessions/);
		assert.match(sessions.stdout, /piboSessionId\tstatus\tactiveTurnId\tactivePhase/);
		assert.match(sessions.stdout, /ps_running\trunning\tturn_debug_stuck\ttool_args:open/);
		assert.match(sessions.stdout, /pibo debug telemetry session ps_running/);
		assert.doesNotMatch(sessions.stdout, /sleep 10/);

		const stale = await execFileAsync("node", [cliPath, "debug", "telemetry", "sessions", "--stale", "--json"], { cwd });
		const staleParsed = JSON.parse(stale.stdout);
		assert.equal(staleParsed.available, true);
		assert.equal(staleParsed.filters.stale, true);
		assert.equal(staleParsed.rows.some((row) => row.piboSessionId === "ps_running" && row.isStale === true), true);
		assert.equal(staleParsed.limit, 20);

		const session = await execFileAsync("node", [cliPath, "debug", "telemetry", "session", "ps_running", "--limit", "5"], { cwd });
		assert.match(session.stdout, /status\trunning/);
		assert.match(session.stdout, /activeTurn\tturn_debug_stuck/);
		assert.match(session.stdout, /activePhase\ttool_args:open/);
		assert.match(session.stdout, /providerRequestId\tpr_debug_stuck/);
		assert.match(session.stdout, /toolCallId\ttool_debug_stuck/);
		assert.match(session.stdout, /pibo debug telemetry turn turn_debug_stuck/);
		assert.doesNotMatch(session.stdout, /large provider body/);

		const sessionJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "session", "ps_running", "--json"], { cwd });
		const sessionParsed = JSON.parse(sessionJson.stdout);
		assert.equal(sessionParsed.available, true);
		assert.equal(sessionParsed.detail.activeTurn.turnId, "turn_debug_stuck");
		assert.equal(sessionParsed.detail.providerRequests[0].providerRequestId, "pr_debug_stuck");
		assert.equal(sessionParsed.detail.toolCalls[0].argsBytes, 18);

		const turn = await execFileAsync("node", [cliPath, "debug", "telemetry", "turn", "turn_debug_stuck", "--events"], { cwd });
		assert.match(turn.stdout, /pibo debug telemetry turn turn_debug_stuck/);
		assert.match(turn.stdout, /openPhases\t2/);
		assert.match(turn.stdout, /missingTerminalEvent\ttrue/);
		assert.match(turn.stdout, /provider_stream\topen/);
		assert.match(turn.stdout, /tool_args\topen/);
		assert.match(turn.stdout, /evt_running/);
		assert.match(turn.stdout, /pibo debug telemetry provider pr_debug_stuck/);
		assert.doesNotMatch(turn.stdout, /partial command body/);

		const turnJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "turn", "evt_running", "--json"], { cwd });
		const turnParsed = JSON.parse(turnJson.stdout);
		assert.equal(turnParsed.available, true);
		assert.equal(turnParsed.timeline.turn.turnId, "turn_debug_stuck");
		assert.equal(turnParsed.timeline.phases.some((phase) => phase.name === "tool_args" && phase.status === "open"), true);
		assert.equal(turnParsed.openPhases, 2);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug telemetry inspects provider summaries, event pages, and disabled previews", async () => {
	const cwd = await makeDebugFixture();
	try {
		const provider = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck"], { cwd });
		assert.match(provider.stdout, /pibo debug telemetry provider pr_debug_stuck/);
		assert.match(provider.stdout, /status\tstreaming/);
		assert.match(provider.stdout, /provider\topenai/);
		assert.match(provider.stdout, /upstreamResponseId\tresp_debug_stuck/);
		assert.match(provider.stdout, /rawEventCount\t2/);
		assert.match(provider.stdout, /unknownEventCount\t1/);
		assert.match(provider.stdout, /response\.output_item\.added\t1/);
		assert.match(provider.stdout, /pibo debug telemetry provider pr_debug_stuck events --limit 20/);
		assert.doesNotMatch(provider.stdout, /large provider body/);

		const providerJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "--json"], { cwd });
		const providerParsed = JSON.parse(providerJson.stdout);
		assert.equal(providerParsed.available, true);
		assert.equal(providerParsed.request.providerRequestId, "pr_debug_stuck");
		assert.equal(providerParsed.request.rawEventCount, 2);
		assert.equal(providerParsed.eventTypeRows.some((row) => row.eventType === "provider.experimental.unknown" && row.count === 1), true);

		const events = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "events", "--limit", "1", "--fields", "toolName,itemId,status"], { cwd });
		assert.match(events.stdout, /sequence\trawEventId\treceivedAt\teventType/);
		assert.match(events.stdout, /raw_debug_stuck_1/);
		assert.match(events.stdout, /safeFields/);
		assert.match(events.stdout, /toolName=bash/);
		assert.match(events.stdout, /nextAfterSequence\t1/);
		assert.match(events.stdout, /pibo debug telemetry provider pr_debug_stuck events --after 1 --limit 20/);
		assert.doesNotMatch(events.stdout, /large provider body/);

		const eventsJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "events", "--after", "1", "--json"], { cwd });
		const eventsParsed = JSON.parse(eventsJson.stdout);
		assert.equal(eventsParsed.available, true);
		assert.equal(eventsParsed.page.afterSequence, 1);
		assert.equal(eventsParsed.rows.length, 1);
		assert.equal(eventsParsed.rows[0].eventType, "provider.experimental.unknown");
		assert.equal(eventsParsed.rows[0].selectedSafeFields.status, "ignored");
		assert.equal(eventsParsed.rows[0].safeFields.status, "ignored");

		const payload = await execFileAsync("node", [cliPath, "debug", "telemetry", "provider", "pr_debug_stuck", "payload", "raw_debug_stuck_1"], { cwd });
		assert.match(payload.stdout, /status\tdisabled/);
		assert.match(payload.stdout, /preview_capture_disabled/);
		assert.match(payload.stdout, /metadata and links only/);
		assert.doesNotMatch(payload.stdout, /large provider body/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug telemetry inspects tool calls, stale work, stats, and dry-run-first prune", async () => {
	const cwd = await makeDebugFixture();
	try {
		const tool = await execFileAsync("node", [cliPath, "debug", "telemetry", "tool", "tool_debug_stuck"], { cwd });
		assert.match(tool.stdout, /pibo debug telemetry tool tool_debug_stuck/);
		assert.match(tool.stdout, /toolName\tbash/);
		assert.match(tool.stdout, /status\targs_partial/);
		assert.match(tool.stdout, /argsBytes\t18/);
		assert.match(tool.stdout, /parseStatus\tpartial/);
		assert.match(tool.stdout, /noExecutionStart\ttrue/);
		assert.match(tool.stdout, /pibo debug telemetry provider pr_debug_stuck/);
		assert.doesNotMatch(tool.stdout, /sleep 10/);
		assert.doesNotMatch(tool.stdout, /partial command body/);

		const toolJson = await execFileAsync("node", [cliPath, "debug", "telemetry", "tool", "tool_debug_stuck", "--json"], { cwd });
		const toolParsed = JSON.parse(toolJson.stdout);
		assert.equal(toolParsed.available, true);
		assert.equal(toolParsed.tool.toolCallId, "tool_debug_stuck");
		assert.equal(toolParsed.noExecutionStart, true);
		assert.deepEqual(Object.keys(toolParsed.tool).includes("args"), false);

		const stale = await execFileAsync("node", [cliPath, "debug", "telemetry", "stale", "--limit", "5"], { cwd });
		assert.match(stale.stdout, /pibo debug telemetry stale/);
		assert.match(stale.stdout, /ps_running\tturn_debug_stuck/);
		assert.match(stale.stdout, /tool_args/);
		assert.match(stale.stdout, /300000\tdefault/);
		assert.doesNotMatch(stale.stdout, /large provider body/);

		const staleOverride = await execFileAsync("node", [cliPath, "debug", "telemetry", "stale", "--threshold-ms", "1000", "--json"], { cwd });
		const staleOverrideParsed = JSON.parse(staleOverride.stdout);
		assert.equal(staleOverrideParsed.available, true);
		assert.equal(staleOverrideParsed.thresholdOverrideMs, 1000);
		assert.equal(staleOverrideParsed.rows.some((row) => row.thresholdSource === "override" && row.appliedThresholdMs === 1000), true);

		const stats = await execFileAsync("node", [cliPath, "debug", "telemetry", "stats", "--retention", "provider_event", "--json"], { cwd });
		const statsParsed = JSON.parse(stats.stdout);
		assert.equal(statsParsed.available, true);
		assert.equal(statsParsed.retentionClass, "provider_event");
		assert.equal(statsParsed.stats.totalRows, 2);
		assert.equal(statsParsed.stats.totalBytes, 200);

		const dryRun = await execFileAsync("node", [cliPath, "debug", "telemetry", "prune", "--retention", "provider_event", "--before", "2026-05-01T10:04:04.000Z", "--json"], { cwd });
		const dryRunParsed = JSON.parse(dryRun.stdout);
		assert.equal(dryRunParsed.available, true);
		assert.equal(dryRunParsed.dryRun, true);
		assert.equal(dryRunParsed.result.applied, false);
		assert.equal(dryRunParsed.result.rowsMatched, 1);
		assert.equal(dryRunParsed.result.rowsDeleted, 0);

		const apply = await execFileAsync("node", [cliPath, "debug", "telemetry", "prune", "--retention", "provider_event", "--before", "2026-05-01T10:04:04.000Z", "--apply", "--json"], { cwd });
		const applyParsed = JSON.parse(apply.stdout);
		assert.equal(applyParsed.result.applied, true);
		assert.equal(applyParsed.result.rowsDeleted, 1);

		const statsAfter = await execFileAsync("node", [cliPath, "debug", "telemetry", "stats", "--retention", "provider_event", "--json"], { cwd });
		assert.equal(JSON.parse(statsAfter.stdout).stats.totalRows, 1);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug db discovers schema and runs limited read-only SQL", async () => {
	const cwd = await makeDebugFixture();
	try {
		const schema = await execFileAsync("node", [cliPath, "debug", "db", "schema", "sessions", "--json"], { cwd });
		const parsed = JSON.parse(schema.stdout);
		assert.equal(parsed.store, "sessions");
		const sessionsTable = parsed.tables.find((table) => table.name === "sessions");
		assert.ok(sessionsTable);
		assert.equal(sessionsTable.columns[0].name, "id");

		const query = await execFileAsync(
			"node",
			[cliPath, "debug", "db", "query", "sessions", "select id, profile from sessions order by id", "--limit", "2"],
			{ cwd },
		);
		assert.match(query.stdout, /id\tprofile/);
		assert.match(query.stdout, /ps_child\tresearcher/);
		assert.match(query.stdout, /rows: 2 \(limited\)/);

		const cte = await execFileAsync(
			"node",
			[cliPath, "debug", "db", "query", "sessions", "with rows as (select id from sessions) select id from rows limit 1"],
			{ cwd },
		);
		assert.match(cte.stdout, /ps_/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug db rejects mutating and multi-statement SQL", async () => {
	const cwd = await makeDebugFixture();
	try {
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "db", "query", "sessions", "insert into sessions(id) values ('x')"], {
				cwd,
			}),
			(error) => {
				assert.match(error.stderr, /Mutating SQL is not allowed: insert/);
				return true;
			},
		);
		await assert.rejects(
			execFileAsync("node", [cliPath, "debug", "db", "query", "sessions", "select 1; select 2"], { cwd }),
			(error) => {
				assert.match(error.stderr, /Only one SQL statement is allowed/);
				return true;
			},
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug session inspects a Chat URL without event payload dumps", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"session",
				"/apps/chat/rooms/room_one/sessions/ps_parent",
				"--events",
				"--json",
			],
			{ cwd },
		);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.input.roomId, "room_one");
		assert.equal(parsed.input.piboSessionId, "ps_parent");
		assert.equal(parsed.session.profile, "codex-compat-openai-web");
		assert.equal(parsed.room.matches, true);
		assert.equal(parsed.children[0].id, "ps_child");
		assert.equal(parsed.children[0].subagentName, "researcher");
		assert.equal(parsed.chat.status, "idle");
		assert.deepEqual(Object.keys(parsed.events[0]).sort(), ["created_at", "event_id", "stream_id", "type"]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug session warns when a Chat URL room does not match session metadata", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[cliPath, "debug", "session", "/apps/chat/rooms/room_wrong/sessions/ps_parent", "--json"],
			{ cwd },
		);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.room.matches, false);
		assert.match(parsed.warnings[0], /does not match session metadata chatRoomId/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug trace prints rebuilt Chat Web trace nodes", async () => {
	const cwd = await makeDebugFixture();
	try {
		const trace = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--running-only"], { cwd });
		assert.match(trace.stdout, /status\ttype\ttitle\tid\trunId\tlinkedPiboSessionId/);
		assert.match(trace.stdout, /running\ttool.call\t\s+bash\ttool:tool_1/);
		assert.match(trace.stdout, /nodes: 2/);

		const json = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--json"], { cwd });
		const parsed = JSON.parse(json.stdout);
		assert.equal(parsed.status, "running");
		assert.equal(parsed.nodes.some((node) => node.status === "running" && node.title === "bash"), true);

		const checked = await execFileAsync("node", [cliPath, "debug", "trace", "ps_running", "--check", "--json"], { cwd });
		const checkedParsed = JSON.parse(checked.stdout);
		assert.equal(typeof checkedParsed.checks.status, "string");
		assert.ok(Array.isArray(checkedParsed.checks.issues));
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug events extracts selected payload fields", async () => {
	const cwd = await makeDebugFixture();
	try {
		const result = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"events",
				"ps_parent",
				"--type",
				"tool_execution_finished",
				"--fields",
				"toolName,toolCallId,result.details.status",
			],
			{ cwd },
		);
		assert.match(result.stdout, /toolName\ttoolCallId\tresult.details.status/);
		assert.match(result.stdout, /pibo_run_wait\ttool_wait\tcompleted/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug events inspects Pibo event streams and consumers", async () => {
	const cwd = await makeDebugFixture();
	try {
		const stream = await execFileAsync(
			"node",
			[cliPath, "debug", "events", "stream", "--topic", "pibo.output", "--after", "1"],
			{ cwd },
		);
		assert.match(stream.stdout, /streamId\ttopic\tkey\teventId\ttype\tcreatedAt\tretentionClass/);
		assert.match(stream.stdout, /pibo.output\tps_parent\tpibo.output:2\tassistant_message/);
		assert.doesNotMatch(stream.stdout, /pibo.output:1/);

		const consumers = await execFileAsync("node", [cliPath, "debug", "events", "consumers"], { cwd });
		assert.match(consumers.stdout, /consumer\ttopic\tlastStreamId\tupdatedAt/);
		assert.match(consumers.stdout, /chat-projector\tpibo.output\t3/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug events reports stats and prunes live deltas", async () => {
	const cwd = await makeDebugFixture();
	try {
		const stats = await execFileAsync(
			"node",
			[cliPath, "debug", "events", "stats", "--topic", "pibo.output", "--session", "ps_parent", "--retention", "live_delta"],
			{ cwd },
		);
		assert.match(stats.stdout, /topic\tkey\tretentionClass\tcount/);
		assert.match(stats.stdout, /pibo.output\tps_parent\tlive_delta\t2/);

		const prune = await execFileAsync(
			"node",
			[
				cliPath,
				"debug",
				"events",
				"prune",
				"--topic",
				"pibo.output",
				"--retention",
				"live_delta",
				"--before",
				"2026-05-01T10:04:00.000Z",
			],
			{ cwd },
		);
		assert.match(prune.stdout, /deleted/);
		assert.match(prune.stdout, /1/);

		const after = await execFileAsync(
			"node",
			[cliPath, "debug", "events", "stats", "--topic", "pibo.output", "--session", "ps_parent", "--retention", "live_delta", "--json"],
			{ cwd },
		);
		const parsed = JSON.parse(after.stdout);
		assert.equal(parsed.counts[0].count, 1);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug jobs lists dead jobs and replays one", async () => {
	const cwd = await makeDebugFixture();
	try {
		const live = await execFileAsync("node", [cliPath, "debug", "jobs", "list", "--queue", "runs"], { cwd });
		assert.match(live.stdout, /jobId\tqueue\tstate\trunAt\tattempts\tworkerId\tlastError/);
		assert.match(live.stdout, /job_live\truns\tpending/);

		const dead = await execFileAsync("node", [cliPath, "debug", "jobs", "dead", "--queue", "runs"], { cwd });
		assert.match(dead.stdout, /job_dead\truns\t1\/1/);

		const replay = await execFileAsync("node", [cliPath, "debug", "jobs", "replay", "job_dead"], { cwd });
		assert.match(replay.stdout, /runs\tpending/);
		assert.doesNotMatch(replay.stdout, /job_dead\truns\tpending/);

		const deadAfterReplay = await execFileAsync("node", [cliPath, "debug", "jobs", "dead", "--queue", "runs"], { cwd });
		assert.doesNotMatch(deadAfterReplay.stdout, /job_dead/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug runs lists and inspects durable runs", async () => {
	const cwd = await makeDebugFixture();
	try {
		const list = await execFileAsync("node", [cliPath, "debug", "runs", "list", "ps_parent"], { cwd });
		assert.match(list.stdout, /runId\tpiboSessionId\tstatus\ttoolName\tpolicy\tconsumed\tupdatedAt\tsummary/);
		assert.match(list.stdout, /run_debug\tps_parent\tcompleted\thelper\ttracked\tfalse/);

		const inspect = await execFileAsync("node", [cliPath, "debug", "runs", "inspect", "run_debug", "--json"], { cwd });
		const parsed = JSON.parse(inspect.stdout);
		assert.equal(parsed.run.runId, "run_debug");
		assert.equal(parsed.run.result.text, "done");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo debug reports missing stores with the expected path", async () => {
	const cwd = await makeEmptyCwd();
	try {
		await assert.rejects(execFileAsync("node", [cliPath, "debug", "db", "tables", "sessions"], { cwd }), (error) => {
			assert.match(error.stderr, /Debug store "sessions" not found at .*\.pibo\/pibo\.sqlite/);
			return true;
		});
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

async function makeEmptyCwd() {
	const cwd = join(tmpdir(), `pibo-debug-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(cwd, { recursive: true });
	return cwd;
}


function makeWatchNode(identity, attributes = {}) {
	return {
		ref: "@fixture",
		identity,
		identityKind: "pibo-session",
		depth: 0,
		tag: "div",
		name: identity.replace(/^session-row:/, ""),
		attributes: { "data-pibo-debug": "session-row", ...attributes },
		classSummary: "session-row",
		path: "html>body>div:nth-of-type(1)",
	};
}

function makeWatchSnapshot(nodes) {
	return {
		kind: "snapshot",
		createdAt: "2026-05-16T00:00:00.000Z",
		url: "file:///fixture.html",
		title: "Fixture",
		scope: "#container",
		rootFound: true,
		root: nodes[0],
		nodes,
		omitted: { nodes: 0, depth: 0, budget: false },
	};
}

function insertSession(db, input) {
	db.prepare(`
		INSERT INTO sessions (
			id, pi_session_id, owner_scope, room_id, root_session_id, parent_id, origin_id,
			channel, kind, profile, active_model_json, workspace, title, status,
			metadata_json, created_at, updated_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		input.id,
		input.piSessionId,
		input.ownerScope,
		input.roomId ?? null,
		input.rootSessionId ?? input.id,
		input.parentId ?? null,
		null,
		input.channel,
		input.kind,
		input.profile,
		"/workspace",
		input.title,
		input.status,
		JSON.stringify(input.metadata ?? {}),
		input.createdAt,
		input.updatedAt,
		input.lastActivityAt,
	);
	db.prepare(`
		INSERT INTO session_stats (session_id, message_count, tool_call_count, error_count, last_event_stream_id, last_activity_at, status, updated_at)
		VALUES (?, 0, 0, 0, NULL, ?, ?, ?)
	`).run(input.id, input.lastActivityAt, input.status, input.updatedAt);
	db.prepare(`
		INSERT INTO session_navigation (
			owner_scope, room_id, session_id, root_session_id, parent_id, origin_id,
			title, profile, status, last_activity_at, child_count, sort_key, updated_at
		) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?, ?)
	`).run(input.ownerScope, input.roomId ?? null, input.id, input.rootSessionId ?? input.id, input.parentId ?? null, input.title, input.profile, input.status, input.lastActivityAt, input.lastActivityAt, input.updatedAt);
}

function insertEvent(db, input) {
	db.prepare(`
		INSERT INTO event_log (
			stream_id, session_id, session_sequence, room_id, topic, type, source,
			event_id, retention_class, preview_text, attributes_json, created_at
		) VALUES (?, ?, ?, ?, 'pibo.output', ?, 'agent', ?, 'trace_event', ?, ?, ?)
	`).run(
		input.streamId,
		input.sessionId,
		input.sequence,
		input.roomId ?? null,
		input.type,
		input.eventId,
		input.payload?.text ?? null,
		JSON.stringify({ inlinePayload: input.payload }),
		input.createdAt,
	);
}

async function makeDebugFixture() {
	const cwd = await makeEmptyCwd();
	const piboDir = join(cwd, ".pibo");
	await mkdir(piboDir, { recursive: true });
	const data = new PiboDataStore(join(piboDir, "pibo.sqlite"));
	try {
		insertSession(data.db, {
			id: "ps_parent",
			piSessionId: "11111111-1111-4111-8111-111111111111",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "codex-compat-openai-web",
			ownerScope: "user:one",
			roomId: "room_one",
			rootSessionId: "ps_parent",
			title: "Parent",
			status: "idle",
			metadata: { chatRoomId: "room_one" },
			createdAt: "2026-05-01T10:00:00.000Z",
			updatedAt: "2026-05-01T10:03:00.000Z",
			lastActivityAt: "2026-05-01T10:03:00.000Z",
		});
		insertSession(data.db, {
			id: "ps_child",
			piSessionId: "22222222-2222-4222-8222-222222222222",
			channel: "pibo.subagents",
			kind: "subagent",
			profile: "researcher",
			ownerScope: "user:one",
			roomId: "room_one",
			rootSessionId: "ps_parent",
			parentId: "ps_parent",
			title: "Child",
			status: "idle",
			metadata: {
				chatRoomId: "room_one",
				subagentName: "researcher",
				subagentToolName: "pibo_subagent_researcher",
				threadKey: "qa",
			},
			createdAt: "2026-05-01T10:01:00.000Z",
			updatedAt: "2026-05-01T10:01:00.000Z",
			lastActivityAt: "2026-05-01T10:01:00.000Z",
		});
		insertSession(data.db, {
			id: "ps_other",
			piSessionId: "33333333-3333-4333-8333-333333333333",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "codex-compat-openai-web",
			ownerScope: "user:one",
			rootSessionId: "ps_other",
			title: "Other",
			status: "idle",
			metadata: {},
			createdAt: "2026-05-01T10:02:00.000Z",
			updatedAt: "2026-05-01T10:02:00.000Z",
			lastActivityAt: "2026-05-01T10:02:00.000Z",
		});
		insertSession(data.db, {
			id: "ps_running",
			piSessionId: "44444444-4444-4444-8444-444444444444",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "codex-compat-openai-web",
			ownerScope: "user:one",
			rootSessionId: "ps_running",
			title: "Running",
			status: "running",
			metadata: {},
			createdAt: "2026-05-01T10:04:00.000Z",
			updatedAt: "2026-05-01T10:04:03.000Z",
			lastActivityAt: "2026-05-01T10:04:03.000Z",
		});
		insertEvent(data.db, {
			streamId: 1,
			sessionId: "ps_parent",
			sequence: 1,
			roomId: "room_one",
			eventId: "evt_1",
			type: "message_finished",
			createdAt: "2026-05-01T10:03:00.000Z",
			payload: { large: "payload should not be shown" },
		});
		insertEvent(data.db, {
			streamId: 2,
			sessionId: "ps_parent",
			sequence: 2,
			roomId: "room_one",
			eventId: "evt_2",
			type: "tool_execution_finished",
			createdAt: "2026-05-01T10:03:01.000Z",
			payload: {
				type: "tool_execution_finished",
				piboSessionId: "ps_parent",
				eventId: "evt_2",
				toolCallId: "tool_wait",
				toolName: "pibo_run_wait",
				result: { details: { status: "completed" } },
				isError: false,
			},
		});
		insertEvent(data.db, {
			streamId: 3,
			sessionId: "ps_running",
			sequence: 1,
			eventId: "evt_running",
			type: "message_started",
			createdAt: "2026-05-01T10:04:01.000Z",
			payload: { type: "message_started", piboSessionId: "ps_running", eventId: "evt_running", source: "user", text: "run command" },
		});
		insertEvent(data.db, {
			streamId: 4,
			sessionId: "ps_running",
			sequence: 2,
			eventId: "evt_running",
			type: "tool_execution_started",
			createdAt: "2026-05-01T10:04:02.000Z",
			payload: { type: "tool_execution_started", piboSessionId: "ps_running", eventId: "evt_running", toolCallId: "tool_1", toolName: "bash", args: { cmd: "sleep 10" } },
		});
		data.telemetry.upsertTurn({
			turnId: "turn_parent_done",
			piboSessionId: "ps_parent",
			rootSessionId: "ps_parent",
			roomId: "room_one",
			eventId: "evt_1",
			eventStreamId: 1,
			source: "user",
			status: "ok",
			currentPhase: "finish",
			queuedAt: "2026-05-01T10:02:55.000Z",
			startedAt: "2026-05-01T10:02:56.000Z",
			completedAt: "2026-05-01T10:03:00.000Z",
			lastProgressAt: "2026-05-01T10:03:00.000Z",
			queueDepth: 0,
			summary: "completed fixture turn",
			createdAt: "2026-05-01T10:02:55.000Z",
			updatedAt: "2026-05-01T10:03:00.000Z",
		});
		data.telemetry.upsertTurn({
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			eventId: "evt_running",
			eventStreamId: 3,
			source: "user",
			status: "running",
			currentPhase: "tool_args",
			queuedAt: "2026-05-01T10:04:00.000Z",
			startedAt: "2026-05-01T10:04:01.000Z",
			lastProgressAt: "2026-05-01T10:04:06.000Z",
			queuedBehind: 0,
			queueDepth: 1,
			summary: "partial tool-call fixture without argument body",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:00.000Z",
			updatedAt: "2026-05-01T10:04:06.000Z",
			metadata: { fixture: "debug_cli", omittedBody: true },
		});
		data.telemetry.upsertPhase({
			phaseId: "turn_debug_stuck:queued",
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			name: "queued",
			status: "ok",
			startedAt: "2026-05-01T10:04:00.000Z",
			endedAt: "2026-05-01T10:04:01.000Z",
			lastProgressAt: "2026-05-01T10:04:01.000Z",
			durationMs: 1000,
			eventId: "evt_running",
			eventStreamId: 3,
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:00.000Z",
			updatedAt: "2026-05-01T10:04:01.000Z",
		});
		data.telemetry.upsertPhase({
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			name: "provider_stream",
			status: "open",
			startedAt: "2026-05-01T10:04:02.000Z",
			lastProgressAt: "2026-05-01T10:04:05.000Z",
			providerRequestId: "pr_debug_stuck",
			eventId: "evt_running",
			eventStreamId: 3,
			counters: { rawEvents: 2, normalizedEvents: 1 },
			summary: "provider stream metadata only; large provider body omitted",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:02.000Z",
			updatedAt: "2026-05-01T10:04:05.000Z",
		});
		data.telemetry.upsertProviderRequest({
			providerRequestId: "pr_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			provider: "openai",
			api: "openai-responses",
			model: "gpt-debug",
			transport: "sse",
			status: "streaming",
			startedAt: "2026-05-01T10:04:02.000Z",
			firstByteAt: "2026-05-01T10:04:03.000Z",
			lastRawEventAt: "2026-05-01T10:04:05.000Z",
			lastNormalizedEventAt: "2026-05-01T10:04:05.000Z",
			upstreamResponseId: "resp_debug_stuck",
			captureMode: "metadata_only",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:02.000Z",
			updatedAt: "2026-05-01T10:04:05.000Z",
		});
		data.telemetry.appendProviderEventSummary({
			rawEventId: "raw_debug_stuck_1",
			providerRequestId: "pr_debug_stuck",
			piboSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			sequence: 1,
			receivedAt: "2026-05-01T10:04:03.000Z",
			eventType: "response.output_item.added",
			byteSize: 128,
			parseStatus: "ok",
			normalizedType: "tool_call:start",
			itemId: "item_debug_stuck",
			toolCallId: "tool_debug_stuck",
			eventId: "evt_running",
			eventStreamId: 3,
			safeFields: { itemId: "item_debug_stuck", itemType: "function_call", toolName: "bash" },
			retentionClass: "provider_event",
			createdAt: "2026-05-01T10:04:03.000Z",
			updatedAt: "2026-05-01T10:04:03.000Z",
		});
		data.telemetry.appendProviderEventSummary({
			rawEventId: "raw_debug_stuck_2",
			providerRequestId: "pr_debug_stuck",
			piboSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			phaseId: "turn_debug_stuck:provider_stream:pr_debug_stuck",
			sequence: 2,
			receivedAt: "2026-05-01T10:04:05.000Z",
			eventType: "provider.experimental.unknown",
			byteSize: 72,
			parseStatus: "unknown_type",
			eventId: "evt_running",
			eventStreamId: 4,
			safeFields: { eventType: "provider.experimental.unknown", sequence: 2, status: "ignored" },
			retentionClass: "provider_event",
			createdAt: "2026-05-01T10:04:05.000Z",
			updatedAt: "2026-05-01T10:04:05.000Z",
		});
		data.telemetry.upsertPhase({
			phaseId: "turn_debug_stuck:tool_args:tool_debug_stuck",
			turnId: "turn_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			name: "tool_args",
			status: "open",
			startedAt: "2026-05-01T10:04:04.000Z",
			lastProgressAt: "2026-05-01T10:04:06.000Z",
			providerRequestId: "pr_debug_stuck",
			toolCallId: "tool_debug_stuck",
			eventId: "evt_running",
			eventStreamId: 4,
			counters: { argsBytes: 18 },
			summary: "partial command body omitted",
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:04.000Z",
			updatedAt: "2026-05-01T10:04:06.000Z",
		});
		data.telemetry.upsertToolCall({
			toolCallId: "tool_debug_stuck",
			piboSessionId: "ps_running",
			rootSessionId: "ps_running",
			turnId: "turn_debug_stuck",
			providerRequestId: "pr_debug_stuck",
			providerItemId: "item_debug_stuck",
			toolName: "bash",
			status: "args_partial",
			argsStartedAt: "2026-05-01T10:04:04.000Z",
			firstDeltaAt: "2026-05-01T10:04:04.000Z",
			lastDeltaAt: "2026-05-01T10:04:06.000Z",
			argsBytes: 18,
			parseStatus: "partial",
			safeArgKeys: [],
			eventId: "evt_running",
			eventStreamId: 4,
			retentionClass: "incident",
			createdAt: "2026-05-01T10:04:04.000Z",
			updatedAt: "2026-05-01T10:04:06.000Z",
		});
	} finally {
		data.close();
	}

	const reliability = new PiboReliabilityStore(join(piboDir, "pibo-events.sqlite"));
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:1",
		retentionClass: "trace_event",
		payload: { type: "message_started", piboSessionId: "ps_parent" },
	});
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:2",
		retentionClass: "chat_message",
		payload: { type: "assistant_message", piboSessionId: "ps_parent", text: "done" },
	});
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:3",
		createdAt: "2026-05-01T10:03:00.000Z",
		retentionClass: "live_delta",
		payload: { type: "assistant_delta", piboSessionId: "ps_parent", text: "stream one" },
	});
	reliability.append({
		topic: "pibo.output",
		key: "ps_parent",
		eventId: "pibo.output:4",
		createdAt: "2026-05-01T10:03:01.000Z",
		retentionClass: "live_delta",
		payload: { type: "assistant_delta", piboSessionId: "ps_parent", text: "stream two" },
	});
	reliability.saveConsumerOffset("pibo.output", "chat-projector", 3);
	reliability.enqueue({
		jobId: "job_live",
		queue: "runs",
		payload: { runId: "run_live", toolName: "helper" },
		maxAttempts: 1,
	});
	const dead = reliability.enqueue({
		jobId: "job_dead",
		queue: "runs",
		payload: { runId: "run_dead", toolName: "helper" },
		maxAttempts: 1,
	});
	reliability.claimJob(dead.jobId, "worker");
	reliability.fail(dead.jobId, "worker", "failed");
	reliability.createRun({
		runId: "run_debug",
		ownerPiboSessionId: "ps_parent",
		toolName: "helper",
		completionPolicy: "tracked",
	});
	reliability.updateRun("run_debug", {
		status: "completed",
		result: { text: "done" },
		summary: "helper run completed.",
		completedAt: "2026-05-01T10:06:00.000Z",
	});
	reliability.close();
	return cwd;
}
