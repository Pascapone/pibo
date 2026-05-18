#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { prepareWebAnnotationMessageAttachments } from "../dist/web-annotations/attachments.js";
import { createWebAnnotationsWebApp } from "../dist/web-annotations/api.js";
import { WebAnnotationCdpService } from "../dist/web-annotations/cdp.js";
import { WebAnnotationStore } from "../dist/web-annotations/store.js";
import { connectCdpTarget, listCdpTargets, openCdpTarget } from "../dist/tools/cdp-client.js";

const OWNER_SCOPE = "user:web-annotation-fixture";
const PIBO_SESSION_ID = "ps_web_annotation_fixture";
const PIBO_ROOM_ID = "room_web_annotation_fixture";
const CHROME_BIN = process.env.CHROME_BIN || "chromium";
const WORKSPACE = resolve(new URL("..", import.meta.url).pathname);
const FIXTURE_ROOT = join(WORKSPACE, "test/fixtures/web-annotations");

async function main() {
	const store = new WebAnnotationStore({ path: ":memory:" });
	const apiApp = createWebAnnotationsWebApp({ store });
	const apiServer = await listenApiServer(apiApp);
	const fixtureServer = await listenFixtureServer();
	const chromePort = await getFreePort();
	const chromeProfile = mkdtempSync(join(tmpdir(), "pibo-wa-chrome-"));
	const chrome = launchChrome(chromePort, chromeProfile);
	const cdpUrl = `http://127.0.0.1:${chromePort}`;
	const apiBaseUrl = `http://127.0.0.1:${apiServer.port}`;
	const fixtureBaseUrl = `http://127.0.0.1:${fixtureServer.port}`;
	const service = new WebAnnotationCdpService({ store, cdpUrl, apiBaseUrl, timeoutMs: 5_000 });

	try {
		await waitForCdp(cdpUrl);

		const staticResult = await validateStaticFixture({ service, store, cdpUrl, fixtureBaseUrl });
		const reactResult = await validateExistingTargetFixture({ service, store, cdpUrl, fixtureBaseUrl });
		const attachmentResult = await validateAttachmentAndResolve({ apiApp, store, annotationId: staticResult.elementAnnotationId, apiBaseUrl });

		console.log(JSON.stringify({
			ok: true,
			static: staticResult,
			reactLike: reactResult,
			attachment: attachmentResult,
		}, null, 2));
	} finally {
		await stopChrome(chrome);
		await closeServer(apiServer.server);
		await closeServer(fixtureServer.server);
		store.close();
		rmSync(chromeProfile, { recursive: true, force: true });
	}
}

async function validateStaticFixture({ service, store, cdpUrl, fixtureBaseUrl }) {
	const targetUrl = `${fixtureBaseUrl}/static/index.html`;
	const opened = await service.createUrlBinding({ ownerScope: OWNER_SCOPE, piboSessionId: PIBO_SESSION_ID, piboRoomId: PIBO_ROOM_ID, url: targetUrl });
	assert.equal(opened.binding.state, "active");
	const injected = await service.injectBinding({ ownerScope: OWNER_SCOPE, piboSessionId: PIBO_SESSION_ID }, opened.binding.id);
	assert.equal(injected.injected, true);

	let target = await findTargetById(cdpUrl, opened.binding.targetId);
	let client = await connectCdpTarget(target, 5_000);
	try {
		assert.equal(await overlayPresent(client, opened.binding.id), true);
		await createElementAnnotation(client, "#primary-action", "Make this checkout action more prominent");
		const elementAnnotation = await waitForAnnotation(store, (annotation) => annotation.bindingId === opened.binding.id && annotation.targetKind === "element");
		assert.equal(elementAnnotation.ownerScope, OWNER_SCOPE);
		assert.equal(elementAnnotation.piboSessionId, PIBO_SESSION_ID);
		assert.equal(
			elementAnnotation.target?.selector?.includes("checkout-save")
				|| elementAnnotation.target?.selector?.includes("primary-action")
				|| elementAnnotation.target?.stableId === "checkout-save"
				|| elementAnnotation.target?.stableId === "primary-action",
			true,
		);
		assert.equal(elementAnnotation.target?.sourceHints?.some((hint) => hint.confidence === "high"), true);

		await createPinAnnotation(client, ".pin-zone", "Pin this empty area as the visual fallback target");
		const pinAnnotation = await waitForAnnotation(store, (annotation) => annotation.bindingId === opened.binding.id && annotation.targetKind === "pin");
		assert.ok(pinAnnotation.target?.position);
	} finally {
		client.close();
	}

	client = await connectCdpTarget(target, 5_000);
	try {
		await client.send("Page.reload", { ignoreCache: true }, 5_000);
		await delay(800);
	} finally {
		client.close();
	}

	const reinjected = await service.injectBinding({ ownerScope: OWNER_SCOPE, piboSessionId: PIBO_SESSION_ID }, opened.binding.id);
	assert.equal(reinjected.injected, true);
	target = await findTargetById(cdpUrl, opened.binding.targetId);
	client = await connectCdpTarget(target, 5_000);
	try {
		assert.equal(await overlayPresent(client, opened.binding.id), true);
	} finally {
		client.close();
	}

	return {
		url: targetUrl,
		bindingId: opened.binding.id,
		elementAnnotationId: store.listAnnotations({ ownerScope: OWNER_SCOPE, piboSessionId: PIBO_SESSION_ID, limit: 10 }).find((annotation) => annotation.targetKind === "element")?.id,
		reloadedAndReinjected: true,
	};
}

async function validateExistingTargetFixture({ service, store, cdpUrl, fixtureBaseUrl }) {
	const targetUrl = `${fixtureBaseUrl}/react-like/index.html`;
	const openedTarget = await openCdpTarget(targetUrl, { cdpUrl, timeoutMs: 5_000 });
	const bindingResult = await service.createTargetBinding({ ownerScope: OWNER_SCOPE, piboSessionId: PIBO_SESSION_ID, piboRoomId: PIBO_ROOM_ID, targetId: openedTarget.id });
	assert.equal(bindingResult.binding.targetId, openedTarget.id);
	const injected = await service.injectBinding({ ownerScope: OWNER_SCOPE, piboSessionId: PIBO_SESSION_ID }, bindingResult.binding.id);
	assert.equal(injected.injected, true);
	const target = await findTargetById(cdpUrl, openedTarget.id);
	const client = await connectCdpTarget(target, 5_000);
	try {
		assert.equal(await overlayPresent(client, bindingResult.binding.id), true);
		await createElementAnnotation(client, "[data-testid='save-settings']", "Use the source hint fixture for this target");
		const annotation = await waitForAnnotation(store, (item) => item.bindingId === bindingResult.binding.id && item.targetKind === "element");
		assert.equal(annotation.target?.sourceHints?.some((hint) => hint.kind === "pibo-id" || hint.kind === "test-id" || hint.kind === "locatorjs"), true);
		return { url: targetUrl, bindingId: bindingResult.binding.id, annotationId: annotation.id };
	} finally {
		client.close();
	}
}

async function validateAttachmentAndResolve({ apiApp, store, annotationId, apiBaseUrl }) {
	assert.ok(annotationId, "element annotation id is required for attachment validation");
	const prepared = prepareWebAnnotationMessageAttachments({
		store,
		ownerScope: OWNER_SCOPE,
		piboSessionId: PIBO_SESSION_ID,
		messageText: "Please fix the annotated target.",
		attachmentIds: [annotationId],
	});
	assert.match(prepared.messageText, /<attached-web-annotations>/);
	assert.doesNotMatch(prepared.messageText, /base64/i);
	assert.equal(prepared.attachments.length, 1);

	const attached = store.patchAnnotation(OWNER_SCOPE, PIBO_SESSION_ID, annotationId, { status: "attached" });
	assert.equal(attached?.status, "attached");

	const response = await apiApp.handleRequest(new Request(`${apiBaseUrl}/api/web-annotations/${encodeURIComponent(annotationId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json", origin: apiBaseUrl },
		body: JSON.stringify({ piboSessionId: PIBO_SESSION_ID, status: "resolved", summary: "Validated browser fixture flow." }),
	}), fakeContext());
	assert.equal(response.status, 200);
	const json = await response.json();
	assert.equal(json.annotation.status, "resolved");
	const resolved = store.getAnnotation(OWNER_SCOPE, PIBO_SESSION_ID, annotationId);
	assert.match(resolved?.summary, /Validated browser fixture flow/);
	return { annotationId, attached: true, resolved: true };
}

async function createElementAnnotation(client, selector, note) {
	const opened = await client.evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return { ok: false, reason: "missing element" };
		const rect = el.getBoundingClientRect();
		const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: Math.round(rect.left + Math.min(10, rect.width / 2)), clientY: Math.round(rect.top + Math.min(10, rect.height / 2)) };
		if (window.__piboWebAnnotations && typeof window.__piboWebAnnotations.setMode === "function") window.__piboWebAnnotations.setMode("element");
		el.dispatchEvent(new MouseEvent("mousemove", init));
		el.dispatchEvent(new MouseEvent("click", init));
		const root = document.getElementById("pibo-web-annotation-overlay");
		const textarea = root && root.shadowRoot && root.shadowRoot.querySelector("textarea");
		return { ok: Boolean(textarea) };
	})()`, 5_000);
	assert.deepEqual(opened, { ok: true });
	await submitPopup(client, note);
}

async function createPinAnnotation(client, selector, note) {
	const opened = await client.evaluate(`(() => {
		const root = document.getElementById("pibo-web-annotation-overlay");
		const shadow = root && root.shadowRoot;
		const pinButton = shadow && Array.from(shadow.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === "Mark a point instead of an element");
		if (!pinButton) return { ok: false, reason: "missing pin button" };
		pinButton.click();
		const zone = document.querySelector(${JSON.stringify(selector)});
		if (!zone) return { ok: false, reason: "missing pin zone" };
		const rect = zone.getBoundingClientRect();
		const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2) };
		zone.dispatchEvent(new MouseEvent("click", init));
		const textarea = shadow.querySelector("textarea");
		return { ok: Boolean(textarea) };
	})()`, 5_000);
	assert.deepEqual(opened, { ok: true });
	await submitPopup(client, note);
}

async function submitPopup(client, note) {
	const submitted = await client.evaluate(`(() => {
		const root = document.getElementById("pibo-web-annotation-overlay");
		const shadow = root && root.shadowRoot;
		const textarea = shadow && shadow.querySelector("textarea");
		if (!textarea) return { ok: false, reason: "missing textarea" };
		textarea.value = ${JSON.stringify(note)};
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
		const submit = Array.from(shadow.querySelectorAll("button")).find((button) => button.textContent === "Submit");
		if (!submit) return { ok: false, reason: "missing submit" };
		submit.click();
		return { ok: true };
	})()`, 5_000);
	assert.deepEqual(submitted, { ok: true });
	await delay(350);
}

async function overlayPresent(client, bindingId) {
	return client.evaluate(`(() => {
		const root = document.getElementById("pibo-web-annotation-overlay");
		return Boolean(root && root.getAttribute("data-pibo-web-annotation-binding") === ${JSON.stringify(bindingId)} && root.shadowRoot);
	})()`, 5_000);
}

async function waitForAnnotation(store, predicate) {
	for (let i = 0; i < 40; i += 1) {
		const annotation = store.listAnnotations({ ownerScope: OWNER_SCOPE, piboSessionId: PIBO_SESSION_ID, limit: 50 }).find(predicate);
		if (annotation) return annotation;
		await delay(100);
	}
	throw new Error("Timed out waiting for annotation");
}

async function findTargetById(cdpUrl, targetId) {
	const target = (await listCdpTargets({ cdpUrl, timeoutMs: 5_000 })).find((item) => item.id === targetId);
	if (!target) throw new Error(`CDP target not found: ${targetId}`);
	return target;
}

async function listenFixtureServer() {
	const server = createServer((req, res) => {
		const rawPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
		const safePath = rawPath.replace(/^\/+/, "").replace(/\.\.+/g, "");
		const filePath = join(FIXTURE_ROOT, safePath || "static/index.html");
		try {
			const body = readFileSync(filePath);
			res.writeHead(200, { "content-type": contentType(filePath) });
			res.end(body);
		} catch {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
		}
	});
	const port = await listen(server);
	return { server, port };
}

async function listenApiServer(apiApp) {
	const server = createServer(async (req, res) => {
		try {
			const body = await readRequestBody(req);
			const origin = `http://127.0.0.1:${server.address().port}`;
			const request = new Request(`${origin}${req.url || "/"}`, {
				method: req.method,
				headers: req.headers,
				body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
			});
			const response = await apiApp.handleRequest(request, fakeContext()) ?? new Response("not found", { status: 404 });
			res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch (error) {
			res.writeHead(500, { "content-type": "text/plain" });
			res.end(error instanceof Error ? error.stack || error.message : String(error));
		}
	});
	const port = await listen(server);
	return { server, port };
}

function fakeContext() {
	return {
		channelContext: {
			getSession(id) {
				return id === PIBO_SESSION_ID ? { id, piSessionId: "pi_fixture", channel: "web", kind: "chat", profile: "pibo-agent", ownerScope: OWNER_SCOPE, createdAt: "now", updatedAt: "now" } : undefined;
			},
		},
		requireSession() {
			return Promise.resolve({ ownerScope: OWNER_SCOPE, authSession: { user: { id: "fixture-user" } } });
		},
	};
}

function launchChrome(port, userDataDir) {
	const chrome = spawn(CHROME_BIN, [
		"--headless=new",
		"--disable-gpu",
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--remote-debugging-address=127.0.0.1",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${userDataDir}`,
		"about:blank",
	], { detached: true, stdio: "ignore" });
	chrome.unref();
	return chrome;
}

async function stopChrome(chrome) {
	if (!chrome.pid) return;
	try {
		process.kill(-chrome.pid, "SIGTERM");
	} catch {
		try { chrome.kill("SIGTERM"); } catch { /* ignore */ }
	}
	await delay(500);
	try {
		process.kill(-chrome.pid, "SIGKILL");
	} catch {
		// already stopped
	}
}

async function waitForCdp(cdpUrl) {
	for (let i = 0; i < 80; i += 1) {
		try {
			const response = await fetch(`${cdpUrl}/json/version`);
			if (response.ok) return;
		} catch {
			// wait
		}
		await delay(100);
	}
	throw new Error(`Timed out waiting for Chrome CDP at ${cdpUrl}`);
}

async function readRequestBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	return chunks.length ? Buffer.concat(chunks) : undefined;
}

function listen(server) {
	return new Promise((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", rejectListen);
			resolveListen(server.address().port);
		});
	});
}

async function getFreePort() {
	const server = createServer();
	const port = await listen(server);
	await closeServer(server);
	return port;
}

function closeServer(server) {
	return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function contentType(filePath) {
	switch (extname(filePath)) {
		case ".html": return "text/html; charset=utf-8";
		case ".css": return "text/css; charset=utf-8";
		case ".js": return "text/javascript; charset=utf-8";
		default: return "application/octet-stream";
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
