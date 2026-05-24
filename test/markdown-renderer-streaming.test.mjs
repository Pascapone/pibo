import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function renderMarkdownSamples(samples) {
	const script = `
		import React from "react";
		globalThis.React = React;
		import { renderToStaticMarkup } from "react-dom/server";
		const { MarkdownRenderer, stabilizeStreamingInlineCodeMarkdown } = await import("./src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx");
		const samples = ${JSON.stringify(samples)};
		const rendered = samples.map((sample) => ({
			sample,
			stabilized: stabilizeStreamingInlineCodeMarkdown(sample),
			streaming: renderToStaticMarkup(React.createElement(MarkdownRenderer, { streaming: true }, sample)),
			final: renderToStaticMarkup(React.createElement(MarkdownRenderer, null, sample)),
		}));
		console.log(JSON.stringify(rendered));
	`;
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
	return JSON.parse(stdout);
}

test("streaming markdown stabilizes unfinished inline code spans", async () => {
	const [emptyOpen, openCode, secondEmptyOpen, secondOpenCode] = await renderMarkdownSamples([
		"Use `",
		"Use `foo",
		"Use `foo` then `",
		"Use `foo` then `bar",
	]);

	assert.equal(emptyOpen.stabilized, "Use ");
	assert.equal(emptyOpen.streaming, '<p data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="p">Use </p>');
	assert.equal(emptyOpen.final, '<p data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="p">Use `</p>');

	assert.equal(openCode.stabilized, "Use `foo`");
	assert.match(openCode.streaming, /<code[^>]*>foo<\/code>/);
	assert.doesNotMatch(openCode.streaming, /`foo/);
	assert.equal(openCode.final, '<p data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="p">Use `foo</p>');

	assert.equal(secondEmptyOpen.stabilized, "Use `foo` then ");
	assert.match(secondEmptyOpen.streaming, /<code[^>]*>foo<\/code>/);
	assert.doesNotMatch(secondEmptyOpen.streaming, /then `/);

	assert.equal(secondOpenCode.stabilized, "Use `foo` then `bar`");
	assert.match(secondOpenCode.streaming, /<code[^>]*>foo<\/code> then <code[^>]*>bar<\/code>/);
	assert.doesNotMatch(secondOpenCode.streaming, /`bar/);
});

test("streaming inline-code stabilization preserves completed and escaped backticks", async () => {
	const [completed, escaped, backslashInCode, complex] = await renderMarkdownSamples([
		"Use `foo` now",
		"Use \\`literal",
		"Use `foo\\` now",
		"Use ``complex``, then `tail",
	]);

	assert.equal(completed.stabilized, completed.sample);
	assert.equal(completed.streaming, completed.final);
	assert.match(completed.streaming, /<code[^>]*>foo<\/code>/);

	assert.equal(escaped.stabilized, escaped.sample);
	assert.equal(escaped.streaming, escaped.final);
	assert.doesNotMatch(escaped.streaming, /<code/);

	assert.equal(backslashInCode.stabilized, backslashInCode.sample);
	assert.equal(backslashInCode.streaming, backslashInCode.final);
	assert.match(backslashInCode.streaming, /<code[^>]*>foo\\<\/code>/);

	assert.equal(complex.stabilized, complex.sample);
	assert.equal(complex.streaming, complex.final);
});
