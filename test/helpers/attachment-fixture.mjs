import { PluginHost } from "../../dist/plugins/host.js";
import { resolvePluginContributions } from "../../dist/plugins/resolution.js";
import { coreNoteProvider } from "../../dist/attachments/core-providers.js";
import { ATTACHMENT_PROVIDER_RESOURCE_KIND } from "../../dist/attachments/types.js";

export function attachmentInstallation(pluginId = "fixture.attachments", type = "fixture/custom") {
	return {
		pluginId, revision: `sha256:${"a".repeat(64)}`, contentHash: `sha256:${"a".repeat(64)}`, version: "1.0.0",
		state: "active", enabled: true, stateRevision: 1, source: { kind: "local", path: "/unused-fixture" }, createdAt: "2026-09-22T00:00:00Z",
		manifest: { schemaVersion: 1, id: pluginId, name: pluginId, version: "1.0.0", sdk: "^1.0.0", contributions: [{ id: "attachment", kind: "attachment-provider", name: type, scope: "app", required: false, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "User attachment data" } }] },
	};
}
export function attachmentPlan(host, sessionId = "ps_A", enabled = true) {
	return resolvePluginContributions({ catalog: { schemaVersion: 1, revision: 1, installations: host.inspect().plugins.map(plugin => ({ ...plugin, enabled: enabled && plugin.enabled })) }, selection: { schemaVersion: 1, plugins: [] }, selectionRevision: 1, piboSessionId: sessionId, runtime: { adapterId: "fixture", instanceId: "fixture", capabilities: {} } });
}
export async function attachmentFixture({ mode = "resource", provider = { ...coreNoteProvider, type: "fixture/custom" } } = {}) {
	const host = new PluginHost();
	let setup;
	await host.start({ plugins: [{ installation: attachmentInstallation("fixture.attachments", provider.type), setup(context) {
		setup = context;
		if (mode === "resource") context.registerResource(ATTACHMENT_PROVIDER_RESOURCE_KIND, provider.type, provider);
		else context.register("attachment", provider);
	} }] });
	return { host, provider, setup, plan: attachmentPlan(host) };
}
export function attachmentBody(overrides = {}) {
	return { attachmentVersion: 1, admissionVersion: 2, contentBindingVersion: 1, piboSessionId: "ps_A", clientTxnId: "txn", text: "text", attachments: [{ id: "att", revision: 1, type: "pibo.core/note", schemaVersion: 1, payload: { text: "frozen note" } }], attachmentProviderPins: [], attachmentResources: [], ...overrides };
}
