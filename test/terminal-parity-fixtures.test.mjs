import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import test from "node:test";
import { renderToString } from "ink";
import {
	buildTerminalCardDescriptors,
	buildTerminalStatusViewModel,
	progressBarText,
} from "../dist/session-ui/index.js";
import { InkTerminalView } from "../dist/apps/cli-ui/index.js";
import {
	TERMINAL_PARITY_REDACTED,
	TERMINAL_PARITY_SECRET,
	TERMINAL_PARITY_SESSION_ID,
	buildCanonicalTerminalCards,
	buildCanonicalTerminalRows,
	buildCanonicalTerminalTraceView,
	buildExpandableDetailFixtureRow,
	buildStreamingTerminalRows,
	disposedStatusPayload,
	fullStatusPayload,
	highUsageStatusPayload,
	partialStatusPayload,
	unavailableStatusPayload,
	zeroUsageStatusPayload,
} from "./fixtures/terminal-parity-fixtures.mjs";

function textForRow(row) {
	return row.lines.flatMap((line) => [
		...line.tokens.map((token) => token.text),
		line.functionCall ? `${line.functionCall.name} ${JSON.stringify(line.functionCall.input ?? {})}` : "",
	]).join("");
}

function cardKinds(cards) {
	return cards.map((card) => card.kind);
}

test("canonical terminal parity fixture covers required row kinds and real-shaped event metadata", () => {
	const traceView = buildCanonicalTerminalTraceView();
	const rows = buildCanonicalTerminalRows();

	assert.equal(traceView.rawEvents[0].type, "message");
	assert.equal(traceView.rawEvents[1].type, "gateway.action.result");
	assert.equal(traceView.rawEvents[1].payload.action, "status");
	assert.ok(traceView.rawEvents[0].payload.parts[0].text.includes("compact terminal"));

	for (const kind of [
		"message.user",
		"message.assistant",
		"reasoning",
		"tool.group.exploring",
		"tool.call",
		"agent.delegation",
		"agent.async",
		"yielded.run",
		"execution.compaction",
		"execution.command",
		"tool.thinking",
		"tool.model",
		"tool.login",
		"tool.status",
		"error",
	]) {
		assert.ok(rows.some((row) => row.kind === kind), `fixture includes ${kind}`);
	}

	const metadataRows = rows.filter((row) => row.id !== "node-assistant");
	assert.ok(metadataRows.some((row) => row.eventId?.startsWith("evt_terminal_")), "event ids are present");
	assert.ok(metadataRows.some((row) => row.runId === "run_fixture_typecheck"), "run ids are present");
	assert.ok(metadataRows.every((row) => row.orderSource), "all non-assistant fixture rows carry order source metadata");
	assert.ok(metadataRows.every((row) => typeof row.orderStreamId === "number"), "all non-assistant fixture rows carry stream id metadata");
	assert.ok(metadataRows.every((row) => typeof row.orderStreamFrameIndex === "number"), "all non-assistant fixture rows carry stream frame metadata");
	assert.ok(rows.some((row) => row.id === "local-command:status:001"), "stable local command id is present");
	assert.ok(rows.some((row) => row.id === "local-result:status:001"), "stable local command result id is present");
});

test("shared fixture asserts row order, prefixes, token tones, card descriptors, and redaction", () => {
	const rows = buildCanonicalTerminalRows();
	assert.deepEqual(rows.map((row) => [row.id, row.kind, row.status]).slice(0, 17), [
		["node-user", "message.user", "done"],
		["node-reasoning", "reasoning", "done"],
		["group:exploring:node-explore-read:node-explore-list", "tool.group.exploring", "done"],
		["node-tool-call", "tool.call", "done"],
		["node-tool-result", "tool.call", "done"],
		["node-agent-delegation", "agent.delegation", "done"],
		["node-agent-async", "agent.async", "done"],
		["node-yielded-run", "yielded.run", "running"],
		["node-compaction", "execution.compaction", "done"],
		["node-command-fast", "execution.command", "done"],
		["node-thinking-card", "tool.thinking", "done"],
		["node-model-card", "tool.model", "done"],
		["node-login-card", "tool.login", "done"],
		["node-status-result", "tool.status", "done"],
		["node-error", "error", "error"],
		["node-assistant", "message.assistant", "done"],
		["local-command:status:001", "execution.command", "done"],
	]);

	const user = rows.find((row) => row.id === "node-user");
	const reasoning = rows.find((row) => row.id === "node-reasoning");
	const tool = rows.find((row) => row.id === "node-tool-call");
	const command = rows.find((row) => row.id === "local-command:status:001");
	const error = rows.find((row) => row.id === "node-error");
	assert.equal(user.lines[0].prefix, "prompt");
	assert.equal(reasoning.lines[0].prefix, "bullet");
	assert.equal(reasoning.lines[0].tokens[0].tone, "amber");
	assert.equal(tool.lines[0].tokens[0].tone, "green");
	assert.equal(command.lines[0].tokens[0].tone, "yellow");
	assert.equal(error.lines[0].tokens[0].tone, "red");

	const cards = buildCanonicalTerminalCards();
	assert.deepEqual(cardKinds(cards), [
		"tool",
		"tool",
		"tool",
		"yielded-run",
		"compaction",
		"command",
		"thinking",
		"model",
		"login",
		"status",
		"error",
		"command",
		"status",
		"tool",
	]);
	assert.ok(cards.some((card) => card.kind === "status" && card.statusView.progress.some((item) => item.id === "provider-2" && item.tone === "red")));
	const serialized = JSON.stringify(cards);
	assert.match(serialized, new RegExp(TERMINAL_PARITY_REDACTED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.doesNotMatch(serialized, /sk_fixture_secret|fixture-secret-value|warning-secret-value/);
});

test("streaming fixture preserves chronological append order and local command dedupe identifiers", () => {
	const rows = buildStreamingTerminalRows();
	assert.deepEqual(rows.map((row) => [row.id, row.kind, row.status, row.orderSource, row.orderStreamId, row.orderStreamFrameIndex]), [
		["stream-user", "message.user", "done", "event-log", 44, 0],
		["stream-tool-running", "tool.call", "running", "live", 44, 1],
		["stream-assistant-running", "message.assistant", "running", "live", 44, 2],
		["local-command:status:001", "execution.command", "done", "local-ui", 44, 3],
		["local-result:status:001", "tool.status", "done", "local-ui", 44, 4],
		["local-detail:tool-output:001", "tool.call", "error", "local-ui", 44, 5],
	]);
	assert.equal(textForRow(rows[1]).includes("Calling"), true);
	assert.equal(rows[3].id, "local-command:status:001");
	assert.equal(rows[4].id, "local-result:status:001");
});

test("status progress fixture preserves unavailable zero warning high labels percentages and raw counts", () => {
	const highStatus = buildTerminalStatusViewModel({
		contextUsage: highUsageStatusPayload().contextUsage,
		providerUsage: highUsageStatusPayload().providerUsage,
		tools: { enabled: highUsageStatusPayload().enabledTools, active: highUsageStatusPayload().activeTools },
		warnings: highUsageStatusPayload().warnings,
		errors: highUsageStatusPayload().errors,
		message: highUsageStatusPayload().message,
	});
	const zeroStatus = buildTerminalStatusViewModel(zeroUsageStatusPayload());
	const unavailableStatus = buildTerminalStatusViewModel(unavailableStatusPayload());

	const contextHigh = highStatus.progress.find((item) => item.id === "context");
	const providerZero = highStatus.progress.find((item) => item.id === "provider-0");
	const providerWarning = highStatus.progress.find((item) => item.id === "provider-1");
	const providerHigh = highStatus.progress.find((item) => item.id === "provider-2");
	assert.deepEqual([contextHigh.state, contextHigh.value, contextHigh.max, contextHigh.percent, contextHigh.tone], ["available", 920, 1000, 92, "red"]);
	assert.deepEqual([providerZero.label, providerZero.percent, providerZero.tone], ["openai requests", 100, "green"]);
	assert.deepEqual([providerWarning.label, providerWarning.percent, providerWarning.tone], ["openai tokens", 45, "yellow"]);
	assert.match(providerWarning.text, /45\.0% remaining, resets 2026-05-17/);
	assert.deepEqual([providerHigh.label, providerHigh.percent, providerHigh.tone], ["openai spend", 9, "red"]);
	assert.equal(highStatus.fields.find((item) => item.id === "provider-plan").value, "team");
	assert.equal(highStatus.fields.find((item) => item.id === "provider-credits").value, "$42.00");
	assert.equal(highStatus.fields.find((item) => item.id === "enabled-tools").value, "3 (read, edit, bash)");
	assert.equal(highStatus.fields.find((item) => item.id === "active-tools").value, "1 (bash)");
	assert.equal(progressBarText(zeroStatus.progress.find((item) => item.id === "context"), 8), "░░░░░░░░ 0.0%");
	assert.equal(unavailableStatus.progress.find((item) => item.id === "context").state, "unavailable");
	assert.equal(unavailableStatus.progress.find((item) => item.id === "provider").text, "Provider usage unavailable");
	assert.doesNotMatch(JSON.stringify(highStatus), /sk_fixture_secret|warning-secret-value/);
});

test("status fixtures cover full partial unavailable zero non-OpenAI queued streaming and disposed states", () => {
	const full = buildTerminalStatusViewModel({
		owner: { label: fullStatusPayload().activeOwnerLabel, scope: fullStatusPayload().activeOwnerScope },
		session: { id: fullStatusPayload().piboSessionId, title: fullStatusPayload().sessionTitle, profile: fullStatusPayload().profile, status: "running" },
		model: fullStatusPayload().activeModel,
		runtime: { state: "queued", connected: fullStatusPayload().connected, queuedMessages: fullStatusPayload().queuedMessages, processing: fullStatusPayload().processing, streaming: fullStatusPayload().streaming },
		cwd: fullStatusPayload().cwd,
		contextUsage: fullStatusPayload().contextUsage,
		providerUsage: fullStatusPayload().providerUsage,
		tools: { enabled: fullStatusPayload().enabledTools, active: fullStatusPayload().activeTools },
	});
	assert.equal(full.title, "Status");
	assert.ok(full.fields.some((field) => field.id === "owner" && field.value.includes("Web user Fixture")));
	assert.ok(full.fields.some((field) => field.id === "session" && field.value.includes(TERMINAL_PARITY_SESSION_ID)));
	assert.equal(full.fields.find((field) => field.id === "profile").value, "pibo-agent");
	assert.equal(full.fields.find((field) => field.id === "model").value, "GPT Test");
	assert.equal(full.fields.find((field) => field.id === "queue").value, "3");
	assert.equal(full.fields.find((field) => field.id === "processing").value, "no");
	assert.equal(full.fields.find((field) => field.id === "streaming").value, "no");
	assert.equal(full.progress.find((progress) => progress.id === "provider-0").label, "anthropic messages");
	assert.equal(full.fields.find((field) => field.id === "provider-plan").value, "pro");
	assert.equal(full.fields.find((field) => field.id === "provider-credits").value, "unlimited");

	const partial = buildTerminalStatusViewModel({
		owner: { label: partialStatusPayload().activeOwnerLabel, scope: partialStatusPayload().activeOwnerScope },
		runtime: { state: "streaming", queuedMessages: partialStatusPayload().queuedMessages, processing: partialStatusPayload().processing, streaming: partialStatusPayload().streaming },
		contextUsage: partialStatusPayload().contextUsage,
		providerUsage: partialStatusPayload().providerUsage,
	});
	assert.equal(partial.progress.find((progress) => progress.id === "context").state, "available");
	assert.equal(partial.progress.find((progress) => progress.id === "provider-0").state, "unavailable");
	assert.equal(partial.fields.find((field) => field.id === "streaming").value, "yes");

	const disposed = buildTerminalStatusViewModel({
		runtime: { state: "disposed", connected: false, disposed: disposedStatusPayload().disposed },
		contextUsage: disposedStatusPayload().contextUsage,
		providerUsage: disposedStatusPayload().providerUsage,
		message: disposedStatusPayload().message,
	});
	assert.equal(disposed.fields.find((field) => field.id === "disposed").value, "yes");
	assert.equal(disposed.fields.find((field) => field.id === "runtime").tone, "red");
});

test("detail fixture shares bounded preview labels and avoids unredacted detail payload expansion by default", () => {
	const row = buildExpandableDetailFixtureRow();
	assert.deepEqual(row.detailItems.map((item) => item.label), [
		"Input",
		"Output",
		"Error",
		"Linked session",
		"Command args",
		"Tool result preview",
		"Large JSON",
		"Long markdown",
	]);
	assert.equal(row.linkedPiboSessionId, "ps_linked_detail");
	assert.ok(row.expandable);
	assert.match(textForRow(row), /Large output preview/);
	assert.doesNotMatch(textForRow(row), /detail-secret-value/);

	const outputLength = JSON.stringify(row.output).length;
	const previewLength = textForRow(row).length;
	assert.ok(outputLength > previewLength * 10, "collapsed preview is bounded compared with full detail payload");
	assert.doesNotMatch(row.detailItems.find((item) => item.label === "Error").error, /detail-secret-value/);
});

test("Web source hooks and Ink output consume the same canonical terminal fixture", () => {
	const rows = buildCanonicalTerminalRows();
	const cards = buildTerminalCardDescriptors(rows);
	const compactSource = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"), "utf8");
	for (const hook of [
		"data-row-kind={row.kind}",
		"data-row-status={row.status}",
		"data-trace-node-id={row.sourceNodeIds.join(\" \")}",
		"data-event-id={row.eventId}",
		"data-run-id={row.runId}",
		"data-order-source={row.orderSource}",
		"data-order-stream-id={row.orderStreamId}",
		"data-order-frame-index={row.orderStreamFrameIndex}",
	]) {
		assert.match(compactSource, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}

	const output = renderToString(React.createElement(InkTerminalView, { rows, maxRows: 40, maxLineChars: 180 }));
	assert.match(output, /Audit the compact terminal renderer/);
	assert.match(output, /▣ Status — status · done/);
	assert.match(output, /▣ Thinking — thinking · done/);
	assert.match(output, /▣ Model — model · done/);
	assert.match(output, /▣ Login — login · done/);
	assert.match(output, /▣ Tool — tool · error/);
	assert.match(output, /Context: /);
	assert.match(output, /Provider quota: unavailable/);
	assert.doesNotMatch(output, /sk_fixture_secret|detail-secret-value/);
	assert.ok(cards.some((card) => card.kind === "status"));
});
