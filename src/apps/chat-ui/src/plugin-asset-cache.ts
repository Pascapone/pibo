export const BUILTIN_PLUGIN_ASSET_PATH = "/apps/chat/assets/pibo-builtin-plugin.js";

type MutableAssetCache = {
	keys(): Promise<readonly Request[]>;
	delete(request: Request): Promise<boolean>;
};

type MutableAssetCacheStorage = {
	keys(): Promise<readonly string[]>;
	open(name: string): Promise<MutableAssetCache>;
};

/** Remove only the mutable built-in plugin entry before plugin modules can be imported. */
export async function evictCachedBuiltinPluginAssets(storage: MutableAssetCacheStorage): Promise<number> {
	let deleted = 0;
	for (const name of await storage.keys()) {
		const cache = await storage.open(name);
		for (const request of await cache.keys()) {
			if (new URL(request.url).pathname !== BUILTIN_PLUGIN_ASSET_PATH) continue;
			if (await cache.delete(request)) deleted += 1;
		}
	}
	return deleted;
}
