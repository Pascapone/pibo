import { InitialSessionContextBuilder } from "../../dist/core/profiles.js";
import { definePiboCoreContributions } from "../../dist/plugins/builtin.js";
import { createOpenAiChatGptTranscriptionProvider } from "../../dist/transcription/openai-chatgpt.js";
import { createOpenAiTranscriptionProvider } from "../../dist/transcription/openai.js";
import { definePiboPlugin, PiboPluginRegistry } from "../../dist/plugins/registry.js";

/** Test-only bridge for low-level registry tests; production products install ordinary host packages. */
export const piboCorePlugin = definePiboPlugin({
	id: "test.pibo-core-legacy-fixture",
	name: "Pibo Core Test Fixture",
	register(api) {
		definePiboCoreContributions({
			addSkill: (skill) => api.registerSkill(skill),
			addGatewayAction: (action) => api.registerGatewayAction(action),
		});
	},
});

const transcriptionPlugin = definePiboPlugin({
	id: "test.pibo-transcription-legacy-fixture",
	name: "Pibo Transcription Test Fixture",
	register(api) {
		api.registerTranscriptionProvider(createOpenAiChatGptTranscriptionProvider());
		api.registerTranscriptionProvider(createOpenAiTranscriptionProvider());
	},
});

const gatewayProducerPlugin = definePiboPlugin({
	id: "test.pibo-gateway-producer-legacy-fixture",
	name: "Pibo Gateway Producer Test Fixture",
	register(api) {
		api.registerProfile({
			name: "pibo-gateway-producer",
			aliases: ["gateway-producer"],
			create(context) {
				return new InitialSessionContextBuilder("pibo-gateway-producer")
					.withToolPackages({ goalControl: true })
					.addSkill(context.getSkill("pi-agent-harness"))
					.addTools(context.getTools(["pibo_gateway_send"]))
					.createSession();
			},
		});
	},
});

export function createDefaultPiboPluginRegistry() {
	return PiboPluginRegistry.create({ plugins: [piboCorePlugin, transcriptionPlugin] });
}

export function createGatewayProducerPiboPluginRegistry() {
	return PiboPluginRegistry.create({ plugins: [piboCorePlugin, gatewayProducerPlugin, transcriptionPlugin] });
}
