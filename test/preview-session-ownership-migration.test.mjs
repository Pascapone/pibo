import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PreviewStore, PREVIEW_SCHEMA_VERSION } from "../dist/previews/store.js";

// Historical schema fixture only; it cannot seed a running product installation.
test("preview v4 ownership migration preserves session identity and live authorizations", () => {
	const dir = mkdtempSync(join(tmpdir(), "preview-session-migration-"));
	const path = join(dir, "previews.sqlite");
	const now = new Date("2026-09-05T00:00:00.000Z");
	let store = new PreviewStore(path);
	try {
		const exposure = store.createExposure({
			id: "pv-migration", piboSessionId: "ps_existing", label: "Existing site",
			targetHost: "127.0.0.1", targetPort: 5173, workspace: "/workspace/existing",
			createdAt: now.toISOString(), expiresAt: "2026-09-06T00:00:00.000Z",
		});
		const ticket = store.createTicket(exposure.id, 60, now);
		const browser = store.createBrowserSession(exposure.id, 30, now);
		store.close();
		store = undefined;
		const legacy = new DatabaseSync(path);
		try {
			legacy.exec("ALTER TABLE preview_exposures ADD COLUMN project_id TEXT; PRAGMA user_version = 4");
			legacy.prepare("UPDATE preview_exposures SET project_id = ? WHERE id = ?").run("prj_retired", exposure.id);
		} finally { legacy.close(); }
		store = new PreviewStore(path);
		assert.deepEqual(store.requireExposure(exposure.id), exposure);
		assert.equal(store.authenticateBrowserSession(browser.token, exposure.id, now), true);
		assert.equal(store.authenticateBrowserSession(browser.token, "pv-other", now), false);
		assert.equal(store.consumeTicket(ticket.token, exposure.id, now), true);
		const inspection = new DatabaseSync(path, { readOnly: true });
		try {
			assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, PREVIEW_SCHEMA_VERSION);
			assert.equal(inspection.prepare("PRAGMA table_info(preview_exposures)").all().some((column) => column.name === "project_id"), false);
			assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
		} finally { inspection.close(); }
		store.close();
		store = new PreviewStore(path);
		assert.deepEqual(store.requireExposure(exposure.id), exposure);
		assert.equal(store.authenticateBrowserSession(browser.token, exposure.id, now), true);
	} finally {
		store?.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("fresh preview schema and CLI expose only session ownership", () => {
	const store = new PreviewStore(":memory:");
	try {
		const help = spawnSync(process.execPath, ["dist/bin/pibo.js", "preview", "expose", "--help"], { encoding: "utf8" });
		assert.equal(help.status, 0, help.stderr);
		assert.match(help.stdout, /--session/);
		assert.doesNotMatch(help.stdout, /--project|Project association/);
	} finally { store.close(); }
});
