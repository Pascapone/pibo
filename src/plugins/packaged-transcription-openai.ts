import { createOpenAiTranscriptionProvider } from "../transcription/openai.js";
import type { PluginSetupContext } from "./host.js";

export function setupOpenAiTranscription(context: PluginSetupContext): void {
	context.register("provider", createOpenAiTranscriptionProvider());
}
