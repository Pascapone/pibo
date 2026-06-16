import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test } from "node:test";
import { buildInlinedChatHtml, listBundleAssetNames } from "../../src/apps/chat-vscode/extension/src/inlined-chat-html.ts";

function makeFixtureBundle() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-inlined-test-"));
	fs.writeFileSync(
		path.join(dir, "index.html"),
		`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<script type="module" crossorigin src="/apps/chat-vscode/assets/index-FAKE.js"></script>
<link rel="stylesheet" crossorigin href="/apps/chat-vscode/assets/index-FAKE.css">
</head>
<body>
<div id="root"></div>
</body>
</html>`,
	);
	fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "assets", "index-FAKE.js"),
		`console.log("hello from fake bundle");
const x = "</script>"; // defensive escape target
const y = "<!--"; // defensive escape target
const z = "-->"; // defensive escape target
`,
	);
	fs.writeFileSync(
		path.join(dir, "assets", "index-FAKE.css"),
		`body { color: red; }
@font-face { src: url("/apps/chat-vscode/assets/font.woff2") format("woff2"); }
.foo { background: url('./img/bg.png'); }
`,
	);
	return dir;
}

describe("chat-vscode/inlined-chat-html", () => {
	test("buildInlinedChatHtml inlines the JS and CSS with a nonce and a <base> tag", () => {
		const bundleDir = makeFixtureBundle();
		const out = buildInlinedChatHtml({
			extensionPath: path.dirname(bundleDir),
			bundleRelativeDir: path.basename(bundleDir),
			portMappedOrigin: "https://abc-123.vscode-resource.vscode-cdn.net:4789",
			cspSource: "vscode-webview://abc-uuid/",
			nonce: "test-nonce-abc",
		});
		assert.match(out.html, /<base href="https:\/\/abc-123\.vscode-resource\.vscode-cdn\.net:4789\/"/);
		assert.match(out.html, /<script nonce="test-nonce-abc" type="module">/);
		assert.match(out.html, /<\/script>\n<\/body>/);
		assert.match(out.html, /<style nonce="test-nonce-abc">/);
		assert.match(out.html, /<\/style>/);
		assert.match(out.html, /console\.log\("hello from fake bundle"\)/);
		assert.match(out.html, /body \{ color: red; \}/);
		// No external <script src> or <link rel="stylesheet" href> remains.
		assert.ok(!/<script\s+[^>]*src=/.test(out.html), "expected no external <script src=>");
		assert.ok(!/<link\s+[^>]*rel="stylesheet"[^>]*href=/.test(out.html), "expected no external <link rel=stylesheet href=>");
	});

	test("escapes </script>, <!--, and --> inside the JS body", () => {
		const bundleDir = makeFixtureBundle();
		const out = buildInlinedChatHtml({
			extensionPath: path.dirname(bundleDir),
			bundleRelativeDir: path.basename(bundleDir),
			portMappedOrigin: "https://abc-123.vscode-resource.vscode-cdn.net:4789",
			cspSource: "vscode-webview://abc-uuid/",
			nonce: "test-nonce-abc",
		});
		// `</script>` should not appear unescaped inside the body. It can
		// only appear as the final closing tag.
		const scriptCount = (out.html.match(/<\/script>/g) ?? []).length;
		assert.equal(scriptCount, 1, `expected exactly one </script> tag, found ${scriptCount}`);
		assert.ok(out.html.trimEnd().endsWith("</html>"));
		// The escape sequences should be present.
		assert.ok(out.html.includes("<\\/script>"), "expected <\\/script> escape in body");
		assert.ok(out.html.includes("<\\!--"), "expected <\\!-- escape in body");
		assert.ok(out.html.includes("--\\>"), "expected --\\> escape in body");
	});

	test("buildInlinedChatHtml throws when the bundle is missing", () => {
		assert.throws(
			() =>
				buildInlinedChatHtml({
					extensionPath: "/nonexistent",
					portMappedOrigin: "https://x.vscode-resource.vscode-cdn.net:1",
					cspSource: "vscode-webview://x/",
					nonce: "x",
				}),
			/bundle index\.html not found/,
		);
	});

	test("buildInlinedChatHtml throws when the script or css asset is missing", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-inlined-test-"));
		fs.writeFileSync(
			path.join(dir, "index.html"),
			`<!doctype html>
<html lang="en">
<head>
<script type="module" src="/apps/chat-vscode/assets/missing.js"></script>
</head>
<body></body>
</html>`,
		);
		assert.throws(
			() =>
				buildInlinedChatHtml({
					extensionPath: path.dirname(dir),
					bundleRelativeDir: path.basename(dir),
					portMappedOrigin: "https://x.vscode-resource.vscode-cdn.net:1",
					cspSource: "vscode-webview://x/",
					nonce: "x",
				}),
			/missing a <link rel="stylesheet"/,
		);
	});

	test("meta CSP includes the port-mapped origin in connect-src", () => {
		const bundleDir = makeFixtureBundle();
		const out = buildInlinedChatHtml({
			extensionPath: path.dirname(bundleDir),
			bundleRelativeDir: path.basename(bundleDir),
			portMappedOrigin: "https://zzz.vscode-resource.vscode-cdn.net:4799",
			cspSource: "vscode-webview://zzz-uuid/",
			nonce: "nonce-1",
		});
		const meta = out.html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/);
		assert.ok(meta, "expected a Content-Security-Policy meta tag");
		const directive = meta[1];
		assert.ok(
			directive.includes("https://zzz.vscode-resource.vscode-cdn.net:4799"),
			`connect-src should include the port-mapped origin. Got: ${directive}`,
		);
		assert.ok(
			directive.includes("vscode-webview://zzz-uuid/"),
			`cspSource should be present. Got: ${directive}`,
		);
		assert.ok(/script-src/.test(directive), "script-src directive required");
		assert.ok(/style-src/.test(directive), "style-src directive required");
		assert.ok(/connect-src/.test(directive), "connect-src directive required");
	});

	test("listBundleAssetNames returns the JS and CSS asset filenames", () => {
		const dir = makeFixtureBundle();
		const names = listBundleAssetNames(dir);
		assert.equal(names.javascript, "index-FAKE.js");
		assert.equal(names.css, "index-FAKE.css");
	});

	test("listBundleAssetNames returns nulls for an empty bundle dir", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-empty-bundle-"));
		const names = listBundleAssetNames(dir);
		assert.equal(names.javascript, null);
		assert.equal(names.css, null);
	});
});
