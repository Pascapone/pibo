import { loadPiboUserSettings } from "../../core/user-settings.js";
import {
	PiboSpeechError,
	type PiboSpeechProviderInfo,
} from "../../speech/types.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import type { PiboWebAppContext } from "../../web/types.js";

export const CHAT_SPEECH_MAX_CHARACTERS = 32_000;
export const CHAT_SPEECH_MAX_OFFER_CHARACTERS = 256_000;

export async function responseChatSpeechProviders(context: PiboWebAppContext): Promise<Response> {
	const providers = await requireProviderInfos(context);
	return responseJson({
		providers,
		selectedProviderId: loadPiboUserSettings().speech.providerId,
	});
}

export async function responseChatSpeechSessionStart(request: Request, context: PiboWebAppContext): Promise<Response> {
	const startSpeechSession = context.channelContext.startSpeechSession;
	if (!startSpeechSession) throw new PiboWebHttpError("Speech synthesis is not available", 503);
	const providerId = loadPiboUserSettings().speech.providerId;
	const providers = await requireProviderInfos(context);
	if (!providers.some((provider) => provider.id === providerId)) {
		throw new PiboWebHttpError(`Speech provider "${providerId}" is not registered`, 409);
	}
	const body = await readJsonBody<{ offerSdp?: unknown; text?: unknown }>(request);
	if (typeof body.offerSdp !== "string" || !body.offerSdp.startsWith("v=0")) {
		throw new PiboWebHttpError("A WebRTC audio offer is required", 400);
	}
	if (body.offerSdp.length > CHAT_SPEECH_MAX_OFFER_CHARACTERS) {
		throw new PiboWebHttpError("The WebRTC audio offer is too large", 413);
	}
	const text = requireSpeechText(body.text);
	let speechSession: Awaited<ReturnType<typeof startSpeechSession>> | undefined;
	try {
		speechSession = await startSpeechSession(providerId, { offerSdp: body.offerSdp, text }, { signal: request.signal });
		if (request.signal.aborted) throw request.signal.reason;
		return responseJson({ speechSession }, { status: 201 });
	} catch (error) {
		if (speechSession) await context.channelContext.stopSpeechSession?.(speechSession.sessionId).catch(() => {});
		throw speechHttpError(error, "Speech session failed to start");
	}
}

export async function responseChatSpeechSessionSpeak(
	request: Request,
	context: PiboWebAppContext,
	sessionId: string,
): Promise<Response> {
	const speakSpeechSession = context.channelContext.speakSpeechSession;
	if (!speakSpeechSession) throw new PiboWebHttpError("Speech synthesis is not available", 503);
	const body = await readJsonBody<{ text?: unknown }>(request);
	const text = requireSpeechText(body.text);
	try {
		await speakSpeechSession(sessionId, { text });
		return new Response(null, { status: 204 });
	} catch (error) {
		throw speechHttpError(error, "Speech synthesis failed");
	}
}

export async function responseChatSpeechSessionStop(
	context: PiboWebAppContext,
	sessionId: string,
): Promise<Response> {
	const stopSpeechSession = context.channelContext.stopSpeechSession;
	if (!stopSpeechSession) throw new PiboWebHttpError("Speech synthesis is not available", 503);
	try {
		await stopSpeechSession(sessionId);
		return new Response(null, { status: 204 });
	} catch (error) {
		throw speechHttpError(error, "Speech session could not be stopped");
	}
}

function requireSpeechText(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new PiboWebHttpError("Speech text is required", 400);
	}
	const text = value.trim();
	if (text.length > CHAT_SPEECH_MAX_CHARACTERS) {
		throw new PiboWebHttpError(`Speech text exceeds the ${CHAT_SPEECH_MAX_CHARACTERS.toLocaleString("en-US")} character limit`, 413);
	}
	return text;
}

async function requireProviderInfos(context: PiboWebAppContext): Promise<PiboSpeechProviderInfo[]> {
	const getProviderInfos = context.channelContext.getSpeechProviderInfos;
	if (!getProviderInfos) throw new PiboWebHttpError("Speech providers are not available", 503);
	return await getProviderInfos();
}

function speechHttpError(error: unknown, fallback: string): PiboWebHttpError {
	if (error instanceof PiboSpeechError) {
		if (error.code === "invalid_offer" || error.code === "invalid_text") return new PiboWebHttpError(error.message, 400);
		if (error.code === "session_not_found") return new PiboWebHttpError(error.message, 404);
		if (error.code === "not_configured") return new PiboWebHttpError(error.message, 409);
		if (error.code === "capacity_exceeded") return new PiboWebHttpError(error.message, 429);
		if (error.code === "aborted") return new PiboWebHttpError(error.message, 499);
		return new PiboWebHttpError(error.message, 502);
	}
	return new PiboWebHttpError(error instanceof Error ? error.message : fallback, 502);
}
