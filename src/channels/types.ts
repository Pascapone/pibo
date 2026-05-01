import type { PiboEventListener, PiboInputEvent, PiboOutputEvent } from "../core/events.js";
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
import type { ContextFileProfile } from "../core/profiles.js";
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
	deleteSession?(id: string): boolean;
	findSessions(input: FindPiboSessionsInput): PiboSession[];
	listSessions?(): PiboSession[];
	getGatewayActions(): PiboGatewayActionInfo[];
	getProfiles?(): PiboProfileInfo[];
	getCapabilityCatalog?(): PiboCapabilityCatalog;
	upsertProfile?(profile: PiboProfileDefinition): void;
	removeProfile?(name: string): void;
	upsertContextFile?(contextFile: ContextFileProfile): void;
	removeContextFile?(key: string): void;
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
