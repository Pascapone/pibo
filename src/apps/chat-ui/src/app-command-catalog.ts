import type { BootstrapData } from "./types";
import type { SlashCommand } from "./chat-commands";
import { defaultProfileFromBootstrap, findSessionNode } from "./app-session-model";

export type AppSkill = NonNullable<BootstrapData["agentCatalog"]>["skills"][number] | NonNullable<BootstrapData["agentCatalog"]>["userSkills"][number];

export function buildSlashCommands(actions: BootstrapData["capabilities"]["actions"]): SlashCommand[] {
	const commands = actions.flatMap((action): SlashCommand[] =>
		action.slashCommands
			.filter((command) => command !== "tree")
			.map((command): SlashCommand => ({
				slash: `/${command}`,
				action: action.name,
				description: action.name === "thinking" && command === "thinking"
					? "Show thinking level or use /thinking <level>."
					: action.description ?? action.name,
			})),
	);
	commands.push(
		{
			slash: "/download",
			action: "download",
			description: "Download a file by absolute path or relative to the current working directory.",
		},
		{
			slash: "/upload",
			action: "upload",
			description: "Upload one or more files to ~/.pibo/uploads.",
		},
		{
			slash: "/thinking-show",
			action: "thinking-show",
			description: "Toggle historical thinking display in this browser.",
		},
	);
	return commands;
}

export function availableSkillsForSession(bootstrap: BootstrapData | null, selectedPiboSessionId: string | null): AppSkill[] {
	if (!bootstrap) return [];
	const catalogSkills = bootstrap.agentCatalog?.skills ?? [];
	const userSkills = bootstrap.agentCatalog?.userSkills ?? [];
	const allSkills: AppSkill[] = [...catalogSkills, ...userSkills];

	const fallbackProfile = defaultProfileFromBootstrap(bootstrap);
	const selectedSessionProfile = selectedPiboSessionId
		? findSessionNode(bootstrap.sessions, selectedPiboSessionId)?.profile ?? fallbackProfile
		: fallbackProfile;

	const agentSkills = [
		...bootstrap.agents.map((agent) => ({ name: agent.name, skills: agent.skills })),
		...bootstrap.customAgents.map((agent) => ({ name: agent.profileName, skills: agent.skills })),
	];
	const currentAgent = agentSkills.find((agent) => agent.name === selectedSessionProfile);
	const allowedSkillNames = new Set(currentAgent?.skills ?? []);

	return allSkills.filter((skill) => allowedSkillNames.has(skill.name));
}
