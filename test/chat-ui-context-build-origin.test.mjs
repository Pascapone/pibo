import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewPath = new URL("../src/apps/chat-ui/src/plugins/build-context-view.tsx", import.meta.url);

async function readViewSource() {
	return await readFile(viewPath, "utf8");
}

test("plugin Build Context distinguishes inspector metadata from model content", async () => {
	const source = await readViewSource();
	assert.match(source, /Inspector metadata is not model prompt text/);
	assert.match(source, /Content redacted/);
	assert.match(source, /content\.visibility/);
});

test("plugin Build Context copy output includes only visible unredacted model text", async () => {
	const source = await readViewSource();
	const copyFunction = source.slice(
		source.indexOf("export function renderPluginNodeModelContentForCopy"),
		source.indexOf("function BuildNode"),
	);
	assert.ok(copyFunction.length > 0);
	assert.match(copyFunction, /visibility !== "model"/);
	assert.match(copyFunction, /content\.redacted/);
	assert.match(copyFunction, /return node\.content\.text/);
	assert.doesNotMatch(copyFunction, /metadata|origin|configurationRevisions|delivery|diagnostic/);
});
