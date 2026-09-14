import type { ChatWebAppOptions } from "../apps/chat/web-app.js";
import { createPiboCronChannel } from "../cron/channel.js";
import { createPreviewWebApp } from "../previews/web-app.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_PRODUCT_OPTIONS_SERVICE, type PiboPluginProductOptions } from "./product-services.js";

/** Transitional feature bundle; Core owns authentication, the base Web channel, and Chat. */
export function setupWebProduct(context: PluginSetupContext): () => Promise<void> {
	const product = context.services.require<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE);
	const options = product.web;
	if (!options) throw new Error("Web product package requires product web options");
	const chatOptions = { ...(options.chat ?? {}) } as ChatWebAppOptions;
	const preview = createPreviewWebApp();
	context.register("cron-channel", createPiboCronChannel({ cronStorePath: chatOptions.cronStorePath, dataStorePath: chatOptions.dataStorePath, dataPayloadRootDir: chatOptions.dataPayloadRootDir }));
	context.register("preview-app", preview);
	return async () => {
		await preview.dispose?.();
	};
}
