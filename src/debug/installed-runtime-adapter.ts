import type { AgentRuntimeAdapter } from "../agent-runtime/types.js";
import { PiboDataStore } from "../data/pibo-store.js";
import { piboHomePath } from "../core/pibo-home.js";
import { preparePluginSdkResolution } from "../plugins/backend-loader.js";
import { PluginHost } from "../plugins/host.js";
import { PiboCapabilityHost } from "../core/capability-host.js";
import { verifyPluginArtifact } from "../plugins/sources.js";
import { createStagedPluginDefinition } from "../plugins/staged-definition.js";

/** Resolve one adapter from its enabled installed package without importing any runtime implementation in Core. */
export async function withInstalledRuntimeAdapter<T>(
	instanceId: string,
	use: (adapter: AgentRuntimeAdapter) => Promise<T>,
): Promise<T | undefined> {
	const data = new PiboDataStore();
	const host = new PluginHost();
	try {
		const installation = data.plugins.listInstallations().find((candidate) =>
			candidate.enabled
			&& candidate.state === "active"
			&& candidate.manifest.contributions.some((contribution) => contribution.kind === "agent-runtime-instance" && contribution.name === instanceId));
		if (!installation) return undefined;
		await verifyPluginArtifact(installation);
		await preparePluginSdkResolution(piboHomePath("plugins", "artifacts"));
		await host.start({ plugins: [createStagedPluginDefinition(installation)] });
		const adapter = PiboCapabilityHost.create({ host }).getAgentRuntimeAdapter(instanceId);
		return adapter ? await use(adapter) : undefined;
	} finally {
		await host.stop().catch(() => undefined);
		data.close();
	}
}
