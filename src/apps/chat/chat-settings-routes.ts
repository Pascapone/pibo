import { readPiboBasePrompt, savePiboCustomBasePrompt, setPiboBasePromptMode } from "../../core/base-prompt.js";
import { readPiboCompactionPrompt, savePiboCustomCompactionPrompt, setPiboCompactionPromptMode } from "../../core/compaction-prompt.js";
import { loadPiboUserSettings, sanitizeShortcutSettings, sanitizeTimezone, updatePiboUserSettings } from "../../core/user-settings.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import { CHAT_WEB_API_PREFIX } from "./chat-api-routes.js";
import {
	normalizeBasePromptMarkdown,
	normalizeBasePromptMode,
	normalizeCompactionPromptMarkdown,
	normalizeCompactionPromptMode,
	updateChatModelDefaults,
	type ChatBasePromptBody,
	type ChatModelDefaultsBody,
	type ChatUserSettingsBody,
} from "./chat-request-normalizers.js";

export type ChatSettingsRoute =
	| { kind: "model-defaults" }
	| { kind: "user-settings"; action: "read" | "update" }
	| { kind: "base-prompt"; action: "read" | "set-mode" | "save-custom" }
	| { kind: "compaction-prompt"; action: "read" | "set-mode" | "save-custom" };

export function chatSettingsRoute(pathname: string, method: string): ChatSettingsRoute | undefined {
	if (pathname === `${CHAT_WEB_API_PREFIX}/model-defaults` && method === "PATCH") return { kind: "model-defaults" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/user-settings` && method === "GET") return { kind: "user-settings", action: "read" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/user-settings` && method === "PATCH") return { kind: "user-settings", action: "update" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/base-prompt` && method === "GET") return { kind: "base-prompt", action: "read" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/base-prompt` && method === "PATCH") return { kind: "base-prompt", action: "set-mode" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/base-prompt/custom` && method === "PUT") return { kind: "base-prompt", action: "save-custom" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/compaction-prompt` && method === "GET") return { kind: "compaction-prompt", action: "read" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/compaction-prompt` && method === "PATCH") return { kind: "compaction-prompt", action: "set-mode" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/compaction-prompt/custom` && method === "PUT") return { kind: "compaction-prompt", action: "save-custom" };
	return undefined;
}

export function chatSettingsRouteRequiresSameOrigin(route: ChatSettingsRoute): boolean {
	return route.kind === "model-defaults" || route.action !== "read";
}

export function chatSettingsRouteInvalidatesBootstrapCatalog(route: ChatSettingsRoute): boolean {
	return route.kind === "model-defaults";
}

export async function handleChatSettingsRoute(input: {
	route: ChatSettingsRoute;
	request: Request;
	cwd?: string;
}): Promise<Response> {
	const cwd = input.cwd ?? process.cwd();
	const { route, request } = input;

	if (route.kind === "model-defaults") {
		const body = await readJsonBody<ChatModelDefaultsBody>(request);
		return responseJson({ modelDefaults: updateChatModelDefaults(body, cwd) });
	}

	if (route.kind === "user-settings") {
		if (route.action === "read") return responseJson({ userSettings: loadPiboUserSettings() });
		const body = await readJsonBody<ChatUserSettingsBody>(request);
		return responseJson({ userSettings: updatePiboUserSettings(userSettingsPatch(body)) });
	}

	if (route.kind === "base-prompt") {
		if (route.action === "read") return responseJson({ basePrompt: await readPiboBasePrompt(cwd) });
		const body = await readJsonBody<ChatBasePromptBody>(request);
		if (route.action === "set-mode") {
			return responseJson({ basePrompt: setPiboBasePromptMode(normalizeBasePromptMode(body.mode), cwd) });
		}
		return responseJson({ basePrompt: await savePiboCustomBasePrompt(normalizeBasePromptMarkdown(body.markdown), cwd) });
	}

	if (route.action === "read") return responseJson({ compactionPrompt: await readPiboCompactionPrompt(cwd) });
	const body = await readJsonBody<ChatBasePromptBody>(request);
	if (route.action === "set-mode") {
		return responseJson({ compactionPrompt: setPiboCompactionPromptMode(normalizeCompactionPromptMode(body.mode), cwd) });
	}
	return responseJson({ compactionPrompt: await savePiboCustomCompactionPrompt(normalizeCompactionPromptMarkdown(body.markdown), cwd) });
}

function userSettingsPatch(body: ChatUserSettingsBody): Parameters<typeof updatePiboUserSettings>[0] {
	const patch: Parameters<typeof updatePiboUserSettings>[0] = {};
	if (body.timezone !== undefined) {
		const timezone = sanitizeTimezone(body.timezone);
		if (!timezone) throw new PiboWebHttpError("Invalid timezone", 400);
		patch.timezone = timezone;
	}
	if (body.shortcuts !== undefined) patch.shortcuts = sanitizeShortcutSettings(body.shortcuts);
	return patch;
}
