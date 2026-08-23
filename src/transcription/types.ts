export type PiboTranscriptionAudio = {
	bytes: Uint8Array;
	filename: string;
	mimeType: string;
};

export type PiboTranscriptionRequest = {
	audio: PiboTranscriptionAudio;
	clientUserAgent?: string;
};

export type PiboTranscriptionResult = {
	providerId: string;
	text: string;
	model?: string;
};

export type PiboTranscriptionProviderInfo = {
	id: string;
	name: string;
	description?: string;
	configured: boolean;
	pluginId?: string;
	pluginName?: string;
};

export type PiboTranscriptionProvider = {
	id: string;
	name: string;
	description?: string;
	pluginId?: string;
	isConfigured?(): boolean | Promise<boolean>;
	transcribe(input: PiboTranscriptionRequest): Promise<Omit<PiboTranscriptionResult, "providerId">>;
};

export type PiboTranscriptionErrorCode = "not_configured" | "invalid_audio" | "provider_error";

export class PiboTranscriptionError extends Error {
	constructor(
		message: string,
		readonly code: PiboTranscriptionErrorCode,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "PiboTranscriptionError";
	}
}
