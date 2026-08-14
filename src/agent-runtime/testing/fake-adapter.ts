import { createMinimalAgentRuntimeCapabilities, type AgentRuntimeCapabilities } from "../capabilities.js";
import { AgentRuntimeBindingMissingError } from "../errors.js";
import type { AgentRuntimeSemanticEvent } from "../events.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeDiagnostic,
	AgentRuntimeDriver,
	AgentRuntimePromptInput,
	AgentRuntimeSession,
	AgentRuntimeStatus,
	OpenAgentRuntimeSessionInput,
	RuntimeSessionBinding,
	ValidateAgentRuntimeProfileInput,
} from "../types.js";
import type { PiboJsonObject } from "../../core/events.js";

export type FakeAgentRuntimeScript = {
	events?: readonly AgentRuntimeSemanticEvent[];
	failWith?: string;
	waitForAbort?: boolean;
	missingNativeSession?: boolean;
};

export type FakeAgentRuntimeConfig = PiboJsonObject & {
	script?: never;
};

export type FakeAgentRuntimeDriverOptions = {
	adapterId?: string;
	displayName?: string;
	capabilities?: AgentRuntimeCapabilities;
	script?: FakeAgentRuntimeScript | ((input: AgentRuntimePromptInput, promptIndex: number) => FakeAgentRuntimeScript);
	diagnostics?: readonly AgentRuntimeDiagnostic[];
};

export class FakeAgentRuntimeSession implements AgentRuntimeSession {
	readonly adapterId: string;
	readonly runtimeInstanceId: string;
	readonly cwd: string;
	readonly capabilities: AgentRuntimeCapabilities;
	private readonly listeners = new Set<(event: AgentRuntimeSemanticEvent) => void>();
	private binding: RuntimeSessionBinding;
	private streaming = false;
	private disposed = false;
	private aborted = false;
	private promptIndex = 0;
	private abortWaiters: Array<() => void> = [];
	readonly prompts: AgentRuntimePromptInput[] = [];
	disposeCalls = 0;
	abortCalls = 0;

	constructor(
		input: OpenAgentRuntimeSessionInput,
		adapterId: string,
		private readonly script: FakeAgentRuntimeDriverOptions["script"],
		capabilities: AgentRuntimeCapabilities,
		nativeSessionId: string,
	) {
		this.adapterId = adapterId;
		this.runtimeInstanceId = input.binding?.runtimeInstanceId ?? input.profile.runtimeInstanceId;
		this.cwd = input.workspace;
		this.capabilities = capabilities;
		this.binding = input.binding?.state === "bound"
			? { ...input.binding }
			: {
				piboSessionId: input.piboSession.id,
				runtimeInstanceId: this.runtimeInstanceId,
				adapterId: this.adapterId,
				nativeSessionId,
				state: "bound",
			};
	}

	getBinding(): RuntimeSessionBinding {
		return structuredClone(this.binding);
	}

	subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		this.prompts.push({ ...input });
		this.promptIndex += 1;
		this.streaming = true;
		this.aborted = false;
		const turnId = `fake-turn-${this.promptIndex}`;
		const script = typeof this.script === "function" ? this.script(input, this.promptIndex) : this.script ?? {};
		this.emit({ type: "turn_started", turnId });
		try {
			if (script.waitForAbort) {
				await new Promise<void>((resolve) => this.abortWaiters.push(resolve));
			}
			if (this.aborted) return;
			for (const event of script.events ?? []) this.emit(event);
			if (script.failWith) {
				this.emit({ type: "turn_failed", turnId, message: script.failWith });
				throw new Error(script.failWith);
			}
			this.emit({ type: "turn_completed", turnId, status: "completed" });
		} finally {
			this.streaming = false;
		}
	}

	async steer(input: AgentRuntimePromptInput): Promise<void> {
		this.assertActive();
		if (!this.streaming || !this.capabilities.input.steering) {
			throw new Error("Fake runtime is not accepting steering.");
		}
		this.prompts.push({ ...input });
	}

	async abort(): Promise<void> {
		this.abortCalls += 1;
		const wasStreaming = this.streaming;
		this.aborted = true;
		const waiters = this.abortWaiters;
		this.abortWaiters = [];
		for (const resolve of waiters) resolve();
		this.streaming = false;
		if (wasStreaming) this.emit({ type: "turn_completed", turnId: `fake-turn-${this.promptIndex}`, status: "aborted" });
	}

	async dispose(): Promise<void> {
		this.disposeCalls += 1;
		if (this.disposed) return;
		this.disposed = true;
		await this.abort();
		this.listeners.clear();
	}

	getStatus(): AgentRuntimeStatus {
		return {
			streaming: this.disposed ? false : this.streaming,
			enabledTools: [],
			cwd: this.cwd,
		};
	}

	private emit(event: AgentRuntimeSemanticEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("Fake runtime session is disposed.");
	}
}

export class FakeAgentRuntimeAdapter implements AgentRuntimeAdapter {
	readonly config: PiboJsonObject;
	readonly displayName: string;
	readonly enabled: boolean;
	readonly sessions: FakeAgentRuntimeSession[] = [];
	private nextNativeSession = 1;

	constructor(
		readonly instanceId: string,
		readonly descriptor: AgentRuntimeAdapter["descriptor"],
		config: PiboJsonObject,
		displayName: string | undefined,
		enabled: boolean,
		private readonly options: FakeAgentRuntimeDriverOptions,
	) {
		this.config = structuredClone(config);
		this.displayName = displayName ?? descriptor.displayName;
		this.enabled = enabled;
	}

	async diagnose(): Promise<readonly AgentRuntimeDiagnostic[]> {
		return [...(this.options.diagnostics ?? [])];
	}

	validateProfile(_input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[] {
		return [];
	}

	async openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const script = typeof this.options.script === "function"
			? this.options.script({ text: "", source: "rpc" }, 0)
			: this.options.script;
		if (script?.missingNativeSession && input.binding?.state === "bound") {
			throw new AgentRuntimeBindingMissingError(
				input.piboSession.id,
				this.instanceId,
				input.binding.nativeSessionId,
			);
		}
		const nativeSessionId = input.binding?.nativeSessionId ?? `fake-native-${this.nextNativeSession++}`;
		const normalizedInput: OpenAgentRuntimeSessionInput = {
			...input,
			binding: input.binding
				? { ...input.binding, adapterId: this.descriptor.id, runtimeInstanceId: this.instanceId }
				: undefined,
		};
		const session = new FakeAgentRuntimeSession(
			normalizedInput,
			this.descriptor.id,
			this.options.script,
			this.descriptor.capabilities,
			nativeSessionId,
		);
		this.sessions.push(session);
		return session;
	}
}

export function createFakeAgentRuntimeDriver(options: FakeAgentRuntimeDriverOptions = {}): AgentRuntimeDriver<PiboJsonObject> {
	const adapterId = options.adapterId ?? "fake";
	const descriptor = {
		id: adapterId,
		displayName: options.displayName ?? "Fake Agent Runtime",
		transport: "embedded" as const,
		configSchema: {
			type: "object",
			additionalProperties: false,
		},
		capabilities: options.capabilities ?? createMinimalAgentRuntimeCapabilities(),
		supportsMultipleInstances: true,
	};
	return {
		descriptor,
		defaultConfig: () => ({}),
		parseConfig(value) {
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config must be an object");
			if (Object.keys(value).length > 0) throw new Error("fake runtime config does not accept instance fields");
			return {};
		},
		create(input) {
			return new FakeAgentRuntimeAdapter(
				input.instanceId,
				descriptor,
				input.config,
				input.displayName,
				input.enabled,
				options,
			);
		},
	};
}
