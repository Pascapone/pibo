import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginSetupContext } from "./host.js";
import { createWebAnnotationsWebApp } from "../web-annotations/api.js";
import { createWebAnnotationToolProfiles } from "../web-annotations/tools.js";

const PIBO_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Backend entry used by the ordinary staged package for the first migrated built-in feature. */
export function setup(context: PluginSetupContext): () => void {
	for (const profile of createWebAnnotationToolProfiles()) context.register(profile.name, profile);
	const webApp = createWebAnnotationsWebApp();
	context.register("api", webApp);
	context.register("skill", {
		name: "web-annotations",
		path: resolve(PIBO_PACKAGE_ROOT, "skills", "builtin", "web-annotations", "SKILL.md"),
		kind: "builtin",
	});
	context.register("annotations", {});
	context.register("build-context", {});
	context.register("terminal", {});
	return () => webApp.dispose?.();
}
