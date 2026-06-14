import assert from "node:assert/strict";
import {
	buildWebviewShellHtml,
	EMPTY_STATE_COMMAND,
	generateNonce,
} from "../../src/apps/chat-vscode/extension/src/webview-shell.ts";
import { describe, test } from "node:test";

const baseArgs = {
	healthUrl: "http://127.0.0.1:4788/api/chat/bootstrap?roomId=__vscode_health__",
	targetUrl: "http://127.0.0.1:4788/apps/chat-vscode/?workspace=/home/x",
	baseUrl: "http://127.0.0.1:4788",
	command: EMPTY_STATE_COMMAND,
	nonce: "test-nonce-123",
};

describe("chat-vscode/webview-shell", () => {
	test("buildWebviewShellHtml contains the empty-state heading and command", () => {
		const html = buildWebviewShellHtml(baseArgs);
		assert.match(html, /Pibo Web-Gateway läuft nicht/);
		assert.match(html, /pibo gateway:web/);
		assert.match(html, /Erneut prüfen/);
		assert.match(html, /Im VS Code Terminal öffnen/);
		assert.match(html, /Kopieren/);
	});

	test("buildWebviewShellHtml shows the configured baseUrl", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			baseUrl: "http://192.168.1.50:4788",
		});
		assert.match(html, /192\.168\.1\.50:4788/);
	});

	test("buildWebviewShellHtml escapes the command for HTML", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			command: 'pibo "evil"; </script>',
		});
		// The <pre><code>${command}</code></pre> section should HTML-escape
		assert.ok(html.includes("&quot;evil&quot;"));
		assert.ok(html.includes("&lt;/script&gt;"));
		// The raw injection should not appear unescaped in the <pre> block
		assert.ok(!html.includes('<code>pibo "evil"'));
		// The <pre> block should be safe (the only </script> in the document
		// is the legitimate end-of-script tag).
		const scriptCloseCount = (html.match(/<\/script>/g) ?? []).length;
		assert.equal(scriptCloseCount, 1);
		// And the legit one is at the end
		assert.ok(html.trimEnd().endsWith("</html>"));
	});

	test("buildWebviewShellHtml JSON-stringifies URLs for the script context", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			healthUrl: "http://x/with\"quote",
		});
		// Should be wrapped in a JSON string literal in the script
		assert.match(html, /const HEALTH = "http:\/\/x\/with\\"quote"/);
	});

	test("buildWebviewShellHtml includes the nonce on the script tag", () => {
		const html = buildWebviewShellHtml({ ...baseArgs, nonce: "abc-123" });
		assert.match(html, /<script nonce="abc-123">/);
	});

	test("buildWebviewShellHtml injects the health check URL", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			healthUrl: "http://example.test/api/health",
		});
		assert.match(html, /HEALTH = "http:\/\/example\.test\/api\/health"/);
	});

	test("buildWebviewShellHtml injects the target URL", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			targetUrl: "http://example.test/webview?roomId=r1",
		});
		assert.match(html, /TARGET = "http:\/\/example\.test\/webview\?roomId=r1"/);
	});

	test("buildWebviewShellHtml embeds the health-check timeout", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			healthCheckTimeoutMs: 999,
		});
		assert.match(html, /TIMEOUT_MS = 999/);
	});

	test("buildWebviewShellHtml embeds the poll interval", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			pollIntervalMs: 4321,
		});
		assert.match(html, /POLL_MS = 4321/);
	});

	test("buildWebviewShellHtml keeps the empty-state hidden by default", () => {
		const html = buildWebviewShellHtml(baseArgs);
		assert.match(html, /id="empty-state" class="hidden"/);
	});

	test("buildWebviewShellHtml wires the buttons to the right handlers", () => {
		const html = buildWebviewShellHtml(baseArgs);
		assert.match(html, /btn-copy.*addEventListener.*click/s);
		assert.match(html, /btn-term.*addEventListener.*click/s);
		assert.match(html, /btn-retry.*addEventListener.*click/s);
		// Open-in-terminal posts the open-terminal message
		assert.match(html, /type: "pibo\/open-terminal"/);
	});

	test("buildWebviewShellHtml uses mode: no-cors for the health check", () => {
		const html = buildWebviewShellHtml(baseArgs);
		// CORS would fail because the webview origin is vscode-webview://
		// and the gateway has no CORS middleware. no-cors is required.
		assert.match(html, /mode: "no-cors"/);
		assert.match(html, /cache: "no-store"/);
	});

	test("buildWebviewShellHtml uses location.replace for the redirect", () => {
		const html = buildWebviewShellHtml(baseArgs);
		// Use replace, not href=, so the back button doesn't trap the user
		assert.match(html, /window\.location\.replace\(TARGET\)/);
	});

	test("buildWebviewShellHtml polls while in the empty state", () => {
		const html = buildWebviewShellHtml(baseArgs);
		assert.match(html, /setInterval\(/);
		assert.match(html, /clearInterval\(pollId\)/);
	});

	test("generateNonce returns a non-empty base64 string", () => {
		const n = generateNonce();
		assert.ok(n.length > 16);
		assert.match(n, /^[A-Za-z0-9+/=]+$/);
		const n2 = generateNonce();
		assert.notEqual(n, n2);
	});
});
