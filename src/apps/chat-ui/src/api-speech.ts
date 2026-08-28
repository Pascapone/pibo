export type SpeechProvider = {
	id: string;
	name: string;
	description?: string;
	configured: boolean;
	pluginId?: string;
	pluginName?: string;
};

export type SpeechProviderCatalog = {
	providers: SpeechProvider[];
	selectedProviderId: string;
};

export type ChatSpeechSession = {
	providerId: string;
	sessionId: string;
	answerSdp: string;
};

export async function getSpeechProviders(): Promise<SpeechProviderCatalog> {
	const response = await fetch("/api/chat/speech/providers");
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) throw new Error(errorMessage(payload, "Could not load speech providers"));
	return payload as SpeechProviderCatalog;
}

export async function startChatSpeechSession(
	offerSdp: string,
	text: string,
	signal?: AbortSignal,
): Promise<ChatSpeechSession> {
	const response = await fetch("/api/chat/speech/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ offerSdp, text }),
		signal,
	});
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) throw new Error(errorMessage(payload, "Speech session failed to start"));
	return (payload as { speechSession: ChatSpeechSession }).speechSession;
}

export async function speakChatSpeech(sessionId: string, text: string, signal?: AbortSignal): Promise<void> {
	const response = await fetch(`/api/chat/speech/sessions/${encodeURIComponent(sessionId)}/speak`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
		signal,
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		throw new Error(errorMessage(payload, "Speech synthesis failed"));
	}
}

export async function stopChatSpeechSession(sessionId: string): Promise<void> {
	const response = await fetch(`/api/chat/speech/sessions/${encodeURIComponent(sessionId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		throw new Error(errorMessage(payload, "Speech session could not be stopped"));
	}
}

function errorMessage(payload: unknown, fallback: string): string {
	return payload && typeof payload === "object" && "error" in payload
		? String((payload as { error: unknown }).error)
		: fallback;
}
