import type { AgentCatalog, BootstrapData, UserSkill } from "./types";

type McpServerCatalogItem = AgentCatalog["mcpServers"][number];

export function updateAgentCatalogMcpServer(data: BootstrapData, server: McpServerCatalogItem): BootstrapData {
	if (!data.agentCatalog) return data;
	return {
		...data,
		agentCatalog: {
			...data.agentCatalog,
			mcpServers: data.agentCatalog.mcpServers.map((candidate) => candidate.name === server.name ? server : candidate),
		},
	};
}

export function upsertAgentCatalogUserSkill(data: BootstrapData, skill: UserSkill): BootstrapData {
	if (!data.agentCatalog) return data;
	const others = data.agentCatalog.userSkills.filter((candidate) => candidate.id !== skill.id);
	return {
		...data,
		agentCatalog: {
			...data.agentCatalog,
			userSkills: sortByName([...others, skill]),
		},
	};
}

export function removeAgentCatalogUserSkill(data: BootstrapData, skillId: string): BootstrapData {
	if (!data.agentCatalog) return data;
	return {
		...data,
		agentCatalog: {
			...data.agentCatalog,
			userSkills: data.agentCatalog.userSkills.filter((candidate) => candidate.id !== skillId),
		},
	};
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
	return items.sort((left, right) => left.name.localeCompare(right.name));
}
