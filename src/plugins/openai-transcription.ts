import {
	createOpenAiTranscriptionProvider,
	type OpenAiTranscriptionProviderOptions,
} from "../transcription/openai.js";
import { definePiboPlugin } from "./registry.js";

export function createPiboOpenAiTranscriptionPlugin(options: OpenAiTranscriptionProviderOptions = {}) {
	return definePiboPlugin({
		id: "pibo.transcription.openai",
		name: "OpenAI Transcription",
		register(api) {
			api.registerTranscriptionProvider(createOpenAiTranscriptionProvider(options));
		},
	});
}

export const piboOpenAiTranscriptionPlugin = createPiboOpenAiTranscriptionPlugin();
