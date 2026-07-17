import type { PiboEventListener, PiboInputEvent, PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import type { PiboRunSnapshot } from "../runs/registry.js";
import type { PiboSignalPatch, PiboSignalSnapshot, PiboSignalStatusSnapshot } from "../signals/types.js";
import type {
	PiboCapabilityCatalog,
	PiboGatewayActionInfo,
	PiboProductEvent,
	PiboProductEventInput,
	PiboProductEventListener,
	PiboProfileDefinition,
	PiboProfileInfo,
} from "../plugins/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type { PiboWebApp } from "../web/types.js";
import type { PiboRalphStopConditionDefinition, PiboRalphStopConditionInfo } from "../ralph/types.js";
import type { ContextFileProfile, InitialSessionContext, ModelProfile, SkillProfile } from "../core/profiles.js";
import type {
	CreatePiboSessionInput,
	FindPiboSessionsInput,
	PiboSession,
	UpdatePiboSessionInput,
} from "../sessions/store.js";

export type PiboChannelAuthMode = "trusted-local" | "required" | "none";

export type PiboChannelAuth = {
	mode: PiboChannelAuthMode;
};

export type PiboChannelKind = "local" | "web" | "messaging" | "custom";

export type PiboChannelContext = {
	emit(event: PiboInputEvent): Promise<PiboOutputEvent>;
	subscribe(listener: PiboEventListener): () => void;
	getSession(id: string): PiboSession | undefined;
	createSession(input: CreatePiboSessionInput): PiboSession;
	updateSession?(id: string, input: UpdatePiboSessionInput): PiboSession | undefined;
	setLiveSessionActiveModel?(id: string, model: ModelProfile | undefined): Promise<ModelProfile | undefined>;
	reportSessionError?(id: string, error: string, options?: { eventId?: string; source?: "pi" | "pibo" }): void;
	deleteSession?(id: string): boolean;
	findSessions(input: FindPiboSessionsInput): PiboSession[];
	listSessions?(): PiboSession[];
	getSessionRuntimeStatus?(piboSessionId: string): PiboSessionStatus | undefined;
	listSessionRuntimeStatuses?(): PiboSessionStatus[];
	listRuns?(options?: { includeConsumed?: boolean; includeDetached?: boolean }): PiboRunSnapshot[];
	snapshotSignalSession?(piboSessionId: string): PiboSignalSnapshot;
	snapshotSignalTree?(rootPiboSessionId: string): PiboSignalSnapshot;
	snapshotSignalStatuses?(): PiboSignalStatusSnapshot;
	subscribeSignalTree?(rootPiboSessionId: string, listener: (patch: PiboSignalPatch) => void): () => void;
	subscribeSignalStatuses?(listener: (patch: PiboSignalPatch) => void): () => void;
	getGatewayActions(): PiboGatewayActionInfo[];
	getProfiles?(): PiboProfileInfo[];
	createProfile?(name: string): InitialSessionContext;
	getCapabilityCatalog?(): PiboCapabilityCatalog;
	getRalphStopConditionDefinitions?(): PiboRalphStopConditionDefinition[];
	getRalphStopConditionInfos?(): PiboRalphStopConditionInfo[];
	upsertProfile?(profile: PiboProfileDefinition): void;
	removeProfile?(name: string): void;
	upsertContextFile?(contextFile: ContextFileProfile): void;
	removeContextFile?(key: string): void;
	registerSkill?(skill: SkillProfile): void;
	unregisterSkill?(name: string): void;
	emitProductEvent?(event: PiboProductEventInput): PiboProductEvent;
	subscribeProductEvents?(listener: PiboProductEventListener): () => void;
	auth?: PiboAuthService;
	getWebApps(): PiboWebApp[];
};

export type PiboChannel = {
	name: string;
	kind?: PiboChannelKind;
	description?: string;
	auth: PiboChannelAuth;
	start(context: PiboChannelContext): Promise<void> | void;
	stop?(): Promise<void> | void;
};
