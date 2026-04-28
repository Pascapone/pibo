import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
	AssistantMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
	type ExtensionContext,
	type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import { type AutocompleteProvider, Container, Spacer, type TUI } from "@mariozechner/pi-tui";
import type { PiboJsonValue, PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import { parsePiboThinkingLevel } from "../core/thinking.js";
import type { LocalRoutedTuiCapabilities, LocalRoutedTuiClientLike } from "./client.js";

const LOCAL_MESSAGE_TYPE = "pibo.local-routed";
const STREAMING_WIDGET_KEY = "pibo.local.streaming";

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

const SUBMIT_KEYS = new Set(["\r", "\n"]);

type LocalMessageDetails = {
	role: "system" | "user" | "assistant" | "thinking" | "tool" | "execution" | "error";
	event?: PiboOutputEvent;
	tool?: LocalToolState;
};

type LocalToolResult = {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: unknown;
	isError: boolean;
};

type LocalToolState = {
	toolCallId: string;
	toolName: string;
	args: unknown;
	argsComplete: boolean;
	executionStarted: boolean;
	result?: LocalToolResult;
};

class LocalStreamingMessageWidget extends Container {
	private assistantContent = "";
	private thinkingBlocks: string[] = [];
	private renderTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly tui: TUI,
		private readonly showThinking: () => boolean,
	) {
		super();
		this.rebuild();
	}

	setContent(input: { assistantContent?: string; thinkingBlocks?: string[] }): void {
		const nextAssistantContent = input.assistantContent ?? this.assistantContent;
		const nextThinkingBlocks = input.thinkingBlocks ?? this.thinkingBlocks;
		const sameThinkingBlocks =
			nextThinkingBlocks.length === this.thinkingBlocks.length &&
			nextThinkingBlocks.every((block, index) => block === this.thinkingBlocks[index]);
		if (nextAssistantContent === this.assistantContent && sameThinkingBlocks) {
			return;
		}
		this.assistantContent = nextAssistantContent;
		this.thinkingBlocks = [...nextThinkingBlocks];
		this.rebuild();
		this.scheduleRender();
	}

	refresh(): void {
		this.rebuild();
		this.scheduleRender();
	}

	dispose(): void {
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = undefined;
		}
	}

	private rebuild(): void {
		this.clear();
		if (this.showThinking()) {
			for (const thinkingBlock of this.thinkingBlocks) {
				if (!thinkingBlock.trim()) continue;
				this.addChild(createLocalMessageComponent(thinkingBlock, { role: "thinking" }));
				this.addChild(new Spacer(1));
			}
		}
		this.addChild(createLocalMessageComponent(this.assistantContent || " ", { role: "assistant" }));
	}

	private scheduleRender(): void {
		if (this.renderTimer) return;
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			this.tui.requestRender();
		}, 33);
	}
}

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

function getLeadingSlashCommand(text: string): string | undefined {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("/")) return undefined;
	const command = trimmed.slice(1).split(/\s+/, 1)[0];
	return command || undefined;
}

function isBlockedPiTuiCommandInput(text: string): boolean {
	const command = getLeadingSlashCommand(text);
	return command !== undefined && BLOCKED_PI_TUI_COMMANDS.has(command);
}

function createLocalMessageComponent(content: string, details: LocalMessageDetails): Container {
	if (details.role === "user") {
		return new UserMessageComponent(content);
	}
	if (details.role === "assistant") {
		return new AssistantMessageComponent(createLocalAssistantMessage([{ type: "text", text: content }]));
	}
	if (details.role === "thinking") {
		return new AssistantMessageComponent(createLocalAssistantMessage([{ type: "thinking", thinking: content }]));
	}
	if (details.role === "tool" && details.tool) {
		return createLocalToolExecutionComponent(details.tool);
	}
	return new AssistantMessageComponent(createLocalAssistantMessage([{ type: "text", text: content }]));
}

function createLocalAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "pibo-local",
		model: "pibo-local-routed",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function normalizeToolResult(input: unknown, isError: boolean): LocalToolResult {
	if (input && typeof input === "object" && Array.isArray((input as { content?: unknown }).content)) {
		const candidate = input as { content: LocalToolResult["content"]; details?: unknown };
		return { content: candidate.content, details: candidate.details, isError };
	}
	return { content: [{ type: "text", text: input === undefined ? "" : String(input) }], isError };
}

function createLocalToolExecutionComponent(tool: LocalToolState, tui?: TUI, cwd = process.cwd()): ToolExecutionComponent {
	const component = new ToolExecutionComponent(
		tool.toolName,
		tool.toolCallId,
		tool.args,
		{},
		undefined,
		tui ?? ({ requestRender() {} } as TUI),
		cwd,
	);
	if (tool.executionStarted) component.markExecutionStarted();
	if (tool.argsComplete) component.setArgsComplete();
	if (tool.result) component.updateResult(tool.result);
	return component;
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

function isThinkingResult(value: unknown): value is { level: string; supported: boolean } {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { level?: unknown; supported?: unknown };
	return typeof candidate.level === "string" && typeof candidate.supported === "boolean";
}

function createExecutionParams(slashCommand: string, args = ""): PiboJsonValue | undefined {
	if (slashCommand !== "/thinking") return undefined;
	const level = args.trim();
	return level ? { level: parsePiboThinkingLevel(level) } : undefined;
}

function formatExecutionResult(event: Extract<PiboOutputEvent, { type: "execution_result" }>): string {
	if (event.action === "status" && isSessionStatus(event.result)) {
		return `status: session=${event.result.sessionKey} queued=${event.result.queuedMessages} processing=${event.result.processing} streaming=${event.result.streaming}`;
	}

	if (event.action === "thinking" && isThinkingResult(event.result)) {
		const suffix = event.result.supported ? "" : " (current model does not support thinking)";
		return `thinking: ${event.result.level}${suffix}`;
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
		"Only /quit and /thinking-show stay local in routed mode.",
	].join("\n");
}

function splitSlashInput(text: string): { slashCommand: string; args: string } | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return undefined;
	const match = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
	if (!match) return undefined;
	return { slashCommand: `/${match[1]}`, args: match[2] ?? "" };
}

export type LocalRoutedTuiExtensionOptions = {
	showThinking?: boolean;
};

export function createLocalRoutedTuiExtension(
	client: LocalRoutedTuiClientLike,
	options: LocalRoutedTuiExtensionOptions = {},
): ExtensionFactory {
	return (pi) => {
		let context: ExtensionContext | undefined;
		let assistantBuffer = "";
		let activeThinkingBuffer = "";
		let thinkingBlocks: string[] = [];
		let showThinking = options.showThinking === true;
		let autocompleteRefreshed = false;
		let connected = false;
		let unsubscribeEvents: (() => void) | undefined;
		let unsubscribeSubmitGuard: (() => void) | undefined;
		let streamingWidget: LocalStreamingMessageWidget | undefined;
		const toolStates = new Map<string, LocalToolState>();
		const toolWidgets = new Map<string, ToolExecutionComponent>();
		const slashCommands = createSlashCommandMap(client.capabilities);
		const registeredCommands = new Set<string>();

		pi.registerMessageRenderer<LocalMessageDetails>(LOCAL_MESSAGE_TYPE, (message) => {
			return createLocalMessageComponent(String(message.content), message.details ?? { role: "system" });
		});

		const setStatus = (text: string | undefined) => {
			context?.ui.setStatus("pibo.local", text);
		};

		const ensureStreamingWidget = () => {
			if (streamingWidget || !context) return;
			context.ui.setWidget(
				STREAMING_WIDGET_KEY,
				(tui) => {
					streamingWidget = new LocalStreamingMessageWidget(tui, () => showThinking);
					streamingWidget.setContent({
						assistantContent: assistantBuffer,
						thinkingBlocks: getThinkingBlocks(),
					});
					return streamingWidget;
				},
				{ placement: "aboveEditor" },
			);
		};

		const clearStreamingWidget = () => {
			context?.ui.setWidget(STREAMING_WIDGET_KEY, undefined);
			streamingWidget = undefined;
		};

		const clearToolWidgets = () => {
			for (const toolCallId of toolWidgets.keys()) {
				context?.ui.setWidget(`pibo.local.tool.${toolCallId}`, undefined);
			}
			toolWidgets.clear();
		};

		const getThinkingBlocks = () => {
			return activeThinkingBuffer.trim() ? [...thinkingBlocks, activeThinkingBuffer] : thinkingBlocks;
		};

		const finishActiveThinkingBlock = () => {
			if (activeThinkingBuffer.trim()) {
				thinkingBlocks = [...thinkingBlocks, activeThinkingBuffer];
			}
			activeThinkingBuffer = "";
		};

		const toggleThinkingDisplay = () => {
			showThinking = !showThinking;
			streamingWidget?.refresh();
			sendTuiMessage(pi, `Thinking display: ${showThinking ? "on" : "off"}`, { role: "system" });
		};

		const runRoutedCommand = async (slashCommand: string, action: string, args = "") => {
			try {
				const params = createExecutionParams(slashCommand, args);
				sendTuiMessage(pi, args.trim() ? `${slashCommand} ${args.trim()}` : slashCommand, { role: "user" });
				await client.sendExecution(action, params);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendTuiMessage(pi, `Local routed request failed: ${message}`, { role: "error" });
			}
		};

		const ensureToolState = (input: { toolCallId: string; toolName: string; args: unknown }) => {
			const existing = toolStates.get(input.toolCallId);
			if (existing) {
				existing.toolName = input.toolName;
				existing.args = input.args;
				return existing;
			}
			const state: LocalToolState = {
				toolCallId: input.toolCallId,
				toolName: input.toolName,
				args: input.args,
				argsComplete: false,
				executionStarted: false,
			};
			toolStates.set(input.toolCallId, state);
			return state;
		};

		const ensureToolWidget = (state: LocalToolState) => {
			if (toolWidgets.has(state.toolCallId) || !context) return toolWidgets.get(state.toolCallId);
			context.ui.setWidget(
				`pibo.local.tool.${state.toolCallId}`,
				(tui) => {
					const component = createLocalToolExecutionComponent(state, tui, context?.cwd);
					toolWidgets.set(state.toolCallId, component);
					return component;
				},
				{ placement: "aboveEditor" },
			);
			return toolWidgets.get(state.toolCallId);
		};

		const persistToolState = (state: LocalToolState, event: PiboOutputEvent) => {
			context?.ui.setWidget(`pibo.local.tool.${state.toolCallId}`, undefined);
			toolWidgets.delete(state.toolCallId);
			toolStates.delete(state.toolCallId);
			sendTuiMessage(pi, "", { role: "tool", event, tool: { ...state } });
		};

		const handleLocalEvent = (event: PiboOutputEvent) => {
			if (event.type === "message_started") {
				assistantBuffer = "";
				activeThinkingBuffer = "";
				thinkingBlocks = [];
				toolStates.clear();
				clearToolWidgets();
				ensureStreamingWidget();
				setStatus("local running");
				return;
			}
			if (event.type === "thinking_started") {
				finishActiveThinkingBlock();
				ensureStreamingWidget();
				streamingWidget?.setContent({ thinkingBlocks: getThinkingBlocks() });
				return;
			}
			if (event.type === "thinking_delta") {
				activeThinkingBuffer += event.text;
				ensureStreamingWidget();
				streamingWidget?.setContent({ thinkingBlocks: getThinkingBlocks() });
				return;
			}
			if (event.type === "thinking_finished") {
				if (event.text !== undefined) {
					activeThinkingBuffer = event.text;
				}
				finishActiveThinkingBlock();
				streamingWidget?.setContent({ thinkingBlocks: getThinkingBlocks() });
				return;
			}
			if (event.type === "assistant_delta") {
				assistantBuffer += event.text;
				ensureStreamingWidget();
				streamingWidget?.setContent({ assistantContent: assistantBuffer });
				return;
			}
			if (event.type === "tool_call") {
				const state = ensureToolState(event);
				state.argsComplete = state.argsComplete || event.argsComplete;
				const widget = ensureToolWidget(state);
				widget?.updateArgs(state.args);
				if (state.argsComplete) widget?.setArgsComplete();
				return;
			}
			if (event.type === "tool_execution_started") {
				const state = ensureToolState(event);
				state.executionStarted = true;
				state.argsComplete = true;
				const widget = ensureToolWidget(state);
				widget?.updateArgs(state.args);
				widget?.setArgsComplete();
				widget?.markExecutionStarted();
				return;
			}
			if (event.type === "tool_execution_updated") {
				const state = ensureToolState(event);
				state.executionStarted = true;
				state.result = normalizeToolResult(event.partialResult, false);
				const widget = ensureToolWidget(state);
				widget?.updateResult(state.result, true);
				return;
			}
			if (event.type === "tool_execution_finished") {
				const state = ensureToolState({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: toolStates.get(event.toolCallId)?.args ?? {},
				});
				state.executionStarted = true;
				state.argsComplete = true;
				state.result = normalizeToolResult(event.result, event.isError);
				const widget = toolWidgets.get(state.toolCallId);
				widget?.updateResult(state.result);
				persistToolState(state, event);
				return;
			}
			if (event.type === "assistant_message") {
				finishActiveThinkingBlock();
				const finalThinkingBlocks = getThinkingBlocks();
				clearStreamingWidget();
				if (showThinking && finalThinkingBlocks.length > 0) {
					sendTuiMessage(pi, finalThinkingBlocks.join("\n\n"), { role: "thinking", event });
				}
				sendTuiMessage(pi, event.text || assistantBuffer, { role: "assistant", event });
				assistantBuffer = "";
				thinkingBlocks = [];
				setStatus("local connected");
				return;
			}
			if (event.type === "execution_result") {
				sendTuiMessage(pi, formatExecutionResult(event), { role: "execution", event });
				setStatus("local connected");
				return;
			}
			if (event.type === "session_error") {
				clearStreamingWidget();
				clearToolWidgets();
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
					async handler(args = "") {
						await runRoutedCommand(slashCommand, action, String(args));
					},
				});
			}
			if (!registeredCommands.has("thinking-show")) {
				registeredCommands.add("thinking-show");
				pi.registerCommand("thinking-show", {
					description: "Toggle routed thinking token visibility in the local TUI.",
					async handler() {
						toggleThinkingDisplay();
					},
				});
			}

			if (!autocompleteRefreshed) {
				const allowedCommands = new Set([...slashCommands.keys()].map((command) => command.slice(1)));
				allowedCommands.add("quit");
				allowedCommands.add("thinking-show");
				ctx.ui.addAutocompleteProvider((current) => createLocalAutocompleteProvider(current, allowedCommands));
				autocompleteRefreshed = true;
			}

			if (!unsubscribeSubmitGuard) {
				unsubscribeSubmitGuard = ctx.ui.onTerminalInput((data) => {
					if (!SUBMIT_KEYS.has(data)) return undefined;
					const text = ctx.ui.getEditorText();
					if (!isBlockedPiTuiCommandInput(text)) return undefined;

					ctx.ui.setEditorText("");
					sendTuiMessage(pi, `Command "${text.trim()}" is not available in local routed mode.`, {
						role: "error",
					});
					return { consume: true };
				});
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
			unsubscribeSubmitGuard?.();
			unsubscribeSubmitGuard = undefined;
			clearStreamingWidget();
			clearToolWidgets();
			connected = false;
			void client.close();
		});

		pi.on("input", async (event, ctx) => {
			const text = event.text.trim();
			if (!text) return { action: "continue" };
			if (text === "/quit") return { action: "continue" };

			try {
				ensureConnected(ctx);
				if (text === "/thinking-show") {
					toggleThinkingDisplay();
					return { action: "handled" };
				}

				const slashInput = splitSlashInput(text);
				const action = slashInput ? slashCommands.get(slashInput.slashCommand) : undefined;
				if (action) {
					await runRoutedCommand(slashInput!.slashCommand, action, slashInput!.args);
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
