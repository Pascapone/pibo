import type {
	PiboAgentSendMessageInput,
	PiboAgentSendMessageResult,
	PiboAgentsController,
} from "../../src/index.js";

const controller: PiboAgentsController = {
	async sendMessage(input: PiboAgentSendMessageInput): Promise<PiboAgentSendMessageResult> {
		return {
			agentId: "ps_legacy_child",
			name: input.subagent.name,
			profile: input.subagent.targetProfile,
			threadKey: input.threadKey ?? "legacy-thread",
			eventId: "legacy-event",
			reply: {
				type: "assistant_message",
				piboSessionId: "ps_legacy_child",
				eventId: "legacy-event",
				text: "legacy reply",
			},
		};
	},
	listAgents() {
		return [];
	},
	observe(input) {
		return { filters: input, observations: [], nextAfterSequence: 0, truncated: false };
	},
	async killAgent(agentId) {
		return { agentId, killed: [agentId], cancelledRuns: [] };
	},
};

async function callControllerWithRequiredSessionName(): Promise<void> {
	await controller.sendMessage({
		subagent: { name: "legacy", targetProfile: "legacy-profile" },
		sessionName: "Legacy request",
		message: "legacy request",
		requestId: "run_legacy",
	});
}

void controller;
void callControllerWithRequiredSessionName;
