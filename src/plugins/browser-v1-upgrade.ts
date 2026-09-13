import { createHash } from "node:crypto";
import type { PluginJsonObject, PluginQualifiedId, PluginSessionTabset, PluginTabInstance } from "./manifest.js";
import { pluginViewPresentation } from "./manifest.js";
import type { EffectivePluginPlan } from "./contributions.js";
import { migratePluginProductState } from "./product-state-migration.js";
import { PluginConflictError, pluginErrorMessage, type PluginStore } from "./store.js";

type LegacyTab = Record<string, unknown> & { id?: unknown; target?: unknown };

export type BrowserV1UpgradeReport = {
	sourceHash: string;
	backupRetained: true;
	migratedSessions: string[];
	alreadyAppliedSessions: string[];
	unresolved: Array<{ tabId?: string; piboSessionId?: string; reason: string; repair: string }>;
	blocked: Array<{ piboSessionId: string; diagnostic: string; repair: string }>;
};

/**
 * Imports only tabs carrying their own Pibo Session identity. Global selection is never used as ownership evidence.
 * The exact browser source is backed up before any tabset CAS write and remains a non-executable recovery artifact.
 */
export async function migrateBrowserV1Tabs(options: {
	store: PluginStore;
	source: string;
	backupRoot: string;
	assertSessionAccess: (piboSessionId: string) => void | Promise<void>;
	getSessionPlan: (piboSessionId: string) => Promise<{ plan: EffectivePluginPlan }>;
}): Promise<BrowserV1UpgradeReport> {
	if (typeof options.source !== "string" || options.source.length > 1_048_576) throw new Error("Legacy browser tab source must be a string no larger than 1 MiB");
	const bytes = new TextEncoder().encode(options.source);
	const sourceHash = createHash("sha256").update(bytes).digest("hex");
	const report: BrowserV1UpgradeReport = { sourceHash, backupRetained: true, migratedSessions: [], alreadyAppliedSessions: [], unresolved: [], blocked: [] };
	await migrateProductStateWithCasRetry({
		store: options.store,
		id: `pibo4-browser-v1-source:${sourceHash}`,
		legacyBytes: bytes,
		backupRoot: options.backupRoot,
		configurations: [],
		tabsets: [],
		ownerStages: [],
	});

	let parsed: unknown;
	try { parsed = JSON.parse(options.source); }
	catch {
		report.unresolved.push({ reason: "The retained browser source is not valid JSON.", repair: "Open Plugin Recovery, export the retained source, repair the JSON offline, and import each tab into an explicitly selected session." });
		return report;
	}
	if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.tabs)) {
		report.unresolved.push({ reason: "The retained browser source is not the supported desktopTabs v1 object.", repair: "Keep the backup and use Plugin Recovery to map supported tab objects to an explicit session; unsupported bytes are never executed." });
		return report;
	}

	const grouped = new Map<string, LegacyTab[]>();
	for (const value of parsed.tabs) {
		if (!isRecord(value)) {
			report.unresolved.push({ reason: "A legacy tab entry is not an object.", repair: "Inspect the retained source and import the entry manually only after its session owner is known." });
			continue;
		}
		const piboSessionId = explicitSessionId(value);
		if (!piboSessionId) {
			report.unresolved.push({ tabId: stringValue(value.id), reason: "No explicit Pibo Session identity is stored on this tab.", repair: "Select the owning session in Plugin Recovery and import this retained tab explicitly. lastSelection is not accepted as ownership evidence." });
			continue;
		}
		const tabs = grouped.get(piboSessionId) ?? [];
		tabs.push(value);
		grouped.set(piboSessionId, tabs);
	}

	for (const [piboSessionId, tabs] of grouped) {
		try {
			await options.assertSessionAccess(piboSessionId);
			const { plan } = await options.getSessionPlan(piboSessionId);
			if (plan.piboSessionId !== piboSessionId) throw new Error("Resolved plugin plan belongs to another session");
			const tabset = mapSessionTabs(parsed.activeTabId, piboSessionId, tabs, plan, report);
			if (!tabset.tabs.length) continue;
			const before = options.store.getTabset(piboSessionId);
			await migrateProductStateWithCasRetry({
				store: options.store,
				id: `pibo4-browser-v1-tabs:${sourceHash}:${piboSessionId}`,
				legacyBytes: bytes,
				backupRoot: options.backupRoot,
				configurations: [],
				tabsets: [tabset],
				ownerStages: [],
			});
			if (before) report.alreadyAppliedSessions.push(piboSessionId);
			else report.migratedSessions.push(piboSessionId);
		} catch (error) {
			report.blocked.push({
				piboSessionId,
				diagnostic: pluginErrorMessage(error, "Browser v1 tab migration failed"),
				repair: `The source backup and existing tabset were retained. Export session ${piboSessionId}'s current tabset, then use Plugin Recovery to reconcile each legacy tab without replacing either source.`,
			});
		}
	}
	return report;
}

async function migrateProductStateWithCasRetry(input: Parameters<typeof migratePluginProductState>[0]) {
	for (let attempt = 0; ; attempt += 1) {
		try { return await migratePluginProductState(input); }
		catch (error) {
			if (!(error instanceof PluginConflictError) || attempt >= 2) throw error;
		}
	}
}

function mapSessionTabs(activeLegacyId: unknown, piboSessionId: string, tabs: LegacyTab[], plan: EffectivePluginPlan, report: BrowserV1UpgradeReport): PluginSessionTabset {
	const mapped: PluginTabInstance[] = [];
	const singletonViews = new Set<string>();
	let activeTabId: string | null = null;
	for (const tab of tabs) {
		const mapping = legacyView(tab);
		if (!mapping) {
			report.unresolved.push({ tabId: stringValue(tab.id), piboSessionId, reason: "The tab has explicit session ownership but no supported plugin-view mapping.", repair: `Open session ${piboSessionId}, choose the replacement view, and import the retained tab JSON through Plugin Recovery.` });
			continue;
		}
		const entry = plan.contributions.find((candidate) => candidate.id === mapping.viewId && candidate.contribution.view && pluginViewPresentation(candidate.contribution.view) === "workspace");
		if (!entry?.contribution.view) {
			report.unresolved.push({ tabId: stringValue(tab.id), piboSessionId, reason: `Replacement view ${mapping.viewId} is not effective in this session's immutable/current plugin plan.`, repair: `Restore a compatible plugin revision or select another replacement in session ${piboSessionId}; the retained source is unchanged.` });
			continue;
		}
		if (mapping.subviewId && !entry.contribution.view.subviews?.some((subview) => subview.id === mapping.subviewId)) {
			report.unresolved.push({ tabId: stringValue(tab.id), piboSessionId, reason: `Replacement subview ${mapping.subviewId} is unavailable for ${mapping.viewId}.`, repair: `Choose an available subview in session ${piboSessionId}; the retained source is unchanged.` });
			continue;
		}
		if (entry.contribution.view.instance === "singleton" && singletonViews.has(mapping.viewId)) {
			report.unresolved.push({ tabId: stringValue(tab.id), piboSessionId, reason: `A duplicate legacy singleton tab for ${mapping.viewId} was retained but not duplicated.`, repair: `Compare the duplicate entries in Plugin Recovery and merge any required state into session ${piboSessionId}.` });
			continue;
		}
		singletonViews.add(mapping.viewId);
		const legacyId = stringValue(tab.id) ?? createHash("sha256").update(JSON.stringify(tab)).digest("hex").slice(0, 20);
		const instanceId = `legacy-v1-${createHash("sha256").update(`${piboSessionId}:${legacyId}:${mapping.viewId}`).digest("hex").slice(0, 24)}`;
		const state = { ...mapping.state, legacyDesktopTab: tab } as PluginJsonObject;
		mapped.push({
			instanceId,
			piboSessionId,
			pluginId: entry.pluginId,
			viewId: mapping.viewId,
			pluginRevision: entry.pluginRevision,
			stateSchemaVersion: entry.contribution.view.stateSchemaVersion,
			state,
			fallback: entry.contribution.view.title,
			...(mapping.subviewId ? { subviewId: mapping.subviewId } : {}),
		});
		if (legacyId === activeLegacyId) activeTabId = instanceId;
	}
	return { schemaVersion: 1, piboSessionId, revision: 0, tabs: mapped, activeTabId: activeTabId ?? mapped[0]?.instanceId ?? null, layout: { migrationSource: "desktopTabs.v1" } };
}

function explicitSessionId(tab: LegacyTab): string | undefined {
	const target = isRecord(tab.target) ? tab.target : undefined;
	const route = target && isRecord(target.route) ? target.route : undefined;
	return [tab.piboSessionId, target?.piboSessionId, route?.piboSessionId].find((value): value is string => typeof value === "string" && value.startsWith("ps_"));
}

function legacyView(tab: LegacyTab): { viewId: PluginQualifiedId; subviewId?: string; state: PluginJsonObject } | undefined {
	const target = isRecord(tab.target) ? tab.target : undefined;
	if (!target) return undefined;
	if (target.kind === "plugin-view" && typeof target.viewId === "string" && /^[^/]+\/[^/]+$/.test(target.viewId)) {
		return { viewId: target.viewId as PluginQualifiedId, ...(typeof target.subviewId === "string" ? { subviewId: target.subviewId } : {}), state: {} };
	}
	if (target.kind !== "route" || !isRecord(target.route)) return undefined;
	const route = target.route;
	if (route.area === "workflows") return { viewId: "pibo.product-ui/workflows", state: { ...(typeof route.draftId === "string" ? { draftId: route.draftId } : {}), ...(typeof route.viewWorkflowId === "string" ? { viewWorkflowId: route.viewWorkflowId } : {}), ...(typeof route.viewWorkflowVersion === "string" ? { viewWorkflowVersion: route.viewWorkflowVersion } : {}) } };
	if (route.area === "agents") return { viewId: "pibo.product-ui/agent-designer", state: {} };
	if (route.area === "cron") return { viewId: "pibo.product-ui/cron", state: {} };
	if (route.area === "loops") return { viewId: "pibo.product-ui/loops", state: {} };
	if (route.area === "context") return { viewId: "pibo.product-ui/user-resources", subviewId: "context-files", state: {} };
	if (route.area === "settings") return { viewId: "pibo.product-ui/settings", subviewId: typeof route.panel === "string" ? route.panel : "general", state: {} };
	return undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}
