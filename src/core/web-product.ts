import { createBetterAuthService, type BetterAuthServiceOptions } from "../auth/better-auth.js";
import { createChatWebApp, type ChatWebAppOptions } from "../apps/chat/web-app.js";
import { createWebHostChannel, type WebHostChannelOptions } from "../web/channel.js";
import { createDevAuthService } from "../auth/dev-auth.js";
import type { PluginHost } from "../plugins/host.js";
import { PIBO_WORKFLOW_CATALOG_QUERY_SERVICE, type PiboPluginProductOptions } from "../plugins/product-services.js";
import { PluginScope } from "../plugins/scope.js";

/** Core-owned authentication, base Web channel, and Chat application. */
export function provideCoreWebProduct(host: PluginHost, options: NonNullable<PiboPluginProductOptions["web"]>): () => Promise<void> {
	const scope = new PluginScope("@pibo/core", "@pibo/core/web-product");
	const auth = options.authMode === "dev-auth"
		? createDevAuthService()
		: createBetterAuthService((options.auth ?? {}) as BetterAuthServiceOptions);
	const chat = createChatWebApp({ ...(options.chat ?? {}) } as ChatWebAppOptions);
	// Provision before plugin setup. Headless compositions have no query;
	// the workflow plugin's view still activates without a Chat Web app.
	const disposeCatalog = host.provideCoreService({
		id: PIBO_WORKFLOW_CATALOG_QUERY_SERVICE,
		version: "1.0.0",
		value: chat.workflowCatalogQuery(),
	});
	const channel = createWebHostChannel((options.channel ?? {}) as WebHostChannelOptions);
	host.contributions.register(scope, "resource:auth-service", auth.name, auth);
	host.contributions.register(scope, "resource:channel", channel.name, channel);
	host.contributions.register(scope, "resource:web-app", chat.name, chat);
	let disposed = false;
	return async () => {
		if (disposed) return;
		disposed = true;
		const errors: unknown[] = [];
		try { await chat.dispose?.(); } catch (error) { errors.push(error); }
		try { await scope.dispose(); } catch (error) { errors.push(error); }
		try { await disposeCatalog(); } catch (error) { errors.push(error); }
		if (errors.length) throw new AggregateError(errors, "Core Web product cleanup failed");
	};
}
