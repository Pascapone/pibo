import { SettingsManager, getAgentDir, type CreateAgentSessionServicesOptions } from "@earendil-works/pi-coding-agent";

/** Read-through settings policy: never mutate user settings to disable executable discovery. */
export function pluginOnlyPiSettings(settings: SettingsManager): SettingsManager {
	return new Proxy(settings, { get(target, property) {
		if (property === "getGlobalSettings" || property === "getProjectSettings") return () => ({ ...target[property](), packages: [], extensions: [] });
		if (property === "getPackages" || property === "getProjectPackages" || property === "getExtensionPaths") return () => [];
		const value = Reflect.get(target, property, target);
		return typeof value === "function" ? value.bind(target) : value;
	} });
}

/** Shared by session bootstrap, replacement and model catalog. Explicit host factories remain allowed. */
export function pluginOnlyPiServicesOptions(options: CreateAgentSessionServicesOptions): CreateAgentSessionServicesOptions {
	return { ...options,
		settingsManager: pluginOnlyPiSettings(options.settingsManager ?? SettingsManager.create(options.cwd, options.agentDir ?? getAgentDir())),
		resourceLoaderOptions: { ...options.resourceLoaderOptions, additionalExtensionPaths: [], noExtensions: true },
	};
}
