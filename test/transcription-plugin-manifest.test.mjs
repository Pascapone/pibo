import assert from "node:assert/strict";
import test from "node:test";
import {
	CHATGPT_TRANSCRIPTION_PLUGIN_ID,
	OPENAI_TRANSCRIPTION_PLUGIN_ID,
	openAiChatGptTranscriptionPackageManifest,
	openAiTranscriptionPackageManifest,
} from "../dist/plugins/default-packages.js";
import { OPENAI_CHATGPT_TRANSCRIPTION_PROVIDER_ID } from "../dist/transcription/openai-chatgpt.js";
import { OPENAI_TRANSCRIPTION_PROVIDER_ID } from "../dist/transcription/openai.js";

const CASES = [
	{
		pluginId: CHATGPT_TRANSCRIPTION_PLUGIN_ID,
		manifest: openAiChatGptTranscriptionPackageManifest,
		providerId: OPENAI_CHATGPT_TRANSCRIPTION_PROVIDER_ID,
	},
	{
		pluginId: OPENAI_TRANSCRIPTION_PLUGIN_ID,
		manifest: openAiTranscriptionPackageManifest,
		providerId: OPENAI_TRANSCRIPTION_PROVIDER_ID,
	},
];

for (const { pluginId, manifest, providerId } of CASES) {
	test(`transcription contribution of ${pluginId} is keyed by provider id`, () => {
		const built = manifest();
		assert.equal(built.id, pluginId);
		const contributions = built.contributions.filter((entry) => entry.kind === "transcription-provider");
		assert.equal(contributions.length, 1);
		// The capability projection keys transcription providers by contribution
		// name, so the name must equal the provider id used for transcribe().
		assert.equal(contributions[0]?.name, providerId);
	});
}
