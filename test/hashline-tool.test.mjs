import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { startTestPluginProduct } from "./helpers/plugin-product.mjs";
import {
	HASHLINE_TOOL_NAME,
	createHashlineToolDefinition,
	hashLineContent,
} from "../dist/tools/hashline.js";

async function createProductRegistry(t) {
	const product = await startTestPluginProduct("pibo-hashline-product-");
	const registry = product.createDefaultRegistry();
	t.after(async () => {

		await product.dispose();
	});
	return registry;
}

test("default catalog exposes Pi-only hashline replacement metadata", async (t) => {
	const registry = await createProductRegistry(t);
	const tool = registry.getCapabilityCatalog().nativeTools.find((entry) => entry.name === HASHLINE_TOOL_NAME);
	assert.ok(tool);
	assert.equal(tool.pluginId, "pibo.file-editing");
	assert.equal(tool.portable, false);
	assert.equal(tool.yieldable, false);
	assert.deepEqual(tool.replacesBuiltinTools, ["read"]);
});

test("hashline formats text reads as LINE#HASH:CONTENT with pagination preserved", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-hashline-read-"));
	try {
		writeFileSync(join(cwd, "sample.txt"), "alpha\nbeta\ngamma\n", "utf8");
		const tool = createHashlineToolDefinition(cwd);
		const result = await tool.execute("call-1", { path: "sample.txt", offset: 2, limit: 1 });
		assert.deepEqual(result.content, [{
			type: "text",
			text: `2#${hashLineContent("beta")}:beta\n\n[2 more lines in file. Use offset=3 to continue.]`,
		}]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("selecting hashline removes built-in read from the effective Pi runtime", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-hashline-runtime-"));
	const product = await startTestPluginProduct("pibo-hashline-runtime-product-");
	const registry = product.createDefaultRegistry();
	registry.upsertProfile({
		name: "hashline-agent",
		create(context) {
			return new InitialSessionContextBuilder("hashline-agent")
				.addTool(context.getTool(HASHLINE_TOOL_NAME))
				.createSession();
		},
	});
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_hashline", channel: "test", kind: "chat", profile: "hashline-agent", workspace: cwd });
	const router = new PiboSessionRouter({ persistSession: false, capabilityHost: registry, pluginRuntime: product.runtime, sessionStore: store, cwd });
	t.after(async () => { await router.disposeAll(); await product.dispose(); rmSync(cwd, { recursive: true, force: true }); });
	await router.emit({ type: "execution", piboSessionId: "ps_hashline", action: "status" });
	const activeTools = new Set(router.sessions.get("ps_hashline").runtime.session.getActiveToolNames());
	assert.equal(activeTools.has(HASHLINE_TOOL_NAME), true);
	assert.equal(activeTools.has("read"), false);
	assert.equal(activeTools.has("bash"), true);
	assert.equal(activeTools.has("edit"), true);
	assert.equal(activeTools.has("write"), true);
});
