import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export type ToolProfile = {
	name: string;
	description?: string;
	enabled?: boolean;
	definition?: ToolDefinition;
};

export type SkillProfile = {
	name: string;
	path: string;
	enabled?: boolean;
};

export type ContextFileProfile = {
	path: string;
	label?: string;
	enabled?: boolean;
};

export type BuiltinToolsMode = "default" | "disabled";

export type InitialSessionContextOptions = {
	profileName: string;
	sessionId?: string;
	skills?: readonly SkillProfile[];
	tools?: readonly ToolProfile[];
	contextFiles?: readonly ContextFileProfile[];
	builtinTools?: BuiltinToolsMode;
};

export class InitialSessionContext {
	readonly profileName: string;
	readonly sessionId?: string;
	readonly skills: readonly SkillProfile[];
	readonly tools: readonly ToolProfile[];
	readonly contextFiles: readonly ContextFileProfile[];
	readonly builtinTools: BuiltinToolsMode;

	constructor(options: InitialSessionContextOptions) {
		this.profileName = options.profileName;
		this.sessionId = options.sessionId;
		this.skills = [...(options.skills ?? [])];
		this.tools = [...(options.tools ?? [])];
		this.contextFiles = [...(options.contextFiles ?? [])];
		this.builtinTools = options.builtinTools ?? "default";
	}
}

export class InitialSessionContextBuilder {
	private readonly profileName: string;
	private sessionId?: string;
	private skills: SkillProfile[] = [];
	private tools: ToolProfile[] = [];
	private contextFiles: ContextFileProfile[] = [];
	private builtinTools: BuiltinToolsMode = "default";

	constructor(profileName: string) {
		this.profileName = profileName;
	}

	withSessionId(sessionId: string): this {
		this.sessionId = sessionId;
		return this;
	}

	withBuiltinTools(mode: BuiltinToolsMode): this {
		this.builtinTools = mode;
		return this;
	}

	addSkill(skill: SkillProfile): this {
		this.skills.push(skill);
		return this;
	}

	addSkills(skills: readonly SkillProfile[]): this {
		this.skills.push(...skills);
		return this;
	}

	addTool(tool: ToolProfile): this {
		this.tools.push(tool);
		return this;
	}

	addTools(tools: readonly ToolProfile[]): this {
		this.tools.push(...tools);
		return this;
	}

	addContextFile(contextFile: ContextFileProfile): this {
		this.contextFiles.push(contextFile);
		return this;
	}

	addContextFiles(contextFiles: readonly ContextFileProfile[]): this {
		this.contextFiles.push(...contextFiles);
		return this;
	}

	createSession(): InitialSessionContext {
		return new InitialSessionContext({
			profileName: this.profileName,
			sessionId: this.sessionId,
			skills: this.skills,
			tools: this.tools,
			contextFiles: this.contextFiles,
			builtinTools: this.builtinTools,
		});
	}
}
