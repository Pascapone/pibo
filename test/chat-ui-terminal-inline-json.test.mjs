import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const componentPath = "src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx";

async function renderInlineJson(input) {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { TerminalFunctionCall } = await import("./${componentPath}");
		console.log(renderToStaticMarkup(React.createElement(TerminalFunctionCall, {
			name: "fixture",
			input: ${JSON.stringify(input)},
		})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
	return stdout.trim();
}

function collectionButtons(markup) {
	return [...markup.matchAll(/<button\b([^>]*)>/g)]
		.map((match) => Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]])))
		.filter((attributes) => attributes["data-inline-json-path"] !== undefined);
}

test("compact Terminal inline JSON renders synchronized disclosure semantics without eager collapsed content", async () => {
	const markup = await renderInlineJson({
		nested: { hiddenSecret: "must stay lazy" },
		sibling: [1, 2],
		"escaped.path": { hiddenChild: true },
	});
	const buttons = collectionButtons(markup);
	assert.equal(buttons.length, 4);

	const root = buttons.find((button) => button["data-inline-json-path"] === "$");
	assert.deepEqual(
		{
			label: root?.["aria-label"],
			expanded: root?.["aria-expanded"],
			title: root?.title,
		},
		{ label: "JSON at $", expanded: "true", title: "Collapse JSON" },
	);

	const nested = buttons.find((button) => button["data-inline-json-path"] === "$.nested");
	assert.deepEqual(
		{
			label: nested?.["aria-label"],
			expanded: nested?.["aria-expanded"],
			title: nested?.title,
		},
		{ label: "JSON at $.nested", expanded: "false", title: "Expand JSON" },
	);

	const controlledIds = buttons.map((button) => button["aria-controls"]);
	assert.equal(new Set(controlledIds).size, buttons.length, "each collection controls a unique region");
	for (const id of controlledIds) {
		assert.ok(id, "each collection exposes aria-controls");
		assert.match(markup, new RegExp(`<span id="${id}">`), `controlled region ${id} exists`);
	}
	assert.match(markup, new RegExp(`<span id="${nested?.["aria-controls"]}"></span>`), "collapsed content region stays empty");
	assert.doesNotMatch(markup, /hiddenSecret|must stay lazy|hiddenChild/, "collapsed nested subtrees are not rendered");
	assert.ok(buttons.some((button) => button["data-inline-json-path"] === "$.escaped\\.path"), "escaped collection paths stay unchanged");
});

test("compact Terminal inline JSON keeps one stable collection button across disclosure states", () => {
	const source = fs.readFileSync(componentPath, "utf8");
	const collectionSource = source.slice(source.indexOf("function InlineCollection"), source.indexOf("function escapePathKey"));

	assert.equal((collectionSource.match(/<button/g) ?? []).length, 1, "InlineCollection renders one button in both states");
	assert.doesNotMatch(collectionSource, /if \(!expanded\)/, "collapsed state does not replace the collection branch");
	assert.match(collectionSource, /const contentId = `inline-json-\$\{useId\(\)\}`/);
	assert.match(collectionSource, /title=\{expanded \? "Collapse JSON" : "Expand JSON"\}/);
	assert.match(collectionSource, /aria-label=\{`JSON at \$\{path\}`\}/);
	assert.match(collectionSource, /aria-expanded=\{expanded\}/);
	assert.match(collectionSource, /aria-controls=\{contentId\}/);
	assert.match(collectionSource, /<span id=\{contentId\}>/);
	assert.match(collectionSource, /const entries = expanded\s*\?/);
	assert.match(collectionSource, /event\.stopPropagation\(\)/);
});
