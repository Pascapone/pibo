import {
	readPiCredential,
	resolvePiProviderAuth,
} from "../agent-runtimes/pi/credentials.js";
import {
	PiboTranscriptionError,
	type PiboTranscriptionProvider,
} from "./types.js";

export const OPENAI_CHATGPT_TRANSCRIPTION_PROVIDER_ID = "openai-chatgpt";
export const OPENAI_CODEX_AUTH_PROVIDER_ID = "openai-codex";
export const DEFAULT_OPENAI_CHATGPT_TRANSCRIPTION_URL = "https://chatgpt.com/backend-api/transcribe";
export const DEFAULT_OPENAI_CHATGPT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export type OpenAiChatGptTranscriptionAuth = {
	accessToken: string;
	accountId?: string;
};

export type OpenAiChatGptTranscriptionProviderOptions = {
	url?: string;
	fetch?: typeof fetch;
	getAuth?: () => Promise<OpenAiChatGptTranscriptionAuth | undefined>;
	isConfigured?: () => boolean | Promise<boolean>;
};

export function createOpenAiChatGptTranscriptionProvider(
	options: OpenAiChatGptTranscriptionProviderOptions = {},
): PiboTranscriptionProvider {
	const url = options.url ?? DEFAULT_OPENAI_CHATGPT_TRANSCRIPTION_URL;
	const fetchImpl = options.fetch ?? fetch;
	const getAuth = options.getAuth ?? resolveOpenAiChatGptTranscriptionAuth;
	const isConfigured = options.isConfigured ?? hasOpenAiCodexOAuthCredential;

	return {
		id: OPENAI_CHATGPT_TRANSCRIPTION_PROVIDER_ID,
		name: "ChatGPT Subscription",
		description: "Uses the existing OpenAI Codex OAuth login and ChatGPT subscription through Codex's transcription path.",
		isConfigured,
		async transcribe(input) {
			if (input.audio.bytes.byteLength === 0) {
				throw new PiboTranscriptionError("The audio recording is empty.", "invalid_audio");
			}

			let auth: OpenAiChatGptTranscriptionAuth | undefined;
			try {
				auth = await getAuth();
			} catch (error) {
				throw new PiboTranscriptionError(
					"ChatGPT Subscription authentication could not be loaded. Sign in again under Settings → Providers.",
					"not_configured",
					{ cause: error },
				);
			}
			if (!auth?.accessToken) {
				throw new PiboTranscriptionError(
					"ChatGPT Subscription authentication is not configured. Sign in to OpenAI (ChatGPT Plus/Pro) under Settings → Providers.",
					"not_configured",
				);
			}

			const form = new FormData();
			const audioBytes = input.audio.bytes.slice().buffer;
			const audio = new Blob([audioBytes], { type: input.audio.mimeType || "application/octet-stream" });
			form.append("file", audio, input.audio.filename);

			const headers: Record<string, string> = {
				Authorization: `Bearer ${auth.accessToken}`,
				Origin: "https://chatgpt.com",
				Referer: "https://chatgpt.com/",
				"User-Agent": chatGptUserAgent(input.clientUserAgent),
			};
			if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

			let response: Response;
			try {
				response = await fetchImpl(url, {
					method: "POST",
					headers,
					body: form,
				});
			} catch (error) {
				throw new PiboTranscriptionError("ChatGPT subscription transcription request failed.", "provider_error", { cause: error });
			}

			const responseText = await response.text().catch(() => "");
			const payload = parseJsonObject(responseText);
			if (!response.ok) {
				const detail = transcriptionErrorMessage(payload, responseText);
				const loginGuidance = response.status === 401
					? " Sign in again under Settings → Providers."
					: "";
				throw new PiboTranscriptionError(
					`ChatGPT subscription transcription request failed (${response.status})${detail ? `: ${detail}` : "."}${loginGuidance}`,
					"provider_error",
				);
			}

			const text = transcriptionText(payload);
			if (!text) {
				throw new PiboTranscriptionError("ChatGPT returned an empty transcription.", "provider_error");
			}
			return { text };
		},
	};
}

async function hasOpenAiCodexOAuthCredential(): Promise<boolean> {
	return (await readPiCredential(OPENAI_CODEX_AUTH_PROVIDER_ID))?.type === "oauth";
}

async function resolveOpenAiChatGptTranscriptionAuth(): Promise<OpenAiChatGptTranscriptionAuth | undefined> {
	const credential = await readPiCredential(OPENAI_CODEX_AUTH_PROVIDER_ID);
	if (credential?.type !== "oauth") return undefined;
	const resolvedAuth = await resolvePiProviderAuth(OPENAI_CODEX_AUTH_PROVIDER_ID);
	const accessToken = resolvedAuth?.auth.apiKey;
	if (!accessToken) return undefined;
	return {
		accessToken,
		accountId: getOpenAiAccountId(accessToken, credential.accountId),
	};
}

function chatGptUserAgent(value: string | undefined): string {
	const userAgent = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return userAgent && userAgent.length <= 512 && /\bMozilla\/5\.0\b/.test(userAgent)
		? userAgent
		: DEFAULT_OPENAI_CHATGPT_USER_AGENT;
}

function getOpenAiAccountId(accessToken: string, storedAccountId: unknown): string | undefined {
	if (typeof storedAccountId === "string" && storedAccountId.trim()) return storedAccountId.trim();
	const payload = decodeJwtPayload(accessToken);
	const auth = payload?.["https://api.openai.com/auth"];
	if (!auth || typeof auth !== "object" || Array.isArray(auth)) return undefined;
	const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

function transcriptionText(payload: Record<string, unknown> | undefined): string | undefined {
	const text = payload?.text;
	return typeof text === "string" && text.trim() ? text.trim() : undefined;
}

function transcriptionErrorMessage(payload: Record<string, unknown> | undefined, responseText: string): string | undefined {
	const error = payload?.error;
	const message = error && typeof error === "object" && !Array.isArray(error)
		? (error as Record<string, unknown>).message
		: undefined;
	const candidate = typeof message === "string"
		? message
		: typeof payload?.detail === "string"
			? payload.detail
			: responseText.trimStart().startsWith("<")
				? "ChatGPT rejected the request at its web boundary."
				: responseText;
	const normalized = candidate.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 300) : undefined;
}
