import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderPendingDelivery() {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		const { PendingUserMessageDelivery } = await import("./src/apps/chat-ui/src/components/PendingUserMessageDelivery.tsx");
		const queue = renderToStaticMarkup(React.createElement(PendingUserMessageDelivery, { delivery: "queue" }));
		const steer = renderToStaticMarkup(React.createElement(PendingUserMessageDelivery, { delivery: "steer" }));
		assert.match(queue, /data-pibo-debug="pending-user-message-queue"/);
		assert.match(queue, /aria-live="polite"/);
		assert.match(queue, /Queued for next turn/);
		assert.match(queue, /Waiting for the active turn to finish\./);
		assert.match(steer, /data-pibo-debug="pending-user-message-steer"/);
		assert.match(steer, /Steering pending/);
		assert.match(steer, /Waiting for the next tool call boundary\./);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("pending Queue and Steer feedback exposes stable live-region semantics", async () => {
	await renderPendingDelivery();
});

test("pending delivery metadata reaches both Terminal and trace-tree renderers", async () => {
	const [rows, terminal, adapt, span] = await Promise.all([
		readFile("src/session-ui/terminalRows.ts", "utf8"),
		readFile("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/tracing/adapt.ts", "utf8"),
		readFile("src/apps/chat-ui/src/tracing/SpanNode.tsx", "utf8"),
	]);
	assert.match(rows, /pendingMessageDelivery\?: "queue" \| "steer"/);
	assert.match(rows, /pendingMessageDelivery: pendingUserMessageDelivery\(node\)/);
	assert.match(terminal, /<PendingUserMessageDelivery delivery=\{row\.pendingMessageDelivery\}/);
	assert.match(adapt, /attributes\["message\.pending_delivery"\] = pendingDelivery/);
	assert.match(span, /<PendingUserMessageDelivery delivery=\{pendingDelivery\}/);
});
