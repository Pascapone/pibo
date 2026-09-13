import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InitialSessionContext } from "../../dist/core/profiles.js";
import { PiboDataStore } from "../../dist/data/pibo-store.js";
import { profileFromPluginPlan } from "../../dist/agent-runtime/plugin-plan.js";
import { createDefaultPiboPlugins } from "../../dist/plugins/builtin.js";
import { PluginHost } from "../../dist/plugins/host.js";
import { startPluginProductRuntime } from "../../dist/plugins/product-runtime.js";
import { PiboPluginRegistry } from "../../dist/plugins/registry.js";
import { createAgentPluginSelectionForProfile } from "../../dist/plugins/selection.js";

export async function startTestPluginProduct(prefix = "pibo-test-plugin-product-") {
	const root = await mkdtemp(join(tmpdir(), prefix));
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const host = new PluginHost();
	const product = await startPluginProductRuntime({
		host,
		data,
		artifactRoot: join(root, "artifacts"),
		collectConsumers: async () => [],
	});
	return {
		host,
		runtime: product.runtime,
		createDefaultRegistry() {
			return PiboPluginRegistry.create({ host, plugins: createDefaultPiboPlugins() });
		},
		createRegistry(plugins = []) {
			return PiboPluginRegistry.create({ host, plugins });
		},
		materializeProfile(registry, profile, piboSessionId) {
			const selected = profile.pluginSelection ? profile : new InitialSessionContext({
				...profile,
				pluginSelection: createAgentPluginSelectionForProfile(host.inspect().plugins, profile),
				pluginSelectionRevision: host.inspect().plugins.reduce((sum, installation) => sum + installation.stateRevision, 0),
			});
			const adapter = registry.requireAgentRuntimeAdapter(selected.runtimeInstanceId);
			const plan = product.runtime.preview(selected, {
				adapterId: adapter.descriptor.id,
				instanceId: selected.runtimeInstanceId,
				capabilities: adapter.descriptor.capabilities,
			}, piboSessionId);
			return profileFromPluginPlan(selected, plan, host);
		},
		async dispose() {
			await product.dispose();
			data.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}
