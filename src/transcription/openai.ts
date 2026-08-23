import { getPiProviderAuthStatus, resolvePiProviderAuth } from "../agent-runtimes/pi/credentials.js";
import {
	PiboTranscriptionError,
	type PiboTranscriptionProvider,
} from "./types.js";

export const OPENAI_TRANSCRIPTION_PROVIDER_ID = "openai-api";
export const OPENAI_API_CREDENTIAL_PROVIDER_ID = "openai";
export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";

export type OpenAiTranscriptionProviderOptions = {
	model?: string;
	url?: string;
	fetch?: typeof fetch;
	getApiKey?: () => Promise<string | undefined>;
	isConfigured?: () => boolean | Promise<boolean>;
};

export function createOpenAiTranscriptionProvider(
	options: OpenAiTranscriptionProviderOptions = {},
): PiboTranscriptionProvider {
	const model = options.model ?? DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
	const url = options.url ?? DEFAULT_OPENAI_TRANSCRIPTION_URL;
	const fetchImpl = options.fetch ?? fetch;
	const getApiKey = options.getApiKey ?? (async () => (await resolvePiProviderAuth(OPENAI_API_CREDENTIAL_PROVIDER_ID))?.auth.apiKey);
	const isConfigured = options.isConfigured ?? (async () => (await getPiProviderAuthStatus(OPENAI_API_CREDENTIAL_PROVIDER_ID)).configured);

	return {
		id: OPENAI_TRANSCRIPTION_PROVIDER_ID,
		name: "OpenAI API",
		description: `Official OpenAI Audio Transcriptions API using ${model}.`,
		isConfigured,
		async transcribe(input) {
			if (input.audio.bytes.byteLength === 0) {
				throw new PiboTranscriptionError("The audio recording is empty.", "invalid_audio");
			}
			const apiKey = await getApiKey();
			if (!apiKey) {
				throw new PiboTranscriptionError(
					"OpenAI API authentication is not configured. Add an OpenAI API key in Settings → Providers.",
					"not_configured",
				);
			}

			const form = new FormData();
			const audioBytes = input.audio.bytes.slice().buffer;
			const audio = new Blob([audioBytes], { type: input.audio.mimeType || "application/octet-stream" });
			form.append("file", audio, input.audio.filename);
			form.append("model", model);

			let response: Response;
			try {
				response = await fetchImpl(url, {
					method: "POST",
					headers: { Authorization: `Bearer ${apiKey}` },
					body: form,
				});
			} catch (error) {
				throw new PiboTranscriptionError("OpenAI transcription request failed.", "provider_error", { cause: error });
			}

			const payload = await response.json().catch(() => undefined);
			if (!response.ok) {
				const detail = transcriptionErrorMessage(payload);
				throw new PiboTranscriptionError(
					`OpenAI transcription request failed (${response.status})${detail ? `: ${detail}` : "."}`,
					"provider_error",
				);
			}
			const text = transcriptionText(payload);
			if (!text) {
				throw new PiboTranscriptionError("OpenAI returned an empty transcription.", "provider_error");
			}
			return { text, model };
		},
	};
}

function transcriptionText(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const text = (payload as Record<string, unknown>).text;
	return typeof text === "string" && text.trim() ? text.trim() : undefined;
}

function transcriptionErrorMessage(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const error = (payload as Record<string, unknown>).error;
	const message = error && typeof error === "object" && !Array.isArray(error)
		? (error as Record<string, unknown>).message
		: undefined;
	if (typeof message !== "string") return undefined;
	const normalized = message.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 300) : undefined;
}
