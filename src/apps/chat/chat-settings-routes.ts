import { readPiboBasePrompt, savePiboCustomBasePrompt, setPiboBasePromptMode } from "../../core/base-prompt.js";
import { readPiboCompactionPrompt, savePiboCustomCompactionPrompt, setPiboCompactionPromptMode } from "../../core/compaction-prompt.js";
import {
	loadPiboGatewaySettings,
	sanitizeConcurrentYieldedRuns,
	updatePiboGatewaySettings,
} from "../../core/gateway-settings.js";
import { sanitizeTelemetryRetentionDays, sanitizeTelemetryRetentionSettings } from "../../core/telemetry-retention-settings.js";
import { loadPiboUserSettings, sanitizeShortcutSettings, sanitizeTimezone, sanitizeTranscriptionProviderId, updatePiboUserSettings, updateTelemetryRetentionLastPrunedAt } from "../../core/user-settings.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import { CHAT_WEB_API_PREFIX } from "./chat-api-routes.js";
import {
	normalizeBasePromptMarkdown,
	normalizeBasePromptMode,
	normalizeCompactionPromptMarkdown,
	normalizeCompactionPromptMode,
	updateChatModelDefaults,
	type ChatBasePromptBody,
	type ChatGatewaySettingsBody,
	type ChatModelDefaultsBody,
	type ChatTelemetryRetentionPruneBody,
	type ChatUserSettingsBody,
} from "./chat-request-normalizers.js";
import { pruneTelemetryOlderThan } from "./telemetry-retention-service.js";

export type ChatSettingsRoute =
	| { kind: "model-defaults" }
	| { kind: "user-settings"; action: "read" | "update" }
	| { kind: "gateway-settings"; action: "read" | "update" }
	| { kind: "telemetry-retention"; action: "prune" }
	| { kind: "base-prompt"; action: "read" | "set-mode" | "save-custom" }
	| { kind: "compaction-prompt"; action: "read" | "set-mode" | "save-custom" };

export function chatSettingsRoute(pathname: string, method: string): ChatSettingsRoute | undefined {
	if (pathname === `${CHAT_WEB_API_PREFIX}/model-defaults` && method === "PATCH") return { kind: "model-defaults" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/user-settings` && method === "GET") return { kind: "user-settings", action: "read" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/user-settings` && method === "PATCH") return { kind: "user-settings", action: "update" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/gateway-settings` && method === "GET") return { kind: "gateway-settings", action: "read" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/gateway-settings` && method === "PATCH") return { kind: "gateway-settings", action: "update" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/telemetry-retention/prune` && method === "POST") return { kind: "telemetry-retention", action: "prune" };
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
	dataStore?: import("../../data/pibo-store.js").PiboDataStore;
	transcriptionProviderIds?: readonly string[];
	speechProviderIds?: readonly string[];
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
		return responseJson({
			userSettings: updatePiboUserSettings(userSettingsPatch(body, input.transcriptionProviderIds, input.speechProviderIds)),
		});
	}

	if (route.kind === "gateway-settings") {
		if (route.action === "read") return responseJson({ gatewaySettings: loadPiboGatewaySettings() });
		const body = await readJsonBody<ChatGatewaySettingsBody>(request);
		return responseJson({ gatewaySettings: updatePiboGatewaySettings(gatewaySettingsPatch(body)) });
	}

	if (route.kind === "telemetry-retention") {
		if (!input.dataStore) throw new PiboWebHttpError("Telemetry retention store unavailable", 503);
		const body = await readJsonBody<ChatTelemetryRetentionPruneBody>(request);
		const days = sanitizeTelemetryRetentionDays(body.days);
		if (!days) throw new PiboWebHttpError("Invalid telemetry retention days", 400);
		const result = pruneTelemetryOlderThan({ dataStore: input.dataStore, days, apply: body.dryRun !== true });
		if (result.applied) updateTelemetryRetentionLastPrunedAt(new Date().toISOString());
		return responseJson({ telemetryRetention: result });
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

function gatewaySettingsPatch(body: ChatGatewaySettingsBody): Parameters<typeof updatePiboGatewaySettings>[0] {
	const patch: Parameters<typeof updatePiboGatewaySettings>[0] = {};
	if (body.maxConcurrentYieldedRuns !== undefined) {
		const value = sanitizeConcurrentYieldedRuns(body.maxConcurrentYieldedRuns);
		if (!value) throw new PiboWebHttpError("Invalid gateway yielded-run concurrency", 400);
		patch.maxConcurrentYieldedRuns = value;
	}
	if (body.sessionConcurrentYieldedRuns !== undefined) {
		const value = sanitizeConcurrentYieldedRuns(body.sessionConcurrentYieldedRuns);
		if (!value) throw new PiboWebHttpError("Invalid session yielded-run concurrency", 400);
		patch.sessionConcurrentYieldedRuns = value;
	}
	if (Object.keys(patch).length === 0) throw new PiboWebHttpError("No gateway settings provided", 400);
	return patch;
}

function userSettingsPatch(
	body: ChatUserSettingsBody,
	transcriptionProviderIds?: readonly string[],
	speechProviderIds?: readonly string[],
): Parameters<typeof updatePiboUserSettings>[0] {
	const patch: Parameters<typeof updatePiboUserSettings>[0] = {};
	if (body.timezone !== undefined) {
		const timezone = sanitizeTimezone(body.timezone);
		if (!timezone) throw new PiboWebHttpError("Invalid timezone", 400);
		patch.timezone = timezone;
	}
	if (body.shortcuts !== undefined) patch.shortcuts = sanitizeShortcutSettings(body.shortcuts);
	if (body.transcription !== undefined) {
		const raw = body.transcription && typeof body.transcription === "object" && !Array.isArray(body.transcription)
			? body.transcription as Record<string, unknown>
			: {};
		const providerId = sanitizeTranscriptionProviderId(raw.providerId);
		if (!providerId) throw new PiboWebHttpError("Invalid transcription provider", 400);
		if (transcriptionProviderIds && !transcriptionProviderIds.includes(providerId)) {
			throw new PiboWebHttpError(`Unknown transcription provider "${providerId}"`, 400);
		}
		patch.transcription = { providerId };
	}
	if (body.speech !== undefined) {
		const raw = body.speech && typeof body.speech === "object" && !Array.isArray(body.speech)
			? body.speech as Record<string, unknown>
			: {};
		const providerId = sanitizeTranscriptionProviderId(raw.providerId);
		if (!providerId) throw new PiboWebHttpError("Invalid speech provider", 400);
		if (speechProviderIds && !speechProviderIds.includes(providerId)) {
			throw new PiboWebHttpError(`Unknown speech provider "${providerId}"`, 400);
		}
		patch.speech = { providerId };
	}
	if (body.telemetryRetention !== undefined) {
		const current = loadPiboUserSettings().telemetryRetention;
		patch.telemetryRetention = {
			...sanitizeTelemetryRetentionSettings(body.telemetryRetention),
			...(current.lastPrunedAt ? { lastPrunedAt: current.lastPrunedAt } : {}),
		};
	}
	return patch;
}
