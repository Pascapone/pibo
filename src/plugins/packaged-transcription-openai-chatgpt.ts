import { createOpenAiChatGptTranscriptionProvider } from "../transcription/openai-chatgpt.js";
import type { PluginSetupContext } from "./host.js";

export function setupOpenAiChatGptTranscription(context: PluginSetupContext): void {
	context.register("provider", createOpenAiChatGptTranscriptionProvider());
}
