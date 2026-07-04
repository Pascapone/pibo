export type ProjectModuleDefinition = {
	id: "sessions" | string;
	label: string;
	routeSegment: string;
	enabled: boolean;
	description: string;
};

export const projectModules: readonly ProjectModuleDefinition[] = [
	{
		id: "sessions",
		label: "Sessions",
		routeSegment: "sessions",
		enabled: true,
		description: "Room-like chat sessions that always run in the project workspace.",
	},
	{
		id: "workflows",
		label: "Workflows",
		routeSegment: "workflows",
		enabled: false,
		description: "Workflow runs and graph authoring will return as a project module after the redesign.",
	},
	{
		id: "todos",
		label: "Todos / Kanban",
		routeSegment: "todos",
		enabled: false,
		description: "Project-scoped planning views are reserved for a later module.",
	},
	{
		id: "knowledge",
		label: "Knowledge",
		routeSegment: "knowledge",
		enabled: false,
		description: "Project-scoped knowledge, skills, MCPs, hooks, and heartbeat modules are deferred.",
	},
];
