import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";

type PiboSystemPromptTemplateOptions = {
	selectedTools?: string[];
	toolSnippets?: Record<string, string>;
	promptGuidelines?: string[];
};

export const PIBO_AVAILABLE_TOOLS_MARKER = "{{availableTools}}";
export const PIBO_GUIDELINES_MARKER = "{{guidelines}}";

export function hasPiboSystemPromptTemplateMarkers(systemPrompt: string): boolean {
	return systemPrompt.includes(PIBO_AVAILABLE_TOOLS_MARKER) || systemPrompt.includes(PIBO_GUIDELINES_MARKER);
}

export function buildPiboAvailableTools(options: PiboSystemPromptTemplateOptions): string {
	const tools = options.selectedTools || ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => !!options.toolSnippets?.[name]);
	if (visibleTools.length === 0) return "(none)";
	return visibleTools.map((name) => `- ${name}: ${options.toolSnippets![name]}`).join("\n");
}

export function buildPiboGuidelines(options: PiboSystemPromptTemplateOptions): string {
	const tools = options.selectedTools || ["read", "bash", "edit", "write"];
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) return;
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");

	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	} else if (hasBash && (hasGrep || hasFind || hasLs)) {
		addGuideline("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
	}

	for (const guideline of options.promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) addGuideline(normalized);
	}

	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	return guidelinesList.map((guideline) => `- ${guideline}`).join("\n");
}

export function renderPiboSystemPromptTemplate(
	systemPrompt: string,
	options: PiboSystemPromptTemplateOptions,
): string {
	if (!hasPiboSystemPromptTemplateMarkers(systemPrompt)) return systemPrompt;
	return systemPrompt
		.replaceAll(PIBO_AVAILABLE_TOOLS_MARKER, buildPiboAvailableTools(options))
		.replaceAll(PIBO_GUIDELINES_MARKER, buildPiboGuidelines(options));
}

export function createPiboSystemPromptTemplateExtension(): ExtensionFactory {
	return (pi) => {
		pi.on("before_agent_start", (event) => {
			const systemPrompt = renderPiboSystemPromptTemplate(event.systemPrompt, event.systemPromptOptions);
			return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
		});
	};
}
