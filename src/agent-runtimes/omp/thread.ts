import type {
	AgentRuntimeForkCandidate,
	AgentRuntimeNativeSessionInfo,
	AgentRuntimeNativeSessionSnapshot,
	AgentRuntimeSessionOperationResult,
} from "../../agent-runtime/types.js";
import type { RuntimeSessionBinding } from "../../sessions/runtime-binding.js";
import { OmpRpcClient, OmpRpcResponseError } from "./client.js";
import { OMP_RPC_PROTOCOL_NAME, OMP_RPC_PROTOCOL_VERSION, type OmpRpcAvailableSlashCommand } from "./protocol-types.js";

export const OMP_ADAPTER_ID = "orp";
export const OMP_ADAPTER_VERSION = "1.0.0";

export type OmpSessionSnapshot = {
	sessionId: string;
	sessionName?: string;
	sessionFile?: string;
	messageCount: number;
	cwd: string;
};

function isUnsupportedForkCommand(error: unknown): boolean {
	if (!(error instanceof OmpRpcResponseError)) return false;
	return /unknown_command|unsupported_command|method_not_found|(?:unknown|unsupported|unrecognized|invalid)\s+(?:rpc\s+)?(?:command|method)|(?:command|method)\s+(?:is\s+)?(?:unknown|unsupported|unrecognized|not implemented|not found)/i
		.test(`${error.errorCode ?? ""} ${error.error}`);
}

/**
 * OMP session-file lifecycle controller. OMP owns its session files (JSONL
 * session transcripts) under the isolated `PI_CODING_AGENT_DIR` sessions dir.
 * Pibo records only an opaque binding locator pointing at OMP's native session
 * id/file, so resume/re-attach target the native session through `switch_session`.
 */
export class OmpThreadController {
	private snapshot: OmpSessionSnapshot;
	constructor(
		private readonly client: OmpRpcClient,
		private readonly cwd: string,
		initial: Pick<OmpSessionSnapshot, "sessionId">,
	) {
		this.snapshot = { sessionId: initial.sessionId, messageCount: 0, cwd };
	}

	get current(): OmpSessionSnapshot {
		return this.snapshot;
	}

	getSessionSnapshot(runtimeInstanceId: string): AgentRuntimeNativeSessionSnapshot {
		return {
			adapterId: OMP_ADAPTER_ID,
			runtimeInstanceId,
			nativeSessionId: this.snapshot.sessionId,
			locator: {
				kind: "adapter-resolved",
				value: this.snapshot.sessionFile ?? this.snapshot.sessionId,
			},
			cwd: this.cwd,
			name: this.snapshot.sessionName,
			metadata: {
				protocol: OMP_RPC_PROTOCOL_NAME,
				protocolVersion: OMP_RPC_PROTOCOL_VERSION,
			},
		};
	}

	async refresh(): Promise<void> {
		const state = await this.client.request({ type: "get_state" }, "get_state");
		const data = state["data" as keyof typeof state];
		if (data && typeof data === "object" && !Array.isArray(data)) {
			const record = data as Record<string, unknown>;
			this.snapshot = {
				sessionId: typeof record.sessionId === "string" ? record.sessionId : this.snapshot.sessionId,
				sessionName: typeof record.sessionName === "string" ? record.sessionName : undefined,
				sessionFile: typeof record.sessionFile === "string" ? record.sessionFile : undefined,
				messageCount: typeof record.messageCount === "number" ? record.messageCount : 0,
				cwd: this.cwd,
			};
		}
	}

	async listSessions(runtimeInstanceId: string): Promise<AgentRuntimeNativeSessionInfo[]> {
		await this.refresh();
		const snapshot = this.getSessionSnapshot(runtimeInstanceId);
		return [{ ...snapshot, messageCount: this.snapshot.messageCount, name: this.snapshot.sessionName }];
	}

	/** Fetch fork candidates from current OMP RPC names with legacy branch compatibility. */
	async loadForkCandidates(_runtimeInstanceId: string): Promise<AgentRuntimeForkCandidate[]> {
		let result;
		try {
			result = await this.client.request({ type: "get_fork_messages" }, "get_fork_messages");
		} catch (error) {
			if (!isUnsupportedForkCommand(error)) throw error;
			try {
				result = await this.client.request({ type: "get_branch_messages" }, "get_branch_messages");
			} catch (legacyError) {
				if (isUnsupportedForkCommand(legacyError)) return [];
				throw legacyError;
			}
		}
		const data = result["data" as keyof typeof result];
		if (!data || typeof data !== "object" || Array.isArray(data) || !("messages" in data)) return [];
		const messages = (data as { messages: unknown }).messages;
		if (!Array.isArray(messages)) return [];
		const candidates: AgentRuntimeForkCandidate[] = [];
		const seenEntryIds = new Set<string>();
		for (const entry of messages) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
			const record = entry as Record<string, unknown>;
			if (typeof record.entryId !== "string" || !record.entryId.trim() || seenEntryIds.has(record.entryId)) continue;
			seenEntryIds.add(record.entryId);
			candidates.push({
				entryId: record.entryId,
				text: typeof record.text === "string" ? record.text : "",
			});
		}
		return candidates;
	}

	async forkSession(
		runtimeInstanceId: string,
		entryId: string,
	): Promise<AgentRuntimeSessionOperationResult> {
		if (!entryId.trim()) throw new Error("OMP session fork requires a native user-message id.");
		const previousState = structuredClone(this.snapshot);
		const previous = structuredClone(this.getSessionSnapshot(runtimeInstanceId));
		let result;
		try {
			result = await this.client.request({ type: "fork", entryId }, "fork");
		} catch (error) {
			if (!isUnsupportedForkCommand(error)) throw error;
			result = await this.client.request({ type: "branch", entryId }, "branch");
		}
		const data = result["data" as keyof typeof result];
		const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
		const cancelled = record?.cancelled === true;
		try {
			await this.refresh();
			const current = this.getSessionSnapshot(runtimeInstanceId);
			if (!cancelled && current.nativeSessionId === previous.nativeSessionId) {
				throw new Error("OMP session fork returned the source native session id.");
			}
			return {
				previous,
				current,
				cancelled,
				summaryEntryId: entryId,
				...(typeof record?.text === "string" ? { selectedText: record.text } : {}),
			};
		} catch (error) {
			if (!cancelled && previousState.sessionFile) {
				try {
					await this.client.request({ type: "switch_session", sessionPath: previousState.sessionFile }, "switch_session");
					await this.refresh();
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], "OMP session fork failed and the source session could not be restored.");
				}
			}
			throw error;
		}
	}

	async switchSession(runtimeInstanceId: string, sessionPath: string): Promise<AgentRuntimeSessionOperationResult> {
		const previous = structuredClone(this.getSessionSnapshot(runtimeInstanceId));
		const result = await this.client.request({ type: "switch_session", sessionPath }, "switch_session");
		const data = result["data" as keyof typeof result];
		const cancelled = Boolean(
			data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>).cancelled === true,
		);
		await this.refresh();
		const current = this.getSessionSnapshot(runtimeInstanceId);
		return { previous, current, cancelled };
	}
}

export type OmpThreadControllerBinding = {
	binding(piboSessionId: string, runtimeInstanceId: string, previous?: RuntimeSessionBinding): RuntimeSessionBinding;
	snapshot: OmpSessionSnapshot;
};

export type OmpCommandInfo = {
	name: string;
	description?: string;
	source: string;
	aliases?: string[];
	inputHint?: string;
	subcommands?: Array<{ name: string; description?: string; usage?: string }>;
};

export async function readOmpAvailableCommands(client: OmpRpcClient): Promise<OmpCommandInfo[]> {
	try {
		const result = await client.request({ type: "get_available_commands" }, "get_available_commands");
		const data = result["data" as keyof typeof result];
		if (data && typeof data === "object" && !Array.isArray(data) && "commands" in data) {
			const commands = (data as { commands: unknown }).commands;
			if (Array.isArray(commands)) {
				return commands
					.filter((c): c is OmpRpcAvailableSlashCommand => Boolean(c) && typeof c === "object")
					.filter(isOmpCommand)
					.map((c) => ({
						name: c.name,
						description: c.description,
						source: String(c.source ?? "unknown"),
						aliases: c.aliases,
						inputHint: c.input?.hint,
						subcommands: c.subcommands,
					}));
			}
		}
	} catch {
		// available_commands is best-effort; return empty if unavailable.
	}
	return [];
}

function isOmpCommand(c: OmpRpcAvailableSlashCommand): c is OmpRpcAvailableSlashCommand {
	return typeof c.name === "string" && c.name.length > 0;
}
