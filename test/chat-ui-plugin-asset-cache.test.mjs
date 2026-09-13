import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { BUILTIN_PLUGIN_ASSET_PATH, evictCachedBuiltinPluginAssets } = await tsImport("../src/apps/chat-ui/src/plugin-asset-cache.ts", import.meta.url);

function cacheStorageFixture(entriesByCache) {
	const stores = new Map(Object.entries(entriesByCache).map(([name, urls]) => [name, new Set(urls)]));
	return {
		stores,
		async keys() { return [...stores.keys()]; },
		async open(name) {
			const entries = stores.get(name) ?? new Set();
			stores.set(name, entries);
			return {
				async keys() { return [...entries].map((url) => new Request(url)); },
				async delete(request) { return entries.delete(request.url); },
			};
		},
	};
}

test("startup removes every cached mutable built-in plugin entry without clearing hashed assets", async () => {
	const stable = `https://pibo.test${BUILTIN_PLUGIN_ASSET_PATH}`;
	const fixture = cacheStorageFixture({
		"pibo-chat-v2": [`${stable}?v=1.0.0`, "https://pibo.test/apps/chat/assets/app-old.js"],
		"pibo-chat-v3": [stable, "https://pibo.test/apps/chat/assets/app-current.js"],
	});

	assert.equal(await evictCachedBuiltinPluginAssets(fixture), 2);
	assert.deepEqual([...fixture.stores.get("pibo-chat-v2")], ["https://pibo.test/apps/chat/assets/app-old.js"]);
	assert.deepEqual([...fixture.stores.get("pibo-chat-v3")], ["https://pibo.test/apps/chat/assets/app-current.js"]);
});
