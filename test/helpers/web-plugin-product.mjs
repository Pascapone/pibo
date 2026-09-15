import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiboDataStore } from "../../dist/data/pibo-store.js";
import { PluginHost } from "../../dist/plugins/host.js";
import { startPluginProductRuntime } from "../../dist/plugins/product-runtime.js";
import { PiboCapabilityHost } from "../../dist/core/capability-host.js";

export async function startTestWebPluginProduct(options = {}) {
	const root = await mkdtemp(join(tmpdir(), "pibo-test-web-product-"));
	const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const host = new PluginHost();
	const product = await startPluginProductRuntime({
		host,
		data,
		artifactRoot: join(root, "artifacts"),
		collectConsumers: async () => [],
		includeWebProduct: true,
		productOptions: {
			web: { authMode: options.authMode === "local" ? "dev-auth" : options.authMode, auth: options.auth, channel: { ...options.web, landingAppName: "pibo.chat-web" }, chat: options.chat },
			userResources: {
				contextFilesMode: "full",
				contextFiles: options.contextFiles,
				userSkills: { globalRoot: options.chat?.userSkillGlobalRoot, workspaceRoot: options.chat?.userSkillWorkspaceRoot },
				customAgents: { agentStorePath: options.chat?.agentStorePath },
			},
		},
	});
	const registry = PiboCapabilityHost.create({ host });
	return {
		root,
		host,
		product,
		registry,
		async dispose() {
			await product.dispose();
			data.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}
