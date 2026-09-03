import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Agent Designer context-file scope exposes its label and pressed state", async () => {
	const source = await readFile("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");
	assert.match(source, /useState<"global" \| "agent">\("agent"\)/, "Agent scope remains selected by default");
	assert.match(source, /<div role="group" aria-label="New context file scope"/);
	assert.match(source, /<button type="button" aria-pressed=\{newContextFileScope === "agent"\}[^>]*onClick=\{\(\) => setNewContextFileScope\("agent"\)\}[^>]*>Agent<\/button>/);
	assert.match(source, /<button type="button" aria-pressed=\{newContextFileScope === "global"\}[^>]*onClick=\{\(\) => setNewContextFileScope\("global"\)\}[^>]*>Global<\/button>/);
	assert.equal(source.match(/aria-pressed=\{newContextFileScope === "(?:agent|global)"\}/g)?.length, 2);
});
