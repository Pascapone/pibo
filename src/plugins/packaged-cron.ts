import type { ChatWebAppOptions } from "../apps/chat/web-app.js";
import { createPiboCronChannel } from "../cron/channel.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_PRODUCT_OPTIONS_SERVICE, type PiboPluginProductOptions } from "./product-services.js";

export function setupCron(context: PluginSetupContext): void {
	const product = context.services.get<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE);
	const chatOptions = { ...(product?.web?.chat ?? {}) } as ChatWebAppOptions;
	context.register("channel", createPiboCronChannel({
		cronStorePath: chatOptions.cronStorePath,
		dataStorePath: chatOptions.dataStorePath,
		dataPayloadRootDir: chatOptions.dataPayloadRootDir,
	}));
	context.register("view", {});
}
