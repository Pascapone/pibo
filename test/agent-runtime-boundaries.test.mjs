import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const GENERIC_RUNTIME_FILES = [
	"src/agent-runtime/capabilities.ts",
	"src/agent-runtime/contract.ts",
	"src/agent-runtime/errors.ts",
	"src/agent-runtime/events.ts",
	"src/agent-runtime/registry.ts",
	"src/agent-runtime/routed-session.ts",
	"src/agent-runtime/types.ts",
	"src/core/session-router.ts",
];

const FORBIDDEN_IMPORTS = [
	/@earendil-works\/pi-/,
	/from ["'][^"']*agent-runtimes\/pi\//,
	/from ["'][^"']*agent-runtimes\/codex\//,
];

test("generic runtime and router modules do not import Pi, Codex, or adapter implementations", async () => {
	for (const path of GENERIC_RUNTIME_FILES) {
		const source = await readFile(path, "utf8");
		for (const forbidden of FORBIDDEN_IMPORTS) {
			assert.doesNotMatch(source, forbidden, `${path} crossed the runtime adapter boundary`);
		}
	}
});

test("deprecated Pi compatibility facades are explicit and do not contain implementation logic", async () => {
	for (const path of ["src/core/runtime.ts", "src/core/routed-session.ts"]) {
		const source = await readFile(path, "utf8");
		assert.match(source, /@deprecated Pi/);
		assert.ok(source.split("\n").length <= 8, `${path} must remain a thin compatibility facade`);
	}
});
