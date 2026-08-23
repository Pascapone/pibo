import {
	createOpenAiChatGptTranscriptionProvider,
	type OpenAiChatGptTranscriptionProviderOptions,
} from "../transcription/openai-chatgpt.js";
import { definePiboPlugin } from "./registry.js";

export function createPiboOpenAiChatGptTranscriptionPlugin(options: OpenAiChatGptTranscriptionProviderOptions = {}) {
	return definePiboPlugin({
		id: "pibo.transcription.openai-chatgpt",
		name: "ChatGPT Subscription Transcription",
		register(api) {
			api.registerTranscriptionProvider(createOpenAiChatGptTranscriptionProvider(options));
		},
	});
}

export const piboOpenAiChatGptTranscriptionPlugin = createPiboOpenAiChatGptTranscriptionPlugin();
