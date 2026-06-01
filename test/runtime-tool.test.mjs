import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { inspectPiboProfile } from "../dist/core/runtime.js";
import { createDefaultPiboPluginRegistry } from "../dist/plugins/builtin.js";
import { RuntimeSessionRegistry } from "../dist/tools/runtime/registry.js";

async function withRuntimeRegistry(run) {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-runtime-tool-"));
	const registry = new RuntimeSessionRegistry({ cwd });
	try {
		return await run(registry, cwd);
	} finally {
		await registry.closeAll({ force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("python runtime preserves variables across exec calls", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller", { runtime: "python" });
		assert.equal(start.status, "ok");
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		assert.equal((await registry.exec("controller", { sessionId, code: "x = 1" })).status, "ok");
		const result = await registry.exec("controller", { sessionId, code: "x + 1", mode: "eval" });
		assert.equal(result.status, "ok");
		assert.equal(result.result?.repr, "2");
	});
});

test("python runtime errors keep prior state and expose failing line", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller", { runtime: "python" });
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		const failed = await registry.exec("controller", {
			sessionId,
			code: "x = 1\nraise Exception('boom')",
			closeOnSuccess: true,
		});
		assert.equal(failed.status, "error");
		assert.equal(failed.autoClosed, undefined);
		assert.equal(failed.error?.line, 2);

		const result = await registry.exec("controller", { sessionId, code: "x", mode: "eval" });
		assert.equal(result.status, "ok");
		assert.equal(result.result?.repr, "1");
	});
});

test("closeOnSuccess closes only after successful exec", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller", { runtime: "python" });
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		const failed = await registry.exec("controller", { sessionId, code: "y = 2\nraise RuntimeError('no')", closeOnSuccess: true });
		assert.equal(failed.status, "error");
		assert.equal(registry.list("controller").sessions.length, 1);

		const success = await registry.exec("controller", { sessionId, code: "y + 1", mode: "eval", closeOnSuccess: true });
		assert.equal(success.status, "ok");
		assert.equal(success.autoClosed, true);
		assert.equal(success.result?.repr, "3");
		assert.equal(registry.list("controller").sessions.length, 0);

		const afterClose = await registry.exec("controller", { sessionId, code: "y", mode: "eval" });
		assert.equal(afterClose.status, "not_found");
	});
});

test("runtime captures stdout and stderr separately", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller", { runtime: "python" });
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		const result = await registry.exec("controller", {
			sessionId,
			code: "import sys\nprint('out')\nprint('err', file=sys.stderr)",
		});
		assert.equal(result.status, "ok");
		assert.equal(result.stdout, "out\n");
		assert.equal(result.stderr, "err\n");
	});
});

test("runtime vars, inspect, and controller isolation work", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller-a", { runtime: "python" });
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		await registry.exec("controller-a", { sessionId, code: "_private = 1\npublic = 2\ndef f(a, b=1):\n    return a + b" });
		const vars = await registry.vars("controller-a", { sessionId });
		assert.equal(vars.status, "ok");
		assert.ok(vars.variables.some((entry) => entry.name === "public"));
		assert.ok(!vars.variables.some((entry) => entry.name === "_private"));

		const inspected = await registry.inspect("controller-a", { sessionId, expression: "f", what: "signature" });
		assert.equal(inspected.status, "ok");
		assert.equal(inspected.signature, "(a, b=1)");

		assert.deepEqual(registry.list("controller-b").sessions, []);
		assert.equal((await registry.exec("controller-b", { sessionId, code: "public", mode: "eval" })).status, "not_found");
	});
});

test("node runtime preserves variables across exec calls", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller", { runtime: "node" });
		assert.equal(start.status, "ok");
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		assert.equal((await registry.exec("controller", { sessionId, code: "let x = 1" })).status, "ok");
		const result = await registry.exec("controller", { sessionId, code: "x + 1", mode: "eval" });
		assert.equal(result.status, "ok");
		assert.equal(result.result?.repr, "2");
	});
});

test("node runtime errors keep prior state and expose failing line", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller", { runtime: "node" });
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		const failed = await registry.exec("controller", {
			sessionId,
			code: "globalThis.x = 1\nthrow new Error('boom')",
			closeOnSuccess: true,
		});
		assert.equal(failed.status, "error");
		assert.equal(failed.autoClosed, undefined);
		assert.equal(failed.error?.line, 2);

		const result = await registry.exec("controller", { sessionId, code: "x", mode: "eval" });
		assert.equal(result.status, "ok");
		assert.equal(result.result?.repr, "1");
	});
});

test("node runtime captures stdout, stderr, inspect, vars, and closeOnSuccess", async () => {
	await withRuntimeRegistry(async (registry) => {
		const start = await registry.start("controller", { runtime: "node" });
		const sessionId = start.sessionId;
		assert.ok(sessionId);

		const output = await registry.exec("controller", {
			sessionId,
			code: "globalThis.public = 2; console.log('out'); console.error('err'); function f(a, b = 1) { return a + b; } globalThis.f = f;",
		});
		assert.equal(output.status, "ok");
		assert.equal(output.stdout, "out\n");
		assert.equal(output.stderr, "err\n");

		const vars = await registry.vars("controller", { sessionId });
		assert.equal(vars.status, "ok");
		assert.ok(vars.variables.some((entry) => entry.name === "public"));

		const inspected = await registry.inspect("controller", { sessionId, expression: "f", what: "signature" });
		assert.equal(inspected.status, "ok");
		assert.match(inspected.signature, /function f\(a, b = 1\)/);

		const success = await registry.exec("controller", { sessionId, code: "public + 1", mode: "eval", closeOnSuccess: true });
		assert.equal(success.status, "ok");
		assert.equal(success.autoClosed, true);
		assert.equal(success.result?.repr, "3");
		assert.equal(registry.list("controller").sessions.length, 0);
	});
});

test("runtime can be selected by a registered profile and inspection", async () => {
	const registry = createDefaultPiboPluginRegistry();
	registry.upsertProfile({
		name: "runtime-agent",
		create(context) {
			return new InitialSessionContextBuilder("runtime-agent")
				.addTool(context.getTool("runtime"))
				.createSession();
		},
	});
	const profile = registry.createProfile("runtime-agent");
	assert.ok(profile.tools.some((tool) => tool.name === "runtime" && tool.builtInPiboTool === "runtime"));
	assert.ok(registry.getCapabilityCatalog().nativeTools.some((tool) => tool.name === "runtime" && tool.pluginId === "pibo.core"));

	const inspection = await inspectPiboProfile({ profile, persistSession: false });
	const runtimeTool = inspection.tools.find((tool) => tool.name === "runtime");
	assert.ok(runtimeTool);
	assert.equal(runtimeTool.hasDefinition, true);
	assert.equal(runtimeTool.registered, true);
	assert.equal(runtimeTool.active, true);
});
