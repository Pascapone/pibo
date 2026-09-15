import type { PluginSetupContext } from "./host.js";
import {
	PIBO_CHAT_EXTENSION_SERVICE,
	type PiboChatExtensionService,
} from "./product-services.js";
import { responseJson } from "../web/http.js";

export const VSCODE_WEB_INTEGRATION_API = "/api/chat/vscode-web";

export type VscodeWebIntegration = {
	url: string;
	workspaceRoot?: string;
};

export function resolveVscodeWebUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	const origin = "https://pibo.invalid";
	try {
		const url = new URL(trimmed, origin);
		if (url.origin === origin && trimmed.startsWith("/") && !trimmed.startsWith("//") && !url.username && !url.password) {
			return `${url.pathname}${url.search}${url.hash}`;
		}
	} catch {}
	throw new Error("VS Code Web URL must be a same-origin absolute path beginning with /");
}

export function setupVscodeWeb(context: PluginSetupContext): () => void {
	context.register("view", {});
	const chatExtensions = context.services.require<PiboChatExtensionService>(PIBO_CHAT_EXTENSION_SERVICE);
	const disposeRoute = chatExtensions.registerApiRoute(({ request }) => {
		const url = new URL(request.url);
		if (url.pathname !== VSCODE_WEB_INTEGRATION_API) return undefined;
		if (request.method !== "GET") return responseJson({ error: "Method not allowed" }, { status: 405 });
		const integrationUrl = resolveVscodeWebUrl(process.env.PIBO_VSCODE_WEB_URL);
		const workspaceRoot = process.env.PIBO_VSCODE_WEB_WORKSPACE_ROOT?.trim();
		return responseJson({
			integration: integrationUrl
				? { url: integrationUrl, ...(workspaceRoot ? { workspaceRoot } : {}) } satisfies VscodeWebIntegration
				: null,
		});
	});
	return disposeRoute;
}
