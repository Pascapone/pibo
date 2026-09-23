import { handleWorkflowCatalogReadApiRequest } from "../apps/chat/workflow-catalog-api.js";
import type { PluginSetupContext } from "./host.js";
import {
	PIBO_CHAT_EXTENSION_SERVICE,
	PIBO_WORKFLOW_CATALOG_QUERY_SERVICE,
	type PiboChatExtensionService,
	type PiboWorkflowCatalogQuery,
} from "./product-services.js";

export function setupWorkflows(context: PluginSetupContext): void | (() => void) {
	context.register("view", {});
	// Headless installations retain their view contribution. The optional
	// borrowed query exists only when Core provisions the Chat Web app.
	const catalog = context.services.get<PiboWorkflowCatalogQuery>(PIBO_WORKFLOW_CATALOG_QUERY_SERVICE);
	if (!catalog) return;
	const chatExtensions = context.services.require<PiboChatExtensionService>(PIBO_CHAT_EXTENSION_SERVICE);
	return chatExtensions.registerApiRoute((input) => handleWorkflowCatalogReadApiRequest(input, catalog));
}
