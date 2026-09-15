import { defineTestCapabilitySetup, createTestCapabilityHost } from "./capability-host.mjs";
import { InitialSessionContextBuilder } from "../../dist/core/profiles.js";
import { definePiboCoreContributions } from "../../dist/plugins/builtin.js";
import { createOpenAiChatGptTranscriptionProvider } from "../../dist/transcription/openai-chatgpt.js";
import { createOpenAiTranscriptionProvider } from "../../dist/transcription/openai.js";
import { PiboCapabilityHost } from "../../dist/core/capability-host.js";

/** Test-only bridge for low-level registry tests; production products install ordinary host packages. */
export const coreCapabilitiesSetup = defineTestCapabilitySetup({
	id: "test.pibo-core-legacy-fixture",
	name: "Pibo Core Test Fixture",
	register(api) {
		definePiboCoreContributions({
			addSkill: (skill) => api.registerSkill(skill),
			addGatewayAction: (action) => api.registerGatewayAction(action),
		});
	},
});

const transcriptionPlugin = defineTestCapabilitySetup({
	id: "test.pibo-transcription-legacy-fixture",
	name: "Pibo Transcription Test Fixture",
	register(api) {
		api.registerTranscriptionProvider(createOpenAiChatGptTranscriptionProvider());
		api.registerTranscriptionProvider(createOpenAiTranscriptionProvider());
	},
});

const gatewayProducerPlugin = defineTestCapabilitySetup({
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

export function createDefaultPiboCapabilityHost() {
	return createTestCapabilityHost({ setups: [coreCapabilitiesSetup, transcriptionPlugin] });
}

export function createGatewayProducerPiboCapabilityHost() {
	return createTestCapabilityHost({ setups: [coreCapabilitiesSetup, gatewayProducerPlugin, transcriptionPlugin] });
}
