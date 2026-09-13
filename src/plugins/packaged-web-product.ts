import { createBetterAuthService, type BetterAuthServiceOptions } from "../auth/better-auth.js";
import { createChatWebApp, type ChatWebAppOptions } from "../apps/chat/web-app.js";
import { createPiboCronChannel } from "../cron/channel.js";
import { createPreviewWebApp } from "../previews/web-app.js";
import { createWebHostChannel, type WebHostChannelOptions } from "../web/channel.js";
import { createDevAuthService } from "./dev-auth.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_PRODUCT_OPTIONS_SERVICE, type PiboPluginProductOptions } from "./product-services.js";

/** Web product composition loaded through the same staged PluginHost path as every other built-in package. */
export function setupWebProduct(context: PluginSetupContext): () => Promise<void> {
	const product = context.services.require<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE);
	const options = product.web;
	if (!options) throw new Error("Web product package requires product web options");
	const auth = options.authMode === "dev-auth"
		? createDevAuthService()
		: createBetterAuthService((options.auth ?? {}) as BetterAuthServiceOptions);
	const chatOptions = { ...(options.chat ?? {}) } as ChatWebAppOptions;
	const chat = createChatWebApp(chatOptions);
	const preview = createPreviewWebApp();
	context.register("auth", auth);
	context.register("web-channel", createWebHostChannel((options.channel ?? {}) as WebHostChannelOptions));
	context.register("cron-channel", createPiboCronChannel({ cronStorePath: chatOptions.cronStorePath, dataStorePath: chatOptions.dataStorePath, dataPayloadRootDir: chatOptions.dataPayloadRootDir }));
	context.register("preview-app", preview);
	context.register("chat-app", chat);
	return async () => {
		await preview.dispose?.();
		await chat.dispose?.();
	};
}
