import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

for (const name of ["compaction-prompt", "provider-recovery"]) {
	test(`Core ${name} has no transitive Pi implementation dependency`, async () => {
		const result = await build({
			entryPoints: [fileURLToPath(new URL(`../src/core/${name}.ts`, import.meta.url))],
			bundle: true,
			write: false,
			metafile: true,
			platform: "node",
			format: "esm",
			logLevel: "silent",
		});
		for (const input of Object.keys(result.metafile.inputs)) {
			assert.doesNotMatch(input.replaceAll("\\", "/"), /agent-runtimes\/|(?:@earendil-works|@mariozechner)\/pi-/, input);
		}
	});
}

test("retired Pi Core forwarders and runtime TUI entry are absent", () => {
	for (const name of ["runtime", "routed-session"]) {
		assert.equal(existsSync(new URL(`../src/core/${name}.ts`, import.meta.url)), false);
	}
	for (const filename of ["src/index.ts", "src/cli.ts", "src/agent-runtimes/pi/runtime.ts", "src/agent-runtimes/pi/adapter.ts"]) {
		assert.doesNotMatch(readFileSync(new URL(`../${filename}`, import.meta.url), "utf8"), /runPiboTui|contextGuardTuiQueueOrdering/);
	}
});
