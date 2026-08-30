import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Project module views hide the session composer without changing Terminal behavior", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { shouldRenderSessionComposer } = await import("./src/apps/chat-ui/src/session-trace-layout.tsx");

		assert.equal(shouldRenderSessionComposer({ hideComposer: false }), true, "ordinary Terminal keeps the composer");
		assert.equal(shouldRenderSessionComposer({ hideComposer: false, projectModulePanel: "Project Info" }), false, "Project Info cannot send into a hidden transcript");
		assert.equal(shouldRenderSessionComposer({ hideComposer: true }), false, "explicit hide semantics remain available for Preview");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });

	const layoutSource = readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");
	assert.match(
		layoutSource,
		/shouldRenderSessionComposer\(\{ hideComposer, projectModulePanel \}\)/,
		"the rendered composer must use the shared module-visibility contract",
	);
});
