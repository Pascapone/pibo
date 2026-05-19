import assert from "node:assert/strict";
import test from "node:test";
import { listCdpTargets, openCdpTarget } from "../dist/tools/cdp-client.js";
import { createWebAnnotationsWebApp } from "../dist/web-annotations/api.js";
import { WebAnnotationCdpService } from "../dist/web-annotations/cdp.js";
import { WebAnnotationStore } from "../dist/web-annotations/store.js";

function withMockFetch(handler, fn) {
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => handler(String(url), init ?? {});
	return Promise.resolve()
		.then(fn)
		.finally(() => {
			globalThis.fetch = original;
		});
}

function jsonResponse(payload, init = {}) {
	return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function createRequest(path, body, method = "POST") {
	return new Request(`http://127.0.0.1${path}`, {
		method,
		headers: { "content-type": "application/json", origin: "http://127.0.0.1" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

function createContext(options = "user:a") {
	const webOwnerScope = typeof options === "string" ? options : options.webOwnerScope ?? "user:a";
	const sessions = typeof options === "string"
		? { ps_a: { ownerScope: options } }
		: options.sessions ?? { ps_a: { ownerScope: options.sessionOwnerScope ?? webOwnerScope } };
	return {
		channelContext: {
			getSession(id) {
				const session = sessions[id];
				return session ? { id, piSessionId: "pi", channel: "web", kind: "chat", profile: "pibo-agent", ownerScope: session.ownerScope, createdAt: "now", updatedAt: "now" } : undefined;
			},
		},
		requireSession() {
			return Promise.resolve({ ownerScope: webOwnerScope, authSession: { user: { id: "u" } } });
		},
	};
}

test("CDP helpers list and open targets with bounded normalized fields", async () => {
	const calls = [];
	await withMockFetch((url, init) => {
		calls.push({ url, method: init.method ?? "GET" });
		if (url.endsWith("/json/list")) {
			return jsonResponse([{ id: "target-1", type: "page", title: "Demo", url: "http://localhost:3000", webSocketDebuggerUrl: "ws://target" }]);
		}
		assert.equal(init.method, "PUT");
		assert.match(url, /\/json\/new\?/);
		return jsonResponse({ id: "target-2", type: "page", title: "Opened", url: "http://localhost:4000", webSocketDebuggerUrl: "ws://opened" });
	}, async () => {
		const targets = await listCdpTargets({ cdpUrl: "http://127.0.0.1:9999/" });
		assert.deepEqual(targets, [{ id: "target-1", type: "page", title: "Demo", url: "http://localhost:3000", webSocketDebuggerUrl: "ws://target" }]);

		const opened = await openCdpTarget("http://localhost:4000", { cdpUrl: "http://127.0.0.1:9999/" });
		assert.equal(opened.id, "target-2");
	});
	assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT"]);
});

test("Web Annotation CDP service creates selected bindings and marks missing targets closed", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		let targets = [{ id: "target-a", type: "page", title: "Settings", url: "http://localhost:3000/settings", webSocketDebuggerUrl: "ws://target-a" }];
		await withMockFetch((url) => {
			if (url.endsWith("/json/list")) return jsonResponse(targets);
			return jsonResponse({ id: "target-url", type: "page", title: "Opened", url: "http://localhost:3000/opened", webSocketDebuggerUrl: "ws://target-url" });
		}, async () => {
			const service = new WebAnnotationCdpService({ store, cdpUrl: "http://127.0.0.1:9999" });
			const urlBinding = await service.createUrlBinding({ ownerScope: "user:a", piboSessionId: "ps_a", piboRoomId: "room_a", url: "http://localhost:3000/opened" });
			assert.equal(urlBinding.binding.targetId, "target-url");
			assert.equal(urlBinding.binding.state, "active");

			const targetBinding = await service.createTargetBinding({ ownerScope: "user:a", piboSessionId: "ps_a", targetId: "target-a" });
			assert.equal(targetBinding.binding.url, "http://localhost:3000/settings");

			targets = [];
			await assert.rejects(() => service.injectBinding({ ownerScope: "user:a", piboSessionId: "ps_a" }, targetBinding.binding.id), /no longer reachable/);
			assert.equal(store.getBinding("user:a", "ps_a", targetBinding.binding.id).state, "closed");
		});
	} finally {
		store.close();
	}
});

test("Web Annotation API creates same-origin bindings and serves standalone overlay script", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const app = createWebAnnotationsWebApp({ store });
		const context = createContext();
		const response = await app.handleRequest(createRequest("/api/web-annotations/bindings", {
			piboSessionId: "ps_a",
			url: "http://127.0.0.1/apps/chat/rooms/room_a/sessions/ps_a?view=terminal",
			title: "Pibo Chat",
			sameOrigin: true,
		}), context);
		assert.equal(response.status, 201);
		const json = await response.json();
		assert.equal(json.binding.ownerScope, "user:a");
		assert.equal(json.binding.state, "active");
		assert.equal(json.binding.metadata.source, "same-origin");
		assert.equal(json.overlay.bindingId, json.binding.id);
		assert.equal(json.overlay.bindingToken, json.binding.metadata.overlaySubmissionToken);
		assert.match(json.binding.url, /^http:\/\/127\.0\.0\.1\/apps\/chat/);

		await assert.rejects(
			() => app.handleRequest(createRequest("/api/web-annotations/bindings", {
				piboSessionId: "ps_a",
				url: "https://example.com/",
				sameOrigin: true,
			}), context),
			/same-origin annotations require a URL on this Pibo web origin/,
		);

		const scriptResponse = await app.handleRequest(new Request("http://127.0.0.1/apps/web-annotations/overlay.js"), context);
		assert.equal(scriptResponse.status, 200);
		assert.match(scriptResponse.headers.get("content-type"), /javascript/);
		const script = await scriptResponse.text();
		assert.match(script, /window\.__piboWebAnnotationConfig/);
		assert.match(script, /active: false/);
		assert.match(script, /Enable element annotation mode/);
		assert.match(script, /Alt\+Shift\+A/);
		assert.match(script, /right:112px;bottom:156px/);
		assert.match(script, /pibo-wa-attention/);
		assert.doesNotMatch(script, /Drag annotation widget/);
		assert.match(script, /data-pibo-component/);
		assert.match(script, /pibo-terminal-row/);
		assert.match(script, /data-shared-terminal-card/);
	} finally {
		store.close();
	}
});

test("Web Annotation overlay submissions use binding token and derive session scope", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const binding = store.createBinding({
			id: "binding-submit",
			ownerScope: "user:a",
			piboSessionId: "ps_a",
			piboRoomId: "room_a",
			url: "http://localhost:3000/page",
			targetId: "target-a",
			metadata: { overlaySubmissionToken: "submit-token" },
		});
		const app = createWebAnnotationsWebApp({ store });
		const noAuthContext = { requireSession() { throw new Error("auth should not be required for token submission"); } };
		const response = await app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/submissions", {
			method: "POST",
			headers: { "content-type": "application/json", origin: "http://localhost:3000" },
			body: JSON.stringify({
				bindingId: binding.id,
				bindingToken: "submit-token",
				note: "Make this primary",
				url: "http://localhost:3000/page#section",
				title: "Demo",
				targetKind: "element",
				viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
				target: { kind: "element", selector: "[data-testid=save]", sourceHints: [{ kind: "test-id", confidence: "high", id: "save" }] },
			}),
		}), noAuthContext);
		assert.equal(response.status, 201);
		assert.equal(response.headers.get("access-control-allow-origin"), "*");
		const json = await response.json();
		assert.equal(json.annotation.ownerScope, "user:a");
		assert.equal(json.annotation.piboSessionId, "ps_a");
		assert.equal(json.annotation.piboRoomId, "room_a");
		assert.equal(json.annotation.bindingId, "binding-submit");
		assert.equal(json.annotation.targetId, "target-a");
		assert.equal(store.listAnnotations({ ownerScope: "user:a", piboSessionId: "ps_a" }).length, 1);

		const spoofed = await app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/submissions", {
			method: "POST",
			headers: { "content-type": "application/json", origin: "http://localhost:3000" },
			body: JSON.stringify({
				bindingId: binding.id,
				bindingToken: "submit-token",
				ownerScope: "user:spoofed",
				piboSessionId: "ps_spoofed",
				piboRoomId: "room_spoofed",
				note: "Spoof attempt",
				targetKind: "pin",
				viewport: { width: 1, height: 1 },
			}),
		}), noAuthContext);
		const spoofedJson = await spoofed.json();
		assert.equal(spoofedJson.annotation.ownerScope, "user:a");
		assert.equal(spoofedJson.annotation.piboSessionId, "ps_a");
		assert.equal(spoofedJson.annotation.piboRoomId, "room_a");

		await assert.rejects(
			() => app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/submissions", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "http://localhost:3000" },
				body: JSON.stringify({ bindingId: binding.id, bindingToken: "wrong", note: "x", targetKind: "pin", viewport: { width: 1, height: 1 } }),
			}), noAuthContext),
			/Invalid Web Annotation binding token/,
		);
		await assert.rejects(
			() => app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/submissions", {
				method: "POST",
				headers: { "content-type": "application/json", origin: "http://localhost:3000" },
				body: JSON.stringify({ bindingId: binding.id, bindingToken: 123, note: "x", targetKind: "pin", viewport: { width: 1, height: 1 } }),
			}), noAuthContext),
			/bindingToken must be a string/,
		);
	} finally {
		store.close();
	}
});

test("Web Annotation API lists gets and patches authorized session annotations", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const created = store.createAnnotation({
			id: "ann_api",
			ownerScope: "user:a",
			piboSessionId: "ps_a",
			piboRoomId: "room_a",
			note: "Fix spacing",
			url: "http://localhost:3000/settings",
			targetKind: "element",
			viewport: { width: 100, height: 100 },
			target: { kind: "element", label: "Save", selector: "[data-testid=save]" },
		});
		const app = createWebAnnotationsWebApp({ store });
		const context = createContext();

		store.createAnnotation({
			id: "ann_other_session",
			ownerScope: "user:a",
			piboSessionId: "ps_b",
			note: "Cross-session note",
			url: "http://localhost:3000/other",
			targetKind: "pin",
			viewport: { width: 100, height: 100 },
		});
		const listed = await app.handleRequest(new Request("http://127.0.0.1/api/web-annotations?piboSessionId=ps_a&limit=10"), context);
		const listedJson = await listed.json();
		assert.equal(listedJson.annotations.length, 1);
		assert.equal(listedJson.annotations[0].id, created.id);
		assert.equal(listedJson.annotations[0].piboSessionId, "ps_a");
		assert.equal(listedJson.annotations[0].label, "Save");

		const listedAll = await app.handleRequest(new Request("http://127.0.0.1/api/web-annotations?piboSessionId=ps_a&scope=owner&limit=10"), context);
		const listedAllJson = await listedAll.json();
		assert.equal(listedAllJson.scope, "owner");
		assert.deepEqual(listedAllJson.annotations.map((annotation) => annotation.id).sort(), ["ann_api", "ann_other_session"]);

		const got = await app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/ann_api?piboSessionId=ps_a"), context);
		assert.equal((await got.json()).annotation.note, "Fix spacing");

		const patched = await app.handleRequest(createRequest("/api/web-annotations/ann_api", { piboSessionId: "ps_a", status: "attached" }, "PATCH"), context);
		assert.equal((await patched.json()).annotation.status, "attached");
		assert.equal(store.getAnnotation("user:a", "ps_a", "ann_api").status, "attached");

		await assert.rejects(
			() => app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/ann_api?piboSessionId=ps_missing"), context),
			/Pibo session not found/,
		);
	} finally {
		store.close();
	}
});

test("Web Annotation API rejects cross-owner cross-session and invalid status updates", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		store.createAnnotation({
			id: "ann_api_a",
			ownerScope: "user:a",
			piboSessionId: "ps_a",
			piboRoomId: "room_a",
			note: "Fix spacing",
			url: "http://localhost:3000/settings",
			targetKind: "element",
			viewport: { width: 100, height: 100 },
		});
		store.createAnnotation({
			id: "ann_api_b",
			ownerScope: "user:a",
			piboSessionId: "ps_b",
			note: "Other session",
			url: "http://localhost:3000/other",
			targetKind: "pin",
			viewport: { width: 100, height: 100 },
		});
		store.createAnnotation({
			id: "ann_resolved",
			ownerScope: "user:a",
			piboSessionId: "ps_a",
			status: "resolved",
			note: "Done",
			url: "http://localhost:3000/done",
			targetKind: "pin",
			viewport: { width: 100, height: 100 },
		});
		const app = createWebAnnotationsWebApp({ store });
		const sameOwnerContext = createContext({ webOwnerScope: "user:a", sessions: { ps_a: { ownerScope: "user:a" }, ps_b: { ownerScope: "user:a" } } });
		const otherOwnerContext = createContext({ webOwnerScope: "user:b", sessions: { ps_a: { ownerScope: "user:a" } } });

		await assert.rejects(
			() => app.handleRequest(new Request("http://127.0.0.1/api/web-annotations?piboSessionId=ps_a"), otherOwnerContext),
			/Pibo session is not authorized/,
		);
		await assert.rejects(
			() => app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/ann_api_a?piboSessionId=ps_b"), sameOwnerContext),
			/Web Annotation was not found/,
		);
		await assert.rejects(
			() => app.handleRequest(createRequest("/api/web-annotations/ann_api_a", { piboSessionId: "ps_b", status: "attached" }, "PATCH"), sameOwnerContext),
			/Web Annotation was not found/,
		);
		assert.equal(store.getAnnotation("user:a", "ps_a", "ann_api_a").status, "open");

		await assert.rejects(
			() => app.handleRequest(createRequest("/api/web-annotations/ann_resolved", { piboSessionId: "ps_a", status: "acknowledged" }, "PATCH"), sameOwnerContext),
			/resolved annotations cannot transition/,
		);
		assert.equal(store.getAnnotation("user:a", "ps_a", "ann_resolved").status, "resolved");
	} finally {
		store.close();
	}
});

test("Web Annotation API enforces same-origin session authorization and routes binding operations", async () => {
	const calls = [];
	const fakeService = {
		listTargets: async () => [{ id: "target-a", type: "page", title: "Demo", url: "http://localhost", attachable: true }],
		listBindings: () => [{ id: "binding-a", ownerScope: "user:a", piboSessionId: "ps_a", state: "active", url: "http://localhost", createdAt: "now" }],
		createUrlBinding: async (input) => {
			calls.push(["url", input]);
			return { binding: { id: "binding-url", ownerScope: input.ownerScope, piboSessionId: input.piboSessionId, state: "active", url: input.url, createdAt: "now" } };
		},
		createTargetBinding: async (input) => {
			calls.push(["target", input]);
			return { binding: { id: "binding-target", ownerScope: input.ownerScope, piboSessionId: input.piboSessionId, state: "active", url: "http://localhost", targetId: input.targetId, createdAt: "now" } };
		},
		injectBinding: async (_context, id) => ({ binding: { id, ownerScope: "user:a", piboSessionId: "ps_a", state: "injected", url: "http://localhost", createdAt: "now" }, injected: true }),
		stopBinding: async (_context, id) => ({ binding: { id, ownerScope: "user:a", piboSessionId: "ps_a", state: "active", url: "http://localhost", createdAt: "now" }, stopped: true }),
		removeBinding: () => true,
	};
	const app = createWebAnnotationsWebApp({ cdpService: fakeService });
	const context = createContext();

	const created = await app.handleRequest(createRequest("/api/web-annotations/bindings", { piboSessionId: "ps_a", piboRoomId: "room_a", url: "http://localhost:3000" }), context);
	assert.equal(created.status, 201);
	assert.equal((await created.json()).binding.id, "binding-url");
	assert.equal(calls[0][1].ownerScope, "user:a");

	const injected = await app.handleRequest(createRequest("/api/web-annotations/bindings/binding-url/inject", { piboSessionId: "ps_a" }), context);
	assert.equal((await injected.json()).injected, true);

	await assert.rejects(
		() => app.handleRequest(new Request("http://127.0.0.1/api/web-annotations/bindings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ piboSessionId: "ps_a", url: "http://localhost" }) }), context),
		/Origin header is required/,
	);

	await assert.rejects(
		() => app.handleRequest(createRequest("/api/web-annotations/bindings", { piboSessionId: "ps_missing", url: "http://localhost" }), context),
		/Pibo session not found/,
	);
});
