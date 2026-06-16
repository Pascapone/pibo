import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, test } from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(new URL(".", import.meta.url).pathname, "..", "..");
const tsxBin = resolve(root, "node_modules/.bin/tsx");

describe("chat-vscode/integration", () => {
	test("inliner produces ~800 KB of HTML for the real chat-vscode bundle", async () => {
		const script = `
import { buildInlinedChatHtml } from "./src/apps/chat-vscode/extension/src/inlined-chat-html.ts";
import { generateNonce } from "./src/apps/chat-vscode/extension/src/webview-shell.ts";

const out = buildInlinedChatHtml({
	extensionPath: ${JSON.stringify(root + "/src/apps/chat-vscode")},
	portMappedOrigin: "https://abc-uuid.vscode-resource.vscode-cdn.net:4789",
	cspSource: "vscode-webview://abc-uuid/",
	nonce: generateNonce(),
});

process.stdout.write("PIBO_INTEGRATION_RESULT::" + JSON.stringify({
	size: out.html.length,
	hasBase: out.html.includes('<base href="https://abc-uuid.vscode-resource.vscode-cdn.net:4789/"'),
	hasInlinedJs: out.html.includes("Pibo") || out.html.includes("pibo"),
	hasInlinedCss: out.html.includes("color:") || out.html.includes("background"),
	hasNonce: /<script nonce="[A-Za-z0-9_-]+"/.test(out.html),
	hasStyleNonce: /<style nonce="[A-Za-z0-9_-]+"/.test(out.html),
	hasMetaCsp: out.html.includes('http-equiv="Content-Security-Policy"'),
}) + "\\n");
`;
		const result = await execFileAsync(tsxBin, ["--eval", script], { cwd: root });
		const match = result.stdout.match(/PIBO_INTEGRATION_RESULT::(.+)/);
		const out = JSON.parse(match[1]);
		assert.ok(out.size > 500_000, `expected at least 500 KB of HTML; got ${out.size}`);
		assert.ok(out.size < 2_000_000, `expected at most 2 MB of HTML; got ${out.size}`);
		assert.ok(out.hasBase, "expected <base> tag in inlined HTML");
		assert.ok(out.hasInlinedJs, "expected inlined JS in HTML");
		assert.ok(out.hasInlinedCss, "expected inlined CSS in HTML");
		assert.ok(out.hasNonce, "expected nonce on script tag");
		assert.ok(out.hasStyleNonce, "expected nonce on style tag");
		assert.ok(out.hasMetaCsp, "expected meta CSP in HTML");
	});
});
