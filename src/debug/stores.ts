import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type PiboDebugStoreName = "sessions" | "chat" | "agents" | "auth" | "bindings" | "reliability";

export type PiboDebugStore = {
	name: PiboDebugStoreName;
	description: string;
	defaultPath: string;
};

export type ResolvedPiboDebugStore = PiboDebugStore & {
	path: string;
	exists: boolean;
};

export const PIBO_DEBUG_STORES: readonly PiboDebugStore[] = [
	{
		name: "sessions",
		description: "canonical Pibo Session metadata",
		defaultPath: ".pibo/pibo-sessions.sqlite",
	},
	{
		name: "chat",
		description: "Chat Web read model, rooms, and durable chat events",
		defaultPath: ".pibo/web-chat.sqlite",
	},
	{
		name: "agents",
		description: "custom Agent Designer profiles",
		defaultPath: ".pibo/chat-agents.sqlite",
	},
	{
		name: "auth",
		description: "Better Auth local auth data",
		defaultPath: ".pibo/auth.sqlite",
	},
	{
		name: "bindings",
		description: "local session binding data",
		defaultPath: ".pibo/session-bindings.sqlite",
	},
	{
		name: "reliability",
		description: "Pibo event stream, durable jobs, and yielded runs",
		defaultPath: ".pibo/pibo-events.sqlite",
	},
];

export function resolveDebugStores(cwd = process.cwd()): ResolvedPiboDebugStore[] {
	return PIBO_DEBUG_STORES.map((store) => resolveDebugStore(store.name, cwd));
}

export function resolveDebugStore(name: string, cwd = process.cwd()): ResolvedPiboDebugStore {
	const store = PIBO_DEBUG_STORES.find((item) => item.name === name);
	if (!store) {
		throw new Error(`Unknown debug store "${name}". Use one of: ${PIBO_DEBUG_STORES.map((item) => item.name).join(", ")}`);
	}
	const path = resolve(cwd, store.defaultPath);
	return {
		...store,
		path,
		exists: existsSync(path),
	};
}
