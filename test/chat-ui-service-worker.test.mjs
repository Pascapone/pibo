import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const ORIGIN = "https://pibo.test";
const CACHE_NAME = "pibo-chat-v2";
const APP_SHELL_URL = "/apps/chat/";
const serviceWorkerSource = fs.readFileSync("src/apps/chat-ui/public/sw.js", "utf8");

function cacheKey(request) {
	return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
}

function createCacheStorage() {
	const stores = new Map();

	function cacheFor(name) {
		let entries = stores.get(name);
		if (!entries) {
			entries = new Map();
			stores.set(name, entries);
		}
		return {
			async add() {},
			async match(request) {
				return entries.get(cacheKey(request))?.clone();
			},
			async put(request, response) {
				entries.set(cacheKey(request), response.clone());
			},
		};
	}

	return {
		async open(name) {
			return cacheFor(name);
		},
		async match(request) {
			for (const entries of stores.values()) {
				const response = entries.get(cacheKey(request));
				if (response) return response.clone();
			}
			return undefined;
		},
		async keys() {
			return [...stores.keys()];
		},
		async delete(name) {
			return stores.delete(name);
		},
	};
}

function loadServiceWorker(fetchImpl, caches = createCacheStorage()) {
	const listeners = new Map();
	const self = {
		location: { origin: ORIGIN },
		clients: { claim: async () => {} },
		skipWaiting: async () => {},
		addEventListener(type, listener) {
			listeners.set(type, listener);
		},
	};
	vm.runInContext(serviceWorkerSource, vm.createContext({ URL, caches, fetch: fetchImpl, self }), {
		filename: "src/apps/chat-ui/public/sw.js",
	});

	return {
		caches,
		async activate() {
			const lifetimePromises = [];
			listeners.get("activate")({
				waitUntil(value) {
					lifetimePromises.push(Promise.resolve(value));
				},
			});
			await Promise.all(lifetimePromises);
		},
		async fetch(request) {
			let responsePromise;
			const lifetimePromises = [];
			listeners.get("fetch")({
				request,
				respondWith(value) {
					responsePromise = Promise.resolve(value);
				},
				waitUntil(value) {
					lifetimePromises.push(Promise.resolve(value));
				},
			});
			assert.ok(responsePromise, "service worker should handle the request");
			const response = await responsePromise;
			await Promise.all(lifetimePromises);
			return response;
		},
	};
}

function navigationRequest(path = "/apps/chat/rooms/room-1/sessions/ps-1") {
	return { method: "GET", mode: "navigate", url: `${ORIGIN}${path}` };
}

test("successful Chat navigation refreshes the canonical cached shell with one network fetch", async () => {
	const caches = createCacheStorage();
	const cache = await caches.open(CACHE_NAME);
	await cache.put(APP_SHELL_URL, new Response("old shell"));
	let fetchCount = 0;
	const worker = loadServiceWorker(async () => {
		fetchCount += 1;
		return new Response("current shell", { status: 200 });
	}, caches);

	const response = await worker.fetch(navigationRequest());

	assert.equal(fetchCount, 1);
	assert.equal(await response.text(), "current shell");
	assert.equal(await (await caches.match(APP_SHELL_URL)).text(), "current shell");
});

test("non-successful Chat navigation does not replace a known-good cached shell", async () => {
	const caches = createCacheStorage();
	const cache = await caches.open(CACHE_NAME);
	await cache.put(APP_SHELL_URL, new Response("known-good shell"));
	const worker = loadServiceWorker(async () => new Response("maintenance", { status: 503 }), caches);

	const response = await worker.fetch(navigationRequest());

	assert.equal(response.status, 503);
	assert.equal(await response.text(), "maintenance");
	assert.equal(await (await caches.match(APP_SHELL_URL)).text(), "known-good shell");
});

test("failed Chat navigation falls back to the canonical cached shell", async () => {
	const caches = createCacheStorage();
	const cache = await caches.open(CACHE_NAME);
	await cache.put(APP_SHELL_URL, new Response("offline shell"));
	const worker = loadServiceWorker(async () => {
		throw new Error("offline");
	}, caches);

	const response = await worker.fetch(navigationRequest("/apps/chat/projects/project-1"));

	assert.equal(await response.text(), "offline shell");
});

test("static Chat assets remain cache-first and cache successful misses", async () => {
	const caches = createCacheStorage();
	const cache = await caches.open(CACHE_NAME);
	const cachedAssetUrl = `${ORIGIN}/apps/chat/assets/cached.js`;
	await cache.put(cachedAssetUrl, new Response("cached asset"));
	let fetchCount = 0;
	const worker = loadServiceWorker(async () => {
		fetchCount += 1;
		return new Response("network asset");
	}, caches);

	const cachedResponse = await worker.fetch({ method: "GET", mode: "cors", url: cachedAssetUrl });
	const networkAssetUrl = `${ORIGIN}/apps/chat/assets/network.js`;
	const networkResponse = await worker.fetch({ method: "GET", mode: "cors", url: networkAssetUrl });
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(await cachedResponse.text(), "cached asset");
	assert.equal(await networkResponse.text(), "network asset");
	assert.equal(fetchCount, 1);
	assert.equal(await (await caches.match(networkAssetUrl)).text(), "network asset");
});

test("activation keeps the current Chat cache and removes older caches", async () => {
	const caches = createCacheStorage();
	await caches.open(CACHE_NAME);
	await caches.open("pibo-chat-v1");
	const worker = loadServiceWorker(async () => new Response("unused"), caches);

	await worker.activate();

	assert.deepEqual(await caches.keys(), [CACHE_NAME]);
});
