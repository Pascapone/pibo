import type { BootstrapData, ModelProfile, PiboWebSessionNode } from "./types";

export function defaultProfileFromBootstrap(bootstrap: BootstrapData): string {
	return bootstrap.session?.profile ?? bootstrap.agents[0]?.name ?? bootstrap.customAgents[0]?.profileName ?? "";
}

export function identityFromBootstrap(bootstrap: BootstrapData | null | undefined): BootstrapData["identity"] {
	return bootstrap?.identity ?? { userId: "user" };
}

export function resolveSessionActiveModelLabel(
	bootstrap: BootstrapData,
	session: Pick<PiboWebSessionNode, "profile" | "parentId" | "activeModel">,
): string | undefined {
	const model = resolveSessionActiveModel(bootstrap, session);
	return model ? formatModelProfile(model) : undefined;
}

export function findSessionNode(nodes: readonly PiboWebSessionNode[], piboSessionId: string): PiboWebSessionNode | undefined {
	for (const node of nodes) {
		if (node.piboSessionId === piboSessionId) return node;
		const child = findSessionNode(node.children, piboSessionId);
		if (child) return child;
	}
	return undefined;
}

export function findSessionPath(
	nodes: readonly PiboWebSessionNode[],
	piboSessionId: string,
	path: readonly PiboWebSessionNode[] = [],
): PiboWebSessionNode[] {
	for (const node of nodes) {
		const nextPath = [...path, node];
		if (node.piboSessionId === piboSessionId) return nextPath;
		const childPath = findSessionPath(node.children, piboSessionId, nextPath);
		if (childPath.length) return childPath;
	}
	return [];
}

export function createClientTxnId(): string {
	const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
	return `web-${Date.now().toString(36)}-${randomId}`;
}

function formatModelProfile(model: ModelProfile): string {
	return `${model.provider}/${model.id}`;
}

function resolveSessionActiveModel(
	bootstrap: BootstrapData,
	session: Pick<PiboWebSessionNode, "profile" | "parentId" | "activeModel">,
): ModelProfile | undefined {
	if (session.activeModel) return session.activeModel;
	const staticAgent = bootstrap.agents.find((agent) => agent.name === session.profile);
	if (staticAgent?.model) return staticAgent.model;

	const customAgent = bootstrap.customAgents.find((agent) => agent.profileName === session.profile);
	const profileModel = staticAgent ?? customAgent;
	if (session.parentId) return profileModel?.subagentModel ?? bootstrap.modelDefaults?.subagent;
	return profileModel?.mainModel ?? bootstrap.modelDefaults?.main;
}
