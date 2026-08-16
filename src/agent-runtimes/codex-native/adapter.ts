import { randomUUID } from "node:crypto";
import {
	unsupportedAgentRuntimeCapability,
	type AgentRuntimeCapabilities,
} from "../../agent-runtime/capabilities.js";
import {
	AgentRuntimeBindingMissingError,
	AgentRuntimeUnavailableError,
} from "../../agent-runtime/errors.js";
import type { AgentRuntimeSemanticEvent } from "../../agent-runtime/events.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeDiagnostic,
	AgentRuntimeDriver,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryPage,
	AgentRuntimeProductContext,
	AgentRuntimePromptInput,
	AgentRuntimeSession,
	AgentRuntimeStatus,
	InspectAgentRuntimeHistoryInput,
	OpenAgentRuntimeSessionInput,
	ReadAgentRuntimeHistoryInput,
	RuntimeSessionBinding,
	ValidateAgentRuntimeProfileInput,
} from "../../agent-runtime/types.js";
import type { PiboJsonObject } from "../../core/events.js";
import {
	CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA,
	defaultCodexNativeRuntimeConfig,
	parseCodexNativeRuntimeConfig,
	type CodexNativeRuntimeConfig,
} from "./config.js";
import {
	diagnoseCodexNativeRuntime,
	startCodexNativeAppServer,
	type CodexNativeAppServerProcess,
} from "./process.js";
import {
	inspectCodexThreadHistory,
	pageCodexThreadHistory,
	unavailableCodexThreadHistoryInspection,
} from "./history.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CodexNativeThreadController,
	CodexNativeThreadMissingError,
} from "./thread.js";
import type { CodexAppServerThread } from "./protocol-types.js";
import {
	CODEX_APP_SERVER_PROTOCOL_NAME,
	CODEX_APP_SERVER_SUPPORTED_RANGE,
	CODEX_APP_SERVER_VERSION,
} from "./protocol-version.js";
import { CodexNativeTurnController } from "./turn.js";

export { CODEX_NATIVE_ADAPTER_ID } from "./thread.js";

export const CODEX_NATIVE_ADAPTER_VERSION = "1.0.0";

const unavailableUntilResourceIntegration = unsupportedAgentRuntimeCapability(
	"This capability has not yet been delivered through the native Codex runtime adapter.",
);

export const CODEX_NATIVE_THREAD_CAPABILITIES: AgentRuntimeCapabilities = {
	lifecycle: {
		persistent: true,
		lazyBinding: false,
		resume: true,
		attach: true,
		listNativeSessions: true,
		fork: true,
		clone: true,
		tree: false,
	},
	input: {
		text: true,
		images: false,
		audio: false,
		steering: true,
		structuredOutput: false,
	},
	output: {
		assistantDeltas: true,
		reasoning: true,
		toolEvents: true,
		usage: true,
		plans: false,
		diffs: false,
		rawNativeEvents: false,
	},
	tools: {
		piboManaged: unavailableUntilResourceIntegration,
		nativeToolYielding: unsupportedAgentRuntimeCapability(
			"Codex native tools remain harness-owned and are not wrapped as Pibo yielded tools.",
		),
	},
	mcp: {
		externalServers: unavailableUntilResourceIntegration,
		statusInspection: false,
	},
	skills: unavailableUntilResourceIntegration,
	context: unavailableUntilResourceIntegration,
	models: {
		catalog: false,
		switchInSession: false,
	},
	reasoning: {
		supported: false,
	},
	approvals: {
		supported: false,
		structuredUserInput: false,
	},
	maintenance: {
		compaction: false,
		contextUsage: false,
		history: true,
		health: true,
	},
};

function timestamp(seconds: number): string {
	return new Date(seconds * 1_000).toISOString();
}

function safeThreadMetadata(thread: CodexAppServerThread, previous: PiboJsonObject = {}): PiboJsonObject {
	const {
		diagnosticCode: _diagnosticCode,
		diagnosticMessage: _diagnosticMessage,
		...metadata
	} = previous;
	return {
		...metadata,
		persistent: true,
		nativePresenceExpected: true,
		threadCreatedAt: timestamp(thread.createdAt),
		threadUpdatedAt: timestamp(thread.updatedAt),
		threadStatus: thread.status.type,
		modelProvider: thread.modelProvider,
	};
}

function bindingForThread(input: {
	piboSessionId: string;
	runtimeInstanceId: string;
	previous?: RuntimeSessionBinding;
	thread: CodexAppServerThread;
}): RuntimeSessionBinding {
	return {
		...(input.previous ? structuredClone(input.previous) : {}),
		piboSessionId: input.piboSessionId,
		runtimeInstanceId: input.runtimeInstanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		nativeSessionId: input.thread.id,
		state: "bound",
		protocol: CODEX_APP_SERVER_PROTOCOL_NAME,
		protocolVersion: CODEX_APP_SERVER_VERSION,
		adapterVersion: CODEX_NATIVE_ADAPTER_VERSION,
		locator: { kind: "adapter-resolved" },
		metadata: safeThreadMetadata(input.thread, input.previous?.metadata),
	};
}

function validateOpenBinding(
	input: OpenAgentRuntimeSessionInput,
	runtimeInstanceId: string,
): RuntimeSessionBinding {
	const binding = input.binding
		? structuredClone(input.binding)
		: {
			piboSessionId: input.piboSession.id,
			runtimeInstanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound" as const,
		};
	if (binding.piboSessionId !== input.piboSession.id) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The Codex binding belongs to a different Pibo Session.");
	}
	if (binding.runtimeInstanceId !== runtimeInstanceId || binding.adapterId !== CODEX_NATIVE_ADAPTER_ID) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The Codex binding does not match the configured runtime instance.");
	}
	if (binding.state === "missing") {
		throw new AgentRuntimeBindingMissingError(binding.piboSessionId, runtimeInstanceId, binding.nativeSessionId);
	}
	if (binding.state === "error") {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The persisted Codex binding is in an error state.");
	}
	if (binding.state === "bound" && !binding.nativeSessionId) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The persisted Codex binding has no native thread id.");
	}
	if (binding.state === "unbound" && binding.nativeSessionId) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "An unbound Codex binding cannot contain a native thread id.");
	}
	return binding;
}

export class CodexNativeThreadSession implements AgentRuntimeSession {
	readonly adapterId = CODEX_NATIVE_ADAPTER_ID;
	readonly cwd: string;
	readonly capabilities = CODEX_NATIVE_THREAD_CAPABILITIES;
	readonly controls: NonNullable<AgentRuntimeSession["controls"]>;
	private readonly listeners = new Set<(event: AgentRuntimeSemanticEvent) => void>();
	private readonly turns: CodexNativeTurnController;
	private binding: RuntimeSessionBinding;
	private disposed = false;

	constructor(
		readonly runtimeInstanceId: string,
		private readonly process: CodexNativeAppServerProcess,
		private readonly threads: CodexNativeThreadController,
		binding: RuntimeSessionBinding,
		private readonly productContext?: AgentRuntimeProductContext,
	) {
		this.cwd = threads.thread.cwd;
		this.binding = structuredClone(binding);
		this.turns = new CodexNativeTurnController(process.client, threads, (event) => this.emit(event));
		this.controls = {
			getCurrentSession: () => this.threads.getSnapshot(this.runtimeInstanceId),
			listSessions: () => this.threads.list(this.runtimeInstanceId, this.cwd),
			getForkCandidates: () => this.threads.getForkCandidates(),
			forkSession: async (entryId) => {
				this.assertActive();
				const result = await this.threads.fork(this.runtimeInstanceId, this.cwd, entryId);
				this.updateBindingFromCurrentThread();
				return result;
			},
			cloneSession: async () => {
				this.assertActive();
				const result = await this.threads.clone(this.runtimeInstanceId, this.cwd);
				this.updateBindingFromCurrentThread();
				return result;
			},
		};
	}

	getBinding(): RuntimeSessionBinding {
		return structuredClone(this.binding);
	}

	subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void {
		this.assertActive();
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		await this.turns.start(input.text, this.productContext?.getActiveMessage?.()?.id ?? randomUUID());
		this.updateBindingFromCurrentThread();
	}

	async steer(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		await this.turns.steer(input.text, randomUUID());
	}

	async abort(): Promise<void> {
		this.assertActive();
		await this.turns.interrupt();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.turns.dispose();
		this.listeners.clear();
		await this.process.close();
	}

	getStatus(): AgentRuntimeStatus {
		const diagnostics = this.process.client.getDiagnostics();
		return {
			streaming: this.turns.streaming,
			enabledTools: [],
			cwd: this.cwd,
			warnings: diagnostics.filter((entry) => entry.level === "warning").map((entry) => entry.message),
			errors: diagnostics.filter((entry) => entry.level === "error").map((entry) => entry.message),
		};
	}

	getNativeCompatibilityHandle(): unknown {
		return this.process.client;
	}

	private emit(event: AgentRuntimeSemanticEvent): void {
		if (this.disposed) return;
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// Runtime listeners are isolated from the owned Codex process lifecycle.
			}
		}
	}

	private updateBindingFromCurrentThread(): void {
		this.binding = bindingForThread({
			piboSessionId: this.binding.piboSessionId,
			runtimeInstanceId: this.runtimeInstanceId,
			previous: this.binding,
			thread: this.threads.thread,
		});
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Codex runtime session is disposed.");
	}
}

export class CodexNativeAgentRuntimeAdapter implements AgentRuntimeAdapter {
	readonly descriptor = CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor;
	readonly config: CodexNativeRuntimeConfig;
	readonly displayName: string;
	readonly enabled: boolean;

	constructor(
		readonly instanceId: string,
		config: CodexNativeRuntimeConfig,
		displayName: string | undefined,
		enabled: boolean,
	) {
		this.config = structuredClone(config);
		this.displayName = displayName ?? this.descriptor.displayName;
		this.enabled = enabled;
	}

	diagnose(): Promise<readonly AgentRuntimeDiagnostic[]> {
		return diagnoseCodexNativeRuntime(this.config, this.instanceId);
	}

	validateProfile(input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[] {
		const diagnostics: AgentRuntimeDiagnostic[] = [];
		if (input.profile.runtimeInstanceId !== this.instanceId) {
			diagnostics.push({
				severity: "error",
				code: "runtime_instance_mismatch",
				message: `Profile "${input.profile.profileName}" selects runtime instance "${input.profile.runtimeInstanceId}", not "${this.instanceId}".`,
			});
		}
		if (Object.keys(input.profile.runtimeOptions).length > 0) {
			diagnostics.push({
				severity: "error",
				code: "codex_native_runtime_options_pending",
				message: "Codex adapter-native profile options are not enabled by the current checkpoint.",
				path: "runtimeOptions",
			});
		}
		return diagnostics;
	}

	async resolveBinding(input: { binding: RuntimeSessionBinding; workspace: string }): Promise<RuntimeSessionBinding> {
		const binding = structuredClone(input.binding);
		if (binding.state !== "bound") return binding;
		if (!binding.nativeSessionId) {
			return {
				...binding,
				state: "error",
				metadata: {
					...(binding.metadata ?? {}),
					diagnosticCode: "codex_native_thread_id_missing",
					diagnosticMessage: "The persisted Codex binding has no native thread id.",
				},
			};
		}
		try {
			const thread = await this.withProcess(binding.piboSessionId, input.workspace, async (process) =>
				await CodexNativeThreadController.read(process.client, binding.nativeSessionId!, false));
			return bindingForThread({
				piboSessionId: binding.piboSessionId,
				runtimeInstanceId: this.instanceId,
				previous: binding,
				thread,
			});
		} catch (error) {
			if (error instanceof CodexNativeThreadMissingError) {
				return {
					...binding,
					state: "missing",
					metadata: {
						...(binding.metadata ?? {}),
						diagnosticCode: "codex_native_thread_missing",
						diagnosticMessage: "The bound Codex thread is no longer available in this configured runtime instance.",
					},
				};
			}
			throw new AgentRuntimeUnavailableError(
				this.instanceId,
				`Codex binding inspection failed for runtime instance "${this.instanceId}".`,
			);
		}
	}

	async openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const binding = validateOpenBinding(input, this.instanceId);
		const sessionGeneration = input.services?.resources?.sessionGeneration
			?? input.services?.portableTools?.sessionGeneration
			?? randomUUID();
		const process = await startCodexNativeAppServer({
			config: this.config,
			runtimeInstanceId: this.instanceId,
			piboSessionId: input.piboSession.id,
			sessionGeneration,
			workspace: input.workspace,
			clientVersion: CODEX_NATIVE_ADAPTER_VERSION,
			resourceEnvironment: input.services?.resources?.getAdapterEnvironment(),
		});
		try {
			const threads = binding.state === "bound"
				? await CodexNativeThreadController.resume(process.client, binding.nativeSessionId!, input.workspace)
				: await CodexNativeThreadController.start(process.client, input.workspace);
			return new CodexNativeThreadSession(
				this.instanceId,
				process,
				threads,
				bindingForThread({
					piboSessionId: input.piboSession.id,
					runtimeInstanceId: this.instanceId,
					previous: binding,
					thread: threads.thread,
				}),
				input.productContext,
			);
		} catch (error) {
			await process.close().catch(() => {});
			if (error instanceof CodexNativeThreadMissingError) {
				throw new AgentRuntimeBindingMissingError(input.piboSession.id, this.instanceId, binding.nativeSessionId);
			}
			throw error;
		}
	}

	async inspectHistory(input: InspectAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryInspection> {
		const threadId = input.binding.nativeSessionId;
		if (!threadId) {
			return unavailableCodexThreadHistoryInspection(
				this.instanceId,
				input.binding,
				"codex_native_history_thread_id_missing",
				"The Codex runtime binding has no native thread id for history lookup.",
			);
		}
		try {
			const thread = await this.withProcess(input.binding.piboSessionId, input.workspace, async (process) =>
				await CodexNativeThreadController.read(process.client, threadId, false));
			return inspectCodexThreadHistory(this.instanceId, input.binding, thread);
		} catch (error) {
			return unavailableCodexThreadHistoryInspection(
				this.instanceId,
				input.binding,
				error instanceof CodexNativeThreadMissingError ? "codex_native_history_not_found" : "codex_native_history_unavailable",
				error instanceof CodexNativeThreadMissingError
					? "The bound Codex thread is unavailable for native history inspection."
					: "Codex native history inspection failed safely.",
			);
		}
	}

	async readHistory(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage> {
		const threadId = input.binding.nativeSessionId;
		if (!threadId) {
			const inspection = await this.inspectHistory(input);
			return {
				runtimeInstanceId: this.instanceId,
				adapterId: CODEX_NATIVE_ADAPTER_ID,
				source: "native",
				entries: [],
				hasMore: false,
				inspection,
			};
		}
		try {
			const thread = await this.withProcess(input.binding.piboSessionId, input.workspace, async (process) =>
				await CodexNativeThreadController.read(process.client, threadId, true));
			return pageCodexThreadHistory({
				runtimeInstanceId: this.instanceId,
				binding: input.binding,
				thread,
				cursor: input.cursor,
				beforeTimestamp: input.beforeTimestamp,
				limit: input.limit,
			});
		} catch (error) {
			if (error instanceof CodexNativeThreadMissingError) {
				const inspection = unavailableCodexThreadHistoryInspection(
					this.instanceId,
					input.binding,
					"codex_native_history_not_found",
					"The bound Codex thread is unavailable for native history reads.",
				);
				return {
					runtimeInstanceId: this.instanceId,
					adapterId: CODEX_NATIVE_ADAPTER_ID,
					source: "native",
					entries: [],
					hasMore: false,
					inspection,
				};
			}
			throw new AgentRuntimeUnavailableError(
				this.instanceId,
				`Codex native history read failed for runtime instance "${this.instanceId}".`,
			);
		}
	}

	private async withProcess<T>(
		piboSessionId: string,
		workspace: string,
		operation: (process: CodexNativeAppServerProcess) => Promise<T>,
	): Promise<T> {
		const process = await startCodexNativeAppServer({
			config: this.config,
			runtimeInstanceId: this.instanceId,
			piboSessionId,
			sessionGeneration: `inspection-${randomUUID()}`,
			workspace,
			clientVersion: CODEX_NATIVE_ADAPTER_VERSION,
		});
		try {
			return await operation(process);
		} finally {
			await process.close();
		}
	}
}

export const CODEX_NATIVE_AGENT_RUNTIME_DRIVER: AgentRuntimeDriver<CodexNativeRuntimeConfig> = {
	descriptor: {
		id: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex App Server",
		transport: "stdio-rpc",
		configSchema: CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA,
		capabilities: CODEX_NATIVE_THREAD_CAPABILITIES,
		protocol: {
			name: CODEX_APP_SERVER_PROTOCOL_NAME,
			supportedRange: CODEX_APP_SERVER_SUPPORTED_RANGE,
		},
		supportsMultipleInstances: true,
	},
	defaultConfig: defaultCodexNativeRuntimeConfig,
	parseConfig: parseCodexNativeRuntimeConfig,
	create(input) {
		return new CodexNativeAgentRuntimeAdapter(
			input.instanceId,
			input.config,
			input.displayName,
			input.enabled,
		);
	},
};

export function getCodexNativeClient(session: AgentRuntimeSession): unknown {
	if (session.adapterId !== CODEX_NATIVE_ADAPTER_ID) return undefined;
	return session.getNativeCompatibilityHandle?.();
}
