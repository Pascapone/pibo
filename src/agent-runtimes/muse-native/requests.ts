import type { Session } from "@muse-code/sdk";
import { AgentRuntimeCapabilityUnavailableError } from "../../agent-runtime/errors.js";
import type {
	AgentRuntimeApprovalRequest,
	AgentRuntimeSemanticEvent,
	AgentRuntimeUserInputRequest,
} from "../../agent-runtime/events.js";
import type { PiboJsonValue } from "../../core/events.js";
import { redactMuseNativeSensitiveText, redactMuseNativeValue } from "./redaction.js";

const MAX_DETAIL_CHARS = 4_000;

type PendingApproval = {
	request: AgentRuntimeApprovalRequest;
	resolve: (choiceId: string) => void;
	reject: (error: Error) => void;
	choiceIds: readonly string[];
};

function boundedDetail(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	return redactMuseNativeSensitiveText(value).slice(0, MAX_DETAIL_CHARS);
}

function argumentsValue(rawArgs: unknown): PiboJsonValue {
	if (typeof rawArgs !== "string" || !rawArgs.trim()) return "";
	const bounded = rawArgs.slice(0, MAX_DETAIL_CHARS);
	try {
		return redactMuseNativeValue(JSON.parse(bounded)) as PiboJsonValue;
	} catch {
		return redactMuseNativeSensitiveText(bounded);
	}
}

export class MuseNativeRequestController {
	private readonly pending = new Map<string, PendingApproval>();
	private disposed = false;

	constructor(
		private readonly session: Session,
		private readonly runtimeInstanceId: string,
		private readonly emit: (event: AgentRuntimeSemanticEvent) => void,
	) {
		session.onApproval(async (request) => {
			const approvalId = request.approvalId;
			if (this.disposed || this.pending.has(approvalId)) {
				throw new Error(`Muse approval "${approvalId}" cannot be parked.`);
			}
			const choices = request.availableChoices.map((choice) => ({
				id: choice.choiceId,
				label: choice.label,
				...(choice.rulePreview ? { description: choice.rulePreview.slice(0, 512) } : {}),
			}));
			const toolName = typeof request.toolName === "string" && request.toolName.trim() ? request.toolName : "muse-tool";
			const approvalRequest: AgentRuntimeApprovalRequest = {
				requestId: approvalId,
				requestType: "tool-approval",
				title: toolName,
				...(boundedDetail(request.rawArgs) ? { detail: boundedDetail(request.rawArgs) } : {}),
				arguments: argumentsValue(request.rawArgs),
				decisions: choices,
			};
			const parked = new Promise<string>((resolve, reject) => {
				this.pending.set(approvalId, {
					request: approvalRequest,
					resolve,
					reject,
					choiceIds: choices.map((choice) => choice.id),
				});
			});
			this.emit({ type: "approval_requested", request: approvalRequest });
			const choiceId = await parked;
			return { choiceId };
		});
		session.onApprovalError((failure) => {
			if (failure.kind === "handlerThrew" || failure.kind === "submitFailed") {
				this.emit({
					type: "warning",
					message: `Muse approval "${failure.approvalId}" did not complete (${failure.kind}).`,
				});
			}
		});
	}

	get pendingApproval(): AgentRuntimeApprovalRequest | undefined {
		return this.pendingApprovals[0];
	}

	get pendingApprovals(): readonly AgentRuntimeApprovalRequest[] {
		return [...this.pending.values()].map((entry) => entry.request);
	}

	get pendingUserInput(): AgentRuntimeUserInputRequest | undefined {
		return undefined;
	}

	get pendingUserInputs(): readonly AgentRuntimeUserInputRequest[] {
		return [];
	}

	async respondToApproval(requestId: string, decision: string): Promise<void> {
		const entry = this.pending.get(requestId);
		if (!entry) throw new Error(`Muse approval "${requestId}" is not pending.`);
		const normalized = decision.trim();
		const choice = entry.choiceIds.find((candidate) => candidate === normalized)
			?? entry.request.decisions?.find((candidate) => candidate.label === normalized)?.id;
		if (!choice) {
			throw new Error(`Muse approval "${requestId}" has no offered choice "${normalized}".`);
		}
		this.pending.delete(requestId);
		entry.resolve(choice);
		this.emit({ type: "approval_resolved", requestId, resolution: "responded" });
	}

	async respondToUserInput(): Promise<void> {
		throw new AgentRuntimeCapabilityUnavailableError(
			"structured user input",
			this.runtimeInstanceId,
			"Muse structured user input is not supported by this runtime adapter.",
		);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const [requestId, entry] of [...this.pending]) {
			this.pending.delete(requestId);
			entry.reject(new Error(`Muse approval "${requestId}" was disposed.`));
			this.emit({ type: "approval_resolved", requestId, resolution: "aborted" });
		}
	}
}
