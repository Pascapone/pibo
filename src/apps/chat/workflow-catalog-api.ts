import type { PiboChatApiRouteInput, PiboWorkflowCatalogQuery } from "../../plugins/product-services.js";
import { responseJson } from "../../web/http.js";
import { CHAT_WEB_API_PREFIX, workflowVersionResource } from "./chat-api-routes.js";
import { buildWorkflowCatalogList, buildWorkflowVersionList } from "./workflow-catalog.js";

/** First plugin-served workflow read slice. Other routes deliberately fall
 * through to the existing Core handlers until their owner moves. */
export function handleWorkflowCatalogReadApiRequest(
	input: PiboChatApiRouteInput,
	catalog: PiboWorkflowCatalogQuery,
): Response | undefined {
	if (input.request.method !== "GET") return undefined;
	const url = new URL(input.request.url);
	const includeArchived = url.searchParams.get("includeArchived") === "true" || url.searchParams.get("archived") === "true";
	if (url.pathname === `${CHAT_WEB_API_PREFIX}/workflows`) {
		return responseJson(buildWorkflowCatalogList(catalog.state, input.context, input.webSession, catalog.services, { includeArchived }));
	}
	const resource = workflowVersionResource(url.pathname);
	// Version inspection includes a fresh validation timestamp in its body;
	// leave it entirely on the existing Core path in this read-list slice.
	if (!resource || resource.version) return undefined;
	return responseJson(buildWorkflowVersionList(catalog.state, input.context, input.webSession, catalog.services, resource.workflowId, { includeArchived }));
}
