import { createOpenAiChatGptTranscriptionProvider } from "../transcription/openai-chatgpt.js";
import { createOpenAiTranscriptionProvider } from "../transcription/openai.js";
import type { PluginSetupContext } from "./host.js";

export function setupOpenAiChatGptTranscription(context: PluginSetupContext): void {
	context.register("provider", createOpenAiChatGptTranscriptionProvider());
}

export function setupOpenAiTranscription(context: PluginSetupContext): void {
	context.register("provider", createOpenAiTranscriptionProvider());
}
