import { createPreviewWebApp } from "../previews/web-app.js";
import type { PluginSetupContext } from "./host.js";

export function setupPreview(context: PluginSetupContext): () => Promise<void> {
	const preview = createPreviewWebApp();
	context.register("app", preview);
	context.register("view", {});
	return async () => {
		await preview.dispose?.();
	};
}
