import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { storedPiboEventFromV2Row } from "../dist/apps/chat/data/chat-data-mappers.js";
import { normalizePiEvent } from "../dist/core/routed-session.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";

const execFileAsync = promisify(execFile);

function makeSession(id) {
	return {
		id,
		piSessionId: `pi_${id}`,
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "web-search-test",
		workspace: "/tmp",
		createdAt: "2026-08-26T00:00:00.000Z",
		updatedAt: "2026-08-26T00:00:00.000Z",
		metadata: {},
	};
}

function rowText(row) {
	return row.lines.map((line) => line.tokens.map((token) => token.text).join("")).join("\n");
}

function projectPersistedAction({ id, action, expectedResult }) {
	const piboSessionId = `ps_${id}`;
	const start = normalizePiEvent(piboSessionId, {
		type: "response.output_item.added",
		item: { id, type: "web_search_call", status: "in_progress", action },
	});
	const finish = normalizePiEvent(piboSessionId, {
		type: "response.output_item.done",
		item: { id, type: "web_search_call", status: "completed", action },
	});
	assert.equal(start?.type, "tool_execution_started");
	assert.equal(finish?.type, "tool_execution_finished");
	assert.deepEqual(finish.result, expectedResult);

	const payloadRootDir = mkdtempSync(join(tmpdir(), "pibo-web-search-trace-"));
	const databasePath = join(payloadRootDir, "pibo.sqlite");
	const payloadPath = join(payloadRootDir, "payloads");
	let store = new PiboDataStore(databasePath, { payloadRootDir: payloadPath });
	try {
		const session = makeSession(piboSessionId);
		const ingest = new ChatDataIngestService(store);
		const eventId = `turn_${id}`;
		const startEvent = { ...start, eventId };
		const finishEvent = { ...finish, eventId };
		assert.equal(ingest.ingestOutputEvent({ session, roomId: "room_web_search", createdAt: "2026-08-26T00:00:01.000Z", event: startEvent }).duplicate, false);
		assert.equal(ingest.ingestOutputEvent({ session, roomId: "room_web_search", createdAt: "2026-08-26T00:00:01.000Z", event: startEvent }).duplicate, true);
		assert.equal(ingest.ingestOutputEvent({ session, roomId: "room_web_search", createdAt: "2026-08-26T00:00:02.000Z", event: finishEvent }).duplicate, false);
		assert.equal(ingest.ingestOutputEvent({ session, roomId: "room_web_search", createdAt: "2026-08-26T00:00:02.000Z", event: finishEvent }).duplicate, true);

		store.close();
		store = undefined;
		store = new PiboDataStore(databasePath, { payloadRootDir: payloadPath });
		const storedRows = store.db.prepare("SELECT * FROM event_log WHERE session_id = ? ORDER BY stream_id").all(session.id);
		const events = storedRows.map(storedPiboEventFromV2Row).filter(Boolean);
		assert.equal(events.length, 2, "replayed semantic events must remain idempotent after product-history restart");
		const view = buildTraceViewFromEvents({
			session: { id: session.id, piSessionId: session.piSessionId, title: "Web search semantics" },
			events,
			status: "idle",
			includeRawEvents: true,
		});
		const toolNodes = view.nodes
			.flatMap((node) => [node, ...node.children])
			.filter((node) => node.type === "tool.call" && node.title === "web_search");
		assert.equal(toolNodes.length, 1, "persisted start/finish must reload as one semantic trace node");
		assert.deepEqual(toolNodes[0].output, expectedResult);
		const rows = buildCompactTerminalRows(view, { showThinking: true });
		const terminalRows = rows.filter((row) => row.input?.providerTool === "web_search");
		assert.equal(terminalRows.length, 1, "persisted trace must describe one Compact Terminal row");
		return { start, finish, node: toolNodes[0], row: terminalRows[0] };
	} finally {
		store?.close();
		rmSync(payloadRootDir, { recursive: true, force: true });
	}
}

test("search raw events persist normalized, deduplicated source descriptors", () => {
	const sources = [
		{ title: "Docs", url: "HTTPS://Example.COM:443/docs#overview" },
		{ title: "Duplicate docs", href: "https://example.com/docs#other" },
		"https://openai.com/research",
		{ name: "API", url: "https://api.example.org/reference" },
		{ title: "News", link: "http://news.example.net/latest" },
		{ title: "Unsafe", url: "javascript:alert(1)" },
		{ title: "Malformed", url: "not a URL" },
	];
	const expectedSources = [
		{ title: "Docs", url: "https://example.com/docs" },
		{ url: "https://openai.com/research" },
		{ title: "API", url: "https://api.example.org/reference" },
		{ title: "News", url: "http://news.example.net/latest" },
	];
	const { start, row } = projectPersistedAction({
		id: "ws_search",
		action: {
			type: "search",
			query: "  OpenAI API docs  ",
			queries: ["OpenAI API docs", "OpenAI API docs", " pricing "],
			sources,
		},
		expectedResult: {
			actionType: "search",
			query: "OpenAI API docs",
			queries: ["OpenAI API docs", "pricing"],
			sources: expectedSources,
			sourceCount: 4,
		},
	});
	assert.deepEqual(start.args.queries, ["OpenAI API docs", "pricing"]);
	assert.match(rowText(row), /Searched web/);
	assert.match(rowText(row), /query: "OpenAI API docs"/);
	assert.match(rowText(row), /sources: 4/);
	assert.match(rowText(row), /\+1 more sources/);
	assert.deepEqual(
		row.lines.flatMap((line) => line.tokens).filter((token) => token.href).map((token) => token.href),
		expectedSources.slice(0, 3).map((source) => source.url),
	);
});

test("open-page raw events persist the inspected page link descriptor", () => {
	const { row } = projectPersistedAction({
		id: "ws_open",
		action: { type: "open_page", url: " HTTPS://Example.COM:443/docs " },
		expectedResult: { actionType: "open_page", url: "https://example.com/docs" },
	});
	assert.match(rowText(row), /Opened web page/);
	assert.match(rowText(row), /page: https:\/\/example\.com\/docs/);
	const [link] = row.lines.flatMap((line) => line.tokens).filter((token) => token.href);
	assert.deepEqual(link, {
		text: "https://example.com/docs",
		tone: "blue",
		weight: "normal",
		italic: false,
		href: "https://example.com/docs",
		ariaLabel: "Open web page: https://example.com/docs",
	});
});

test("find-in-page raw events persist page and pattern descriptors", () => {
	const { row } = projectPersistedAction({
		id: "ws_find",
		action: { type: "find_in_page", url: "https://example.com/docs#pricing", pattern: "  service tier  " },
		expectedResult: { actionType: "find_in_page", url: "https://example.com/docs#pricing", pattern: "service tier" },
	});
	assert.match(rowText(row), /Found in web page/);
	assert.match(rowText(row), /page: https:\/\/example\.com\/docs#pricing/);
	assert.match(rowText(row), /find: "service tier"/);
	assert.equal(row.lines.flatMap((line) => line.tokens).find((token) => token.href)?.href, "https://example.com/docs#pricing");
});

test("running provider actions use action-specific Compact Terminal labels", () => {
	for (const [id, action, label] of [
		["running_search", { type: "search", query: "docs" }, "Searching web"],
		["running_open", { type: "open_page", url: "https://example.com/docs" }, "Opening web page"],
		["running_find", { type: "find_in_page", url: "https://example.com/docs", pattern: "pricing" }, "Finding in web page"],
	]) {
		const start = normalizePiEvent("ps_running", {
			type: "response.output_item.added",
			item: { id, type: "web_search_call", status: "in_progress", action },
		});
		const view = buildTraceViewFromEvents({
			session: { id: "ps_running", piSessionId: "pi_running" },
			events: [{
				id: `event_${id}`,
				piboSessionId: "ps_running",
				createdAt: "2026-08-26T00:00:01.000Z",
				eventSequence: 1,
				type: start.type,
				payload: { ...start, eventId: `turn_${id}` },
			}],
			status: "running",
		});
		const row = buildCompactTerminalRows(view, { showThinking: true }).find((candidate) => candidate.input?.providerTool === "web_search");
		assert.ok(row);
		assert.match(rowText(row), new RegExp(label));
	}
});

test("missing and malformed provider fields cannot create unsafe website descriptors", () => {
	const { finish, row } = projectPersistedAction({
		id: "ws_malformed",
		action: {
			type: "open_page",
			url: "javascript:alert(1)",
			query: "   ",
			pattern: 42,
			sources: [
				{ url: "https://user:password@example.com/private" },
				{ href: "data:text/html,unsafe" },
				{ title: "missing URL" },
			],
		},
		expectedResult: { actionType: "open_page", sources: [], sourceCount: 0 },
	});
	assert.deepEqual(finish.result, { actionType: "open_page", sources: [], sourceCount: 0 });
	assert.match(rowText(row), /Opened web page/);
	assert.doesNotMatch(rowText(row), /javascript|password|data:text/);
	assert.equal(row.lines.flatMap((line) => line.tokens).some((token) => token.href), false);
	assert.deepEqual(
		normalizePiEvent("ps_missing", { type: "response.output_item.done", item: { type: "web_search_call" } }),
		{
			type: "tool_execution_finished",
			piboSessionId: "ps_missing",
			toolCallId: "provider:web_search:active",
			toolName: "web_search",
			result: {},
			isError: false,
		},
		"a terminal provider item with missing optional fields remains a safe generic lifecycle",
	);
});

test("Compact Terminal website descriptors render accessible external links", async () => {
	const line = {
		prefix: "detail",
		tokens: [{
			text: "https://example.com/docs",
			tone: "blue",
			href: "https://example.com/docs",
			ariaLabel: "Open web page: https://example.com/docs",
		}],
	};
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { TerminalLine } = await import("./src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx");
		console.log(renderToStaticMarkup(React.createElement(TerminalLine, {
			line: ${JSON.stringify(line)},
			status: "done",
		})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	assert.match(stdout, /<a [^>]*href="https:\/\/example\.com\/docs"/);
	assert.match(stdout, /target="_blank"/);
	assert.match(stdout, /rel="noreferrer noopener"/);
	assert.match(stdout, /aria-label="Open web page: https:\/\/example\.com\/docs"/);
	assert.match(stdout, />https:\/\/example\.com\/docs<\/a>/);
});
