import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

test("completed compaction card renders segment metrics and Markdown disclosure", () => {
	execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { TerminalCompactionCard } from "./src/apps/chat-ui/src/session-views/compact-terminal/TerminalCompactionCard.tsx";
		globalThis.React = React;
		const markup = renderToStaticMarkup(React.createElement(TerminalCompactionCard, {
			row: {
				id: "compaction-1",
				kind: "execution.compaction",
				status: "done",
				lines: [],
				sourceNodeIds: ["compaction-1"],
				compactionStats: {
					toolCallCount: 7,
					maxToolOutputTokens: 12345,
					maxToolOutputTokenBasis: "chars/4",
					compactionTokens: 90000,
				},
				compactionMarkdown: "# Compacted context\\n\\n- Kept decisions",
			},
		}));
		assert.match(markup, /data-pibo-component="TerminalCompactionCard"/);
		assert.match(markup, /aria-label="Compaction statistics"/);
		assert.match(markup, />Tool calls</);
		assert.match(markup, />7</);
		assert.match(markup, />Peak tool output</);
		assert.match(markup, /≈12,345 tokens/);
		assert.match(markup, />Compaction tokens</);
		assert.match(markup, />90,000</);
		assert.match(markup, /<details/);
		assert.match(markup, />Compaction text</);
		assert.match(markup, /data-pibo-markdown-kind="compaction"/);
		assert.match(markup, /<h1[^>]*>Compacted context<\\/h1>/);
		assert.match(markup, /<li[^>]*>Kept decisions<\\/li>/);
	`], { cwd: process.cwd(), stdio: "pipe" });
});

test("native Codex compaction explains unavailable text without inventing a summary", () => {
	execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { TerminalCompactionCard } from "./src/apps/chat-ui/src/session-views/compact-terminal/TerminalCompactionCard.tsx";
		globalThis.React = React;
		const markup = renderToStaticMarkup(React.createElement(TerminalCompactionCard, {
			row: {
				id: "codex-compaction-1",
				kind: "execution.compaction",
				status: "done",
				lines: [],
				sourceNodeIds: ["codex-compaction-1"],
				input: { reason: "codex_context_compaction" },
				compactionStats: { toolCallCount: 1 },
			},
		}));
		assert.match(markup, /Codex did not provide compaction text\./);
		assert.doesNotMatch(markup, /data-pibo-markdown-kind="compaction"/);
	`], { cwd: process.cwd(), stdio: "pipe" });
});

test("Terminal topbar exposes compaction count navigation", () => {
	const source = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8");
	assert.match(source, /type TerminalNavigationKind = "compaction" \| "system" \| "tool" \| "user"/);
	assert.match(source, /onNavigate\("compaction"\)/);
	assert.match(source, /jump to previous compaction/);
	assert.match(source, /row\.kind === "execution\.compaction"/);
});
