import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const componentPath = "src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx";

async function renderInlineJsonValue({ value, path, expanded }) {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { InlineJsonValue } = await import("./${componentPath}");
		console.log(renderToStaticMarkup(React.createElement(InlineJsonValue, {
			value: ${JSON.stringify(value)},
			path: ${JSON.stringify(path)},
			expandedPaths: new Set(),
			expandedStrings: new Set(${JSON.stringify(expanded ? [path] : [])}),
			onTogglePath: () => {},
			onToggleString: () => {},
		})));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
	});
	return stdout.trim();
}

function buttonAttributes(markup) {
	const match = markup.match(/<button\b([^>]*)>/);
	if (!match) return null;
	return Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]]));
}

function htmlText(value) {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const technicalUuid = "2f3dd2f1-f4f5-41c8-9df8-b5134b509c93";
const longPayload = `${technicalUuid}:${"payload".repeat(64)}`;

test("expandable Terminal strings keep stable path-specific disclosure bindings", async () => {
	const path = "$.result.output";
	const collapsedMarkup = await renderInlineJsonValue({ value: longPayload, path, expanded: false });
	const expandedMarkup = await renderInlineJsonValue({ value: longPayload, path, expanded: true });
	const collapsed = buttonAttributes(collapsedMarkup);
	const expanded = buttonAttributes(expandedMarkup);

	assert.deepEqual(
		{
			label: collapsed?.["aria-label"],
			expanded: collapsed?.["aria-expanded"],
			title: collapsed?.title,
		},
		{ label: "String at $.result.output", expanded: "false", title: "Expand string" },
	);
	assert.deepEqual(
		{
			label: expanded?.["aria-label"],
			expanded: expanded?.["aria-expanded"],
			title: expanded?.title,
		},
		{ label: "String at $.result.output", expanded: "true", title: "Collapse string" },
	);
	assert.equal(collapsed?.["aria-controls"], undefined);
	assert.equal(expanded?.["aria-controls"], undefined);
	assert.equal(collapsed?.["aria-pressed"], undefined);
	assert.equal(expanded?.["aria-pressed"], undefined);
	assert.doesNotMatch(collapsed?.["aria-label"] ?? "", new RegExp(technicalUuid));
	assert.doesNotMatch(expanded?.["aria-label"] ?? "", new RegExp(technicalUuid));
});

test("expandable Terminal string names sanitize UUID path keys without losing human context", async () => {
	const recordsPath = `$.records.${technicalUuid}.details.message`;
	const archivePath = `$.archive.${technicalUuid}.details.message`;
	const records = buttonAttributes(await renderInlineJsonValue({ value: longPayload, path: recordsPath, expanded: false }));
	const archive = buttonAttributes(await renderInlineJsonValue({ value: longPayload, path: archivePath, expanded: false }));

	assert.equal(records?.["aria-label"], "String at $.records.[id].details.message");
	assert.equal(archive?.["aria-label"], "String at $.archive.[id].details.message");
	assert.notEqual(records?.["aria-label"], archive?.["aria-label"], "surrounding human path context remains distinct");
	assert.doesNotMatch(records?.["aria-label"] ?? "", new RegExp(technicalUuid, "i"));
	assert.doesNotMatch(archive?.["aria-label"] ?? "", new RegExp(technicalUuid, "i"));
});

test("expandable Terminal string names are bounded and distinguish JSON paths", async () => {
	const firstPath = `$.${"first-segment.".repeat(8)}value`;
	const secondPath = "$.second.value";
	const first = buttonAttributes(await renderInlineJsonValue({ value: longPayload, path: firstPath, expanded: false }));
	const second = buttonAttributes(await renderInlineJsonValue({ value: longPayload, path: secondPath, expanded: false }));

	assert.ok(first?.["aria-label"]);
	assert.ok(second?.["aria-label"]);
	assert.ok(first["aria-label"].length <= 90, "accessible name stays bounded");
	assert.notEqual(first["aria-label"], second["aria-label"], "different paths keep different names");
	assert.match(first["aria-label"], /^String at \$\./);
	assert.match(first["aria-label"], /…/);
});

test("expandable Terminal strings preserve the 140-character JSON preview", async () => {
	const collapsedMarkup = await renderInlineJsonValue({ value: longPayload, path: "$.message", expanded: false });
	const expandedMarkup = await renderInlineJsonValue({ value: longPayload, path: "$.message", expanded: true });
	const preview = `${longPayload.slice(0, 140)}...`;

	assert.match(collapsedMarkup, new RegExp(htmlText(JSON.stringify(preview))));
	assert.doesNotMatch(collapsedMarkup, new RegExp(htmlText(JSON.stringify(longPayload))));
	assert.match(expandedMarkup, new RegExp(htmlText(JSON.stringify(longPayload))));
});

test("short Terminal strings remain non-expandable and JSON-stringified", async () => {
	const value = 'short "quoted" string';
	const markup = await renderInlineJsonValue({ value, path: "$.message", expanded: false });

	assert.doesNotMatch(markup, /<button\b/);
	assert.equal(markup, `<span class="text-[#fb923c]">${htmlText(JSON.stringify(value))}</span>`);
});
