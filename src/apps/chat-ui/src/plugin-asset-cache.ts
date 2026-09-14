export const PLUGIN_ASSET_PATH_PREFIX = "/apps/chat/assets/pibo-plugin-";

export function isMutablePluginAssetPath(pathname: string): boolean {
	return pathname.startsWith(PLUGIN_ASSET_PATH_PREFIX) && pathname.endsWith(".js");
}

type MutableAssetCache = {
	keys(): Promise<readonly Request[]>;
	delete(request: Request): Promise<boolean>;
};

type MutableAssetCacheStorage = {
	keys(): Promise<readonly string[]>;
	open(name: string): Promise<MutableAssetCache>;
};

/** Remove mutable plugin entry modules before plugin modules can be imported. */
export async function evictCachedBuiltinPluginAssets(storage: MutableAssetCacheStorage): Promise<number> {
	let deleted = 0;
	for (const name of await storage.keys()) {
		const cache = await storage.open(name);
		for (const request of await cache.keys()) {
			if (!isMutablePluginAssetPath(new URL(request.url).pathname)) continue;
			if (await cache.delete(request)) deleted += 1;
		}
	}
	return deleted;
}
