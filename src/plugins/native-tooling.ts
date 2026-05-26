import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InitialSessionContextBuilder } from "../core/profiles.js";
import type { PiboPluginApi, PiboProfileBuildContext } from "./types.js";

export const PIBO_NATIVE_TOOLING_CONTEXT_FILE_KEY = "Pibo Native Tooling";

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const PIBO_NATIVE_TOOLING_CONTEXT_FILE_PATH = resolve(PROJECT_ROOT, "context/pibo-native-tooling.md");

export function registerPiboNativeTooling(api: PiboPluginApi): void {
	api.registerContextFile({
		key: PIBO_NATIVE_TOOLING_CONTEXT_FILE_KEY,
		label: "Pibo Native Tooling",
		path: PIBO_NATIVE_TOOLING_CONTEXT_FILE_PATH,
	});
}

export function addPiboNativeToolingContext(
	builder: InitialSessionContextBuilder,
	context: PiboProfileBuildContext,
): InitialSessionContextBuilder {
	return builder.addContextFile(context.getContextFile(PIBO_NATIVE_TOOLING_CONTEXT_FILE_KEY));
}
