import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewPath = new URL("../src/apps/chat-ui/src/context/ContextBuildView.tsx", import.meta.url);

async function readViewSource() {
	return await readFile(viewPath, "utf8");
}

test("Context Build labels generated tool origins as inspector-only header metadata", async () => {
	const source = await readViewSource();
	assert.match(source, /Origin: \{label\}/);
	assert.match(source, /Inspector metadata/);
	assert.match(source, /Not sent to model/);
	assert.match(source, /key !== "inspectorOrigin"/);
});

test("Context Build copy output excludes inspector-only origin metadata", async () => {
	const source = await readViewSource();
	const copyFunction = source.slice(source.indexOf("function renderNodeForCopy"), source.indexOf("function indent"));
	assert.ok(copyFunction.length > 0);
	assert.doesNotMatch(copyFunction, /metadata|inspectorOrigin/);
});
