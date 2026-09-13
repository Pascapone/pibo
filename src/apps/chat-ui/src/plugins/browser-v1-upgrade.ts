import { DESKTOP_TABS_STORAGE_KEY } from "../desktop-tabs-model";
import { pluginRequest } from "./session-tab-controller";

export const BROWSER_V1_SOURCE_BACKUP_KEY = "pibo.chat.pluginMigration.browserV1.source";
export const BROWSER_V1_RESULT_KEY = "pibo.chat.pluginMigration.browserV1.result";

type BrowserV1UpgradeReport = {
	sourceHash: string;
	backupRetained: true;
	migratedSessions: string[];
	alreadyAppliedSessions: string[];
	unresolved: Array<{ tabId?: string; piboSessionId?: string; reason: string; repair: string }>;
	blocked: Array<{ piboSessionId: string; diagnostic: string; repair: string }>;
};

const capturedSource = capturePreUpgradeSource();
let pending: Promise<BrowserV1UpgradeReport | null> | undefined;

/** Runs before the first session tab controller loads, so an empty new tabset cannot race the upgrade import. */
export function migrateBrowserV1TabsOnce(): Promise<BrowserV1UpgradeReport | null> {
	if (pending) return pending;
	pending = runUpgrade().catch((error) => {
		pending = undefined;
		throw error;
	});
	return pending;
}

export function readBrowserV1UpgradeReport(): BrowserV1UpgradeReport | null {
	try {
		const raw = localStorage.getItem(BROWSER_V1_RESULT_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as BrowserV1UpgradeReport;
		return value && typeof value.sourceHash === "string" ? value : null;
	} catch {
		return null;
	}
}

async function runUpgrade(): Promise<BrowserV1UpgradeReport | null> {
	if (!capturedSource || readBrowserV1UpgradeReport()) return readBrowserV1UpgradeReport();
	const report = await pluginRequest<BrowserV1UpgradeReport>("/api/chat/plugins/migrate-browser-v1", {
		method: "POST",
		body: JSON.stringify({ source: capturedSource }),
	});
	try { localStorage.setItem(BROWSER_V1_RESULT_KEY, JSON.stringify(report)); } catch { /* Server journal remains authoritative. */ }
	return report;
}

function capturePreUpgradeSource(): string | null {
	try {
		const retained = localStorage.getItem(BROWSER_V1_SOURCE_BACKUP_KEY);
		if (retained !== null) return retained;
		const source = localStorage.getItem(DESKTOP_TABS_STORAGE_KEY);
		if (source !== null) localStorage.setItem(BROWSER_V1_SOURCE_BACKUP_KEY, source);
		return source;
	} catch {
		return null;
	}
}
