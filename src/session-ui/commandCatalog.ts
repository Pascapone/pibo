import { redactTerminalSecret } from "./statusViewModel.js";

export type SlashCommandSupport = "supported" | "terminal-adapted" | "browser-only" | "product-area" | "deferred";

export type SlashCommandDescriptor = {
	id: string;
	slash: `/${string}`;
	actionName?: string;
	description: string;
	argumentHint?: string;
	group: "session" | "navigation" | "runtime" | "cli" | "unsupported";
	support: SlashCommandSupport;
	unsupportedReason?: string;
	terminalAdaptation?: string;
	aliases?: readonly `/${string}`[];
};

export type GatewayCommandCapability = {
	name?: string;
	slash?: string;
	slashCommands?: readonly string[];
	actionName?: string;
	description?: string;
	argumentHint?: string;
	supported?: boolean;
	browserOnly?: boolean;
	productArea?: boolean;
	unsupportedReason?: string;
	hidden?: boolean;
};

export type SlashCommandBehaviorMatrixEntry = {
	id: string;
	slash: `/${string}`;
	aliases: readonly `/${string}`[];
	group: SlashCommandDescriptor["group"];
	support: SlashCommandSupport;
	supportLabel: string;
	palette: "shown" | "hidden";
	argumentBehavior: string;
	enterBehavior: string;
	resultPlacement: "transcript" | "overlay" | "navigation" | "exit" | "transcript-or-overlay";
	contextRequirement: string;
	errorBehavior: string;
	terminalAdaptation?: string;
};

export const CLI_ONLY_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [
	{ id: "help", slash: "/help", description: "Show command help and keyboard controls.", group: "cli", support: "supported" },
	{ id: "new", slash: "/new", description: "Create a new session in the active or selected room.", group: "navigation", support: "supported" },
	{ id: "room", slash: "/room", description: "Select the active room in the shared app.", group: "navigation", support: "supported" },
	{ id: "session", slash: "/session", description: "Select a room, then open or create a session.", group: "navigation", support: "supported" },
	{ id: "agent", slash: "/agent", description: "Select an existing agent/profile for the session.", group: "navigation", support: "supported" },
	{ id: "profile", slash: "/profile", description: "Select an existing agent/profile for the session.", group: "navigation", support: "supported" },
	{ id: "repair-user-unknown", slash: "/repair-user-unknown", description: "Repair legacy CLI sessions stored under user:unknown.", group: "cli", support: "supported" },
	{ id: "exit", slash: "/exit", description: "Exit the terminal UI.", group: "cli", support: "supported", aliases: ["/quit"] },
	{ id: "quit", slash: "/quit", description: "Exit the terminal UI.", group: "cli", support: "supported" },
];

export const WEB_PARITY_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [
	{ id: "status", slash: "/status", actionName: "status", description: "Show session, runtime, model, queue, and usage status.", group: "session", support: "supported" },
	{ id: "compact", slash: "/compact", actionName: "compact", description: "Run session compaction when the runtime supports it.", group: "runtime", support: "terminal-adapted" },
	{ id: "clear", slash: "/clear", actionName: "clear_queue", description: "Clear queued messages that have not started yet; terminal currently also clears local display.", group: "runtime", support: "terminal-adapted" },
	{ id: "abort", slash: "/abort", actionName: "abort", description: "Abort the active response.", group: "runtime", support: "terminal-adapted" },
	{ id: "kill", slash: "/kill", actionName: "kill", description: "Dispose the active session runtime.", group: "runtime", support: "terminal-adapted" },
	{ id: "kill-all", slash: "/kill-all", actionName: "kill-all", description: "Dispose all routed runtimes for the selected app context when supported.", group: "runtime", support: "terminal-adapted" },
	{ id: "fast", slash: "/fast", actionName: "fast_mode", description: "Toggle fast mode for the active session.", argumentHint: "[on|off]", group: "runtime", support: "terminal-adapted" },
	{ id: "thinking", slash: "/thinking", actionName: "thinking", description: "Show or set model thinking level.", argumentHint: "[off|minimal|low|medium|high|xhigh]", group: "runtime", support: "terminal-adapted", terminalAdaptation: "Without an argument, open a keyboard picker." },
	{ id: "model", slash: "/model", actionName: "model", description: "Choose an authenticated provider model.", group: "runtime", support: "terminal-adapted", terminalAdaptation: "Open provider and model pickers." },
	{ id: "login", slash: "/login", actionName: "login", description: "Authenticate a model provider.", group: "runtime", support: "terminal-adapted", terminalAdaptation: "Show provider/auth-method instructions in terminal." },
	{ id: "session-current", slash: "/session-current", actionName: "session-current", description: "Show metadata for the active session.", group: "session", support: "terminal-adapted" },
	{ id: "sessions", slash: "/sessions", actionName: "sessions", description: "List sessions for the selected shared room.", group: "session", support: "terminal-adapted" },
	{ id: "clone", slash: "/clone", actionName: "clone", description: "Clone or derive the active session when supported.", group: "session", support: "terminal-adapted" },
	{ id: "fork-candidates", slash: "/fork-candidates", actionName: "session.fork_candidates", description: "Inspect terminal-selectable fork candidates.", argumentHint: "[entry-id]", group: "session", support: "terminal-adapted", terminalAdaptation: "Without an argument, list candidates; selecting one attempts a routed fork." },
	{ id: "download", slash: "/download", actionName: "download", description: "Show terminal-safe download instructions for a server path.", argumentHint: "<path>", group: "session", support: "terminal-adapted", terminalAdaptation: "Use shell/server paths instead of browser download APIs." },
	{ id: "upload", slash: "/upload", actionName: "upload", description: "Show terminal-safe upload instructions for a local path.", argumentHint: "<path>", group: "session", support: "terminal-adapted", terminalAdaptation: "Use path-based terminal instructions instead of browser file picker APIs." },
	{ id: "thinking-show", slash: "/thinking-show", actionName: "thinking", description: "Show thinking controls in Web.", group: "unsupported", support: "deferred", unsupportedReason: "Use /thinking in terminal." },
];

export function buildSlashCommandCatalog(capabilities: readonly GatewayCommandCapability[] = []): SlashCommandDescriptor[] {
	const bySlash = new Map<string, SlashCommandDescriptor>();
	for (const command of [...WEB_PARITY_SLASH_COMMANDS, ...CLI_ONLY_SLASH_COMMANDS]) bySlash.set(command.slash, command);
	for (const capability of expandGatewayCommandCapabilities(capabilities)) {
		if (capability.hidden) continue;
		const slash = normalizeSlash(capability.slash ?? capability.name);
		if (!slash) continue;
		const existing = bySlash.get(slash);
		if (existing && isCliOwnedCommand(existing) && capability.name !== undefined) continue;
		bySlash.set(slash, {
			id: slash.slice(1),
			slash,
			actionName: capability.actionName ?? existing?.actionName ?? capability.name,
			description: redactTerminalSecret(capability.description ?? existing?.description ?? `Run ${slash}.`),
			argumentHint: capability.argumentHint ?? existing?.argumentHint,
			group: capability.browserOnly || capability.productArea ? "unsupported" : existing?.group ?? "session",
			support: supportForCapability(capability, existing),
			unsupportedReason: redactTerminalSecret(capability.unsupportedReason ?? existing?.unsupportedReason ?? "") || undefined,
			terminalAdaptation: existing?.terminalAdaptation,
			aliases: existing?.aliases,
		});
	}
	return [...bySlash.values()].sort((left, right) => left.slash.localeCompare(right.slash));
}

export function filterSlashCommands(catalog: readonly SlashCommandDescriptor[], input: string): SlashCommandDescriptor[] {
	const normalized = input.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
	const prefix = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return catalog.filter((command) => command.slash.toLowerCase().startsWith(prefix) || command.aliases?.some((alias) => alias.toLowerCase().startsWith(prefix)));
}

export function formatSlashCommand(command: SlashCommandDescriptor): string {
	return `${command.slash}${command.argumentHint ? ` ${command.argumentHint}` : ""}`;
}

export function commandSupportLabel(command: SlashCommandDescriptor): string {
	if (command.support === "supported") return "available";
	if (command.support === "terminal-adapted") return "terminal";
	if (command.support === "browser-only") return "browser-only";
	if (command.support === "product-area") return "product-area";
	return "deferred";
}

export function groupSlashCommandsForHelp(catalog: readonly SlashCommandDescriptor[]): { available: SlashCommandDescriptor[]; navigation: SlashCommandDescriptor[]; unsupported: SlashCommandDescriptor[] } {
	return {
		available: catalog.filter((command) => (command.group === "session" || command.group === "runtime") && (command.support === "supported" || command.support === "terminal-adapted")),
		navigation: catalog.filter((command) => command.group === "navigation" || command.group === "cli"),
		unsupported: catalog.filter((command) => command.group === "unsupported" || command.support === "browser-only" || command.support === "product-area" || command.support === "deferred"),
	};
}

export function buildSlashCommandBehaviorMatrix(catalog: readonly SlashCommandDescriptor[] = buildSlashCommandCatalog()): SlashCommandBehaviorMatrixEntry[] {
	return catalog.map((command) => ({
		id: command.id,
		slash: command.slash,
		aliases: command.aliases ?? [],
		group: command.group,
		support: command.support,
		supportLabel: commandSupportLabel(command),
		palette: "shown",
		argumentBehavior: slashArgumentBehavior(command),
		enterBehavior: slashEnterBehavior(command),
		resultPlacement: slashResultPlacement(command),
		contextRequirement: slashContextRequirement(command),
		errorBehavior: slashErrorBehavior(command),
		terminalAdaptation: command.terminalAdaptation,
	}));
}

function slashArgumentBehavior(command: SlashCommandDescriptor): string {
	if (command.argumentHint) return command.argumentHint;
	if (command.slash === "/model") return "no argument opens provider/model picker; provider/model applies selection";
	if (command.slash === "/login") return "no argument opens provider/auth picker; provider/method applies selection";
	if (command.slash === "/thinking") return "no argument opens thinking picker; level applies selection";
	return "none";
}

function slashEnterBehavior(command: SlashCommandDescriptor): string {
	if (command.slash === "/help") return "append help text above transcript guidance";
	if (command.slash === "/new") return "create session in active or selected room";
	if (["/room", "/session", "/profile", "/agent"].includes(command.slash)) return "open keyboard picker overlay";
	if (["/exit", "/quit"].includes(command.slash)) return "exit terminal UI";
	if (command.slash === "/repair-user-unknown") return "append compact repair result";
	if (["/model", "/login", "/thinking"].includes(command.slash)) return "open picker without arguments or append result with arguments";
	if (command.slash === "/fork-candidates") return "open candidate picker without entry id or dispatch fork with entry id";
	if (command.support === "browser-only" || command.support === "product-area" || command.support === "deferred") return "append unsupported/deferred transcript result";
	return "append command and result rows to transcript";
}

function slashResultPlacement(command: SlashCommandDescriptor): SlashCommandBehaviorMatrixEntry["resultPlacement"] {
	if (["/exit", "/quit"].includes(command.slash)) return "exit";
	if (["/room", "/session", "/profile", "/agent"].includes(command.slash)) return "overlay";
	if (command.slash === "/new") return "navigation";
	if (["/model", "/login", "/thinking", "/fork-candidates"].includes(command.slash)) return "transcript-or-overlay";
	return "transcript";
}

function slashContextRequirement(command: SlashCommandDescriptor): string {
	if (["/room", "/session", "/new", "/profile", "/repair-user-unknown"].includes(command.slash)) return "app room/session navigation";
	if (["/status", "/sessions", "/session-current", "/clone", "/fork-candidates"].includes(command.slash)) return "active session when available; named room context preferred";
	if (["/compact", "/clear", "/abort", "/kill", "/kill-all", "/fast", "/thinking", "/model", "/login"].includes(command.slash)) return "active routed session/runtime";
	if (["/download", "/upload"].includes(command.slash)) return "terminal path argument";
	return "none";
}

function slashErrorBehavior(command: SlashCommandDescriptor): string {
	if (command.support === "browser-only" || command.support === "product-area" || command.support === "deferred") return "render compact unsupported result";
	if (["/room", "/session", "/profile", "/agent", "/model", "/login", "/thinking", "/fork-candidates"].includes(command.slash)) return "keep overlay compact or append redacted error row after confirmed action";
	return "append redacted command error row";
}

function expandGatewayCommandCapabilities(capabilities: readonly GatewayCommandCapability[]): GatewayCommandCapability[] {
	const expanded: GatewayCommandCapability[] = [];
	for (const capability of capabilities) {
		if (capability.slashCommands && capability.slashCommands.length > 0) {
			for (const slash of capability.slashCommands) expanded.push({ ...capability, slash, actionName: capability.actionName ?? capability.name });
			continue;
		}
		expanded.push(capability);
	}
	return expanded;
}

function isCliOwnedCommand(command: SlashCommandDescriptor): boolean {
	return command.group === "cli" || command.slash === "/new" || command.slash === "/room" || command.slash === "/session" || command.slash === "/agent" || command.slash === "/profile";
}

function normalizeSlash(value: string | undefined): `/${string}` | undefined {
	if (!value) return undefined;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return undefined;
	return (trimmed.startsWith("/") ? trimmed : `/${trimmed}`) as `/${string}`;
}

function supportForCapability(capability: GatewayCommandCapability, existing?: SlashCommandDescriptor): SlashCommandSupport {
	if (capability.browserOnly) return "browser-only";
	if (capability.productArea) return "product-area";
	if (capability.supported === false) return "deferred";
	return existing?.support ?? "terminal-adapted";
}
