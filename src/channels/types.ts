import type { PiboEventListener, PiboInputEvent, PiboOutputEvent } from "../core/events.js";
import type { PiboGatewayActionInfo } from "../plugins/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type { PiboWebApp } from "../web/types.js";
import type { PiboSessionBinding, ResolveSessionBindingInput, UpdateSessionBindingInput } from "../sessions/bindings.js";

export type PiboChannelAuthMode = "trusted-local" | "required" | "none";

export type PiboChannelAuth = {
	mode: PiboChannelAuthMode;
};

export type PiboChannelKind = "local" | "web" | "messaging" | "custom";

export type PiboChannelContext = {
	emit(event: PiboInputEvent): Promise<PiboOutputEvent>;
	subscribe(listener: PiboEventListener): () => void;
	resolveSession(input: ResolveSessionBindingInput): PiboSessionBinding;
	updateSession?(sessionKey: string, input: UpdateSessionBindingInput): PiboSessionBinding | undefined;
	listSessions?(): PiboSessionBinding[];
	getGatewayActions(): PiboGatewayActionInfo[];
	getProfiles?(): Array<{ name: string; description?: string; aliases: string[] }>;
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
