import { requestJson } from "./api-http";

export type TranscriptionProvider = {
	id: string;
	name: string;
	description?: string;
	configured: boolean;
	pluginId?: string;
	pluginName?: string;
};

export type TranscriptionProviderCatalog = {
	providers: TranscriptionProvider[];
	selectedProviderId: string;
};

export type ChatTranscriptionResult = {
	providerId: string;
	text: string;
	model?: string;
};

export async function getTranscriptionProviders(): Promise<TranscriptionProviderCatalog> {
	return await requestJson<TranscriptionProviderCatalog>("/api/chat/transcription/providers");
}

export async function transcribeChatAudio(file: File): Promise<ChatTranscriptionResult> {
	const form = new FormData();
	form.append("file", file, file.name);
	const response = await fetch("/api/chat/transcription", {
		method: "POST",
		body: form,
	});
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message = payload && typeof payload === "object" && "error" in payload
			? String(payload.error)
			: "Transcription failed";
		throw new Error(message);
	}
	return (payload as { transcription: ChatTranscriptionResult }).transcription;
}
