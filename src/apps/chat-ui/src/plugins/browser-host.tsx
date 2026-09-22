import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactQuery from "@tanstack/react-query";
import * as sdk from "../../../../plugins/sdk";
import type { EffectivePluginPlan, PluginArtifactEnvelope, PluginBrowserCatalog, PluginBrowserModule, PluginBrowserSetup, PluginComposerHook, PluginHookDescriptor, PluginHookResult, PluginJsonValue, PluginQualifiedId, PluginRendererProps, PluginViewProps } from "../../../../plugins/sdk";
export type { PluginBrowserModule, PluginBrowserSetup, PluginComposerHook, PluginRendererProps, PluginViewProps } from "../../../../plugins/sdk";
import { pluginRequest } from "./session-tab-controller";
import { assertValidAttachmentProvider } from "../../../../attachments/providers";
import type { AttachmentProviderLookup, K07AttachmentProvider } from "../../../../attachments/types";

export type BrowserModuleLoader = (url: string) => Promise<PluginBrowserModule>;
const importModule: BrowserModuleLoader = (url) => import(/* @vite-ignore */ url);
export class BrowserPluginHost {
	readonly views = new Map<PluginQualifiedId, React.ComponentType<PluginViewProps>>();
	readonly renderers = new Map<PluginQualifiedId, { schemaVersion: number; component: React.ComponentType<PluginRendererProps> }>();
	readonly hooks: PluginComposerHook[] = [];
	private readonly attachmentProviders = new Map<string, K07AttachmentProvider>();
	readonly lookupAttachmentProvider: AttachmentProviderLookup = (type, scope) =>
		!this.disposed && scope.sessionId === this.plan.piboSessionId ? this.attachmentProviders.get(type) : undefined;
	readonly errors = new Map<string, string>();
	shell?: React.ComponentType<{ children: React.ReactNode; piboSessionId: string }>;
	private scopes: sdk.PluginScope[] = [];
	private disposed = false;
	constructor(readonly plan: EffectivePluginPlan, readonly catalog: PluginBrowserCatalog, private loader: BrowserModuleLoader = importModule) {}
	async start() {
		if (!this.plan.piboSessionId) throw new Error("Browser host requires a fixed Pibo Session");
		for (const plugin of this.catalog.plugins) {
			const effective = this.plan.contributions.filter((entry) => entry.pluginId === plugin.pluginId && entry.pluginRevision === plugin.revision);
			if (!effective.length || !plugin.browserEntry || this.disposed) continue;
			const scope = new sdk.PluginScope(plugin.pluginId, this.plan.piboSessionId); this.scopes.push(scope);
			const assertContribution = (id: PluginQualifiedId) => {
				scope.assertOpen();
				const entry = effective.find((entry) => entry.id === id);
				if (!entry) throw new Error(`Undeclared or disabled browser contribution: ${id}`);
				return entry;
			};
			try {
				Object.assign(globalThis, { __PIBO_BROWSER_PLUGIN_BRIDGE__: Object.freeze({ React, ReactDOM, ReactQuery }) });
				const url = new URL(plugin.browserEntry, typeof location === "undefined" ? "http://localhost" : location.origin);
				if (typeof location !== "undefined" && url.origin !== location.origin) throw new Error("Plugin modules must use authenticated same-origin assets");
				const module = await this.loader(url.href); scope.assertOpen();
				const disposer = await module.setup?.({ React, sdk, scope, piboSessionId: this.plan.piboSessionId,
					registerRenderer: (id, schemaVersion, component) => { assertContribution(id); if (this.renderers.has(id)) throw new Error(`Duplicate renderer ${id}`); this.renderers.set(id, { schemaVersion, component }); scope.defer(() => { this.renderers.delete(id); }); },
					registerHook: (hook) => { assertContribution(hook.descriptor.id); if (this.hooks.some((item) => item.descriptor.id === hook.descriptor.id)) throw new Error("Duplicate input hook"); this.hooks.push(hook); scope.defer(() => { const i = this.hooks.indexOf(hook); if (i >= 0) this.hooks.splice(i, 1); }); },
					registerShell: (id, component) => { assertContribution(id); if (this.shell) throw new Error("Multiple effective shell providers; select one in the plan"); this.shell = component; scope.defer(() => { if (this.shell === component) this.shell = undefined; }); },
					registerAttachmentProvider: (id, provider) => {
						const entry = assertContribution(id);
						assertValidAttachmentProvider(provider);
						if (entry.contribution.kind !== sdk.ATTACHMENT_PROVIDER_KIND || entry.contribution.name !== provider.type) throw new Error(`Attachment provider does not match its declared contribution: ${id}`);
						const type = provider.type;
						if (type.startsWith("pibo.core/")) throw new Error("Core attachment types cannot be replaced by plugins");
						if (this.attachmentProviders.has(type)) throw new Error(`Duplicate attachment provider ${type}`);
						this.attachmentProviders.set(type, provider);
						scope.defer(() => { if (this.attachmentProviders.get(type) === provider) this.attachmentProviders.delete(type); });
					},
				});
				if (disposer) scope.defer(disposer);
				scope.assertOpen();
				for (const entry of effective) {
					if (!entry.contribution.view) continue;
					const component = module[entry.contribution.view.exportName];
					if (typeof component !== "function" && (typeof component !== "object" || component === null)) throw new Error(`Missing view export ${entry.contribution.view.exportName}`);
					this.views.set(entry.id, component as React.ComponentType<PluginViewProps>); scope.defer(() => { this.views.delete(entry.id); });
				}
			} catch (error) {
				this.errors.set(plugin.pluginId, error instanceof Error ? error.message : String(error));
				await scope.dispose().catch((cleanup) => this.errors.set(plugin.pluginId, `${this.errors.get(plugin.pluginId)}; cleanup: ${String(cleanup)}`));
			}
		}
	}
	async dispose() { this.disposed = true; await Promise.allSettled(this.scopes.map((scope) => scope.dispose())); }
}
export class PluginErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { error: boolean }> {
	state = { error: false };
	static getDerivedStateFromError() { return { error: true }; }
	render() { return this.state.error ? this.props.fallback : this.props.children; }
}
export const BrowserPluginContext = React.createContext<{ host: BrowserPluginHost; openView: PluginViewProps["openView"] } | null>(null);
export function readPluginArtifact(value: unknown): PluginArtifactEnvelope | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const candidate = (record.pluginArtifact ?? (record.structuredContent as Record<string, unknown> | undefined)?.pluginArtifact ?? value) as Partial<PluginArtifactEnvelope>;
	if (candidate.schemaVersion !== 1 || typeof candidate.pluginId !== "string" || typeof candidate.contributionId !== "string" || !candidate.contributionId.startsWith(`${candidate.pluginId}/`) || !Number.isInteger(candidate.dataSchemaVersion) || typeof candidate.objectId !== "string" || typeof candidate.eventId !== "string" || typeof candidate.fallback !== "string") return null;
	return candidate as PluginArtifactEnvelope;
}
export function PluginArtifact({ envelope, piboSessionId }: { envelope: PluginArtifactEnvelope; piboSessionId: string }) {
	const context = React.useContext(BrowserPluginContext);
	const renderer = context?.host.plan.piboSessionId === piboSessionId ? context.host.renderers.get(envelope.contributionId) : undefined;
	const fallback = <pre className="whitespace-pre-wrap text-xs text-slate-300" data-plugin-fallback>{envelope.fallback}</pre>;
	if (!renderer || renderer.schemaVersion !== envelope.dataSchemaVersion || !envelope.contributionId.startsWith(`${envelope.pluginId}/`)) return fallback;
	const Component = renderer.component;
	return <PluginErrorBoundary key={`${envelope.eventId}:${envelope.dataSchemaVersion}`} fallback={fallback}><Component envelope={envelope} piboSessionId={piboSessionId} openView={context!.openView} /></PluginErrorBoundary>;
}
export async function runPluginInputHooks(hooks: readonly PluginComposerHook[], phase: PluginHookDescriptor["phase"], initial: PluginJsonValue, piboSessionId: string, signal: AbortSignal): Promise<{ value: PluginJsonValue; transformations: { id: string; provenance: Extract<PluginHookResult, { action: "transform" }>["provenance"] }[] }> {
	let value = initial;
	const transformations: { id: string; provenance: Extract<PluginHookResult, { action: "transform" }>["provenance"] }[] = [];
	for (const hook of [...hooks].filter((item) => item.descriptor.phase === phase).sort((a, b) => a.descriptor.order - b.descriptor.order || a.descriptor.id.localeCompare(b.descriptor.id))) {
		signal.throwIfAborted();
		const controller = new AbortController();
		const cancel = () => controller.abort(signal.reason); signal.addEventListener("abort", cancel, { once: true });
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const result = await Promise.race([
				Promise.resolve().then(() => hook.run(value, { piboSessionId, signal: controller.signal })),
				new Promise<never>((_, reject) => { controller.signal.addEventListener("abort", () => reject(controller.signal.reason ?? new Error("Hook cancelled")), { once: true }); timeout = setTimeout(() => controller.abort(new Error(`Input hook timed out: ${hook.descriptor.id}`)), Math.max(1, hook.descriptor.timeoutMs)); }),
			]);
			signal.throwIfAborted();
			if (result.action === "reject") throw new Error(result.reason);
			if (result.action === "transform") { if (!result.provenance?.description) throw new Error("Input transform requires provenance"); value = result.value; transformations.push({ id: hook.descriptor.id, provenance: result.provenance }); }
		} catch (error) {
			// Rejection is always respected, including optional hooks. Optional failures do not silently send unreviewed input either.
			throw error;
		} finally { clearTimeout(timeout); signal.removeEventListener("abort", cancel); controller.abort(); }
	}
	return { value, transformations };
}
export function sessionPluginRequest(piboSessionId: string, pluginId: string, signal: AbortSignal): PluginViewProps["request"] {
	return (path, init = {}) => {
		if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("?") || path.includes("#")) throw new Error("Use a plugin-relative API path");
		return pluginRequest(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}/plugins/${encodeURIComponent(pluginId)}${path}`, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
	};
}
