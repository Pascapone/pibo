import type { ChatWebAppOptions } from "../apps/chat/web-app.js";
import { handleChatCronApiRequest } from "../apps/chat/cron-api.js";
import { createPiboCronChannel } from "../cron/channel.js";
import { createDefaultPiboCronStore } from "../cron/store.js";
import type { PluginSetupContext } from "./host.js";
import {
	PIBO_CHAT_EXTENSION_SERVICE,
	PIBO_PRODUCT_OPTIONS_SERVICE,
	type PiboChatExtensionService,
	type PiboPluginProductOptions,
} from "./product-services.js";

export function setupCron(context: PluginSetupContext): () => void {
	const product = context.services.get<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE);
	const chatOptions = { ...(product?.web?.chat ?? {}) } as ChatWebAppOptions;
	context.register("channel", createPiboCronChannel({
		cronStorePath: chatOptions.cronStorePath,
		dataStorePath: chatOptions.dataStorePath,
		dataPayloadRootDir: chatOptions.dataPayloadRootDir,
	}));
	context.register("view", {});
	const store = createDefaultPiboCronStore({ path: chatOptions.cronStorePath });
	const chatExtensions = context.services.require<PiboChatExtensionService>(PIBO_CHAT_EXTENSION_SERVICE);
	const disposeRoute = chatExtensions.registerApiRoute(async (input) => {
		if (!new URL(input.request.url).pathname.startsWith("/api/chat/cron")) return undefined;
		return await handleChatCronApiRequest({
			...input,
			cronStore: store,
		});
	});
	return () => {
		disposeRoute();
		store.close();
	};
}
