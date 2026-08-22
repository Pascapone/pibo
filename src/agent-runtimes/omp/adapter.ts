import { randomUUID } from "node:crypto";
import {
	unsupportedAgentRuntimeCapability,
	type AgentRuntimeCapabilities,
} from "../../agent-runtime/capabilities.js";
import {
	AgentRuntimeAuthError,
	AgentRuntimeBindingMissingError,
	AgentRuntimeUnavailableError,
} from "../../agent-runtime/errors.js";
import type { AgentRuntimeSemanticEvent } from "../../agent-runtime/events.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeForkCandidate,
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	AgentRuntimeDiagnostic,
	AgentRuntimeDriver,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryPage,
	AgentRuntimeModelCatalog,
	AgentRuntimePromptInput,
	AgentRuntimeSession,
	AgentRuntimeStatus,
	CancelAgentRuntimeAuthInput,
	InspectAgentRuntimeHistoryInput,
	LogoutAgentRuntimeAuthInput,
	AgentRuntimeModelInfo,
	OpenAgentRuntimeSessionInput,
	ReadAgentRuntimeHistoryInput,
	RuntimeSessionBinding,
	StartAgentRuntimeAuthInput,
	ValidateAgentRuntimeProfileInput,
} from "../../agent-runtime/types.js";
import type { PiboJsonObject } from "../../core/events.js";
import type { PiboToolExecutionContext } from "../../tools/contract.js";
import { OmpAuthController, OMP_AUTH_METHODS, unknownOmpStatusForAdapter } from "./auth.js";
import { OmpRpcClient, OmpRpcResponseError } from "./client.js";
import { defaultOmpRuntimeConfig, OMP_RUNTIME_CONFIG_SCHEMA, parseOmpRuntimeConfig, type OmpRuntimeConfig } from "./config.js";
import { OmpHostToolBridge } from "./host-tools.js";
import { emptyOmpHistoryPage, inspectOmpHistory, readOmpHistory } from "./history.js";
import {
	OMP_MODEL_OPTIONS_SCHEMA,
	OMP_MODEL_PROVIDER_ID,
	OMP_REASONING_VALUES,
	parseOmpReasoning,
	readOmpModelCatalog,
	setOmpModel,
	setOmpThinkingLevel,
} from "./models.js";
import {
	buildOmpProcessEnvironment,
	diagnoseOmpRuntime,
	disposeOmpSessionPaths,
	prepareOmpSessionPaths,
	resetOmpNativeSession,
	resolveOmpCommand,
	type OmpSessionPaths,
} from "./process.js";
import { OmpResourceDelivery } from "./resource-delivery.js";
import { OMP_ADAPTER_ID, OMP_ADAPTER_VERSION, OmpThreadController, readOmpAvailableCommands } from "./thread.js";
import { OmpRpcTurnController } from "./turn.js";

export { OMP_ADAPTER_ID } from "./thread.js";

export const OMP_RUNTIME_PROTOCOL_NAME = "omp-rpc";
export const OMP_RUNTIME_SUPPORTED_RANGE = "2";

function ompCapabilities(): AgentRuntimeCapabilities {
	return {
		lifecycle: {
			persistent: true,
			lazyBinding: false,
			resume: true,
			attach: true,
			listNativeSessions: true,
			fork: true,
			clone: false,
			tree: false,
		},
		input: {
			text: true,
			images: true,
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
			piboManaged: { support: "direct" },
			nativeToolInspection: {
				support: "degraded",
				mode: "observed-runtime-items",
				reason: "OMP exposes its native tool inventory via get_state.dumpTools and runtime tool_execution items; a complete pre-turn inventory is only partially exposed through RPC.",
			},
			nativeToolYielding: unsupportedAgentRuntimeCapability(
				"OMP native tools remain harness-owned and are not wrapped as Pibo yielded tools.",
			),
			intentTracing: {
				supported: true,
				configurable: false,
				enabledByDefault: true,
			},
		},
		mcp: {
			externalServers: { support: "unsupported", reason: "OMP manages its own MCP; external MCP delivery is not wired in the initial OMP adapter." },
			statusInspection: false,
		},
		skills: { support: "materialized", modes: ["omp-custom-directories"] },
		context: { support: "materialized", modes: ["native-project-discovery", "omp-append-system-prompt"] },
		contextDiscovery: {
			supported: true,
			configurable: false,
			enabledByDefault: true,
			strategy: "omp-project",
			knownFileNames: ["AGENTS.md"],
			knownUserRelativePaths: [
				".claude/CLAUDE.md",
				".codex/AGENTS.md",
				".gemini/GEMINI.md",
				".config/opencode/AGENTS.md",
				".copilot/copilot-instructions.md",
			],
			knownCwdRelativePaths: [
				".claude/CLAUDE.md",
				".gemini/GEMINI.md",
				".github/copilot-instructions.md",
			],
			knownRelativePaths: [
				".omp/AGENTS.md",
			],
			knownAncestorRelativePaths: [
				".agent/AGENTS.md",
				".agents/AGENTS.md",
			],
		},
		nativeSubagents: {
			supported: true,
			configurable: true,
			enabledByDefault: true,
		},
		historyImport: true,
		auth: {
			status: true,
			methods: OMP_AUTH_METHODS,
			cancel: true,
			logout: true,
			credentialScope: "runtime-instance",
		},
		models: {
			catalog: true,
			switchInSession: true,
			optionsSchema: OMP_MODEL_OPTIONS_SCHEMA as unknown as PiboJsonObject,
		},
		reasoning: {
			supported: true,
			values: [...OMP_REASONING_VALUES],
		},
		approvals: {
			supported: false,
			structuredUserInput: false,
		},
		maintenance: {
			compaction: true,
			contextUsage: true,
			history: true,
			health: true,
		},
	};
}

export const OMP_RUNTIME_CAPABILITIES = ompCapabilities();

function validateOpenBinding(input: OpenAgentRuntimeSessionInput, runtimeInstanceId: string): RuntimeSessionBinding {
	const binding = input.binding
		? structuredClone(input.binding)
		: {
			piboSessionId: input.piboSession.id,
			runtimeInstanceId,
			adapterId: OMP_ADAPTER_ID,
			state: "unbound" as const,
		};
	if (binding.piboSessionId !== input.piboSession.id) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The OMP binding belongs to a different Pibo Session.");
	}
	if (binding.runtimeInstanceId !== runtimeInstanceId || binding.adapterId !== OMP_ADAPTER_ID) {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The OMP binding does not match the configured runtime instance.");
	}
	if (binding.state === "missing") {
		throw new AgentRuntimeBindingMissingError(binding.piboSessionId, runtimeInstanceId, binding.nativeSessionId);
	}
	if (binding.state === "error") {
		throw new AgentRuntimeUnavailableError(runtimeInstanceId, "The persisted OMP binding is in an error state.");
	}
	return binding;
}

type OmpProcessBundle = {
	client: OmpRpcClient;
	paths: OmpSessionPaths;
	threads: OmpThreadController;
	resourceDelivery: OmpResourceDelivery;
};

function bindingForOmp(piboSessionId: string, runtimeInstanceId: string, previous: RuntimeSessionBinding | undefined): RuntimeSessionBinding {
	return {
		...(previous ? structuredClone(previous) : {}),
		piboSessionId,
		runtimeInstanceId,
		adapterId: OMP_ADAPTER_ID,
		protocol: OMP_RUNTIME_PROTOCOL_NAME,
		protocolVersion: OMP_RUNTIME_SUPPORTED_RANGE,
		adapterVersion: OMP_ADAPTER_VERSION,
		locator: { kind: "adapter-resolved" },
		state: "bound" as const,
	};
}

export class OmpSession implements AgentRuntimeSession {
	readonly adapterId = OMP_ADAPTER_ID;
	readonly cwd: string;
	readonly capabilities: AgentRuntimeCapabilities;
	readonly controls: NonNullable<AgentRuntimeSession["controls"]>;
	private readonly listeners = new Set<(event: AgentRuntimeSemanticEvent) => void>();
	private binding: RuntimeSessionBinding;
	private disposed = false;
	private operationInFlight = false;
	private readonly client: OmpRpcClient;
	private readonly paths: OmpSessionPaths;
	private turn: OmpRpcTurnController;
	private thread: OmpThreadController;
	private hostTools: OmpHostToolBridge;
	private resourceDelivery: OmpResourceDelivery;

	constructor(
		readonly runtimeInstanceId: string,
		private readonly bundle: OmpProcessBundle,
		private readonly config: OmpRuntimeConfig,
		private readonly emitWarning: (message: string) => void,
		private readonly adapter?: { detachLiveSession(session: OmpSession): void },
	) {
		this.client = bundle.client;
		this.paths = bundle.paths;
		this.thread = bundle.threads;
		this.resourceDelivery = bundle.resourceDelivery;
		this.cwd = bundle.threads.current.cwd;
		this.binding = bindingForOmp("", runtimeInstanceId, undefined);
		this.capabilities = ompCapabilities();
		this.turn = new OmpRpcTurnController(this.client, (event) => this.emit(event));
		this.hostTools = new OmpHostToolBridge(this.client, undefined, this.toolExecutionContext(), (m) => this.emitWarning(m));
		this.controls = {
			getCurrentSession: () => this.thread.getSessionSnapshot(this.runtimeInstanceId),
			listSessions: () => this.thread.listSessions(this.runtimeInstanceId),
			getForkCandidates: () => this.forkCandidates(),
			forkSession: async (entryId) => await this.runIdleOperation(async () => {
				const previous = this.thread.getSessionSnapshot(this.runtimeInstanceId);
				const result = await this.thread.forkSession(this.runtimeInstanceId, entryId);
				this.updateBinding();
				return { previous, current: result.current, cancelled: result.cancelled };
			}),
			getReasoning: () => parseOmpReasoning(undefined),
			setReasoning: (value) => {
				this.assertIdle();
				const info = parseOmpReasoning(value);
				// Send the real OMP thinking-level change (best-effort; contract is sync).
				const level = info.value ?? "medium";
				void this.client.request({ type: "set_thinking_level", level }, "set_thinking_level").catch((error) => {
					this.emitWarning("OMP set_thinking_level failed: " + (error instanceof Error ? error.message : String(error)));
				});
				return info;
			},
			setFastMode: (enabled) => {
				this.assertIdle();
				void this.client.request({ type: "set_fast_mode", enabled }, "set_fast_mode").catch((error) => {
					this.emitWarning("OMP set_fast_mode failed: " + (error instanceof Error ? error.message : String(error)));
				});
				return { mode: enabled ? "fast" : "normal", supported: true, changed: true };
			},
			getFastMode: () => ({ mode: "normal", supported: true }),
			setModel: async (model) => await this.runIdleOperation(async () => {
				const provider = model.provider ?? this.config.defaultProvider ?? "";
				const modelId = model.id ?? this.config.defaultModel ?? "";
				if (!provider || !modelId) {
					throw new Error("OMP model switch requires a provider and model id.");
				}
				await setOmpModel(this.client, provider, modelId);
				return { provider, id: modelId };
			}),
			compact: async (customInstructions) => {
				this.assertIdle();
				return await this.client.request({ type: "compact", ...(customInstructions ? { customInstructions } : {}) }, "compact");
			},
		};
	}

	private toolExecutionContext(): PiboToolExecutionContext {
		return {
			cwd: this.cwd,
			runtimeInstanceId: this.runtimeInstanceId,
			adapterId: OMP_ADAPTER_ID,
		};
	}

	private forkCandidates(): AgentRuntimeForkCandidate[] {
		return this.thread.cachedForkCandidates();
	}

	private async setOmpModel(provider: string, modelId: string): Promise<AgentRuntimeModelInfo> {
		const info = await setOmpModel(this.client, provider, modelId);
		return info;
	}

	private updateBinding(): void {
		const snapshot = this.thread.getSessionSnapshot(this.runtimeInstanceId);
		if (snapshot.nativeSessionId) {
			this.binding = bindingForOmp(this.binding.piboSessionId, this.runtimeInstanceId, this.binding);
			this.binding = {
				...this.binding,
				nativeSessionId: snapshot.nativeSessionId,
				locator: snapshot.locator,
				metadata: {
					...(this.binding.metadata ?? {}),
					nativePresenceExpected: true,
					...(snapshot.name ? { sessionName: snapshot.name } : {}),
				},
			};
		}
	}

	setPiboSessionId(sessionId: string): void {
		this.binding = { ...this.binding, piboSessionId: sessionId };
	}

	/** Apply the resolved native session id from OMP state. */
	bindNativeSessionId(sessionId: string): void {
		this.binding = {
			...this.binding,
			nativeSessionId: sessionId,
			state: "bound",
			locator: { kind: "adapter-resolved", value: sessionId },
		};
	}

	/**
	 * Persist the on-disk OMP transcript path so a later `openSession` can pass
	 * it to `switch_session` (which expects the .jsonl file path, NOT the
	 * nativeSessionId UUID) to resume the same transcript.
	 */
	bindNativeSessionFile(sessionFile: string | undefined): void {
		if (!sessionFile) return;
		this.binding = {
			...this.binding,
			metadata: { ...(this.binding.metadata ?? {}), nativeSessionFile: sessionFile },
		};
	}

	/** Wire a real host-tool bridge backed by the Pibo portable tool session. */
	attachHostToolBridge(bridge: OmpHostToolBridge): void {
		this.hostTools = bridge;
	}

	/** Adapter-level reads route history/models/auth through the live client. */
	getClient(): OmpRpcClient {
		return this.client;
	}

	getBinding(): RuntimeSessionBinding {
		this.updateBinding();
		return structuredClone(this.binding);
	}

	subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void {
		this.assertActive();
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: AgentRuntimeSemanticEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	async prompt(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		this.operationInFlight = true;
		try {
			await this.turn.prompt(input.text);
			this.updateBinding();
		} finally {
			this.operationInFlight = false;
		}
	}

	async steer(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		await this.turn.steer(input.text);
	}

	async abort(): Promise<void> {
		this.assertActive();
		await this.turn.interrupt();
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.turn.dispose();
		await this.hostTools.cancelAll();
		this.hostTools.dispose();
		this.client.dispose();
		await disposeOmpSessionPaths(this.paths);
		// Notify the owning adapter so adapter-level reads stop routing to us.
		this.adapter?.detachLiveSession(this);
	}

	getStatus(): AgentRuntimeStatus {
		const hostInstalled = this.hostTools?.installedNames ?? [];
		// Report the tools Pibo actually mounted (host-tool bridge). OMP's own
		// native tools (bash/edit/…) remain engine-owned and are intentionally
		// not exported here — we do not claim an inventory we do not observe.
		return {
			streaming: this.turn.streaming,
			enabledTools: hostInstalled,
			cwd: this.cwd,
			reasoning: {
				supported: true,
				availableValues: [...OMP_REASONING_VALUES],
			},
		};
	}

	private assertIdle(): void {
		this.assertActive();
		if (this.operationInFlight) throw new Error("OMP session is busy with another operation.");
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("OMP session is disposed.");
	}

	private async runIdleOperation<T>(operation: () => Promise<T>): Promise<T> {
		this.assertIdle();
		this.operationInFlight = true;
		try {
			return await operation();
		} finally {
			this.operationInFlight = false;
		}
	}
}

export class OmpAgentRuntimeAdapter implements AgentRuntimeAdapter {
	readonly instanceId: string;
	readonly descriptor: AgentRuntimeDriver<OmpRuntimeConfig>["descriptor"];
	readonly config: PiboJsonObject;
	readonly displayName: string;
	readonly enabled: boolean;
	private readonly parsed: OmpRuntimeConfig;
	/** Handle to the currently-open session so history/auth/models route to it. */
	private live?: OmpSession;

	constructor(
		input: { instanceId: string; displayName: string; enabled: boolean; config: PiboJsonObject },
		driver: { descriptor: AgentRuntimeDriver<OmpRuntimeConfig>["descriptor"] },
	) {
		this.instanceId = input.instanceId;
		this.descriptor = driver.descriptor;
		this.config = structuredClone(input.config);
		this.displayName = input.displayName;
		this.enabled = input.enabled;
		this.parsed = parseOmpRuntimeConfig(input.config);
	}

	async diagnose(): Promise<readonly AgentRuntimeDiagnostic[]> {
		return await diagnoseOmpRuntime(this.parsed, this.instanceId);
	}

	validateProfile(input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[] {
		// Truthful capability validation is delegated to the profile resolver;
		// unsupported selections are rejected by the registry.
		return [];
	}

	async openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const binding = validateOpenBinding(input, this.instanceId);
		if (binding.state === "bound" && !binding.nativeSessionId) {
			throw new AgentRuntimeUnavailableError(this.instanceId, "The persisted OMP binding has no native session id.");
		}
		const paths = await prepareOmpSessionPaths({
			config: this.parsed,
			runtimeInstanceId: this.instanceId,
			piboSessionId: input.piboSession.id,
			sessionGeneration: randomUUID(),
		});
		if (binding.state === "unbound") await resetOmpNativeSession(paths);
		if (input.historyHandoff?.mode === "import" && binding.state === "bound") {
			throw new Error("OMP portable history import requires a new native session.");
		}
		// Materialize BEFORE spawn: OMP reads config.yml and append-system-prompt at startup.
		const resourceDelivery = new OmpResourceDelivery(
			this.parsed,
			paths,
			input.services?.resources,
			input.historyHandoff,
			input.profile.nativeSubagents ?? this.descriptor.capabilities.nativeSubagents.enabledByDefault,
		);
		const resourceResult = await resourceDelivery.prepare();
		input.services?.resources?.recordAdapterDelivery?.(resourceResult.reports, resourceResult.diagnostics);

		const environment = buildOmpProcessEnvironment({
			paths,
			config: this.parsed,
			baseEnvironment: process.env,
		});
		const command = resolveOmpCommand(this.parsed, paths, resourceDelivery.appendSystemPromptPath);
		const client = new OmpRpcClient({
			startupTimeoutMs: this.parsed.startupTimeoutMs,
			requestTimeoutMs: this.parsed.requestTimeoutMs,
		});
		try {
			await client.connect(command, { cwd: input.workspace, env: environment });
		} catch (error) {
			await client.dispose();
			await disposeOmpSessionPaths(paths);
			if (error instanceof OmpRpcResponseError) throw error;
			throw new AgentRuntimeUnavailableError(this.instanceId, `Failed to start OMP: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Determine native session id (+ transcript file path for later resume).
		let nativeSessionId: string | undefined = binding.nativeSessionId;
		let nativeSessionFile: string | undefined;
		try {
			const state = await client.request({ type: "get_state" }, "get_state");
			const data = state["data" as keyof typeof state];
			if (data && typeof data === "object" && !Array.isArray(data)) {
				const record = data as Record<string, unknown>;
				if (typeof record.sessionId === "string") nativeSessionId = record.sessionId;
				if (typeof record.sessionFile === "string") nativeSessionFile = record.sessionFile;
			}
		} catch {
			// state is best-effort; binding stays as resolved
		}

		const initial = {
			sessionId: nativeSessionId ?? binding.nativeSessionId ?? randomUUID(),
			cwd: input.workspace,
		};

		// Build the session and thread controllers with a client that supports
		// host-tool frames.
		const threads = new OmpThreadController(client, input.workspace, { sessionId: initial.sessionId });
		const bundle: OmpProcessBundle = { client, paths, threads, resourceDelivery };
		const session = new OmpSession(this.instanceId, bundle, this.parsed, (m) => {
			// Warning surfaced via session events is delivered by the turn controller.
		}, this);
		session.setPiboSessionId(input.piboSession.id);

		// Wire host tools after session construction so the executor is available.
		const portableTools = input.services?.portableTools;
		// Rebuild the session's hostTools with the real portable session (the
		// constructor used a placeholder). We recreate the bridge to avoid keeping
		// a hidden reference.
		const hb = new OmpHostToolBridge(
			client,
			portableTools,
			{
				cwd: input.workspace,
				runtimeInstanceId: this.instanceId,
				adapterId: OMP_ADAPTER_ID,
			},
			(m) => session["emitWarning"]?.(m),
		);
		client.subscribeFrames((frame) => {
			if (frame && typeof frame === "object" && (frame as { type?: string }).type === "host_tool_call") {
				void hb.handleFrame(frame);
			}
		});
		try {
			await hb.install();
			await threads.refresh();

			// Resume/F4: if this Pibo Session was previously bound to an OMP
			// native session, switch the new child into that persisted transcript
			// so history/context carry over instead of starting a fresh session.
			if (binding.state === "bound" && binding.nativeSessionId) {
				// switch_session takes the .jsonl transcript PATH, not the session
				// id UUID. Prefer the persisted transcript file (F4); fall back to
				// the id only when no file was recorded.
				const resumePath =
					(binding.metadata && typeof binding.metadata.nativeSessionFile === "string"
						? binding.metadata.nativeSessionFile
						: undefined) ?? binding.nativeSessionId;
				try {
					await client.request({ type: "switch_session", sessionPath: resumePath }, "switch_session");
					await threads.refresh();
					// OMP regenerates the session id on switch but restores the
					// transcript FILE. Re-read state so we persist the RESUMED
					// transcript path (not the fresh pre-switch session's file).
					const resumed = await client.request({ type: "get_state" }, "get_state");
					const resumedData = resumed["data" as keyof typeof resumed];
					if (resumedData && typeof resumedData === "object" && !Array.isArray(resumedData)) {
						const rr = resumedData as Record<string, unknown>;
						if (typeof rr.sessionFile === "string") nativeSessionFile = rr.sessionFile;
					}
				} catch (resumeError) {
					// Keep the fresh session; a failed switch is not fatal.
					// (bindNativeSessionId below still sets the binding.)
				}
			}

			// Prime fork candidates (get_branch_messages) for the sync SPI.
			void threads.loadForkCandidates(this.instanceId);
		} catch (error) {
			await client.dispose();
			await disposeOmpSessionPaths(paths);
			throw error;
		}
		session.attachHostToolBridge(hb);
		session.bindNativeSessionId(threads.current.sessionId);
		session.bindNativeSessionFile(nativeSessionFile);
		this.attachLiveSession(session);
		return session;
	}

	/** Record the live session so adapter-level reads can route to it. */
	attachLiveSession(session: OmpSession): void {
		this.live = session;
	}

	detachLiveSession(session: OmpSession): void {
		if (this.live === session) this.live = undefined;
	}

	async listModels(): Promise<AgentRuntimeModelCatalog> {
		if (this.live) {
			try {
				return await readOmpModelCatalog(this.live.getClient(), this.instanceId);
			} catch {
				// fall through to empty on transient engine error
			}
		}
		return { runtimeInstanceId: this.instanceId, models: [] };
	}

	async getAuthStatus(): Promise<readonly AgentRuntimeAuthStatus[]> {
		if (this.live) {
			try {
				const controller = new OmpAuthController(this.live.getClient());
				return await controller.getStatus();
			} catch {
				// fall through to unknown on transient engine error
			}
		}
		return [unknownOmpStatusForAdapter()];
	}

	async startAuth(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		throw new AgentRuntimeAuthError("orp_auth_unavailable", "OMP auth requires an open session.");
	}

	async cancelAuth(input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return { providerId: input.providerId, configured: false, state: "disconnected", message: "Login canceled." };
	}

	async logoutAuth(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult> {
		return { providerId: input.providerId, configured: false, state: "disconnected" };
	}

	async inspectHistory(input: InspectAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryInspection> {
		return inspectOmpHistory(input, this.instanceId);
	}

	async readHistory(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage> {
		if (this.live) {
			return await readOmpHistory(this.live.getClient(), input, this.instanceId, input.binding);
		}
		return emptyOmpHistoryPage(this.instanceId);
	}

	async resolveBinding(): Promise<RuntimeSessionBinding> {
		return {
			piboSessionId: "",
			runtimeInstanceId: this.instanceId,
			adapterId: OMP_ADAPTER_ID,
			state: "unbound",
		};
	}
}

export const OMP_AGENT_RUNTIME_DRIVER: AgentRuntimeDriver<OmpRuntimeConfig> = {
	descriptor: {
		id: OMP_ADAPTER_ID,
		displayName: "Oh My Pi",
		transport: "stdio-rpc",
		configSchema: OMP_RUNTIME_CONFIG_SCHEMA,
		capabilities: ompCapabilities(),
		protocol: { name: OMP_RUNTIME_PROTOCOL_NAME, supportedRange: OMP_RUNTIME_SUPPORTED_RANGE },
		supportsMultipleInstances: true,
	},
	defaultConfig() {
		return defaultOmpRuntimeConfig();
	},
	parseConfig(value) {
		return parseOmpRuntimeConfig(value);
	},
	create(input) {
		return new OmpAgentRuntimeAdapter(
			{ instanceId: input.instanceId, displayName: input.displayName ?? "Oh My Pi", enabled: input.enabled, config: input.config },
			{ descriptor: OMP_AGENT_RUNTIME_DRIVER.descriptor },
		);
	},
};

void OMP_MODEL_PROVIDER_ID;
void OmpAuthController;
void OmpRpcResponseError;
void readOmpAvailableCommands;
void inspectOmpHistory;
void OMP_RUNTIME_CAPABILITIES;