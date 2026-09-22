import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import test from "node:test";

for (const entry of ["src/agent-runtime/observations/observation-query.ts", "src/remote-agent/modules/observe.ts"]) {
	test(`${entry} consumes observations without loading delegation or harness implementations`, async () => {
		const result = await build({
			entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))],
			bundle: true,
			write: false,
			metafile: true,
			platform: "node",
			format: "esm",
			logLevel: "silent",
		});
		for (const input of Object.keys(result.metafile.inputs)) {
			assert.doesNotMatch(input.replaceAll("\\", "/"), /src\/(?:subagents|agent-runtimes)\/|(?:@earendil-works|@mariozechner)\/pi-/, input);
		}
		assert.ok(Object.keys(result.metafile.inputs).some(input => input.endsWith("agent-runtime/observations/observation-query.ts")));
	});
}
