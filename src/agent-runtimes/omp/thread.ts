import type {
	AgentRuntimeForkCandidate,
	AgentRuntimeNativeSessionInfo,
	AgentRuntimeNativeSessionSnapshot,
	AgentRuntimeSessionOperationResult,
} from "../../agent-runtime/types.js";
import type { RuntimeSessionBinding } from "../../sessions/runtime-binding.js";
import { OmpRpcClient } from "./client.js";
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

/**
 * OMP session-file lifecycle controller. OMP owns its session files (JSONL
 * session transcripts) under the isolated `PI_CODING_AGENT_DIR` sessions dir.
 * Pibo records only an opaque binding locator pointing at OMP's native session
 * id/file, so resume/re-attach target the native session through `switch_session`.
 */
export class OmpThreadController {
	private snapshot: OmpSessionSnapshot;
	private forkCandidatesCache: AgentRuntimeForkCandidate[] = [];

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

	/** Fetch branch candidates from OMP and cache them for the sync SPI. */
	async loadForkCandidates(runtimeInstanceId: string): Promise<AgentRuntimeForkCandidate[]> {
		try {
			const result = await this.client.request({ type: "get_branch_messages" }, "get_branch_messages");
			const data = result["data" as keyof typeof result];
			if (data && typeof data === "object" && !Array.isArray(data) && "messages" in data) {
				const messages = (data as { messages: unknown }).messages;
				if (Array.isArray(messages)) {
					const candidates: AgentRuntimeForkCandidate[] = [];
					for (const entry of messages) {
						if (entry && typeof entry === "object" && !Array.isArray(entry)) {
							const rec = entry as Record<string, unknown>;
							if (typeof rec.entryId === "string") {
								candidates.push({
									entryId: rec.entryId,
									text: typeof rec.text === "string" ? rec.text : "",
								});
							}
						}
					}
					this.forkCandidatesCache = candidates;
					return candidates;
				}
			}
		} catch {
			// Branch candidates are optional; fall through to empty.
		}
		this.forkCandidatesCache = [];
		return [];
	}

	/** Sync accessor for the SPI (get_available_commands via a warm-up load). */
	cachedForkCandidates(): AgentRuntimeForkCandidate[] {
		return this.forkCandidatesCache;
	}

	async forkSession(
		runtimeInstanceId: string,
		entryId: string,
	): Promise<AgentRuntimeSessionOperationResult> {
		const previous = structuredClone(this.getSessionSnapshot(runtimeInstanceId));
		const result = await this.client.request({ type: "branch", entryId }, "branch");
		const data = result["data" as keyof typeof result];
		const cancelled = Boolean(
			data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>).cancelled === true,
		);
		await this.refresh();
		const current = this.getSessionSnapshot(runtimeInstanceId);
		return { previous, current, cancelled };
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