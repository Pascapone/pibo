import type { PiboApprovalResponseParams, PiboExecutionEvent, PiboJsonObject, PiboUserInputResponseParams } from "../../core/events.js";
import type { PiboGatewayAction } from "../../plugins/types.js";

function objectParams(event: PiboExecutionEvent): PiboJsonObject | undefined {
	const params = "params" in event ? event.params : undefined;
	return params && typeof params === "object" && !Array.isArray(params) ? params : undefined;
}

function approvalResponseParams(event: PiboExecutionEvent): PiboApprovalResponseParams {
	const params = objectParams(event);
	if (!params || typeof params.requestId !== "string" || !params.requestId.trim()) throw new Error("runtime.approval.respond requires params.requestId");
	if (typeof params.decision !== "string" || !params.decision.trim()) throw new Error("runtime.approval.respond requires params.decision");
	return { requestId: params.requestId, decision: params.decision };
}

function userInputResponseParams(event: PiboExecutionEvent): PiboUserInputResponseParams {
	const params = objectParams(event);
	if (!params || typeof params.requestId !== "string" || !params.requestId.trim()) throw new Error("runtime.user_input.respond requires params.requestId");
	if (!params.answers || typeof params.answers !== "object" || Array.isArray(params.answers)) throw new Error("runtime.user_input.respond requires params.answers");
	return { requestId: params.requestId, answers: params.answers as PiboJsonObject };
}

export function codexRuntimeRequestActions(): readonly PiboGatewayAction[] {
	return [
		{
			name: "runtime.approval.respond",
			description: "Respond to a pending runtime approval request.",
			hidden: true,
			async execute(context, event) {
				const params = approvalResponseParams(event);
				await context.respondToApproval(params.requestId, params.decision);
				return { requestId: params.requestId, responded: true };
			},
		},
		{
			name: "runtime.user_input.respond",
			description: "Respond to a pending structured runtime user-input request.",
			hidden: true,
			async execute(context, event) {
				const params = userInputResponseParams(event);
				await context.respondToUserInput(params.requestId, params.answers);
				return { requestId: params.requestId, responded: true };
			},
		},
	];
}
