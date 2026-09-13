import type { BootstrapData, UserSkill } from "./types";

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
