import type { ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { Box, type AutocompleteProvider, Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { PiboOutputEvent, PiboSessionStatus } from "../../core/events.js";
import { InitialSessionContextBuilder, type InitialSessionContext } from "../../core/profiles.js";
import { runPiboTui } from "../../core/runtime.js";
import {
	DEFAULT_REMOTE_AGENT_HOST,
	DEFAULT_REMOTE_AGENT_PORT,
	type RemoteAgentCapabilities,
} from "../protocol.js";
import { createRemoteSlashCommandMap, RemoteAgentSessionClient } from "../session-client.js";

// Proof-of-concept controller: reuse Pi's TUI as a local UI shell while all
// meaningful input/output is routed through pibo's remote-agent channel.
export type RemoteAgentTuiOptions = {
	host?: string;
	port?: number;
	sessionName?: string;
	profile?: string;
};

const LOCAL_PI_TUI_COMMANDS = new Set([
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
	"quit",
]);

type RemoteMessageDetails = {
	role: "system" | "user" | "assistant" | "execution" | "error";
	event?: PiboOutputEvent;
};

const REMOTE_MESSAGE_TYPE = "pibo.remote";

function createRemoteControllerProfile(): InitialSessionContext {
	return new InitialSessionContextBuilder("pibo-remote-controller")
		.withBuiltinTools("disabled")
		.createSession();
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

function getRemoteMessageStyle(role: RemoteMessageDetails["role"]): {
	label: string;
	bgColor: number;
	labelColor: number;
} {
	if (role === "user") {
		return { label: "you -> remote", bgColor: 24, labelColor: 117 };
	}
	if (role === "assistant") {
		return { label: "remote assistant", bgColor: 22, labelColor: 120 };
	}
	if (role === "execution") {
		return { label: "remote execution", bgColor: 58, labelColor: 229 };
	}
	if (role === "error") {
		return { label: "remote error", bgColor: 52, labelColor: 210 };
	}
	return { label: "remote session", bgColor: 236, labelColor: 250 };
}

function createRemoteMessageComponent(content: string, details: RemoteMessageDetails): Container {
	const style = getRemoteMessageStyle(details.role);
	const container = new Container();
	const box = new Box(1, 1, (text) => bg(style.bgColor, text));
	box.addChild(new Text(bold(fg(style.labelColor, style.label)), 0, 0));
	box.addChild(new Spacer(1));
	box.addChild(new Text(content, 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(box);
	return container;
}

function createTuiSlashCommandMap(capabilities: RemoteAgentCapabilities): Map<string, string> {
	const commands = createRemoteSlashCommandMap(capabilities);
	for (const command of commands.keys()) {
		if (LOCAL_PI_TUI_COMMANDS.has(command.slice(1))) {
			commands.delete(command);
		}
	}
	return commands;
}

function createRemoteAutocompleteProvider(
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

function sendTuiMessage(pi: Parameters<ExtensionFactory>[0], content: string, details: RemoteMessageDetails): void {
	pi.sendMessage({
		customType: REMOTE_MESSAGE_TYPE,
		content,
		display: true,
		details,
	});
}

function formatConnectedMessage(client: RemoteAgentSessionClient, slashCommands: Map<string, string>): string {
	const commands = [...slashCommands.keys()].join(", ") || "none";
	return [
		`Connected to pibo remote session ${client.binding.sessionKey}.`,
		`Profile: ${client.binding.originalProfile}`,
		`Remote commands: ${commands}`,
		"Pi TUI built-in slash commands stay local.",
	].join("\n");
}

export function createRemoteAgentTuiExtension(options: RemoteAgentTuiOptions = {}): ExtensionFactory {
	const resolvedOptions = {
		host: options.host ?? DEFAULT_REMOTE_AGENT_HOST,
		port: options.port ?? DEFAULT_REMOTE_AGENT_PORT,
		sessionName: options.sessionName ?? "default",
		profile: options.profile ?? "pibo-minimal",
	};

	return (pi) => {
		let client: RemoteAgentSessionClient | undefined;
		let connectPromise: Promise<RemoteAgentSessionClient> | undefined;
		let slashCommands = new Map<string, string>();
		let context: ExtensionContext | undefined;
		let assistantBuffer = "";
		let autocompleteRefreshed = false;
		const registeredCommands = new Set<string>();

		pi.registerMessageRenderer<RemoteMessageDetails>(REMOTE_MESSAGE_TYPE, (message) => {
			return createRemoteMessageComponent(String(message.content), message.details ?? { role: "system" });
		});

		const setStatus = (text: string | undefined) => {
			context?.ui.setStatus("pibo.remote", text);
		};

		const handleRemoteEvent = (event: PiboOutputEvent) => {
			if (event.type === "message_started") {
				assistantBuffer = "";
				setStatus("remote running");
				return;
			}
			if (event.type === "assistant_delta") {
				assistantBuffer += event.text;
				return;
			}
			if (event.type === "assistant_message") {
				sendTuiMessage(pi, event.text || assistantBuffer, { role: "assistant", event });
				assistantBuffer = "";
				setStatus("remote connected");
				return;
			}
			if (event.type === "execution_result") {
				sendTuiMessage(pi, formatExecutionResult(event), { role: "execution", event });
				setStatus("remote connected");
				return;
			}
			if (event.type === "session_error") {
				sendTuiMessage(pi, `Remote error: ${event.error}`, { role: "error", event });
				setStatus("remote error");
			}
		};

		const ensureClient = async (ctx: ExtensionContext): Promise<RemoteAgentSessionClient> => {
			context = ctx;
			if (client) return client;
			if (connectPromise) return connectPromise;

			setStatus("remote connecting");
			connectPromise = RemoteAgentSessionClient.connect(resolvedOptions)
				.then((connectedClient) => {
					client = connectedClient;
					slashCommands = createTuiSlashCommandMap(connectedClient.capabilities);
					for (const [slashCommand, action] of slashCommands) {
						const name = slashCommand.slice(1);
						if (registeredCommands.has(name)) continue;
						registeredCommands.add(name);
						const description =
							connectedClient.capabilities.actions.find((candidate) => candidate.name === action)?.description ??
							`Run remote gateway action "${action}".`;
						pi.registerCommand(name, {
							description,
							async handler() {
								sendTuiMessage(pi, slashCommand, { role: "user" });
								await connectedClient.sendExecution(action);
							},
						});
					}
					if (!autocompleteRefreshed) {
						const allowedCommands = new Set([...slashCommands.keys()].map((command) => command.slice(1)));
						allowedCommands.add("quit");
						ctx.ui.addAutocompleteProvider((current) =>
							createRemoteAutocompleteProvider(current, allowedCommands),
						);
						autocompleteRefreshed = true;
					}
					connectedClient.onEvent(handleRemoteEvent);
					setStatus("remote connected");
					sendTuiMessage(pi, formatConnectedMessage(connectedClient, slashCommands), { role: "system" });
					return connectedClient;
				})
				.catch((error: Error) => {
					connectPromise = undefined;
					setStatus("remote offline");
					sendTuiMessage(pi, `Remote connection failed: ${error.message}`, { role: "error" });
					throw error;
				});
			return connectPromise;
		};

		pi.on("session_start", async (_event, ctx) => {
			await ensureClient(ctx).catch(() => {});
		});

		pi.on("session_shutdown", () => {
			client?.close();
			client = undefined;
			connectPromise = undefined;
		});

		pi.on("input", async (event, ctx) => {
			const text = event.text.trim();
			if (!text) return { action: "continue" };

			try {
				const connectedClient = await ensureClient(ctx);
				sendTuiMessage(pi, text, { role: "user" });

				const action = slashCommands.get(text);
				if (action) {
					await connectedClient.sendExecution(action);
				} else {
					await connectedClient.sendMessage(event.text);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendTuiMessage(pi, `Remote request failed: ${message}`, { role: "error" });
			}

			return { action: "handled" };
		});
	};
}

export async function runRemoteAgentTui(options: RemoteAgentTuiOptions = {}): Promise<void> {
	await runPiboTui({
		persistSession: false,
		profile: createRemoteControllerProfile(),
		extensionFactories: [createRemoteAgentTuiExtension(options)],
	});
}
