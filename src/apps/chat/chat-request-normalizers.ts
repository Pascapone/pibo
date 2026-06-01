import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { PiboJsonObject } from "../../core/events.js";
import type { PiboBasePromptMode } from "../../core/base-prompt.js";
import type { PiboCompactionPromptMode } from "../../core/compaction-prompt.js";
import { savePiboModelDefaults, type PiboModelDefaults } from "../../core/model-defaults.js";
import type { ModelProfile } from "../../core/profiles.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../../core/thinking.js";
import type { PiboSession, UpdatePiboSessionInput } from "../../sessions/store.js";
import { PiboWebHttpError } from "../../web/http.js";
import type { PiboWebAppContext } from "../../web/types.js";
import { listPiPackages } from "../../pi-packages/store.js";
import { withChatWebArchived } from "./session-metadata.js";
import { isDefaultPiboRoom, withPiboRoomArchived, withPiboRoomWorkspace, type PiboRoom } from "./types/rooms.js";
import { isValidCustomAgentName, type CustomAgentSubagent, type UpdateCustomAgentInput } from "./agent-store.js";

export type ChatSessionCreateBody = {
	profile?: unknown;
	roomId?: unknown;
};

export type ChatProjectCreateBody = {
	name?: unknown;
	description?: unknown;
	projectFolder?: unknown;
	createFolder?: unknown;
};

export type ChatProjectPatchBody = {
	name?: unknown;
	description?: unknown;
	archived?: unknown;
};

export type ChatProjectDeleteBody = {
	confirmName?: unknown;
	deleteFiles?: unknown;
};

export type ChatProjectSessionPatchBody = {
	title?: unknown;
	archived?: unknown;
};

export type ChatSessionDeleteBody = {
	confirmText?: unknown;
};

export type ChatRoomCreateBody = {
	name?: unknown;
	topic?: unknown;
	workspace?: unknown;
	type?: unknown;
	parentRoomId?: unknown;
};

export type ChatRoomPatchBody = {
	name?: unknown;
	topic?: unknown;
	workspace?: unknown;
	parentRoomId?: unknown;
	archived?: unknown;
};

export type ChatRoomDeleteBody = {
	confirmName?: unknown;
};

export type ChatAgentBody = {
	displayName?: unknown;
	description?: unknown;
	nativeTools?: unknown;
	skills?: unknown;
	contextFiles?: unknown;
	subagents?: unknown;
	mcpServers?: unknown;
	piPackages?: unknown;
	mainModel?: unknown;
	subagentModel?: unknown;
	thinkingLevel?: unknown;
	mainThinkingLevel?: unknown;
	subagentThinkingLevel?: unknown;
	fast?: unknown;
	mainFast?: unknown;
	subagentFast?: unknown;
	builtinTools?: unknown;
	builtinToolNames?: unknown;
	autoContextFiles?: unknown;
	runControl?: unknown;
	archived?: unknown;
	confirmName?: unknown;
};

export type ChatMcpServerDescriptionBody = {
	description?: unknown;
};

export type ChatBasePromptBody = {
	mode?: unknown;
	markdown?: unknown;
};

export type ChatPiPackageBody = {
	source?: unknown;
};

export type ChatPiPackagePatchBody = {
	enabled?: unknown;
	source?: unknown;
};

export type ChatModelDefaultsBody = {
	main?: unknown;
	subagent?: unknown;
	thinking?: unknown;
	mainThinking?: unknown;
	subagentThinking?: unknown;
	fast?: unknown;
	mainFast?: unknown;
	subagentFast?: unknown;
};

export type ChatUserSettingsBody = {
	timezone?: unknown;
	shortcuts?: unknown;
};

export type ChatMessageBody = {
	piboSessionId?: unknown;
	roomId?: unknown;
	text?: unknown;
	clientTxnId?: unknown;
	webAnnotationIds?: unknown;
	fileAttachmentPaths?: unknown;
};

export type ChatStreamingFixtureBody = {
	piboSessionId?: unknown;
	roomId?: unknown;
	deltas?: unknown;
	cadenceMs?: unknown;
	profile?: unknown;
	mix?: unknown;
	preludeMessages?: unknown;
	preludeOnly?: unknown;
	traceSnapshots?: unknown;
	suppressLiveDeltas?: unknown;
};

export type ChatStreamingFixtureProfile = "steady" | "jitter" | "burst" | "batch";
export type ChatStreamingFixtureMix = "text" | "reasoning-text" | "markdown" | "gfm-markdown" | "gfm-task-markdown" | "gfm-full-markdown";

export function normalizeRoomName(value: unknown, fallback = "New Chat"): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string") throw new PiboWebHttpError("Room name must be a string", 400);
	const name = value.replace(/\s+/g, " ").trim();
	if (!name) throw new PiboWebHttpError("Room name is required", 400);
	if (name.length > 120) throw new PiboWebHttpError("Room name is too long", 400);
	return name;
}

export function normalizeRoomTopic(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Room topic must be a string", 400);
	const topic = value.replace(/\s+/g, " ").trim();
	if (!topic) return undefined;
	if (topic.length > 500) throw new PiboWebHttpError("Room topic is too long", 400);
	return topic;
}

export function normalizeOptionalRoomTopic(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	return normalizeRoomTopic(value) ?? null;
}

export function normalizeRoomType(value: unknown): "space" | "chat" | "agent" {
	if (value === undefined) return "chat";
	if (value === "space" || value === "chat" || value === "agent") return value;
	throw new PiboWebHttpError("Room type is invalid", 400);
}

export function normalizeParentRoomId(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Parent room id must be a string", 400);
	return value;
}

export function normalizeOptionalParentRoomId(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === "") return null;
	if (typeof value !== "string") throw new PiboWebHttpError("Parent room id must be a string", 400);
	return value;
}

export function normalizeRoomArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("Room archived flag must be boolean", 400);
	return value;
}

export function normalizeRoomWorkspace(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Room workspace must be a string", 400);
	const workspace = value.trim();
	if (!workspace) return undefined;
	if (!isAbsolute(workspace)) {
		throw new PiboWebHttpError("Room workspace must be an absolute path", 400);
	}
	if (!existsSync(workspace)) {
		throw new PiboWebHttpError(`Room workspace does not exist: ${workspace}`, 400);
	}
	if (!statSync(workspace).isDirectory()) {
		throw new PiboWebHttpError(`Room workspace is not a directory: ${workspace}`, 400);
	}
	return workspace;
}

export function normalizeOptionalRoomWorkspace(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	return normalizeRoomWorkspace(value) ?? null;
}

export function normalizeRoomDeleteConfirmation(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Type the room name to permanently delete it.", 400);
	}
	return value.trim();
}

export function normalizeAgentDisplayName(value: unknown, fallback = "new-agent"): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string") throw new PiboWebHttpError("Agent name must be a string", 400);
	const name = value.trim();
	if (!name) throw new PiboWebHttpError("Agent name is required", 400);
	if (name.length > 120) throw new PiboWebHttpError("Agent name is too long", 400);
	if (!isValidCustomAgentName(name)) {
		throw new PiboWebHttpError("Agent name must be lowercase kebab-case, for example test-agent", 400);
	}
	return name;
}

export function normalizeAgentDescription(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Agent description must be a string", 400);
	const description = value.trim();
	if (!description) return undefined;
	if (description.length > 1000) throw new PiboWebHttpError("Agent description is too long", 400);
	return description;
}

export function normalizeNameArray(value: unknown, label: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new PiboWebHttpError(`${label} must be an array`, 400);
	const names = value.map((item) => {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw new PiboWebHttpError(`${label} entries must be non-empty strings`, 400);
		}
		return item.trim();
	});
	return [...new Set(names)];
}

export function normalizeRegisteredPiPackages(value: unknown): string[] {
	const names = normalizeNameArray(value, "piPackages");
	const packages = listPiPackages();
	const registered = new Map(packages.flatMap((pkg) => [[pkg.id, pkg.id], [pkg.name, pkg.id]]));
	for (const name of names) {
		if (!registered.has(name)) throw new PiboWebHttpError(`Unknown Pi package "${name}"`, 400);
	}
	return [...new Set(names.map((name) => registered.get(name) ?? name))];
}

export function normalizePiPackageWebSource(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Pi package source is required", 400);
	}
	const source = value.trim();
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		throw new PiboWebHttpError("Pi package source must be a https://pi.dev/packages/... URL", 400);
	}
	if (url.origin !== "https://pi.dev" || !url.pathname.startsWith("/packages/") || url.pathname === "/packages/") {
		throw new PiboWebHttpError("Pi package source must be a https://pi.dev/packages/... URL", 400);
	}
	return source;
}

export function normalizeBuiltinTools(value: unknown): "default" | "disabled" {
	if (value === undefined) return "default";
	if (value === "default" || value === "disabled") return value;
	throw new PiboWebHttpError("builtinTools must be default or disabled", 400);
}

export function normalizeBuiltinToolNames(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	return normalizeNameArray(value, "builtinToolNames");
}

export function normalizeAutoContextFiles(value: unknown): boolean {
	if (value === undefined) return true;
	if (typeof value !== "boolean") throw new PiboWebHttpError("autoContextFiles must be a boolean", 400);
	return value;
}

export function normalizeRunControl(value: unknown): boolean {
	if (value === undefined) return false;
	if (typeof value !== "boolean") throw new PiboWebHttpError("runControl must be a boolean", 400);
	return value;
}

export function normalizeOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError(`${fieldName} must be a boolean`, 400);
	return value;
}

export function normalizeThinkingLevel(value: unknown, fieldName: string): PiboThinkingLevel | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || !isPiboThinkingLevel(value)) {
		throw new PiboWebHttpError(`${fieldName} must be one of off, minimal, low, medium, high, xhigh`, 400);
	}
	return value;
}

export function normalizeModelProfile(value: unknown, fieldName: string): ModelProfile | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new PiboWebHttpError(`${fieldName} must be an object`, 400);
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw.provider !== "string" || typeof raw.id !== "string") {
		throw new PiboWebHttpError(`${fieldName} must include provider and id`, 400);
	}
	const provider = raw.provider.trim();
	const id = raw.id.trim();
	if (!provider || !id) {
		throw new PiboWebHttpError(`${fieldName} must include provider and id`, 400);
	}
	return { provider, id };
}

export function normalizeMcpServerDescriptionBody(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("MCP server description must be a string", 400);
	const description = value.replace(/\s+/g, " ").trim();
	if (!description) throw new PiboWebHttpError("MCP server description is required", 400);
	if (description.length > 480) throw new PiboWebHttpError("MCP server description is too long", 400);
	return description;
}

export function normalizeBasePromptMode(value: unknown): PiboBasePromptMode {
	if (value === "library" || value === "custom") return value;
	throw new PiboWebHttpError("mode must be library or custom", 400);
}

export function normalizeCompactionPromptMode(value: unknown): PiboCompactionPromptMode {
	if (value === "library" || value === "custom") return value;
	throw new PiboWebHttpError("mode must be library or custom", 400);
}

export function normalizeBasePromptMarkdown(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("markdown must be a string", 400);
	return value;
}

export function normalizeCompactionPromptMarkdown(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("markdown must be a string", 400);
	return value;
}

export function normalizeUserSkillName(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Skill name is required", 400);
	}
	const name = value.trim();
	if (name.length > 64) throw new PiboWebHttpError("Skill name is too long", 400);
	if (!/^[a-z][a-z0-9-]*$/.test(name)) {
		throw new PiboWebHttpError("Skill name must be lowercase kebab-case, e.g. my-skill", 400);
	}
	return name;
}

export function normalizeUserSkillDescription(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("Skill description must be a string", 400);
	return value.trim();
}

export function normalizeUserSkillMarkdown(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("Skill markdown must be a string", 400);
	return value;
}

export function normalizeUserSkillEnabled(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("enabled must be a boolean", 400);
	return value;
}

export function normalizeUserSkillUrl(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Skill URL is required", 400);
	}
	const url = value.trim();
	if (!url.startsWith("http://") && !url.startsWith("https://") && !url.includes("/")) {
		throw new PiboWebHttpError("Skill URL must be a valid URL or owner/repo shorthand", 400);
	}
	return url;
}

export function normalizeAgentArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("archived must be a boolean", 400);
	return value;
}

export function normalizeAgentSubagents(value: unknown): CustomAgentSubagent[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new PiboWebHttpError("subagents must be an array", 400);
	return value.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new PiboWebHttpError("subagent entries must be objects", 400);
		}
		const raw = item as Record<string, unknown>;
		const name = normalizeAgentDisplayName(raw.name, "");
		if (typeof raw.targetProfile !== "string" || raw.targetProfile.trim().length === 0) {
			throw new PiboWebHttpError("subagent targetProfile is required", 400);
		}
		const subagent: CustomAgentSubagent = {
			name,
			targetProfile: raw.targetProfile.trim(),
		};
		const description = normalizeAgentDescription(raw.description);
		if (description) subagent.description = description;
		if (raw.timeoutMs !== undefined) {
			if (typeof raw.timeoutMs !== "number" || !Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0) {
				throw new PiboWebHttpError("subagent timeoutMs must be a positive number", 400);
			}
			subagent.timeoutMs = Math.round(raw.timeoutMs);
		}
		if (raw.maxDepth !== undefined) {
			if (typeof raw.maxDepth !== "number" || !Number.isFinite(raw.maxDepth) || raw.maxDepth < 1) {
				throw new PiboWebHttpError("subagent maxDepth must be a positive number", 400);
			}
			subagent.maxDepth = Math.round(raw.maxDepth);
		}
		return subagent;
	});
}

export function normalizeClientTxnId(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("clientTxnId must be a string", 400);
	const id = value.trim();
	if (!id) throw new PiboWebHttpError("clientTxnId must be a non-empty string", 400);
	if (id.length > 160) throw new PiboWebHttpError("clientTxnId is too long", 400);
	return id;
}

export function normalizeSessionDeleteConfirmation(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError('Type "Delete this session" to permanently delete it.', 400);
	}
	return value.trim();
}

export function normalizeMessageText(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Message text is required", 400);
	}
	return value;
}

export function defaultStreamingFixtureDeltas(mix: ChatStreamingFixtureMix): string[] {
	if (mix === "markdown") return [" **a**", " **b**", " **c**", " **d**", " **e**", " **f**", " **g**", " **h**", " **i**", " **j**", " **k**", " **l**"];
	if (mix === "gfm-markdown") return [" ~~a~~", " ~~b~~", " ~~c~~", " ~~d~~", " ~~e~~", " ~~f~~", " ~~g~~", " ~~h~~", " ~~i~~", " ~~j~~", " ~~k~~", " ~~l~~"];
	if (mix === "gfm-task-markdown") return ["- [ ] [_**a**_](https://e.co/a)", " [_**b**_](https://e.co/b)", " [_**c**_](https://e.co/c)", " [_**d**_](https://e.co/d)", " [_**e**_](https://e.co/e)", " [_**f**_](https://e.co/f)", " [_**g**_](https://e.co/g)", " [_**h**_](https://e.co/h)", " [_**i**_](https://e.co/i)", " [_**j**_](https://e.co/j)", " [_**k**_](https://e.co/k)", " [_**l**_](https://e.co/l)"];
	if (mix === "gfm-full-markdown") return ["- [ ] [_~~a~~_](https://e.co/a)", " [_~~b~~_](https://e.co/b)", " [_~~c~~_](https://e.co/c)", " [_~~d~~_](https://e.co/d)", " [_~~e~~_](https://e.co/e)", " [_~~f~~_](https://e.co/f)", " [_~~g~~_](https://e.co/g)", " [_~~h~~_](https://e.co/h)", " [_~~i~~_](https://e.co/i)", " [_~~j~~_](https://e.co/j)", " [_~~k~~_](https://e.co/k)", " [_~~l~~_](https://e.co/l)"];
	return [" a", " b", " c", " d", " e", " f", " g", " h", " i", " j", " k", " l"];
}

export function normalizeStreamingFixtureDeltas(value: unknown, mix: ChatStreamingFixtureMix): string[] {
	if (value === undefined) return defaultStreamingFixtureDeltas(mix);
	if (!Array.isArray(value) || value.length === 0) throw new PiboWebHttpError("deltas must be a non-empty string array", 400);
	if (value.length > 100) throw new PiboWebHttpError("deltas must contain at most 100 entries", 400);
	return value.map((item) => {
		if (typeof item !== "string" || item.length === 0) throw new PiboWebHttpError("deltas entries must be non-empty strings", 400);
		if (item.length > 200) throw new PiboWebHttpError("deltas entries must be at most 200 characters", 400);
		return item;
	});
}

export function normalizeStreamingFixtureCadenceMs(value: unknown): number {
	if (value === undefined) return 100;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 10 || value > 5_000) {
		throw new PiboWebHttpError("cadenceMs must be a number between 10 and 5000", 400);
	}
	return Math.round(value);
}

export function normalizeStreamingFixtureProfile(value: unknown): ChatStreamingFixtureProfile {
	if (value === undefined) return "steady";
	if (value === "steady" || value === "jitter" || value === "burst" || value === "batch") return value;
	throw new PiboWebHttpError("profile must be steady, jitter, burst, or batch", 400);
}

export function normalizeStreamingFixtureMix(value: unknown): ChatStreamingFixtureMix {
	if (value === undefined) return "text";
	if (value === "text" || value === "reasoning-text" || value === "markdown" || value === "gfm-markdown" || value === "gfm-task-markdown" || value === "gfm-full-markdown") return value;
	throw new PiboWebHttpError("mix must be text, reasoning-text, markdown, gfm-markdown, gfm-task-markdown, or gfm-full-markdown", 400);
}

export function normalizeStreamingFixturePreludeMessages(value: unknown): number {
	if (value === undefined) return 0;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2000) {
		throw new PiboWebHttpError("preludeMessages must be an integer between 0 and 2000", 400);
	}
	return value;
}

export function normalizeStreamingFixturePreludeOnly(value: unknown): boolean {
	if (value === undefined) return false;
	if (typeof value === "boolean") return value;
	throw new PiboWebHttpError("preludeOnly must be a boolean", 400);
}

export function normalizeStreamingFixtureTraceSnapshots(value: unknown): boolean {
	if (value === undefined) return false;
	if (typeof value === "boolean") return value;
	throw new PiboWebHttpError("traceSnapshots must be a boolean", 400);
}

export function normalizeStreamingFixtureSuppressLiveDeltas(value: unknown): boolean {
	if (value === undefined) return false;
	if (typeof value === "boolean") return value;
	throw new PiboWebHttpError("suppressLiveDeltas must be a boolean", 400);
}

export function buildStreamingFixtureSchedule(deltaCount: number, cadenceMs: number, profile: ChatStreamingFixtureProfile): number[] {
	const delays: number[] = [];
	let elapsedMs = 0;
	for (let index = 0; index < deltaCount; index += 1) {
		let gapMs = cadenceMs;
		if (profile === "jitter") {
			const jitterMs = [-30, 50, -20, 30, -40, 60, -10, 40, -50, 70, -20, 30][index % 12];
			gapMs = Math.max(10, cadenceMs + jitterMs);
		} else if (profile === "burst") {
			gapMs = index > 0 && index % 3 !== 0 ? Math.max(10, Math.round(cadenceMs / 5)) : Math.max(cadenceMs, Math.round(cadenceMs * 2.5));
		} else if (profile === "batch") {
			gapMs = index % 4 === 0 ? Math.max(cadenceMs, Math.round(cadenceMs * 3)) : 0;
		}
		elapsedMs += gapMs;
		delays.push(elapsedMs);
	}
	return delays;
}

export function updateChatModelDefaults(body: ChatModelDefaultsBody, cwd = process.cwd()): PiboModelDefaults {
	return savePiboModelDefaults({
		main: normalizeModelProfile(body.main, "main"),
		subagent: normalizeModelProfile(body.subagent, "subagent"),
		thinking: normalizeThinkingLevel(body.thinking, "thinking"),
		mainThinking: normalizeThinkingLevel(body.mainThinking, "mainThinking"),
		subagentThinking: normalizeThinkingLevel(body.subagentThinking, "subagentThinking"),
		fast: normalizeOptionalBoolean(body.fast, "fast"),
		mainFast: normalizeOptionalBoolean(body.mainFast, "mainFast"),
		subagentFast: normalizeOptionalBoolean(body.subagentFast, "subagentFast"),
	}, cwd);
}

const PROJECT_SESSION_PATCH_FIELDS = new Set([
	"title",
	"archived",
]);

export function assertProjectSessionPatchFields(body: ChatProjectSessionPatchBody): void {
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new PiboWebHttpError("Invalid JSON body", 400);
	for (const key of Object.keys(body)) {
		if (!PROJECT_SESSION_PATCH_FIELDS.has(key)) {
			throw new PiboWebHttpError(`Unsupported project session update field: ${key}. Project workflow selection and configuration are immutable; create a new configured session to change workflow, input, prompt, model, thinking, or fast-mode values.`, 400);
		}
	}
}

export function normalizeProjectPath(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw new PiboWebHttpError("Project folder is required", 400);
	let projectPath = value.trim();
	if (projectPath === "~") projectPath = process.env.HOME ?? projectPath;
	else if (projectPath.startsWith("~/")) projectPath = `${process.env.HOME ?? ""}${projectPath.slice(1)}`;
	if (!isAbsolute(projectPath)) throw new PiboWebHttpError("Project folder must be an absolute path, e.g. ~/code/my-project or /home/me/code/my-project", 400);
	return resolve(projectPath);
}

export function normalizeProjectDescription(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Project description must be a string", 400);
	return value.trim() || undefined;
}

export function normalizeProjectArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("Project archived flag must be boolean", 400);
	return value;
}

export function normalizeProjectSessionArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("Project session archived flag must be boolean", 400);
	return value;
}

export function normalizeSessionTitle(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== "string") {
		throw new PiboWebHttpError("Session title must be a string or null", 400);
	}
	const title = value.replace(/\s+/g, " ").trim();
	if (!title) return null;
	if (title.length > 120) {
		throw new PiboWebHttpError("Session title is too long", 400);
	}
	return title;
}

export function metadataWithArchiveState(session: PiboSession, archived: unknown): PiboJsonObject | undefined {
	if (archived === undefined) return undefined;
	if (typeof archived !== "boolean") {
		throw new PiboWebHttpError("Session archived flag must be boolean", 400);
	}
	return withChatWebArchived(session.metadata, archived);
}

export function createSessionUpdate(
	context: PiboWebAppContext,
	session: PiboSession,
	body: { title?: unknown; archived?: unknown; profile?: unknown; activeModel?: unknown },
): UpdatePiboSessionInput {
	const update: UpdatePiboSessionInput = {};
	const title = normalizeSessionTitle(body.title);
	if (title !== undefined) update.title = title;
	const metadata = metadataWithArchiveState(session, body.archived);
	if (metadata) update.metadata = metadata;
	if (body.profile !== undefined) {
		update.profile = resolveCreateSessionProfile(context, session.profile, body.profile);
	}
	if (body.activeModel !== undefined) {
		update.activeModel = body.activeModel === null ? null : normalizeModelProfile(body.activeModel, "activeModel");
	}
	if (!("title" in update) && !("metadata" in update) && !("profile" in update) && !("activeModel" in update)) {
		throw new PiboWebHttpError("No session update fields provided", 400);
	}
	return update;
}

export function createRoomUpdate(room: PiboRoom, body: ChatRoomPatchBody): {
	name?: string;
	topic?: string | null;
	parentRoomId?: string | null;
	metadata?: PiboJsonObject;
} {
	if (isDefaultPiboRoom(room)) {
		throw new PiboWebHttpError("Shared Chat cannot be changed", 400);
	}
	const update: {
		name?: string;
		topic?: string | null;
		parentRoomId?: string | null;
		metadata?: PiboJsonObject;
	} = {};
	if (body.name !== undefined) update.name = normalizeRoomName(body.name);
	if (body.topic !== undefined) update.topic = normalizeOptionalRoomTopic(body.topic);
	if (body.parentRoomId !== undefined) update.parentRoomId = normalizeOptionalParentRoomId(body.parentRoomId);
	const archived = normalizeRoomArchived(body.archived);
	const workspace = normalizeOptionalRoomWorkspace(body.workspace);
	let metadata = room.metadata;
	let metadataChanged = false;
	if (archived !== undefined) {
		metadata = withPiboRoomArchived(metadata, archived);
		metadataChanged = true;
	}
	if (workspace !== undefined) {
		metadata = withPiboRoomWorkspace(metadata, workspace ?? undefined);
		metadataChanged = true;
	}
	if (metadataChanged) update.metadata = metadata;
	if (Object.keys(update).length === 0) {
		throw new PiboWebHttpError("No room update fields provided", 400);
	}
	return update;
}

export function createAgentInput(body: ChatAgentBody) {
	return {
		displayName: normalizeAgentDisplayName(body.displayName),
		description: normalizeAgentDescription(body.description),
		nativeTools: normalizeNameArray(body.nativeTools, "nativeTools"),
		skills: normalizeNameArray(body.skills, "skills"),
		contextFiles: normalizeNameArray(body.contextFiles, "contextFiles"),
		subagents: normalizeAgentSubagents(body.subagents),
		mcpServers: normalizeNameArray(body.mcpServers, "mcpServers"),
		piPackages: normalizeRegisteredPiPackages(body.piPackages),
		mainModel: normalizeModelProfile(body.mainModel, "mainModel"),
		subagentModel: normalizeModelProfile(body.subagentModel, "subagentModel"),
		thinkingLevel: normalizeThinkingLevel(body.thinkingLevel, "thinkingLevel"),
		mainThinkingLevel: normalizeThinkingLevel(body.mainThinkingLevel, "mainThinkingLevel"),
		subagentThinkingLevel: normalizeThinkingLevel(body.subagentThinkingLevel, "subagentThinkingLevel"),
		fast: normalizeOptionalBoolean(body.fast, "fast"),
		mainFast: normalizeOptionalBoolean(body.mainFast, "mainFast"),
		subagentFast: normalizeOptionalBoolean(body.subagentFast, "subagentFast"),
		builtinTools: normalizeBuiltinTools(body.builtinTools),
		builtinToolNames: normalizeBuiltinToolNames(body.builtinToolNames),
		autoContextFiles: normalizeAutoContextFiles(body.autoContextFiles),
		runControl: normalizeRunControl(body.runControl),
	};
}

export function createAgentUpdate(body: ChatAgentBody): UpdateCustomAgentInput {
	const update: UpdateCustomAgentInput = {};
	if (body.displayName !== undefined) update.displayName = normalizeAgentDisplayName(body.displayName);
	if (body.description !== undefined) update.description = normalizeAgentDescription(body.description);
	if (body.nativeTools !== undefined) update.nativeTools = normalizeNameArray(body.nativeTools, "nativeTools");
	if (body.skills !== undefined) update.skills = normalizeNameArray(body.skills, "skills");
	if (body.contextFiles !== undefined) update.contextFiles = normalizeNameArray(body.contextFiles, "contextFiles");
	if (body.subagents !== undefined) update.subagents = normalizeAgentSubagents(body.subagents);
	if (body.mcpServers !== undefined) update.mcpServers = normalizeNameArray(body.mcpServers, "mcpServers");
	if (body.piPackages !== undefined) update.piPackages = normalizeRegisteredPiPackages(body.piPackages);
	if (body.mainModel !== undefined) update.mainModel = normalizeModelProfile(body.mainModel, "mainModel");
	if (body.subagentModel !== undefined) update.subagentModel = normalizeModelProfile(body.subagentModel, "subagentModel");
	if (body.thinkingLevel !== undefined) update.thinkingLevel = normalizeThinkingLevel(body.thinkingLevel, "thinkingLevel");
	if (body.mainThinkingLevel !== undefined) update.mainThinkingLevel = normalizeThinkingLevel(body.mainThinkingLevel, "mainThinkingLevel");
	if (body.subagentThinkingLevel !== undefined) update.subagentThinkingLevel = normalizeThinkingLevel(body.subagentThinkingLevel, "subagentThinkingLevel");
	if (body.fast !== undefined) update.fast = normalizeOptionalBoolean(body.fast, "fast");
	if (body.mainFast !== undefined) update.mainFast = normalizeOptionalBoolean(body.mainFast, "mainFast");
	if (body.subagentFast !== undefined) update.subagentFast = normalizeOptionalBoolean(body.subagentFast, "subagentFast");
	if (body.builtinTools !== undefined) update.builtinTools = normalizeBuiltinTools(body.builtinTools);
	if (body.builtinToolNames !== undefined) update.builtinToolNames = normalizeBuiltinToolNames(body.builtinToolNames);
	if (body.autoContextFiles !== undefined) update.autoContextFiles = normalizeAutoContextFiles(body.autoContextFiles);
	if (body.runControl !== undefined) update.runControl = normalizeRunControl(body.runControl);
	if (Object.keys(update).length === 0 && body.archived === undefined) {
		throw new PiboWebHttpError("No agent update fields provided", 400);
	}
	return update;
}

export function resolveCreateSessionProfile(
	context: PiboWebAppContext,
	defaultProfile: string,
	requestedProfile: unknown,
): string {
	if (requestedProfile === undefined) return defaultProfile;
	if (typeof requestedProfile !== "string" || requestedProfile.trim().length === 0) {
		throw new PiboWebHttpError("Profile must be a non-empty string", 400);
	}

	const profileName = requestedProfile.trim();
	const profiles = context.channelContext.getProfiles?.() ?? [];
	if (!profiles.length) {
		if (profileName === defaultProfile) return defaultProfile;
		throw new PiboWebHttpError(`Unknown profile "${profileName}"`, 400);
	}

	const matched = profiles.find(
		(profile) => profile.name === profileName || profile.aliases.includes(profileName),
	);
	if (!matched) {
		throw new PiboWebHttpError(`Unknown profile "${profileName}"`, 400);
	}
	return matched.name;
}
