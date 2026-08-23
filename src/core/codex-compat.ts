import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type CodexCompatExtensionOptions = {
	shell?: string;
	isChildSession?: boolean;
};

function currentDate(): string {
	return new Date().toISOString().slice(0, 10);
}

function currentTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function buildCodexCompatSystemPrompt(options: {
	baseSystemPrompt: string;
	cwd: string;
	shell: string;
	currentDate?: string;
	timezone?: string;
	isChildSession?: boolean;
}): string {
	const childInstructions = options.isChildSession
		? [
				"## Delegated Child Agent",
				"You are a child agent working as part of a team. Complete the delegated task, continue the thread when the parent sends more input, and return a concise final result for the parent agent.",
			].join("\n")
		: "";

	const compatibilityInstructions = [
		"# Codex-Compatible Runtime",
		"You are running in Pibo through the codex-compat profile. Match Codex-style tool use where the exposed Pibo tools support it, while staying truthful about implemented behavior.",
		"Use Pibo's pibo_run_* and pibo_agents_* tools for parallel work, yielded runs, and delegated-agent lifecycle management.",
		"Use direct execution for normal coding tasks. If a structured planning or user-input tool is not present, ask concise questions in normal chat.",
		"When web_search is selected by the profile, use it for current or externally sourced information.",
		childInstructions,
		"<environment_context>",
		`  <cwd>${options.cwd}</cwd>`,
		`  <shell>${options.shell}</shell>`,
		`  <current_date>${options.currentDate ?? currentDate()}</current_date>`,
		`  <timezone>${options.timezone ?? currentTimezone()}</timezone>`,
		"</environment_context>",
		options.baseSystemPrompt,
	];

	return compatibilityInstructions.filter((section) => section.trim().length > 0).join("\n\n");
}

export function createCodexCompatExtension(options: CodexCompatExtensionOptions = {}): ExtensionFactory {
	return (pi) => {
		pi.on("before_agent_start", (event, ctx) => ({
			systemPrompt: buildCodexCompatSystemPrompt({
				baseSystemPrompt: event.systemPrompt,
				cwd: ctx.cwd,
				shell: options.shell ?? process.env.SHELL ?? "bash",
				isChildSession: options.isChildSession,
			}),
		}));
	};
}
