import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function inputWithValue(source, valueExpression) {
	const input = Array.from(source.matchAll(/<input\b[\s\S]*?\/>/g), (match) => match[0])
		.find((candidate) => candidate.includes(`value={${valueExpression}}`));
	assert.ok(input, `expected input with value={${valueExpression}}`);
	return input;
}

test("sidebar inline rename inputs have stable contextual accessible names", () => {
	const sessionSource = readFileSync(resolve("src/apps/chat-ui/src/session-node.tsx"), "utf8");
	const roomSource = readFileSync(resolve("src/apps/chat-ui/src/session-sidebar.tsx"), "utf8");

	assert.match(
		inputWithValue(sessionSource, "draftTitle"),
		/aria-label=\{`Session title for \$\{safeTitle\}`\}/,
	);
	assert.match(
		inputWithValue(roomSource, "draftName"),
		/aria-label=\{`Room name for \$\{room\.name\}`\}/,
	);
	assert.match(
		inputWithValue(roomSource, "draftTopic"),
		/aria-label=\{`Room topic for \$\{room\.name\}`\}/,
	);
	assert.match(
		inputWithValue(roomSource, "draftWorkspace"),
		/aria-label=\{`Room workspace for \$\{room\.name\}`\}/,
	);
});
