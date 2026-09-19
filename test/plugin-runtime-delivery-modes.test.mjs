import assert from "node:assert/strict";
import test from "node:test";
import {
	createMinimalAgentRuntimeCapabilities,
	pluginRuntimeDeliveryModes,
} from "../dist/agent-runtime/capabilities.js";
import { PI_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/pi/adapter.js";
import { CODEX_NATIVE_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/codex-native/adapter.js";
import { OMP_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/omp/adapter.js";
import { MUSE_NATIVE_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/muse-native/adapter.js";

test("plugin delivery modes expose materialized, MCP, degraded, native, and direct vocabulary", () => {
	const capabilities = createMinimalAgentRuntimeCapabilities();
	capabilities.skills = { support: "materialized", modes: ["codex-extra-roots"] };
	capabilities.context = { support: "materialized", modes: ["native-project-discovery", "codex-developer-instructions"] };
	capabilities.tools.piboManaged = { support: "mcp", transports: ["streamable-http"] };
	capabilities.tools.nativeToolInspection = { support: "degraded", mode: "observed-runtime-items", reason: "fixture" };
	capabilities.tools.nativeToolYielding = { support: "native" };
	capabilities.mcp.externalServers = { support: "direct" };
	assert.deepEqual(pluginRuntimeDeliveryModes(capabilities), [
		"codex-developer-instructions",
		"codex-extra-roots",
		"direct",
		"mcp",
		"native",
		"native-project-discovery",
		"observed-runtime-items",
		"streamable-http",
	]);
});

test("plugin delivery modes stay empty when every delivery is unsupported", () => {
	assert.deepEqual(pluginRuntimeDeliveryModes(createMinimalAgentRuntimeCapabilities()), []);
});

test("registered adapters publish their delivery vocabulary for plugin requirements", () => {
	const codex = pluginRuntimeDeliveryModes(CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.capabilities);
	assert.ok(codex.includes("codex-extra-roots"));
	assert.ok(codex.includes("codex-developer-instructions"));
	assert.ok(codex.includes("mcp"));
	const omp = pluginRuntimeDeliveryModes(OMP_AGENT_RUNTIME_DRIVER.descriptor.capabilities);
	assert.ok(omp.includes("omp-custom-directories"));
	assert.ok(omp.includes("omp-append-system-prompt"));
	const muse = pluginRuntimeDeliveryModes(MUSE_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.capabilities);
	assert.ok(muse.includes("muse-turn-prefix"));
	assert.ok(muse.includes("mcp"));
	const pi = pluginRuntimeDeliveryModes(PI_AGENT_RUNTIME_DRIVER.descriptor.capabilities);
	assert.ok(pi.includes("native"));
});
