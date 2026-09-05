import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { previewIdFromHostname, previewPublicURL, requirePreviewBaseURL } from "../dist/previews/config.js";
import {
	MAX_OUTSTANDING_PREVIEW_TICKETS,
	MAX_PREVIEW_BROWSER_SESSIONS,
	MAX_ACTIVE_PREVIEW_EXPOSURES_PER_SESSION,
	PREVIEW_SCHEMA_VERSION,
	PreviewExposureCapacityError,
	PreviewStore,
	previewExposureState,
} from "../dist/previews/store.js";
import { validatePreviewPort } from "../dist/previews/network.js";

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-store-"));
	const store = new PreviewStore(join(dir, "previews.sqlite"));
	return { dir, store };
}

function createExposure(store, overrides = {}) {
	const now = new Date("2026-08-22T12:00:00.000Z");
	return store.createExposure({
		id: overrides.id ?? "pv-abcdef123456",
		piboSessionId: overrides.piboSessionId ?? "ps_preview",
		label: overrides.label ?? "Website",
		targetHost: overrides.targetHost ?? "127.0.0.1",
		targetPort: overrides.targetPort ?? 5173,
		targetProcessId: overrides.targetProcessId,
		targetProcessStartTicks: overrides.targetProcessStartTicks,
		workspace: overrides.workspace ?? "/workspace/site",
		proxyMode: overrides.proxyMode,
		createdAt: overrides.createdAt ?? now.toISOString(),
		expiresAt: overrides.expiresAt ?? "2030-08-22T12:01:00.000Z",
	});
}

test("preview store persists exposures and filters inactive records", () => {
	const { dir, store } = fixture();
	try {
		const active = createExposure(store, {
			targetProcessId: 321,
			targetProcessStartTicks: "987654",
			proxyMode: "pibo-compute-dev-auth",
		});
		assert.equal(active.targetProcessId, 321);
		assert.equal(active.targetProcessStartTicks, "987654");
		assert.equal(active.proxyMode, "pibo-compute-dev-auth");
		const expired = createExposure(store, {
			id: "pv-expired123",
			createdAt: "2026-08-22T10:00:00.000Z",
			expiresAt: "2026-08-22T11:00:00.000Z",
		});
		assert.equal(previewExposureState(active, new Date("2026-08-22T12:00:30.000Z")), "active");
		assert.equal(previewExposureState(expired, new Date("2026-08-22T12:00:30.000Z")), "expired");
		assert.equal(store.listExposures({ piboSessionId: "ps_preview" }).length, 1);
		assert.equal(store.listExposures({ piboSessionId: "ps_preview", includeInactive: true }).length, 2);
		assert.equal(store.closeExposure(active.id)?.closedAt !== undefined, true);
		assert.equal(previewExposureState(store.requireExposure(active.id)), "closed");
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("preview tickets are single-use and preview browser sessions are scoped and revoked", () => {
	const { dir, store } = fixture();
	try {
		const exposure = createExposure(store);
		const ticket = store.createTicket(exposure.id, 60, new Date("2026-08-22T12:00:00.000Z"));
		assert.equal(store.consumeTicket(ticket.token, exposure.id, new Date("2026-08-22T12:00:10.000Z")), true);
		assert.equal(store.consumeTicket(ticket.token, exposure.id, new Date("2026-08-22T12:00:11.000Z")), false);
		const session = store.createBrowserSession(exposure.id, 30, new Date("2026-08-22T12:00:10.000Z"));
		assert.equal(store.authenticateBrowserSession(session.token, exposure.id, new Date("2026-08-22T12:00:20.000Z")), true);
		assert.equal(store.authenticateBrowserSession(session.token, "pv-other123", new Date("2026-08-22T12:00:20.000Z")), false);
		const expiredTicket = store.createTicket(exposure.id, 1, new Date("2026-08-22T12:00:20.000Z"));
		assert.equal(store.consumeTicket(expiredTicket.token, exposure.id, new Date("2026-08-22T12:00:21.001Z")), false);
		const expiringSession = store.createBrowserSession(exposure.id, 1, new Date("2026-08-22T12:00:20.000Z"));
		assert.equal(store.authenticateBrowserSession(expiringSession.token, exposure.id, new Date("2026-08-22T12:01:20.001Z")), false);
		store.closeExposure(exposure.id, "2026-08-22T12:00:30.000Z");
		assert.equal(store.authenticateBrowserSession(session.token, exposure.id, new Date("2026-08-22T12:00:31.000Z")), false);
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("preview store migrates an existing exposure database before creating managed indexes", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-store-migration-"));
	const path = join(dir, "previews.sqlite");
	const legacy = new DatabaseSync(path);
	legacy.exec(`
		CREATE TABLE preview_exposures (
			id TEXT PRIMARY KEY,
			pibo_session_id TEXT NOT NULL,
			project_id TEXT,
			label TEXT NOT NULL,
			target_host TEXT NOT NULL,
			target_port INTEGER NOT NULL,
			target_process_id INTEGER,
			target_process_start_ticks TEXT,
			workspace TEXT NOT NULL,
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			closed_at TEXT
		);
		INSERT INTO preview_exposures VALUES (
			'pv-legacy', 'ps-legacy', NULL, 'Legacy', '127.0.0.1', 5173,
			NULL, NULL, '/workspace', '2026-08-22T00:00:00.000Z', '2030-08-22T00:00:00.000Z', NULL
		);
	`);
	legacy.close();
	const store = new PreviewStore(path);
	try {
		const migrated = store.requireExposure("pv-legacy");
		assert.equal(migrated.managementMode, "external");
		assert.equal(migrated.proxyMode, "standard");
		assert.equal(migrated.serverState, undefined);
		assert.equal(store.listManagedServerCandidates().length, 0);
		const reopened = new PreviewStore(path);
		reopened.close();
		const inspection = new DatabaseSync(path, { readOnly: true });
		assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, PREVIEW_SCHEMA_VERSION);
		assert.equal(inspection.prepare("PRAGMA table_info(preview_exposures)").all().some((column) => column.name === "project_id"), false);
		assert.equal(inspection.prepare("PRAGMA table_info(preview_exposures)").all().some((column) => column.name === "proxy_mode"), true);
		assert.match(
			inspection.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'preview_exposures'").get().sql,
			/'stopping'/,
		);
		assert.equal(inspection.prepare("PRAGMA foreign_key_list(preview_tickets)").get().table, "preview_exposures");
		assert.ok(inspection.prepare("PRAGMA table_info(preview_tickets)").all().some((column) => column.name === "server_generation"));
		assert.ok(inspection.prepare("PRAGMA table_info(preview_browser_sessions)").all().some((column) => column.name === "server_generation"));
		assert.deepEqual(inspection.prepare("PRAGMA foreign_key_check").all(), []);
		inspection.close();
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("preview ticket and browser-session registries remain bounded and reject malformed tokens", () => {
	const { dir, store } = fixture();
	try {
		const exposure = createExposure(store);
		const tickets = [];
		for (let index = 0; index < MAX_OUTSTANDING_PREVIEW_TICKETS + 5; index += 1) {
			tickets.push(store.createTicket(exposure.id, 300, new Date(Date.UTC(2026, 7, 22, 12, 0, index))));
		}
		const sessions = [];
		for (let index = 0; index < MAX_PREVIEW_BROWSER_SESSIONS + 5; index += 1) {
			sessions.push(store.createBrowserSession(exposure.id, 60, new Date(Date.UTC(2026, 7, 22, 12, 0, index))));
		}
		const inspection = new DatabaseSync(store.path, { readOnly: true });
		assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM preview_tickets").get().count, MAX_OUTSTANDING_PREVIEW_TICKETS);
		assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM preview_browser_sessions").get().count, MAX_PREVIEW_BROWSER_SESSIONS);
		inspection.close();
		assert.equal(store.consumeTicket("not-an-opaque-token", exposure.id), false);
		assert.equal(store.authenticateBrowserSession("%broken", exposure.id), false);
		assert.equal(store.consumeTicket(tickets[0].token, exposure.id, new Date("2026-08-22T12:01:00.000Z")), false);
		assert.equal(store.authenticateBrowserSession(sessions[0].token, exposure.id, new Date("2026-08-22T12:01:00.000Z")), false);
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ticket exchange is atomic and single-use across concurrent store connections", () => {
	const { dir, store } = fixture();
	const second = new PreviewStore(store.path);
	try {
		const exposure = createExposure(store);
		const ticket = store.createTicket(exposure.id, 60, new Date("2026-08-22T12:00:00.000Z"));
		const session = second.exchangeTicketForBrowserSession(ticket.token, exposure.id, 10, new Date("2026-08-22T12:00:01.000Z"));
		assert.ok(session);
		assert.equal(store.exchangeTicketForBrowserSession(ticket.token, exposure.id, 10, new Date("2026-08-22T12:00:01.000Z")), undefined);
		assert.equal(store.authenticateBrowserSession(session.token, exposure.id, new Date("2026-08-22T12:00:02.000Z")), true);
	} finally {
		second.close();
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("active Preview exposure admission is bounded per Pibo Session", () => {
	const { dir, store } = fixture();
	try {
		for (let index = 0; index < MAX_ACTIVE_PREVIEW_EXPOSURES_PER_SESSION; index += 1) {
			createExposure(store, { id: `pv-cap-${index}` });
		}
		assert.throws(
			() => createExposure(store, { id: "pv-cap-overflow" }),
			(error) => error instanceof PreviewExposureCapacityError && error.scope === "session",
		);
		store.closeExposure("pv-cap-0", "2026-08-22T12:00:30.000Z");
		assert.equal(createExposure(store, { id: "pv-cap-replacement" }).id, "pv-cap-replacement");
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("preview store rejects future schemas without downgrading them", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-preview-store-future-"));
	const path = join(dir, "previews.sqlite");
	const future = new DatabaseSync(path);
	future.exec(`PRAGMA user_version = ${PREVIEW_SCHEMA_VERSION + 1}`);
	future.close();
	try {
		assert.throws(() => new PreviewStore(path), /newer than supported/);
		const inspection = new DatabaseSync(path, { readOnly: true });
		assert.equal(inspection.prepare("PRAGMA user_version").get().user_version, PREVIEW_SCHEMA_VERSION + 1);
		inspection.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("preview pruning clears expired managed commands and retains recent diagnostics", () => {
	const { dir, store } = fixture();
	try {
		store.createExposure({
			id: "pv-expired-managed",
			piboSessionId: "ps_preview",
			label: "Expired managed",
			targetHost: "127.0.0.1",
			targetPort: 5174,
			workspace: "/workspace/site",
			managementMode: "managed",
			startCommand: "secret-start-command",
			serverState: "stopped",
			createdAt: "2026-08-22T10:00:00.000Z",
			expiresAt: "2026-08-22T11:00:00.000Z",
		});
		const result = store.prune(new Date("2026-08-22T12:00:00.000Z"));
		assert.equal(result.expiredCommands, 1);
		assert.equal(result.exposures, 0);
		assert.equal(store.requireExposure("pv-expired-managed").startCommand, undefined);
	} finally {
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("preview URL construction uses one isolated hostname label", () => {
	const base = requirePreviewBaseURL("https://preview.pibo.example:8443");
	const url = previewPublicURL("pv-abc123", base);
	assert.equal(url.toString(), "https://pv-abc123.preview.pibo.example:8443/");
	assert.equal(previewIdFromHostname("pv-abc123.preview.pibo.example", base), "pv-abc123");
	assert.equal(previewIdFromHostname("nested.pv-abc123.preview.pibo.example", base), undefined);
	assert.throws(() => requirePreviewBaseURL("https://preview.example/path"), /only scheme, hostname/);
	assert.throws(() => requirePreviewBaseURL("http://preview.example.test"), /must use https/);
	assert.throws(() => requirePreviewBaseURL("https://127.0.0.1"), /DNS hostname/);
	assert.throws(() => requirePreviewBaseURL("https://preview.example.test."), /DNS hostname/);
	assert.equal(requirePreviewBaseURL("http://preview.localhost").hostname, "preview.localhost");
	assert.throws(() => previewPublicURL("pv-invalid-", base), /Invalid preview id/);
});

test("preview ports reject privileged and sensitive services", () => {
	assert.equal(validatePreviewPort(5173), 5173);
	assert.throws(() => validatePreviewPort(443), /between 1024/);
	assert.throws(() => validatePreviewPort(4788), /reserved/);
	assert.throws(() => validatePreviewPort(9222), /reserved/);
});
