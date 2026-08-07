import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runFallbackShellScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { createFallbackChatHtml } = await import("./src/apps/chat/static-assets.ts");
		const html = createFallbackChatHtml();
		const inlineScripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)].map((match) => match[1]);

		assert.equal(inlineScripts.length, 1);
		assert.doesNotThrow(() => new Function(inlineScripts[0]));
		assert.ok(inlineScripts[0].includes(' + "\\\\n" + '));
		assert.ok(html.includes('<meta name="mobile-web-app-capable" content="yes">'));
		assert.ok(html.includes('<meta name="apple-mobile-web-app-capable" content="yes">'));
		assert.ok(html.includes('<link rel="icon" type="image/svg+xml" href="/apps/chat/favicon.svg">'));
		assert.match(html, /Fallback UI/);
		assert.match(html, /Built React Chat assets are unavailable/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("fallback Chat shell has valid inline JavaScript and identifies itself", async () => {
	await assert.doesNotReject(runFallbackShellScenario());
});
