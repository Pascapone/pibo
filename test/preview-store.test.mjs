import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { previewIdFromHostname, previewPublicURL, requirePreviewBaseURL } from "../dist/previews/config.js";
import { PreviewStore, previewExposureState } from "../dist/previews/store.js";
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
		projectId: overrides.projectId,
		label: overrides.label ?? "Website",
		targetHost: overrides.targetHost ?? "127.0.0.1",
		targetPort: overrides.targetPort ?? 5173,
		targetProcessId: overrides.targetProcessId,
		targetProcessStartTicks: overrides.targetProcessStartTicks,
		workspace: overrides.workspace ?? "/workspace/site",
		createdAt: now.toISOString(),
		expiresAt: overrides.expiresAt ?? "2030-08-22T12:01:00.000Z",
	});
}

test("preview store persists exposures and filters inactive records", () => {
	const { dir, store } = fixture();
	try {
		const active = createExposure(store, { targetProcessId: 321, targetProcessStartTicks: "987654" });
		assert.equal(active.targetProcessId, 321);
		assert.equal(active.targetProcessStartTicks, "987654");
		const expired = createExposure(store, { id: "pv-expired123", expiresAt: "2026-08-22T11:00:00.000Z" });
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
		store.closeExposure(exposure.id, "2026-08-22T12:00:30.000Z");
		assert.equal(store.authenticateBrowserSession(session.token, exposure.id, new Date("2026-08-22T12:00:31.000Z")), false);
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
});

test("preview ports reject privileged and sensitive services", () => {
	assert.equal(validatePreviewPort(5173), 5173);
	assert.throws(() => validatePreviewPort(443), /between 1024/);
	assert.throws(() => validatePreviewPort(4788), /reserved/);
	assert.throws(() => validatePreviewPort(9222), /reserved/);
});
