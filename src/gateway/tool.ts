import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolProfile } from "../core/profiles.js";
import type { GatewayResponseFrame } from "./protocol.js";
import { sendGatewayMessageAndWaitForReply, type GatewayReplyResult } from "./request.js";

type PiboGatewaySendDetails = {
	ok: boolean;
	piboSessionId?: string;
	error?: string;
	gatewayPayload?: unknown;
	reply?: string;
};

type SendGatewayMessage = typeof sendGatewayMessageAndWaitForReply;

export function createPiboGatewaySendTool(
	sendGatewayMessage: SendGatewayMessage = sendGatewayMessageAndWaitForReply,
): ToolDefinition {
	return defineTool({
		name: "pibo_gateway_send",
		label: "Pibo Gateway Send",
		description:
			"Send a message through the local pibo gateway to a target session and return the target assistant reply.",
		promptSnippet:
			"Send a message through the local pibo gateway to a target session and return the final assistant reply from that session.",
		parameters: Type.Object({
			piboSessionId: Type.String({ description: "Target Pibo gateway session id" }),
			message: Type.String({ description: "Message to enqueue for the target session" }),
		}),
		async execute(_toolCallId, params) {
			let result: GatewayReplyResult | undefined;
			let response: GatewayResponseFrame;

			try {
				result = await sendGatewayMessage({
					type: "message",
					piboSessionId: params.piboSessionId,
					text: params.message,
					source: "actor",
				});
				response = result.response;
			} catch (error) {
				response = {
					type: "res",
					id: "",
					ok: false,
					error: { message: error instanceof Error ? error.message : String(error) },
				};
			}

			if (!response.ok) {
				const message = response.error?.message ?? "Gateway rejected the message";
				const details: PiboGatewaySendDetails = { ok: false, piboSessionId: params.piboSessionId, error: message };
				return {
					content: [{ type: "text", text: `Gateway error: ${message}` }],
					details,
				};
			}

			const details: PiboGatewaySendDetails = {
				ok: true,
				piboSessionId: params.piboSessionId,
				gatewayPayload: response.payload,
				reply: result?.reply.text,
			};

			return {
				content: [
					{
						type: "text",
						text: result?.reply
							? result.reply.text
							: `Queued message for pibo gateway session "${params.piboSessionId}", but no assistant reply was returned.`,
					},
				],
				details,
			};
		},
	});
}

const piboGatewaySendTool = createPiboGatewaySendTool();

export function createPiboGatewayToolProfiles(): ToolProfile[] {
	return [createToolProfile(piboGatewaySendTool)];
}

function createToolProfile(definition: ToolDefinition): ToolProfile {
	return {
		name: definition.name,
		description: definition.description,
		definition,
	};
}
