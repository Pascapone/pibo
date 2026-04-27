import type { ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Box, type AutocompleteProvider, Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import type { LocalRoutedTuiCapabilities, LocalRoutedTuiClientLike } from "./client.js";

const LOCAL_MESSAGE_TYPE = "pibo.local-routed";

const BLOCKED_PI_TUI_COMMANDS = new Set([
	"settings",
	"model",
	"scoped-models",
	"export",
	"import",
	"share",
	"copy",
	"name",
	"session",
	"changelog",
	"hotkeys",
	"fork",
	"clone",
	"tree",
	"login",
	"logout",
	"new",
	"compact",
	"reload",
	"debug",
	"resume",
]);

type LocalMessageDetails = {
	role: "system" | "user" | "assistant" | "execution" | "error";
	event?: PiboOutputEvent;
};

function createSlashCommandMap(capabilities: LocalRoutedTuiCapabilities): Map<string, string> {
	const commands = new Map<string, string>();
	for (const action of capabilities.actions) {
		for (const slashCommand of action.slashCommands) {
			if (BLOCKED_PI_TUI_COMMANDS.has(slashCommand)) continue;
			commands.set(`/${slashCommand}`, action.name);
		}
	}
	return commands;
}

function bg(color: number, text: string): string {
	return `\x1b[48;5;${color}m${text}\x1b[0m`;
}

function fg(color: number, text: string): string {
	return `\x1b[38;5;${color}m${text}\x1b[0m`;
}

function bold(text: string): string {
	return `\x1b[1m${text}\x1b[22m`;
}

function getLocalMessageStyle(role: LocalMessageDetails["role"]): {
	label: string;
	bgColor: number;
	labelColor: number;
} {
	if (role === "user") {
		return { label: "you -> local", bgColor: 24, labelColor: 117 };
	}
	if (role === "assistant") {
		return { label: "local assistant", bgColor: 22, labelColor: 120 };
	}
	if (role === "execution") {
		return { label: "local execution", bgColor: 58, labelColor: 229 };
	}
	if (role === "error") {
		return { label: "local error", bgColor: 52, labelColor: 210 };
	}
	return { label: "local session", bgColor: 236, labelColor: 250 };
}

function createLocalMessageComponent(content: string, details: LocalMessageDetails): Container {
	const style = getLocalMessageStyle(details.role);
	const container = new Container();
	const box = new Box(1, 1, (text) => bg(style.bgColor, text));
	box.addChild(new Text(bold(fg(style.labelColor, style.label)), 0, 0));
	box.addChild(new Spacer(1));
	box.addChild(new Text(content, 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(box);
	return container;
}

function createLocalAutocompleteProvider(
	current: AutocompleteProvider,
	allowedCommands: ReadonlySet<string>,
): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
			if (!suggestions || !beforeCursor.startsWith("/") || beforeCursor.includes(" ")) {
				return suggestions;
			}

			const items = suggestions.items.filter((item) => allowedCommands.has(item.value));
			return items.length > 0 ? { ...suggestions, items } : null;
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
		shouldTriggerFileCompletion: current.shouldTriggerFileCompletion
			? (lines, cursorLine, cursorCol) => current.shouldTriggerFileCompletion!(lines, cursorLine, cursorCol)
			: undefined,
	};
}

function isSessionStatus(value: unknown): value is PiboSessionStatus {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { sessionKey?: unknown; queuedMessages?: unknown; processing?: unknown };
	return (
		typeof candidate.sessionKey === "string" &&
		typeof candidate.queuedMessages === "number" &&
		typeof candidate.processing === "boolean"
	);
}

function formatExecutionResult(event: Extract<PiboOutputEvent, { type: "execution_result" }>): string {
	if (event.action === "status" && isSessionStatus(event.result)) {
		return `status: session=${event.result.sessionKey} queued=${event.result.queuedMessages} processing=${event.result.processing} streaming=${event.result.streaming}`;
	}

	if (event.action === "clear_queue" && event.result && typeof event.result === "object") {
		const cleared = (event.result as { cleared?: unknown }).cleared;
		return `clear: removed ${typeof cleared === "number" ? cleared : 0} queued message(s)`;
	}

	return `${event.action}: ${JSON.stringify(event.result)}`;
}

function sendTuiMessage(pi: Parameters<ExtensionFactory>[0], content: string, details: LocalMessageDetails): void {
	pi.sendMessage({
		customType: LOCAL_MESSAGE_TYPE,
		content,
		display: true,
		details,
	});
}

function formatConnectedMessage(client: LocalRoutedTuiClientLike, slashCommands: Map<string, string>): string {
	const commands = [...slashCommands.keys()].join(", ") || "none";
	return [
		`Connected to pibo local routed session ${client.binding.sessionKey}.`,
		`Profile: ${client.binding.originalProfile}`,
		`Routed commands: ${commands}`,
		"Only /quit stays local in routed mode.",
	].join("\n");
}

export function createLocalRoutedTuiExtension(client: LocalRoutedTuiClientLike): ExtensionFactory {
	return (pi) => {
		let context: ExtensionContext | undefined;
		let assistantBuffer = "";
		let autocompleteRefreshed = false;
		let connected = false;
		let unsubscribeEvents: (() => void) | undefined;
		const slashCommands = createSlashCommandMap(client.capabilities);
		const registeredCommands = new Set<string>();

		pi.registerMessageRenderer<LocalMessageDetails>(LOCAL_MESSAGE_TYPE, (message) => {
			return createLocalMessageComponent(String(message.content), message.details ?? { role: "system" });
		});

		const setStatus = (text: string | undefined) => {
			context?.ui.setStatus("pibo.local", text);
		};

		const handleLocalEvent = (event: PiboOutputEvent) => {
			if (event.type === "message_started") {
				assistantBuffer = "";
				setStatus("local running");
				return;
			}
			if (event.type === "assistant_delta") {
				assistantBuffer += event.text;
				return;
			}
			if (event.type === "assistant_message") {
				sendTuiMessage(pi, event.text || assistantBuffer, { role: "assistant", event });
				assistantBuffer = "";
				setStatus("local connected");
				return;
			}
			if (event.type === "execution_result") {
				sendTuiMessage(pi, formatExecutionResult(event), { role: "execution", event });
				setStatus("local connected");
				return;
			}
			if (event.type === "session_error") {
				sendTuiMessage(pi, `Local routed error: ${event.error}`, { role: "error", event });
				setStatus("local error");
			}
		};

		const ensureConnected = (ctx: ExtensionContext) => {
			context = ctx;
			if (connected) return;

			setStatus("local connecting");
			for (const [slashCommand, action] of slashCommands) {
				const name = slashCommand.slice(1);
				if (registeredCommands.has(name)) continue;
				registeredCommands.add(name);
				const description =
					client.capabilities.actions.find((candidate) => candidate.name === action)?.description ??
					`Run routed action "${action}".`;
				pi.registerCommand(name, {
					description,
					async handler() {
						sendTuiMessage(pi, slashCommand, { role: "user" });
						await client.sendExecution(action);
					},
				});
			}

			if (!autocompleteRefreshed) {
				const allowedCommands = new Set([...slashCommands.keys()].map((command) => command.slice(1)));
				allowedCommands.add("quit");
				ctx.ui.addAutocompleteProvider((current) => createLocalAutocompleteProvider(current, allowedCommands));
				autocompleteRefreshed = true;
			}

			unsubscribeEvents = client.onEvent(handleLocalEvent);
			connected = true;
			setStatus("local connected");
			sendTuiMessage(pi, formatConnectedMessage(client, slashCommands), { role: "system" });
		};

		pi.on("session_start", async (_event, ctx) => {
			ensureConnected(ctx);
		});

		pi.on("session_shutdown", () => {
			unsubscribeEvents?.();
			unsubscribeEvents = undefined;
			connected = false;
			void client.close();
		});

		pi.on("input", async (event, ctx) => {
			const text = event.text.trim();
			if (!text) return { action: "continue" };
			if (text === "/quit") return { action: "continue" };

			try {
				ensureConnected(ctx);
				const action = slashCommands.get(text);
				if (action) {
					sendTuiMessage(pi, text, { role: "user" });
					await client.sendExecution(action);
					return { action: "handled" };
				}

				if (text.startsWith("/")) {
					sendTuiMessage(pi, `Command "${text}" is not available in local routed mode.`, { role: "error" });
					return { action: "handled" };
				}

				sendTuiMessage(pi, text, { role: "user" });
				await client.sendMessage(event.text);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendTuiMessage(pi, `Local routed request failed: ${message}`, { role: "error" });
			}

			return { action: "handled" };
		});
	};
}
