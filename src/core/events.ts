export type PiboEventSource = "user" | "ui" | "service" | "actor";

export type PiboMessageEvent = {
	type: "message";
	sessionKey: string;
	text: string;
	source?: PiboEventSource;
	id?: string;
};

export type BuiltinPiboExecutionAction = "status" | "session_id" | "clear_queue" | "abort" | "dispose";

export type PiboExecutionAction = BuiltinPiboExecutionAction | (string & {});

export type PiboExecutionEvent = {
	type: "execution";
	sessionKey: string;
	action: PiboExecutionAction;
	id?: string;
};

export type PiboInputEvent = PiboMessageEvent | PiboExecutionEvent;

export type PiboSessionStatus = {
	sessionKey: string;
	queuedMessages: number;
	processing: boolean;
	streaming: boolean;
	activeTools: string[];
	cwd: string;
	disposed: boolean;
};

export type PiboMessageQueuedEvent = {
	type: "message_queued";
	sessionKey: string;
	eventId?: string;
	queuedMessages: number;
	text: string;
	source?: PiboEventSource;
};

export type PiboMessageStartedEvent = {
	type: "message_started";
	sessionKey: string;
	eventId?: string;
	text: string;
	source?: PiboEventSource;
};

export type PiboAssistantMessageEvent = {
	type: "assistant_message";
	sessionKey: string;
	eventId?: string;
	text: string;
};

export type PiboOutputEvent =
	| PiboMessageQueuedEvent
	| PiboMessageStartedEvent
	| { type: "message_finished"; sessionKey: string; eventId?: string }
	| { type: "assistant_delta"; sessionKey: string; eventId?: string; text: string }
	| PiboAssistantMessageEvent
	| { type: "execution_result"; sessionKey: string; eventId?: string; action: PiboExecutionAction; result: unknown }
	| { type: "session_error"; sessionKey: string; eventId?: string; error: string }
	| { type: "pi_event"; sessionKey: string; event: unknown };

export type PiboEventListener = (event: PiboOutputEvent) => void;
