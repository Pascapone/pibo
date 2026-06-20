import assert from "node:assert/strict";
import {
	buildWebviewShellHtml,
	EMPTY_STATE_COMMAND,
	generateNonce,
} from "../../src/apps/chat-vscode/extension/src/webview-shell.ts";
import { describe, test } from "node:test";

const baseArgs = {
	healthUrl: "http://127.0.0.1:4788/api/chat/bootstrap?roomId=__vscode_health__",
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
		// Use a real generateNonce() output to also guard against CSP-unsafe
		// characters leaking into the script tag attribute.
		const realNonce = generateNonce();
		const html = buildWebviewShellHtml({ ...baseArgs, nonce: realNonce });
		assert.match(html, new RegExp(`<script nonce="${realNonce}">`));
	});

	test("buildWebviewShellHtml injects the health check URL", () => {
		const html = buildWebviewShellHtml({
			...baseArgs,
			healthUrl: "http://example.test/api/health",
		});
		assert.match(html, /HEALTH = "http:\/\/example\.test\/api\/health"/);
	});

	test("buildWebviewShellHtml does NOT use window.location.replace (CSP-blocked on VS Code 1.117+)", () => {
		// The old shell navigated to TARGET via `window.location.replace`
		// when the gateway health probe succeeded. On VS Code 1.117.0+
		// the workbench CSP `frame-src 'self'` blocks that navigation
		// (the shell's origin is `vscode-webview://`, not the gateway
		// origin). The shell must instead ask the extension host to swap
		// the webview HTML via postMessage. Asserting the absence of
		// `window.location.replace` here is the regression guard.
		const html = buildWebviewShellHtml(baseArgs);
		assert.ok(
			!html.includes("window.location.replace"),
			"shell HTML must not use window.location.replace; it is CSP-blocked",
		);
		assert.ok(
			!html.includes("TARGET ="),
			"shell HTML must not embed a TARGET URL constant; navigation lives on the extension host",
		);
	});

	test("buildWebviewShellHtml requests the inlined swap via postMessage when the gateway is reachable", () => {
		const html = buildWebviewShellHtml(baseArgs);
		assert.match(html, /type: "pibo\/swap-to-inlined"/);
		assert.match(html, /vscode\.postMessage\(/);
		assert.match(html, /pibo\/swap-to-inlined-result/);
	});

	test("buildWebviewShellHtml renders a hint placeholder for swap failures", () => {
		// When the swap fails (e.g. dev-auth handshake did not
		// complete because the gateway is in Better Auth mode), the
		// shell surfaces the hint from the extension host in a
		// dedicated <p id="hint"> element. The hint is hidden by
		// default and the swap-result message handler toggles it on
		// when a non-ok result arrives.
		const html = buildWebviewShellHtml(baseArgs);
		assert.match(html, /<p id="hint" class="hidden">/);
		assert.match(html, /hintEl\.textContent = data\.hint/);
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

	test("buildWebviewShellHtml uses postMessage for the swap (no top-level navigation)", () => {
		const html = buildWebviewShellHtml(baseArgs);
		// The shell must NOT navigate via `window.location.replace`. The
		// gateway reachable branch must use `vscode.postMessage({ type:
		// "pibo/swap-to-inlined" })` so the extension host can replace
		// the webview HTML with the inlined SPA. The shell listens for
		// `pibo/swap-to-inlined-result` so it can surface failures
		// inline if the extension reports the gateway is not in
		// dev-auth mode.
		assert.match(html, /type: "pibo\/swap-to-inlined"/);
	});

	test("buildWebviewShellHtml polls while in the empty state", () => {
		const html = buildWebviewShellHtml(baseArgs);
		assert.match(html, /setInterval\(/);
		assert.match(html, /clearInterval\(pollId\)/);
	});

	test("generateNonce returns a URL-safe base64url string", () => {
		// base64url restricts the alphabet to [A-Za-z0-9_-] and strips padding,
		// so a CSP-unsafe '+', '/', or '=' must never appear in the output.
		const n = generateNonce();
		assert.ok(n.length >= 16, `nonce too short: ${n.length} chars`);
		assert.match(n, /^[A-Za-z0-9_-]+$/);
		assert.ok(!n.includes("+"), `nonce contains '+': ${n}`);
		assert.ok(!n.includes("/"), `nonce contains '/': ${n}`);
		assert.ok(!n.includes("="), `nonce contains '=': ${n}`);
	});

	test("generateNonce is unique across 32 invocations", () => {
		const seen = new Set();
		for (let i = 0; i < 32; i++) seen.add(generateNonce());
		assert.equal(seen.size, 32, "expected 32 unique nonces, found duplicates");
	});

	test("buildWebviewShellHtml embeds cspSource in script-src, style-src, img-src, connect-src", () => {
		const cspSource = "vscode-webview://test-uuid/";
		const html = buildWebviewShellHtml({ ...baseArgs, cspSource });
		const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/);
		assert.ok(meta, "expected a Content-Security-Policy meta tag");
		const directive = meta[1];
		// Each directive that should carry the cspSource must list it as a
		// standalone source expression. We split on ';' to keep the checks
		// local to each directive and avoid cross-directive false positives.
		const directives = Object.fromEntries(
			directive
				.split(";")
				.map((part) => part.trim().split(/\s+/))
				.filter((parts) => parts.length >= 1 && parts[0])
				.map((parts) => [parts[0], parts.slice(1)]),
		);
		assert.ok(
			(directives["script-src"] ?? []).includes(cspSource),
			`script-src missing cspSource. Got: ${directive}`,
		);
		assert.ok(
			(directives["style-src"] ?? []).includes(cspSource),
			`style-src missing cspSource. Got: ${directive}`,
		);
		assert.ok(
			(directives["img-src"] ?? []).includes(cspSource),
			`img-src missing cspSource. Got: ${directive}`,
		);
		assert.ok(
			(directives["connect-src"] ?? []).includes(cspSource),
			`connect-src missing cspSource. Got: ${directive}`,
		);
	});

	test("buildWebviewShellHtml with no cspSource still renders a parseable meta CSP", () => {
		const html = buildWebviewShellHtml(baseArgs);
		const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/);
		assert.ok(meta, "expected a Content-Security-Policy meta tag");
		const directive = meta[1];
		// The directive must still be non-empty and contain the script-src /
		// style-src / img-src / connect-src names. We deliberately do not
		// require any source tokens inside the unconfigured directives, only
		// that the meta tag parses and the directive list stays well-formed.
		for (const name of ["default-src", "script-src", "style-src", "img-src", "connect-src"]) {
			assert.ok(directive.includes(name), `directive missing ${name}: ${directive}`);
		}
		// No standalone empty-token runs like ';;' or '  ;' should appear.
		assert.ok(!/;\s*;/.test(directive), `directive has empty entries: ${directive}`);
	});

	test("buildWebviewShellHtml end-to-end with a real nonce has no CSP-unsafe characters in the meta directive", () => {
		// The killer regression test for the VS Code 1.117.0 bug:
		// render the shell 100 times with a fresh generateNonce() output and
		// assert that the nonce value embedded in the meta CSP and on the
		// <script> tag is restricted to [A-Za-z0-9_-] (no '+', '/', '=').
		// If generateNonce ever regresses to standard base64 the first render
		// would fail.
		for (let i = 0; i < 100; i++) {
			const html = buildWebviewShellHtml({ ...baseArgs, nonce: generateNonce() });
			const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/);
			assert.ok(meta, `render ${i}: missing meta CSP`);
			const directive = meta[1];

			// Extract the nonce-source value from the meta CSP, e.g.
			// 'nonce-r2Sv/xCx...' -> r2Sv/xCx... . This is the only place
			// where a CSP-unsafe character would break the directive.
			const nonceSourceMatch = directive.match(/'nonce-([^']*)'/);
			assert.ok(nonceSourceMatch, `render ${i}: no nonce-source in directive: ${directive}`);
			const nonceValue = nonceSourceMatch[1];
			assert.ok(
				!/[+/=]/.test(nonceValue),
				`render ${i}: nonce value contains CSP-unsafe character(s): ${nonceValue}`,
			);
			assert.match(nonceValue, /^[A-Za-z0-9_-]+$/);

			// And the same nonce value should be on the <script> tag, also
			// free of CSP-unsafe characters.
			const scriptMatch = html.match(/<script nonce="([^"]+)">/);
			assert.ok(scriptMatch, `render ${i}: no script tag with nonce`);
			assert.equal(scriptMatch[1], nonceValue);
			assert.ok(
				!/[+/=]/.test(scriptMatch[1]),
				`render ${i}: script nonce attribute contains CSP-unsafe character(s): ${scriptMatch[1]}`,
			);
		}
	});
});
