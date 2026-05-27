import { requestJson } from "./api-http";
import type { AgentCatalog, CustomAgent, ModelProfile, UserSkill } from "./types";

export type ContextBuildDiagnostic = {
	type: "info" | "warning" | "error";
	message: string;
	nodeId?: string;
};

export type ContextBuildNode = {
	id: string;
	parentId?: string;
	order: number;
	kind: string;
	title: string;
	source: string;
	state?: "active" | "disabled" | "skipped" | "warning" | "error";
	badges?: string[];
	metadata?: Record<string, unknown>;
	path?: string;
	key?: string;
	provider?: string;
	bytes?: number;
	estimatedTokens?: number;
	estimatedSubtreeTokens?: number;
	children?: ContextBuildNode[];
	hydratedText?: string;
	schemaJson?: unknown;
	payloadJson?: unknown;
	notes?: string[];
	redacted?: boolean;
	approximate?: boolean;
};

export type ContextBuildSnapshot = {
	version: 1;
	generatedAt: string;
	profileName: string;
	piboSessionId?: string;
	piboRoomId?: string;
	cwd: string;
	activeModel?: ModelProfile;
	summary: {
		topLevelNodes: number;
		totalNodes: number;
		estimatedTokens: number;
		warnings: number;
		errors: number;
	};
	nodes: ContextBuildNode[];
	diagnostics: ContextBuildDiagnostic[];
};

export type SaveCustomAgentInput = {
	displayName: string;
	description?: string;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: CustomAgent["subagents"];
	mcpServers: string[];
	piPackages: string[];
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	thinkingLevel?: CustomAgent["thinkingLevel"] | null;
	mainThinkingLevel?: CustomAgent["mainThinkingLevel"] | null;
	subagentThinkingLevel?: CustomAgent["subagentThinkingLevel"] | null;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	builtinTools: "default" | "disabled";
	builtinToolNames: string[];
	autoContextFiles: boolean;
	runControl: boolean;
};

export async function getAgentCatalog(): Promise<{
	catalog: AgentCatalog;
	profiles: Array<{ name: string; description?: string; aliases: string[] }>;
}> {
	return requestJson("/api/chat/agent-catalog");
}

export async function getCustomAgents(): Promise<{ agents: CustomAgent[] }> {
	return requestJson("/api/chat/agents");
}

export async function getContextBuild(input: { piboSessionId: string }): Promise<ContextBuildSnapshot> {
	const params = new URLSearchParams({ piboSessionId: input.piboSessionId });
	return (await requestJson<{ snapshot: ContextBuildSnapshot }>(`/api/chat/context-build?${params.toString()}`)).snapshot;
}

export async function postCustomAgent(input: SaveCustomAgentInput): Promise<{ agent: CustomAgent }> {
	return requestJson("/api/chat/agents", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchCustomAgent(
	id: string,
	input: Partial<SaveCustomAgentInput> & { archived?: boolean },
): Promise<{ agent: CustomAgent }> {
	return requestJson(`/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteCustomAgent(id: string, confirmName: string): Promise<{ deletedAgentId: string; deletedSessionIds: string[] }> {
	return requestJson(`/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmName }),
	});
}

export async function patchMcpServerDescription(name: string, description: string): Promise<{
	server: AgentCatalog["mcpServers"][number];
}> {
	return requestJson(`/api/chat/mcp-servers/${encodeURIComponent(name)}/description`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ description }),
	});
}

export async function postPiPackage(source: string): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ package: AgentCatalog["piPackages"][number] }>("/api/chat/pi-packages", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ source }),
	})).package;
}

export async function patchPiPackage(
	id: string,
	input: { enabled: boolean },
): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ package: AgentCatalog["piPackages"][number] }>(`/api/chat/pi-packages/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).package;
}

export async function deletePiPackage(id: string): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ removedPackage: AgentCatalog["piPackages"][number] }>(`/api/chat/pi-packages/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).removedPackage;
}

export async function listUserSkills(): Promise<UserSkill[]> {
	return (await requestJson<{ skills: UserSkill[] }>("/api/chat/user-skills")).skills;
}

export async function getUserSkill(id: string): Promise<{ skill: UserSkill; markdown: string }> {
	return requestJson(`/api/chat/user-skills/${encodeURIComponent(id)}`);
}

export async function createUserSkill(input: { name: string; description: string; markdown: string }): Promise<UserSkill> {
	return (await requestJson<{ skill: UserSkill }>("/api/chat/user-skills", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).skill;
}

export async function updateUserSkill(
	id: string,
	input: Partial<{ name: string; description: string; markdown: string; enabled: boolean }>,
): Promise<UserSkill> {
	return (await requestJson<{ skill: UserSkill }>(`/api/chat/user-skills/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).skill;
}

export async function deleteUserSkill(id: string): Promise<{ removedSkillId: string }> {
	return requestJson(`/api/chat/user-skills/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function installUserSkill(url: string): Promise<UserSkill> {
	return (await requestJson<{ skill: UserSkill }>("/api/chat/user-skills/install", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ url }),
	})).skill;
}
