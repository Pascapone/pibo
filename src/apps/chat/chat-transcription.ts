import { basename } from "node:path";
import { loadPiboUserSettings } from "../../core/user-settings.js";
import {
	PiboTranscriptionError,
	type PiboTranscriptionProviderInfo,
	type PiboTranscriptionResult,
} from "../../transcription/types.js";
import { PiboWebHttpError, responseJson } from "../../web/http.js";
import type { PiboWebAppContext } from "../../web/types.js";

export const CHAT_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;

export async function responseChatTranscriptionProviders(context: PiboWebAppContext): Promise<Response> {
	const providers = await requireProviderInfos(context);
	return responseJson({
		providers,
		selectedProviderId: loadPiboUserSettings().transcription.providerId,
	});
}

export async function responseChatTranscription(request: Request, context: PiboWebAppContext): Promise<Response> {
	const transcribe = context.channelContext.transcribe;
	if (!transcribe) throw new PiboWebHttpError("Transcription is not available", 503);

	const providerId = loadPiboUserSettings().transcription.providerId;
	const providers = await requireProviderInfos(context);
	if (!providers.some((provider) => provider.id === providerId)) {
		throw new PiboWebHttpError(`Transcription provider "${providerId}" is not registered`, 409);
	}

	const audio = await readTranscriptionAudio(request);
	let result: PiboTranscriptionResult;
	try {
		result = await transcribe(providerId, audio);
	} catch (error) {
		if (error instanceof PiboTranscriptionError) {
			throw new PiboWebHttpError(error.message, transcriptionErrorStatus(error));
		}
		throw new PiboWebHttpError(error instanceof Error ? error.message : "Transcription failed", 502);
	}
	return responseJson({ transcription: result });
}

async function requireProviderInfos(context: PiboWebAppContext): Promise<PiboTranscriptionProviderInfo[]> {
	const getProviderInfos = context.channelContext.getTranscriptionProviderInfos;
	if (!getProviderInfos) throw new PiboWebHttpError("Transcription providers are not available", 503);
	return await getProviderInfos();
}

async function readTranscriptionAudio(request: Request) {
	const form = await request.formData();
	const file = form.get("file");
	if (!isUploadedAudioFile(file)) throw new PiboWebHttpError("An audio file is required", 400);
	if (file.size === 0) throw new PiboWebHttpError("The audio recording is empty", 400);
	if (file.size > CHAT_TRANSCRIPTION_MAX_BYTES) {
		throw new PiboWebHttpError("The audio recording exceeds the 25 MiB limit", 413);
	}
	const filename = sanitizeAudioFilename(file.name);
	return {
		audio: {
			bytes: new Uint8Array(await file.arrayBuffer()),
			filename,
			mimeType: file.type || "application/octet-stream",
		},
		clientUserAgent: sanitizeClientUserAgent(request.headers.get("user-agent")),
	};
}

type UploadedAudioFile = {
	name: string;
	size: number;
	type: string;
	arrayBuffer(): Promise<ArrayBuffer>;
};

function isUploadedAudioFile(value: unknown): value is UploadedAudioFile {
	return typeof value === "object"
		&& value !== null
		&& typeof (value as { name?: unknown }).name === "string"
		&& typeof (value as { size?: unknown }).size === "number"
		&& typeof (value as { type?: unknown }).type === "string"
		&& typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function";
}

function sanitizeAudioFilename(value: string): string {
	const filename = basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return filename && !/^\.+$/.test(filename) ? filename : `recording-${Date.now()}.webm`;
}

function sanitizeClientUserAgent(value: string | null): string | undefined {
	if (!value) return undefined;
	const userAgent = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return userAgent ? userAgent.slice(0, 512) : undefined;
}

function transcriptionErrorStatus(error: PiboTranscriptionError): number {
	if (error.code === "invalid_audio") return 400;
	if (error.code === "not_configured") return 409;
	return 502;
}
