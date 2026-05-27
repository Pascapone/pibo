export type SaveState = "idle" | "saving" | "saved" | "error";

export type ProductEvent = {
	id?: string;
	type: string;
	source: string;
	actorId?: string;
	createdAt?: string;
	payload?: {
		key?: string;
		path?: string;
		version?: string;
		updatedAt?: string;
		[name: string]: unknown;
	};
};

export * from "./api-agent-designer";
export * from "./api-auth";
export * from "./api-chat-files";
export * from "./api-chat-sessions";
export * from "./api-context-files";
export * from "./api-cron";
export * from "./api-ralph";
export * from "./api-settings";
export * from "./api-trace-signals";
export * from "./api-web-annotations";
export * from "./api-workflows";
