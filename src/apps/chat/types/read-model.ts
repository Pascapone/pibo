import type { PiboOutputEvent } from "../../../core/events.js";
import type { ChatWebStoredEvent } from "../../../shared/trace-types.js";

export type { ChatWebStoredEvent };
export type ChatWebStoredPiboEvent = ChatWebStoredEvent<PiboOutputEvent>;

export type ChatWebSessionBootstrapIndexResult = {
	checked: number;
	written: number;
	skipped: number;
};

export type ChatWebSessionIndexItem = {
	piboSessionId: string;
	piSessionId: string;
	runtimeInstanceId?: string;
	runtimeAdapterId?: string;
	runtimeBindingState?: "unbound" | "bound" | "missing" | "error";
	nativeSessionId?: string;
	parentId?: string;
	profile: string;
	channel: string;
	kind: string;
	createdAt: string;
	updatedAt: string;
	lastActivityAt?: string;
	status: "idle" | "running" | "error";
};
