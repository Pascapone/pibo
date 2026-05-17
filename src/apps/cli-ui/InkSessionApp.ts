import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { isCliSourceError } from "../../cli-session/index.js";
import {
	buildCompactTerminalRows,
	buildSlashCommandCatalog,
	commandSupportLabel,
	filterSlashCommands,
	formatSlashCommand,
	groupSlashCommandsForHelp,
	type CommandResultDescriptor,
	type CompactTerminalRow,
	type SlashCommandDescriptor,
} from "../../session-ui/index.js";
import type {
	CliAgentSummary,
	CliOpenSession,
	CliOwnerSummary,
	CliRoomSummary,
	CliRuntimeStatus,
	CliSessionSource,
	CliSessionSummary,
} from "../../cli-session/index.js";
import { InkTerminalView } from "./InkTerminalView.js";

export type InkSessionPickerItem = {
	id: string;
	label: string;
	description?: string;
	kind?: "owner" | "room" | "session" | "create-session" | "agent";
	ownerScope?: string;
	roomId?: string;
};

export type InkSessionPickerState = {
	kind: "owner" | "room" | "session" | "agent";
	title: string;
	items: readonly InkSessionPickerItem[];
	selectedIndex: number;
	emptyMessage: string;
	action?: "select-session" | "create-session";
	ownerScope?: string;
	roomId?: string;
};

export type InkSlashSuggestionState = {
	items: readonly SlashCommandDescriptor[];
	selectedIndex: number;
};

export type InkSessionAppState = {
	loading: boolean;
	status?: CliRuntimeStatus;
	activeOwner?: CliOwnerSummary;
	activeRoom?: CliRoomSummary;
	session?: CliSessionSummary;
	rows: readonly CompactTerminalRow[];
	input: string;
	mode: "transcript" | "session-picker" | "agent-picker" | "detail" | "picker";
	picker?: InkSessionPickerState;
	slashCommands?: readonly SlashCommandDescriptor[];
	slashSuggestions?: InkSlashSuggestionState;
	message?: string;
	error?: string;
};

export type InkSessionAppProps = {
	source: CliSessionSource;
	initialSessionId?: string;
	skipOwnerPicker?: boolean;
	maxRows?: number;
	maxLineChars?: number;
	onExit?: () => void;
};

const INITIAL_STATE: InkSessionAppState = {
	loading: true,
	rows: [],
	input: "",
	mode: "transcript",
};

export function InkSessionApp({ source, initialSessionId, skipOwnerPicker = false, maxRows, maxLineChars, onExit }: InkSessionAppProps): React.ReactElement {
	const app = useApp();
	const [state, setState] = useState<InkSessionAppState>(INITIAL_STATE);
	const openedRef = useRef<CliOpenSession | undefined>(undefined);
	const unsubscribeRef = useRef<(() => void) | undefined>(undefined);
	const closedRef = useRef(false);
	const stateRef = useRef(state);

	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const closeOpenSession = useCallback(() => {
		unsubscribeRef.current?.();
		unsubscribeRef.current = undefined;
		void openedRef.current?.close();
		openedRef.current = undefined;
	}, []);

	const cleanup = useMemo(() => createCliSessionCleanup(closeOpenSession, () => {
		void source.close();
	}), [closeOpenSession, source]);

	const openSession = useCallback(async (sessionId: string, message?: string) => {
		closeOpenSession();
		const opened = await source.openSession(sessionId);
		openedRef.current = opened;
		const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });
		setState((current) => ({
			...current,
			loading: false,
			status: opened.status,
			session: opened.session,
			rows,
			mode: "transcript",
			picker: undefined,
			message,
			error: undefined,
		}));
		unsubscribeRef.current = opened.subscribe((sourceUpdate) => {
			setState((current) => ({
				...current,
				session: sourceUpdate.session ?? current.session,
				status: sourceUpdate.status ?? current.status,
				rows: sourceUpdate.traceView === undefined ? current.rows : buildCompactTerminalRows(sourceUpdate.traceView, { showThinking: false }),
				error: sourceUpdate.error?.message ?? current.error,
			}));
		});
	}, [closeOpenSession, source]);

	const requestExit = useCallback(() => {
		cleanup();
		onExit?.();
		app.exit();
	}, [app, cleanup, onExit]);

	const submitCommandOrMessage = useCallback(async (rawInput: string) => {
		await handleCliSessionSubmittedInput(rawInput, source, stateRef.current, setState, openSession, requestExit);
	}, [openSession, requestExit, source]);

	const openSessionPickerForRoom = useCallback(async (room: CliRoomSummary, ownerScope: string) => {
		const sessions = await source.listSessions({ roomId: room.id, ownerScope });
		const createItem: InkSessionPickerItem = {
			id: `create:${room.id}`,
			kind: "create-session",
			label: `+ New session in ${room.title}`,
			description: "Create and open a new CLI session in this room",
			roomId: room.id,
			ownerScope,
		};
		const status = await source.getStatus();
		setState((current) => ({
			...current,
			loading: false,
			status,
			activeRoom: room,
			mode: "session-picker",
			picker: {
				kind: "session",
				title: `Select session in ${room.title}`,
				items: [...sessions.map(sessionPickerItem), createItem],
				selectedIndex: 0,
				emptyMessage: `No sessions in ${room.title}. Create a new session to start chatting.`,
				ownerScope,
				roomId: room.id,
			},
			message: sessions.length === 0 ? `No sessions in ${room.title}. Press Enter to create one.` : "Select a session with arrow keys, or create a new one.",
			error: undefined,
		}));
	}, [source]);

	const openRoomPicker = useCallback(async (owner: CliOwnerSummary) => {
		const rooms = await source.listRooms({ ownerScope: owner.ownerScope });
		const defaultIndex = Math.max(0, rooms.findIndex((room) => room.isDefault));
		const status = await source.getStatus();
		setState((current) => ({
			...current,
			loading: false,
			status,
			activeOwner: owner,
			activeRoom: undefined,
			session: undefined,
			rows: [],
			mode: "picker",
			picker: {
				kind: "room",
				title: `Select room for ${owner.label}`,
				items: rooms.map(roomPickerItem),
				selectedIndex: defaultIndex,
				emptyMessage: "No rooms are available for the selected owner.",
				ownerScope: owner.ownerScope,
			},
			message: rooms.length === 0 ? "No rooms are available for the selected owner." : "Select a room with arrow keys.",
			error: undefined,
		}));
	}, [source]);

	const selectPickerItem = useCallback(async () => {
		const picker = stateRef.current.picker;
		const item = picker?.items[picker.selectedIndex];
		if (!picker || !item) {
			setState((current) => ({ ...current, mode: "transcript", picker: undefined, message: picker?.emptyMessage ?? "Nothing to select." }));
			return;
		}
		try {
			if (picker.kind === "owner") {
				closeOpenSession();
				const owner = await source.setActiveOwner(item.ownerScope ?? item.id);
				await openRoomPicker(owner);
				return;
			}
			if (picker.kind === "room") {
				const room = { id: item.roomId ?? item.id, title: item.label, description: item.description, ownerScope: item.ownerScope ?? picker.ownerScope, isDefault: item.id === stateRef.current.status?.activeRoomId };
				const ownerScope = item.ownerScope ?? picker.ownerScope ?? stateRef.current.activeOwner?.ownerScope ?? "";
				if (picker.action === "create-session") {
					const created = await source.createSession({ roomId: room.id, ownerScope, agentId: stateRef.current.status?.activeAgentId });
					await openSession(created.id, `Created session ${created.title}.`);
					return;
				}
				await openSessionPickerForRoom(room, ownerScope);
				return;
			}
			if (picker.kind === "session") {
				if (item.kind === "create-session") {
					const created = await source.createSession({ roomId: item.roomId ?? picker.roomId, ownerScope: item.ownerScope ?? picker.ownerScope, agentId: stateRef.current.status?.activeAgentId });
					await openSession(created.id, `Created session ${created.title}.`);
					return;
				}
				await openSession(item.id, `Opened session ${item.label}.`);
				return;
			}
			const sessionId = stateRef.current.session?.id;
			if (!sessionId) throw new Error("No session is open. Use /new or /session first.");
			const session = await source.setSessionAgent(sessionId, item.id);
			const status = await source.getStatus({ sessionId });
			setState((current) => ({
				...current,
				session,
				status,
				mode: "transcript",
				picker: undefined,
				message: `Selected agent ${item.label}.`,
				error: undefined,
			}));
		} catch (error) {
			setState((current) => ({ ...current, mode: "transcript", picker: undefined, error: boundedLine(formatCliSessionError(error)), message: undefined }));
		}
	}, [closeOpenSession, openRoomPicker, openSession, openSessionPickerForRoom, source]);

	useEffect(() => {
		closedRef.current = false;
		void (async () => {
			try {
				const slashCommands = await safeListSlashCommands(source);
				setState((current) => ({ ...current, slashCommands }));
				if (initialSessionId) {
					await openSession(initialSessionId);
					return;
				}
				const activeOwner = await source.getActiveOwner();
				const owners = await source.listOwners();
				if (!skipOwnerPicker && owners.length > 1) {
					const selectedIndex = Math.max(0, owners.findIndex((owner) => owner.ownerScope === activeOwner.ownerScope));
					const status = await source.getStatus();
					setState((current) => ({
						...current,
						loading: false,
						status,
						activeOwner,
						mode: "picker",
						picker: {
							kind: "owner",
							title: "Select effective owner",
							items: owners.map(ownerPickerItem),
							selectedIndex,
							emptyMessage: "No owners are available.",
						},
						message: "Select the Web user or Root recovery owner to use in this CLI session.",
						error: undefined,
					}));
					return;
				}
				await openRoomPicker(activeOwner);
			} catch (error) {
				setState((current) => ({ ...current, loading: false, error: formatCliSessionError(error) }));
			}
		})();

		return () => {
			closedRef.current = true;
			cleanup();
		};
	}, [cleanup, initialSessionId, openRoomPicker, openSession, skipOwnerPicker, source]);

	useInput((input, key) => {
		if (closedRef.current) return;
		if (key.ctrl && input === "c") {
			requestExit();
			return;
		}
		if (key.escape) {
			setState((current) => reduceInkSessionInputState(current, { type: "escape" }));
			return;
		}
		if (key.upArrow) {
			setState((current) => reduceInkSessionInputState(current, { type: "up" }));
			return;
		}
		if (key.downArrow) {
			setState((current) => reduceInkSessionInputState(current, { type: "down" }));
			return;
		}
		if (key.return) {
			if (stateRef.current.slashSuggestions && !stateRef.current.picker) {
				const accepted = acceptSlashSuggestion(stateRef.current);
				if (accepted.runInput) {
					setState((current) => ({ ...current, input: "", slashSuggestions: undefined, message: undefined, error: undefined }));
					void submitCommandOrMessage(accepted.runInput);
				} else {
					setState((current) => ({ ...current, input: accepted.input, slashSuggestions: undefined, message: `Accepted ${accepted.input.trim()}. Press Enter to run or add arguments.`, error: undefined }));
				}
				return;
			}
			if (stateRef.current.picker) {
				void selectPickerItem();
				return;
			}
			const submitted = stateRef.current.input;
			setState((current) => reduceInkSessionInputState(current, { type: "enter" }));
			void submitCommandOrMessage(submitted);
			return;
		}
		if (key.backspace || key.delete) {
			setState((current) => reduceInkSessionInputState(current, { type: "backspace" }));
			return;
		}
		if (input && !key.ctrl && !key.meta) {
			setState((current) => reduceInkSessionInputState(current, { type: "text", value: input }));
		}
	});

	return React.createElement(InkSessionAppView, { state, maxRows, maxLineChars });
}

export type InkSessionAppViewProps = {
	state: InkSessionAppState;
	maxRows?: number;
	maxLineChars?: number;
};

export function InkSessionAppView({ state, maxRows = 20, maxLineChars }: InkSessionAppViewProps): React.ReactElement {
	const lineLimit = normalizeTerminalLineLimit(maxLineChars);
	const statusText = useMemo(() => boundedLine(formatStatusLine(state), lineLimit), [lineLimit, state]);
	const commandSummary = useMemo(() => boundedLine(cliCommandSummaryText(state.slashCommands), lineLimit), [lineLimit, state.slashCommands]);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		React.createElement(Text, { color: state.status?.connected === false ? "red" : "cyan" }, statusText),
		React.createElement(Text, { color: "gray" }, commandSummary),
		state.loading ? React.createElement(Text, { color: "yellow" }, "Loading CLI session…") : null,
		state.error ? React.createElement(Text, { color: "red" }, boundedLine(`Error: ${state.error}`, lineLimit)) : null,
		...(state.message ? renderBoundedTextLines(state.message, "gray", lineLimit, "message") : []),
		state.slashSuggestions ? React.createElement(InkSlashSuggestionsView, { suggestions: state.slashSuggestions, maxLineChars: lineLimit }) : null,
		state.picker ? React.createElement(InkSessionPickerView, { picker: state.picker, maxLineChars: lineLimit }) : null,
		React.createElement(InkTerminalView, { rows: state.rows, maxRows, maxLineChars: lineLimit }),
		React.createElement(Text, { color: state.mode === "transcript" ? "green" : "yellow" }, boundedLine(`› ${state.input}`, lineLimit)),
	);
}

export function normalizeTerminalLineLimit(maxLineChars: number | undefined): number {
	if (maxLineChars === undefined || !Number.isFinite(maxLineChars)) return 220;
	return Math.max(20, Math.floor(maxLineChars));
}

export function InkSlashSuggestionsView({ suggestions, maxLineChars }: { suggestions: InkSlashSuggestionState; maxLineChars?: number }): React.ReactElement {
	const lineLimit = normalizeTerminalLineLimit(maxLineChars);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		React.createElement(Text, { color: "yellow" }, boundedLine("Slash commands (↑/↓ select, Enter accept/run, Esc close)", lineLimit)),
		...suggestions.items.slice(0, 8).map((command, index) => React.createElement(Text, { key: command.id, color: index === suggestions.selectedIndex ? "green" : "white" }, boundedLine(`${index === suggestions.selectedIndex ? "❯" : " "} ${formatSlashCommand(command)} — ${command.description}${command.unsupportedReason ? ` (${command.unsupportedReason})` : ""}`, lineLimit))),
	);
}

export function InkSessionPickerView({ picker, maxLineChars }: { picker: InkSessionPickerState; maxLineChars?: number }): React.ReactElement {
	const lineLimit = normalizeTerminalLineLimit(maxLineChars);
	if (picker.items.length === 0) {
		return React.createElement(Box, { flexDirection: "column" },
			React.createElement(Text, { color: "yellow" }, boundedLine(picker.title, lineLimit)),
			React.createElement(Text, { color: "gray" }, boundedLine(picker.emptyMessage, lineLimit)),
		);
	}
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		React.createElement(Text, { color: "yellow" }, boundedLine(`${picker.title} (↑/↓ select, Enter open, Esc cancel)`, lineLimit)),
		...picker.items.map((item, index) => React.createElement(Text, { key: item.id, color: index === picker.selectedIndex ? "green" : "white" }, boundedLine(`${index === picker.selectedIndex ? "❯" : " "} ${item.label}${item.description ? ` — ${item.description}` : ""}`, lineLimit))),
	);
}

export type InkSessionInputAction =
	| { type: "text"; value: string }
	| { type: "backspace" }
	| { type: "enter" }
	| { type: "escape" }
	| { type: "up" }
	| { type: "down" };

export function reduceInkSessionInputState(state: InkSessionAppState, action: InkSessionInputAction): InkSessionAppState {
	if (action.type === "text") return withSlashSuggestions({ ...state, input: state.input + action.value, message: undefined, error: undefined });
	if (action.type === "backspace") return withSlashSuggestions({ ...state, input: state.input.slice(0, -1) });
	if (action.type === "escape") {
		if (state.slashSuggestions) return { ...state, slashSuggestions: undefined, message: "Closed slash suggestions." };
		return { ...state, input: "", mode: "transcript", picker: undefined, message: "Canceled." };
	}
	if (action.type === "up" || action.type === "down") {
		if (state.slashSuggestions && !state.picker && state.slashSuggestions.items.length > 0) {
			const direction = action.type === "up" ? -1 : 1;
			const selectedIndex = (state.slashSuggestions.selectedIndex + direction + state.slashSuggestions.items.length) % state.slashSuggestions.items.length;
			return { ...state, slashSuggestions: { ...state.slashSuggestions, selectedIndex } };
		}
		if (!state.picker || state.picker.items.length === 0) return state;
		const direction = action.type === "up" ? -1 : 1;
		const selectedIndex = (state.picker.selectedIndex + direction + state.picker.items.length) % state.picker.items.length;
		return { ...state, picker: { ...state.picker, selectedIndex } };
	}
	return {
		...state,
		input: "",
		slashSuggestions: undefined,
		message: undefined,
		error: undefined,
	};
}

function withSlashSuggestions(state: InkSessionAppState): InkSessionAppState {
	if (state.picker || !state.input.trimStart().startsWith("/")) return { ...state, slashSuggestions: undefined };
	const catalog = state.slashCommands ?? buildSlashCommandCatalog();
	const items = filterSlashCommands(catalog, state.input);
	if (items.length === 0) return { ...state, slashSuggestions: undefined };
	const previous = state.slashSuggestions?.items[state.slashSuggestions.selectedIndex]?.slash;
	const selectedIndex = Math.max(0, previous ? items.findIndex((item) => item.slash === previous) : 0);
	return { ...state, slashSuggestions: { items, selectedIndex } };
}

function acceptSlashSuggestion(state: InkSessionAppState): { input: string; runInput?: string } {
	const suggestion = state.slashSuggestions?.items[state.slashSuggestions.selectedIndex];
	if (!suggestion) return { input: state.input };
	const trimmed = state.input.trim();
	const token = trimmed.split(/\s+/, 1)[0] ?? "";
	if (token === suggestion.slash && trimmed === suggestion.slash) return { input: suggestion.slash, runInput: suggestion.slash };
	return { input: `${suggestion.slash} ` };
}

export type ParsedCliSessionInput =
	| { type: "empty" }
	| { type: "message"; text: string }
	| { type: "command"; command: CliSessionSlashCommand };

export type CliSessionSlashCommand = {
	name: string;
	args: string;
	raw: string;
};

export function parseCliSessionInput(input: string): ParsedCliSessionInput {
	const trimmed = input.trim();
	if (trimmed.length === 0) return { type: "empty" };
	if (!trimmed.startsWith("/")) return { type: "message", text: trimmed };
	const withoutSlash = trimmed.slice(1);
	const [name = "", ...rest] = withoutSlash.split(/\s+/);
	return { type: "command", command: { name: name.toLowerCase(), args: rest.join(" ").trim(), raw: trimmed } };
}

export function cliCommandSummaryText(catalog: readonly SlashCommandDescriptor[] = buildSlashCommandCatalog()): string {
	const availableSlashes = new Set(catalog.map((command) => command.slash));
	const preferred: `/${string}`[] = ["/help", "/new", "/room", "/session", "/agent", "/owner", "/repair-user-unknown", "/status", "/clear", "/exit", "/quit"];
	const commands = preferred.filter((slash) => availableSlashes.has(slash));
	return `Commands: ${commands.join(" ")} (type / for suggestions, /help for catalog)`;
}

export function cliSessionSlashHelpText(catalog: readonly SlashCommandDescriptor[] = buildSlashCommandCatalog()): string {
	const grouped = groupSlashCommandsForHelp(catalog);
	const format = (command: SlashCommandDescriptor) => `${formatSlashCommand(command)} — ${command.description}${command.unsupportedReason ? ` (${command.unsupportedReason})` : ""}`;
	const available = grouped.available.map((command) => `  ${format(command)} [${commandSupportLabel(command)}]`).join("\n") || "  none";
	const navigation = grouped.navigation.map((command) => `  ${format(command)} [${commandSupportLabel(command)}]`).join("\n") || "  none";
	const unsupported = grouped.unsupported.map((command) => `  ${format(command)} [${commandSupportLabel(command)}]`).join("\n") || "  none";
	return [
		"Slash command catalog",
		"Available Web/session actions:",
		available,
		"CLI navigation and recovery commands:",
		navigation,
		"Unsupported or deferred terminal commands:",
		unsupported,
		"Keyboard controls: type / for suggestions; ↑/↓ selects; Enter accepts or runs; Esc closes suggestions or backs out of pickers; room flow is owner → room → session.",
	].join("\n");
}

export function formatCliSessionStatus(status: CliRuntimeStatus | undefined, session: CliSessionSummary | undefined): string {
	if (!status && !session) return "Status unavailable.";
	const parts = [
		`source=${status?.source ?? "unknown"}`,
		`mode=${status?.mode ?? "unknown"}`,
		`connected=${status?.connected === false ? "no" : "yes"}`,
		`owner=${status?.activeOwnerLabel ?? "unknown"} (${status?.activeOwnerScope ?? session?.ownerScope ?? "unknown"})`,
		`session=${session?.id ?? status?.activeSessionId ?? "none"}`,
		`agent=${session?.agentId ?? session?.profile ?? status?.activeAgentId ?? "default"}`,
		`model=${status?.activeModel ? `${status.activeModel.provider}/${status.activeModel.id}` : "unknown"}`,
		`rooms=${status?.rooms ?? "unknown"}`,
		`agents=${status?.agents ?? "unknown"}`,
	];
	if (status?.message) parts.push(`message=${redactCliSessionStatusText(status.message)}`);
	return parts.join(" | ");
}

export async function handleCliSessionSubmittedInput(
	rawInput: string,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string) => Promise<void>,
	requestExit: () => void,
): Promise<void> {
	const parsed = parseCliSessionInput(rawInput);
	if (parsed.type === "empty") return;
	if (parsed.type === "message") {
		const sessionId = state.session?.id;
		if (!sessionId) {
			setState((current) => ({ ...current, error: "No session is open. Use /new to create one or /session to select an existing session." }));
			return;
		}
		try {
			await source.sendMessage(sessionId, parsed.text);
			setState((current) => ({ ...current, message: "Message sent.", error: undefined }));
		} catch (error) {
			setState((current) => ({ ...current, error: boundedLine(formatCliSessionError(error)), message: undefined }));
		}
		return;
	}
	try {
		await handleSlashCommand(parsed.command, source, state, setState, openSession, requestExit);
	} catch (error) {
		setState((current) => ({ ...current, error: boundedLine(formatCliSessionError(error)), message: undefined, mode: "transcript", picker: undefined }));
	}
}

async function handleSlashCommand(
	command: CliSessionSlashCommand,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string) => Promise<void>,
	requestExit: () => void,
): Promise<void> {
	if (command.name === "help") {
		setState((current) => ({ ...current, message: cliSessionSlashHelpText(current.slashCommands ?? state.slashCommands), error: undefined }));
		return;
	}
	if (command.name === "status") {
		const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		const status = await source.getStatus({ sessionId: state.session?.id });
		setState((current) => ({ ...current, status, message: renderCommandResultDescriptorText(result.descriptor, current.session), error: undefined }));
		return;
	}
	if (command.name === "clear") {
		const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		setState((current) => ({ ...current, rows: [], message: `${renderCommandResultDescriptorText(result.descriptor, current.session)}\nCleared local display. Session data was not deleted.`, error: undefined }));
		return;
	}
	if (command.name === "exit" || command.name === "quit") {
		requestExit();
		return;
	}
	if (command.name === "new") {
		const owner = state.activeOwner ?? await source.getActiveOwner();
		if (!state.activeRoom?.id) {
			const rooms = await source.listRooms({ ownerScope: owner.ownerScope });
			const defaultIndex = Math.max(0, rooms.findIndex((room) => room.isDefault));
			const status = await source.getStatus({ sessionId: state.session?.id });
			setState((current) => ({
				...current,
				status,
				activeOwner: owner,
				mode: "picker",
				picker: {
					kind: "room",
					action: "create-session",
					title: `Select room for new session for ${owner.label}`,
					items: rooms.map(roomPickerItem),
					selectedIndex: defaultIndex,
					emptyMessage: "No rooms are available for the selected owner.",
					ownerScope: owner.ownerScope,
				},
				message: rooms.length === 0 ? "No rooms are available for the selected owner." : "Select the room for the new session.",
				error: undefined,
			}));
			return;
		}
		const created = await source.createSession({ roomId: state.activeRoom.id, ownerScope: owner.ownerScope, agentId: state.status?.activeAgentId });
		await openSession(created.id, `Created session ${created.title}.`);
		return;
	}
	if (command.name === "owner" || command.name === "profile") {
		const activeOwner = await source.getActiveOwner();
		const owners = await source.listOwners();
		const selectedIndex = Math.max(0, owners.findIndex((owner) => owner.ownerScope === activeOwner.ownerScope));
		const status = await source.getStatus({ sessionId: state.session?.id });
		setState((current) => ({
			...current,
			status,
			activeOwner,
			mode: "picker",
			picker: {
				kind: "owner",
				title: "Select effective owner",
				items: owners.map(ownerPickerItem),
				selectedIndex,
				emptyMessage: "No owners are available.",
			},
			message: "Select the Web user or Root recovery owner to use in this CLI session.",
			error: undefined,
		}));
		return;
	}
	if (command.name === "session" || command.name === "room") {
		const owner = state.activeOwner ?? await source.getActiveOwner();
		const rooms = await source.listRooms({ ownerScope: owner.ownerScope });
		const status = await source.getStatus({ sessionId: state.session?.id });
		const activeRoomId = state.activeRoom?.id ?? status.activeRoomId;
		const activeRoomIndex = rooms.findIndex((room) => room.id === activeRoomId);
		const selectedIndex = Math.max(0, activeRoomIndex >= 0 ? activeRoomIndex : rooms.findIndex((room) => room.isDefault));
		setState((current) => ({
			...current,
			status,
			activeOwner: owner,
			mode: "picker",
			picker: {
				kind: "room",
				title: command.name === "room" ? `Select active room for ${owner.label}` : `Select room for sessions for ${owner.label}`,
				items: rooms.map(roomPickerItem),
				selectedIndex,
				emptyMessage: "No rooms are available for the selected owner.",
				ownerScope: owner.ownerScope,
			},
			message: rooms.length === 0 ? "No rooms are available for the selected owner." : command.name === "room" ? "Select the active room with arrow keys." : "Select a room, then choose or create a session.",
			error: undefined,
		}));
		return;
	}
	if (command.name === "repair-user-unknown") {
		if (!source.repairLegacyUserUnknownSessions) throw new Error("This source does not support legacy user:unknown repair.");
		const owner = state.activeOwner ?? await source.getActiveOwner();
		const result = await source.repairLegacyUserUnknownSessions({ ownerScope: owner.ownerScope, roomId: state.activeRoom?.id });
		const status = await source.getStatus({ sessionId: state.session?.id });
		setState((current) => ({
			...current,
			status,
			message: `Repaired ${result.repaired}/${result.scanned} legacy user:unknown CLI session${result.scanned === 1 ? "" : "s"} to ${owner.label} (${result.ownerScope})${result.roomId ? ` in ${result.roomId}` : ""}.`,
			error: undefined,
		}));
		return;
	}
	if (command.name === "agent") {
		const agents = await source.listAgents();
		setState((current) => ({
			...current,
			mode: "agent-picker",
			picker: {
				kind: "agent",
				title: "Select existing agent/profile",
				items: agents.map(agentPickerItem),
				selectedIndex: 0,
				emptyMessage: "No existing agents/profiles are available from this source.",
			},
			message: agents.length === 0 ? "No existing agents/profiles are available." : "Select an existing agent/profile with arrow keys.",
			error: undefined,
		}));
		return;
	}
	const handled = await executeSharedSlashCommand(command, source, state, setState, openSession);
	if (handled) return;
	setState((current) => ({ ...current, error: `Unknown command ${command.raw}. Use /help for supported CLI commands.`, message: undefined }));
}

async function executeSharedSlashCommand(
	command: CliSessionSlashCommand,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string) => Promise<void>,
): Promise<boolean> {
	const catalog = state.slashCommands ?? buildSlashCommandCatalog();
	const descriptor = catalog.find((candidate) => candidate.slash === `/${command.name}` || candidate.aliases?.includes(`/${command.name}` as `/${string}`));
	if (!descriptor || descriptor.group === "cli" || descriptor.group === "navigation") return false;
	const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
	const message = renderCommandResultDescriptorText(result.descriptor, state.session);
	if (result.openSessionId && result.openSessionId !== state.session?.id) {
		await openSession(result.openSessionId, message);
		return true;
	}
	const status = await source.getStatus({ sessionId: state.session?.id });
	setState((current) => ({ ...current, status, message, error: undefined }));
	return true;
}

export function renderCommandResultDescriptorText(descriptor: CommandResultDescriptor, session?: CliSessionSummary): string {
	if (descriptor.kind === "text") return [descriptor.title, descriptor.text].filter(Boolean).join(": ");
	if (descriptor.kind === "unsupported") return `${descriptor.command}: ${descriptor.reason}`;
	if (descriptor.kind === "error") return `${descriptor.title ?? "Error"}: ${descriptor.message}`;
	if (descriptor.kind === "session-link") return `${descriptor.title}: ${descriptor.label ?? "session"} ${descriptor.sessionId}${descriptor.roomId ? ` in ${descriptor.roomId}` : ""}`;
	if (descriptor.kind === "status") return `${descriptor.title}: ${formatCliSessionStatus(descriptor.status as CliRuntimeStatus, session)}`;
	if (descriptor.kind === "menu") return [descriptor.title, ...descriptor.items.map((item) => `  ${item.disabled ? "-" : "•"} ${item.label}${item.description ? ` — ${item.description}` : ""}`)].join("\n");
	return `${descriptor.title ?? "Result"}: ${redactCliSessionStatusText(JSON.stringify(descriptor.value, null, 2))}`;
}

function ownerPickerItem(owner: CliOwnerSummary): InkSessionPickerItem {
	return {
		id: owner.ownerScope,
		kind: "owner",
		ownerScope: owner.ownerScope,
		label: owner.label,
		description: [owner.ownerScope, owner.description].filter(Boolean).join(" | "),
	};
}

function roomPickerItem(room: CliRoomSummary): InkSessionPickerItem {
	return {
		id: room.id,
		kind: "room",
		roomId: room.id,
		ownerScope: room.ownerScope,
		label: room.title || room.id,
		description: [room.isDefault ? "default" : undefined, room.description].filter(Boolean).join(" | "),
	};
}

function sessionPickerItem(session: CliSessionSummary): InkSessionPickerItem {
	return {
		id: session.id,
		kind: "session",
		roomId: session.roomId,
		ownerScope: session.ownerScope,
		label: session.title || session.id,
		description: [session.profile, session.status, session.updatedAt].filter(Boolean).join(" | "),
	};
}

function agentPickerItem(agent: CliAgentSummary): InkSessionPickerItem {
	return {
		id: agent.id,
		label: agent.name || agent.id,
		description: agent.description ?? agent.profileName,
	};
}

function renderBoundedTextLines(value: string, color: string, max: number, keyPrefix: string): React.ReactElement[] {
	return value.split(/\r?\n/).map((line, index) => React.createElement(Text, { key: `${keyPrefix}-${index}`, color }, boundedLine(line, max)));
}

function formatStatusLine(state: InkSessionAppState): string {
	const source = state.status?.source ?? "starting";
	const owner = state.status?.activeOwnerLabel ? `${state.status.activeOwnerLabel} (${state.status.activeOwnerScope ?? "unknown"})` : state.status?.activeOwnerScope ?? state.session?.ownerScope ?? "owner unknown";
	const session = state.session?.title ?? state.status?.activeSessionId ?? "no session";
	const agent = state.session?.agentId ?? state.session?.profile ?? state.status?.activeAgentId ?? "default";
	const model = state.status?.activeModel ? `${state.status.activeModel.provider}/${state.status.activeModel.id}` : "model unknown";
	const mode = state.mode === "transcript" ? "transcript" : state.mode;
	return boundedLine(`Pibo CLI Sessions | ${source} | ${owner} | ${session} | ${agent} | ${model} | ${mode}`);
}

function boundedLine(value: string, max = 220): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 12))}… truncated`;
}

export function createCliSessionCleanup(closeOpenSession: () => void, closeSource: () => void): () => void {
	let cleanedUp = false;
	return () => {
		if (cleanedUp) return;
		cleanedUp = true;
		try {
			closeOpenSession();
		} finally {
			try {
				closeSource();
			} catch {
				// Exit cleanup must be best-effort so terminal shutdown can finish.
			}
		}
	};
}

async function safeListSlashCommands(source: CliSessionSource): Promise<readonly SlashCommandDescriptor[]> {
	try {
		return await source.listSlashCommands();
	} catch {
		return buildSlashCommandCatalog();
	}
}

async function safeListRooms(source: CliSessionSource): Promise<readonly unknown[]> {
	try {
		return await source.listRooms();
	} catch {
		return [];
	}
}

function emptySessionRecoveryMessage(status: CliRuntimeStatus, rooms: readonly unknown[]): string {
	if (status.rooms === "unsupported") return "No sessions found and this source cannot list rooms. Use /new to create a local CLI session.";
	if (rooms.length === 0) return "No sessions or rooms found. Use /new to create a local CLI session.";
	return "No sessions found. Use /new to create a local CLI session.";
}

export function formatCliSessionError(error: unknown): string {
	const message = redactCliSessionStatusText(errorMessage(error));
	if (isCliSourceError(error)) {
		if (error.code === "source_closed") return `${message}. Recovery: restart pibo tui:sessions.`;
		if (error.code === "session_not_found") return `${message}. Recovery: use /session to select another session or /new to create one.`;
		if (error.code === "session_owner_mismatch") return `${message}. Recovery: use /owner to switch back, or /session to select a session for the active owner.`;
		if (error.code === "agent_not_found") return `${message}. Recovery: use /agent to pick an available existing profile.`;
		if (error.code === "empty_message") return `${message}. Type a message or use /help.`;
		return `${message}. Recovery: check local Pibo state, then use /status, /session, or /new.`;
	}
	return `${message}. Recovery: use /status for source state or restart the CLI if the problem persists.`;
}

function redactCliSessionStatusText(text: string): string {
	return text
		.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(?:sk|pk|pibo|ghp|github_pat)_[A-Za-z0-9_\-]{8,}\b/g, "[redacted]");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
