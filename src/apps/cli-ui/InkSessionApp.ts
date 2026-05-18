import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { isCliSourceError } from "../../cli-session/index.js";
import {
	buildCompactTerminalRows,
	buildSlashCommandCatalog,
	buildTerminalStatusViewModel,
	commandSupportLabel,
	filterSlashCommands,
	formatSlashCommand,
	groupSlashCommandsForHelp,
	normalizeCommandErrorDescriptor,
	progressBarText,
	type BuildTerminalStatusInput,
	type CommandResultDescriptor,
	type CommandResultMenuItem,
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
import { isExpandableTerminalRow } from "./InkTerminalRow.js";

export type InkSessionPickerItem = {
	id: string;
	label: string;
	description?: string;
	kind?: "owner" | "room" | "session" | "create-session" | "agent" | "command-option";
	ownerScope?: string;
	roomId?: string;
	value?: unknown;
	disabled?: boolean;
};

const IDENTIFIER_PATTERN = /^(?:user|room|ps|pi|entry|evt|run|create|provider|model|agent)[_:]/i;

export type InkSessionPickerState = {
	kind: "owner" | "room" | "session" | "agent" | "command-menu";
	title: string;
	items: readonly InkSessionPickerItem[];
	selectedIndex: number;
	emptyMessage: string;
	action?: "select-session" | "select-room" | "create-session" | "thinking-level" | "model-provider" | "model-choice" | "login-provider" | "login-method" | "fork-candidate";
	ownerScope?: string;
	roomId?: string;
	commandName?: string;
	parent?: InkSessionPickerState;
};

export type InkOverlayState =
	| { kind: "picker"; picker: InkSessionPickerState }
	| { kind: "suggestions"; suggestions: InkSlashSuggestionState }
	| { kind: "detail"; title: string; lines: readonly string[] }
	| { kind: "confirmation"; title: string; message: string; confirmLabel: string; cancelLabel: string };


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
	selectedRowId?: string;
	expandedRowIds?: readonly string[];
	mode: "transcript" | "session-picker" | "agent-picker" | "detail" | "picker";
	picker?: InkSessionPickerState;
	slashCommands?: readonly SlashCommandDescriptor[];
	slashSuggestions?: InkSlashSuggestionState;
	overlayStack?: readonly InkOverlayState[];
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

	const openSession = useCallback(async (sessionId: string, message?: string, localRows?: readonly CompactTerminalRow[]) => {
		closeOpenSession();
		const opened = await source.openSession(sessionId);
		openedRef.current = opened;
		const rows = [...(localRows ?? []), ...buildCompactTerminalRows(opened.traceView, { showThinking: false })];
		setState((current) => normalizeInkRowSelection({
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
			setState((current) => normalizeInkRowSelection({
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

	const openSessionPickerForRoom = useCallback(async (room: CliRoomSummary, ownerScope: string, parent?: InkSessionPickerState) => {
		const sessions = await source.listSessions({ roomId: room.id, ownerScope });
		const createItem: InkSessionPickerItem = {
			id: `create:${room.id}`,
			kind: "create-session",
			label: "+ New session",
			description: ["create and open", `room ${abbreviateIdentifier(room.id)}`].join(" · "),
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
				parent,
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
				if (picker.action === "select-room") {
					const status = await source.getStatus({ sessionId: stateRef.current.session?.id });
					setState((current) => ({ ...current, status, activeRoom: room, mode: "transcript", picker: undefined, overlayStack: undefined, message: `Selected room ${room.title}.`, error: undefined }));
					return;
				}
				await openSessionPickerForRoom(room, ownerScope, picker);
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
			if (picker.kind === "command-menu") {
				await selectCommandMenuItem(picker, item, source, stateRef.current, setState, openSession);
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
			setState((current) => ({ ...current, mode: "transcript", picker: undefined, error: formatCliSessionError(error), message: undefined }));
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
				const nonFallbackOwners = owners.filter((owner) => owner.isFallback !== true);
				if (!skipOwnerPicker && nonFallbackOwners.length > 1) {
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
			const submitted = stateRef.current.input;
			if (submitted.length === 0 && !stateRef.current.picker && !stateRef.current.slashSuggestions && canToggleSelectedRowDetails(stateRef.current)) {
				setState((current) => reduceInkSessionInputState(current, { type: "toggle-details" }));
				return;
			}
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
			if (submitted.trimStart().startsWith("/")) {
				setState((current) => reduceInkSessionInputState(current, { type: "enter" }));
				void submitCommandOrMessage(submitted);
				return;
			}
			if (stateRef.current.picker) {
				void selectPickerItem();
				return;
			}
			setState((current) => reduceInkSessionInputState(current, { type: "enter" }));
			void submitCommandOrMessage(submitted);
			return;
		}
		if (key.backspace || key.delete) {
			setState((current) => reduceInkSessionInputState(current, { type: "backspace" }));
			return;
		}
		if (input === "d" && !key.ctrl && !key.meta && stateRef.current.input.length === 0 && !stateRef.current.picker && !stateRef.current.slashSuggestions && canToggleSelectedRowDetails(stateRef.current)) {
			setState((current) => reduceInkSessionInputState(current, { type: "toggle-details" }));
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
	const statusLines = useMemo(() => formatStatusHeaderLines(state, lineLimit), [lineLimit, state]);
	const commandSummary = useMemo(() => cliCommandHintText(), []);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		...statusLines.map((line, index) => React.createElement(Text, { color: state.status?.connected === false ? "red" : "cyan", key: `status-${index}` }, line)),
		React.createElement(Text, { color: "gray" }, commandSummary),
		state.loading ? React.createElement(Text, { color: "yellow" }, "Loading CLI session…") : null,
		state.error ? React.createElement(Text, { color: "red" }, `Error: ${state.error}`) : null,
		...(state.message ? renderBoundedTextLines(state.message, "gray", lineLimit, "message") : []),
		state.picker ? React.createElement(InkSessionPickerView, { picker: state.picker, maxLineChars: lineLimit }) : null,
		React.createElement(InkTerminalView, { rows: state.rows, maxRows, maxLineChars: lineLimit, selectedRowId: state.selectedRowId, expandedRowIds: state.expandedRowIds }),
		state.slashSuggestions ? React.createElement(InkSlashSuggestionsView, { suggestions: state.slashSuggestions, maxLineChars: lineLimit }) : null,
		React.createElement(Text, { color: state.mode === "transcript" ? "green" : "yellow" }, `› ${state.input}`),
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
		React.createElement(Text, { color: "yellow" }, "slash commands"),
		...suggestions.items.slice(0, 8).map((command, index) => {
			const disabled = command.support === "deferred" || command.support === "browser-only" || Boolean(command.unsupportedReason);
			const item: InkSessionPickerItem = {
				id: command.id,
				label: formatSlashCommand(command),
				description: [command.description, command.unsupportedReason ? `unavailable: ${command.unsupportedReason}` : undefined].filter(Boolean).join(" · "),
				disabled,
			};
			return React.createElement(Text, { key: command.id, color: overlayItemColor(index === suggestions.selectedIndex, disabled) }, formatOverlayItemLine(item, index === suggestions.selectedIndex, lineLimit));
		}),
		React.createElement(Text, { color: "gray" }, "↑↓ select · enter accept/run · esc close · ctrl-c exit"),
	);
}

export function InkSessionPickerView({ picker, maxLineChars }: { picker: InkSessionPickerState; maxLineChars?: number }): React.ReactElement {
	const lineLimit = normalizeTerminalLineLimit(maxLineChars);
	const title = compactOverlayTitle(picker.title);
	if (picker.items.length === 0) {
		return React.createElement(Box, { flexDirection: "column" },
			React.createElement(Text, { color: "yellow" }, title),
			React.createElement(Text, { color: "gray" }, picker.emptyMessage),
			React.createElement(Text, { color: "gray" }, "esc back/cancel · ctrl-c exit"),
		);
	}
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		React.createElement(Text, { color: "yellow" }, title),
		...picker.items.map((item, index) => React.createElement(Text, { key: item.id, color: overlayItemColor(index === picker.selectedIndex, item.disabled === true) }, formatOverlayItemLine(item, index === picker.selectedIndex, lineLimit))),
		React.createElement(Text, { color: "gray" }, "↑↓ select · enter confirm · esc back/cancel · ctrl-c exit"),
	);
}

export type InkSessionInputAction =
	| { type: "text"; value: string }
	| { type: "backspace" }
	| { type: "enter" }
	| { type: "escape" }
	| { type: "up" }
	| { type: "down" }
	| { type: "toggle-details" };

export function reduceInkSessionInputState(state: InkSessionAppState, action: InkSessionInputAction): InkSessionAppState {
	if (action.type === "text") return withSlashSuggestions({ ...state, input: state.input + action.value, message: undefined, error: undefined });
	if (action.type === "backspace") return withSlashSuggestions({ ...state, input: state.input.slice(0, -1) });
	if (action.type === "toggle-details") return toggleSelectedRowDetails(state);
	if (action.type === "escape") {
		if (state.slashSuggestions) return { ...state, slashSuggestions: undefined, overlayStack: popInkSessionOverlay(state.overlayStack), message: "Closed slash suggestions." };
		if (state.picker?.parent) {
			return withPickerOverlay({ ...state, picker: state.picker.parent, mode: pickerMode(state.picker.parent), message: "Back." }, state.picker.parent);
		}
		return { ...state, input: "", mode: "transcript", picker: undefined, overlayStack: popInkSessionOverlay(state.overlayStack), message: "Canceled." };
	}
	if (action.type === "up" || action.type === "down") {
		if (state.slashSuggestions && !state.picker && state.slashSuggestions.items.length > 0) {
			const direction = action.type === "up" ? -1 : 1;
			const selectedIndex = (state.slashSuggestions.selectedIndex + direction + state.slashSuggestions.items.length) % state.slashSuggestions.items.length;
			return { ...state, slashSuggestions: { ...state.slashSuggestions, selectedIndex } };
		}
		if (!state.picker && state.input.length === 0) return selectExpandableRow(state, action.type === "up" ? -1 : 1);
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

export function normalizeInkRowSelection(state: InkSessionAppState): InkSessionAppState {
	const expandableIds = expandableRowIds(state.rows);
	const expandedRowIds = (state.expandedRowIds ?? []).filter((id) => expandableIds.includes(id));
	if (expandableIds.length === 0) return { ...state, selectedRowId: undefined, expandedRowIds };
	const selectedRowId = state.selectedRowId && expandableIds.includes(state.selectedRowId)
		? state.selectedRowId
		: expandableIds[expandableIds.length - 1];
	return { ...state, selectedRowId, expandedRowIds };
}

function selectExpandableRow(state: InkSessionAppState, direction: -1 | 1): InkSessionAppState {
	const normalized = normalizeInkRowSelection(state);
	const ids = expandableRowIds(normalized.rows);
	if (ids.length === 0) return normalized;
	const currentIndex = Math.max(0, ids.indexOf(normalized.selectedRowId ?? ids[ids.length - 1]));
	const selectedRowId = ids[(currentIndex + direction + ids.length) % ids.length];
	return { ...normalized, selectedRowId, message: `Focused row ${currentIndexLabel(ids, selectedRowId)}. Press d or Enter for details.` };
}

function toggleSelectedRowDetails(state: InkSessionAppState): InkSessionAppState {
	const normalized = normalizeInkRowSelection(state);
	const selectedRowId = normalized.selectedRowId;
	if (!selectedRowId) return { ...normalized, message: "No expandable row is available." };
	const expanded = new Set(normalized.expandedRowIds ?? []);
	const opening = !expanded.has(selectedRowId);
	if (opening) expanded.add(selectedRowId);
	else expanded.delete(selectedRowId);
	return {
		...normalized,
		expandedRowIds: [...expanded],
		message: opening ? "Opened row details." : "Closed row details.",
	};
}

function canToggleSelectedRowDetails(state: InkSessionAppState): boolean {
	return expandableRowIds(state.rows).length > 0;
}

function expandableRowIds(rows: readonly CompactTerminalRow[]): string[] {
	return rows.filter(isExpandableTerminalRow).map((row) => row.id);
}

function currentIndexLabel(ids: readonly string[], selectedRowId: string | undefined): string {
	const index = selectedRowId ? ids.indexOf(selectedRowId) : -1;
	return index >= 0 ? `${index + 1}/${ids.length}` : `1/${ids.length}`;
}

function withSlashSuggestions(state: InkSessionAppState): InkSessionAppState {
	if (state.picker || !state.input.trimStart().startsWith("/")) return { ...state, slashSuggestions: undefined, overlayStack: state.slashSuggestions ? popInkSessionOverlay(state.overlayStack) : state.overlayStack };
	const catalog = state.slashCommands ?? buildSlashCommandCatalog();
	const items = filterSlashCommands(catalog, state.input);
	if (items.length === 0) return { ...state, slashSuggestions: undefined, overlayStack: state.slashSuggestions ? popInkSessionOverlay(state.overlayStack) : state.overlayStack };
	const previous = state.slashSuggestions?.items[state.slashSuggestions.selectedIndex]?.slash;
	const selectedIndex = Math.max(0, previous ? items.findIndex((item) => item.slash === previous) : 0);
	const suggestions = { items, selectedIndex };
	return { ...state, slashSuggestions: suggestions, overlayStack: replaceTopOverlay(state.overlayStack, { kind: "suggestions", suggestions }) };
}

function acceptSlashSuggestion(state: InkSessionAppState): { input: string; runInput?: string } {
	const suggestion = state.slashSuggestions?.items[state.slashSuggestions.selectedIndex];
	if (!suggestion) return { input: state.input };
	const trimmed = state.input.trim();
	const token = trimmed.split(/\s+/, 1)[0] ?? "";
	if (token === suggestion.slash && trimmed.length > suggestion.slash.length) return { input: state.input, runInput: trimmed };
	if (token === suggestion.slash && trimmed === suggestion.slash) return { input: suggestion.slash, runInput: suggestion.slash };
	return { input: `${suggestion.slash} ` };
}

export function pushInkSessionOverlay(stack: readonly InkOverlayState[] | undefined, overlay: InkOverlayState): readonly InkOverlayState[] {
	return [...(stack ?? []), overlay];
}

export function popInkSessionOverlay(stack: readonly InkOverlayState[] | undefined): readonly InkOverlayState[] | undefined {
	if (!stack || stack.length <= 1) return undefined;
	return stack.slice(0, -1);
}

export function activeInkSessionOverlay(stack: readonly InkOverlayState[] | undefined): InkOverlayState | undefined {
	return stack?.[stack.length - 1];
}

function replaceTopOverlay(stack: readonly InkOverlayState[] | undefined, overlay: InkOverlayState): readonly InkOverlayState[] {
	if (!stack || stack.length === 0) return [overlay];
	return [...stack.slice(0, -1), overlay];
}

function withPickerOverlay(state: InkSessionAppState, picker: InkSessionPickerState): InkSessionAppState {
	return { ...state, picker, overlayStack: replaceTopOverlay(state.overlayStack, { kind: "picker", picker }) };
}

function pickerMode(picker: InkSessionPickerState): InkSessionAppState["mode"] {
	if (picker.kind === "agent") return "agent-picker";
	if (picker.kind === "session") return "session-picker";
	return "picker";
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

export function cliCommandHintText(): string {
	return "commands: / opens palette · /status runtime · /room /session navigate · /help catalog · ↑↓ focus rows · d/enter details · ctrl-c exit";
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
		"Keyboard controls: type / for suggestions; ↑/↓ selects suggestions, pickers, or expandable transcript rows; Enter accepts/runs or opens focused details when the composer is empty; d toggles focused details; Esc closes suggestions or backs out of pickers; room flow is owner → room → session.",
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
	openSession: (sessionId: string, message?: string, localRows?: readonly CompactTerminalRow[]) => Promise<void>,
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
			setState((current) => ({ ...current, error: formatCliSessionError(error), message: undefined }));
		}
		return;
	}
	try {
		await handleSlashCommand(parsed.command, source, state, setState, openSession, requestExit);
	} catch (error) {
		setState((current) => applyCommandResultToState(current, parsed.command, normalizeCommandErrorDescriptor(parsed.command.name, error), current.status));
	}
}

async function handleSlashCommand(
	command: CliSessionSlashCommand,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string, localRows?: readonly CompactTerminalRow[]) => Promise<void>,
	requestExit: () => void,
): Promise<void> {
	if (command.name === "help") {
		setState((current) => ({ ...current, message: cliSessionSlashHelpText(current.slashCommands ?? state.slashCommands), error: undefined }));
		return;
	}
	if (command.name === "status") {
		const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		const status = await source.getStatus({ sessionId: state.session?.id });
		setState((current) => applyCommandResultToState(current, command, result.descriptor, status));
		return;
	}
	if (command.name === "clear") {
		const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		setState((current) => normalizeInkRowSelection({ ...current, rows: [], message: `${renderCommandResultDescriptorText(result.descriptor, current.session)}\nCleared local display. Session data was not deleted.`, error: undefined }));
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
				action: command.name === "room" ? "select-room" : undefined,
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
	if (command.name === "thinking") {
		if (command.args.trim()) {
			validateThinkingLevel(command.args);
			const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
			const status = await source.getStatus({ sessionId: state.session?.id });
			setState((current) => applyCommandResultToState(current, command, result.descriptor, status));
			return;
		}
		setState((current) => withPickerOverlay({
			...current,
			mode: "picker",
			message: "Select a thinking level with arrow keys, then Enter.",
			error: undefined,
		}, thinkingPickerState()));
		return;
	}
	if (command.name === "model") {
		const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		if (command.args.trim()) {
			const status = await source.getStatus({ sessionId: state.session?.id });
			setState((current) => applyCommandResultToState(current, command, result.descriptor, status));
			return;
		}
		const providers = modelProviderItemsFromActionResult(result.rawResult, result.descriptor);
		if (providers.length === 0) {
			setState((current) => applyCommandResultToState(current, command, result.descriptor, current.status));
			return;
		}
		setState((current) => withPickerOverlay({
			...current,
			mode: "picker",
			message: "Select a provider, then choose a model.",
			error: undefined,
		}, modelProviderPickerState(providers)));
		return;
	}
	if (command.name === "login") {
		const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		if (command.args.trim()) {
			const status = await source.getStatus({ sessionId: state.session?.id });
			setState((current) => applyCommandResultToState(current, command, result.descriptor, status));
			return;
		}
		const providers = loginProviderItemsFromActionResult(result.rawResult, result.descriptor);
		if (providers.length === 0) {
			setState((current) => applyCommandResultToState(current, command, result.descriptor, current.status));
			return;
		}
		setState((current) => withPickerOverlay({
			...current,
			mode: "picker",
			message: "Select a login provider, then choose a terminal-safe auth method.",
			error: undefined,
		}, loginProviderPickerState(providers)));
		return;
	}
	if (command.name === "fork-candidates") {
		const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		const descriptor = result.descriptor;
		if (command.args.trim() || descriptor.kind !== "menu" || descriptor.items.length === 0) {
			const status = await source.getStatus({ sessionId: state.session?.id });
			if (result.openSessionId && result.openSessionId !== state.session?.id) {
				const localRows = commandResultDescriptorRows(command, descriptor, status, state.session, 0);
				await openSession(result.openSessionId, undefined, localRows);
			}
			else setState((current) => applyCommandResultToState(current, command, descriptor, status));
			return;
		}
		setState((current) => withPickerOverlay({
			...current,
			mode: "picker",
			message: "Select a fork candidate with arrow keys, then Enter.",
			error: undefined,
		}, forkCandidatePickerState(descriptor.items)));
		return;
	}
	const handled = await executeSharedSlashCommand(command, source, state, setState, openSession);
	if (handled) return;
	setState((current) => applyCommandResultToState(current, command, { kind: "unsupported", command: command.raw, reason: "Use /help for supported CLI commands." }, current.status));
}

async function executeSharedSlashCommand(
	command: CliSessionSlashCommand,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string, localRows?: readonly CompactTerminalRow[]) => Promise<void>,
): Promise<boolean> {
	const catalog = state.slashCommands ?? buildSlashCommandCatalog();
	const descriptor = catalog.find((candidate) => candidate.slash === `/${command.name}` || candidate.aliases?.includes(`/${command.name}` as `/${string}`));
	if (!descriptor || descriptor.group === "cli" || descriptor.group === "navigation") return false;
	const result = await source.executeSlashCommand({ command: command.name, args: command.args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
	const status = await source.getStatus({ sessionId: state.session?.id });
	if (result.openSessionId && result.openSessionId !== state.session?.id) {
		const localRows = commandResultDescriptorRows(command, result.descriptor, status, state.session, 0);
		await openSession(result.openSessionId, undefined, localRows);
		return true;
	}
	setState((current) => applyCommandResultToState(current, command, result.descriptor, status));
	return true;
}

const THINKING_LEVELS = ["current/default", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const APPLY_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

type ModelProviderOption = CommandResultMenuItem & { models?: readonly CommandResultMenuItem[] };
type LoginProviderOption = CommandResultMenuItem & { authMethods?: readonly CommandResultMenuItem[] };

async function selectCommandMenuItem(
	picker: InkSessionPickerState,
	item: InkSessionPickerItem,
	source: CliSessionSource,
	state: InkSessionAppState,
	setState: React.Dispatch<React.SetStateAction<InkSessionAppState>>,
	openSession: (sessionId: string, message?: string, localRows?: readonly CompactTerminalRow[]) => Promise<void>,
): Promise<void> {
	if (item.disabled) {
		setState((current) => ({ ...current, message: item.description ? `${item.label}: ${item.description}` : `${item.label} is unavailable.`, error: undefined }));
		return;
	}
	if (picker.action === "thinking-level") {
		const level = String(item.value ?? item.id);
		if (level === "current/default") {
			setState((current) => ({ ...current, mode: "transcript", picker: undefined, overlayStack: popInkSessionOverlay(current.overlayStack), message: "Kept current/default thinking level.", error: undefined }));
			return;
		}
		validateThinkingLevel(level);
		const result = await source.executeSlashCommand({ command: "thinking", args: level, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		const status = await source.getStatus({ sessionId: state.session?.id });
		setState((current) => applyCommandResultToState(current, { name: "thinking", args: level, raw: `/thinking ${level}` }, result.descriptor, status));
		return;
	}
	if (picker.action === "model-provider") {
		const provider = item.value as ModelProviderOption | undefined;
		const models = provider?.models ?? [];
		const next = modelChoicePickerState(item, models, picker);
		setState((current) => withPickerOverlay({ ...current, mode: "picker", message: models.length === 0 ? `${item.label} has no terminal-selectable models.` : `Select model for ${item.label}.`, error: undefined }, next));
		return;
	}
	if (picker.action === "model-choice") {
		const providerValue = picker.parent?.items[picker.parent.selectedIndex]?.value as ModelProviderOption | undefined;
		const itemValue = item.value && typeof item.value === "object" ? item.value as { provider?: unknown; id?: unknown } : undefined;
		const providerId = String(providerValue?.id ?? itemValue?.provider ?? "");
		const modelId = String(itemValue?.id ?? item.id);
		const args = providerId ? `${providerId}/${modelId}` : modelId;
		const result = await source.executeSlashCommand({ command: "model", args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		const status = await source.getStatus({ sessionId: state.session?.id });
		const command = { name: "model", args, raw: `/model ${args}` };
		if (result.openSessionId && result.openSessionId !== state.session?.id) {
			const localRows = commandResultDescriptorRows(command, result.descriptor, status, state.session, 0);
			await openSession(result.openSessionId, undefined, localRows);
			return;
		}
		setState((current) => applyCommandResultToState(current, command, result.descriptor, status));
		return;
	}
	if (picker.action === "login-provider") {
		const provider = item.value as LoginProviderOption | undefined;
		const methods = provider?.authMethods ?? [];
		const next = loginMethodPickerState(item, methods, picker);
		setState((current) => withPickerOverlay({ ...current, mode: "picker", message: methods.length === 0 ? `${item.label} has no terminal auth methods.` : `Select auth method for ${item.label}.`, error: undefined }, next));
		return;
	}
	if (picker.action === "login-method") {
		const providerValue = picker.parent?.items[picker.parent.selectedIndex]?.value as LoginProviderOption | undefined;
		const providerId = String(providerValue?.id ?? "");
		const methodId = String(item.id);
		const args = providerId ? `${providerId}/${methodId}` : methodId;
		const result = await source.executeSlashCommand({ command: "login", args, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		const status = await source.getStatus({ sessionId: state.session?.id });
		setState((current) => applyCommandResultToState(current, { name: "login", args, raw: `/login ${args}` }, result.descriptor, status));
		return;
	}
	if (picker.action === "fork-candidate") {
		const result = await source.executeSlashCommand({ command: "fork-candidates", args: item.id, sessionId: state.session?.id, ownerScope: state.activeOwner?.ownerScope });
		const status = await source.getStatus({ sessionId: state.session?.id });
		const command = { name: "fork-candidates", args: item.id, raw: `/fork-candidates ${item.id}` };
		if (result.openSessionId && result.openSessionId !== state.session?.id) {
			const localRows = commandResultDescriptorRows(command, result.descriptor, status, state.session, 0);
			await openSession(result.openSessionId, undefined, localRows);
			return;
		}
		setState((current) => applyCommandResultToState(current, command, result.descriptor, status));
		return;
	}
	setState((current) => ({ ...current, mode: "transcript", picker: undefined, message: `${item.label} selected.`, error: undefined }));
}

function thinkingPickerState(): InkSessionPickerState {
	return {
		kind: "command-menu",
		action: "thinking-level",
		commandName: "thinking",
		title: "Select thinking level",
		items: THINKING_LEVELS.map((level) => ({ id: level, kind: "command-option", label: level, value: level, description: level === "current/default" ? "Keep current runtime/default setting" : `Set thinking to ${level}` })),
		selectedIndex: 0,
		emptyMessage: "No thinking levels are available.",
	};
}

function validateThinkingLevel(value: string): void {
	const level = value.trim().toLowerCase();
	if (!APPLY_THINKING_LEVELS.has(level)) throw new Error(`Unsupported thinking level "${value}". Use off, minimal, low, medium, high, or xhigh.`);
}

function modelProviderPickerState(providers: readonly ModelProviderOption[]): InkSessionPickerState {
	return {
		kind: "command-menu",
		action: "model-provider",
		commandName: "model",
		title: "Select model provider",
		items: providers.map((provider) => ({ id: provider.id, kind: "command-option", label: provider.label, description: provider.description, value: provider, disabled: provider.disabled })),
		selectedIndex: 0,
		emptyMessage: "No model providers are available.",
	};
}

function modelChoicePickerState(providerItem: InkSessionPickerItem, models: readonly CommandResultMenuItem[], parent: InkSessionPickerState): InkSessionPickerState {
	return {
		kind: "command-menu",
		action: "model-choice",
		commandName: "model",
		title: `Select model for ${providerItem.label}`,
		items: models.map((model) => ({ id: model.id, kind: "command-option", label: model.label, description: model.description, value: { ...model, provider: providerItem.id }, disabled: model.disabled })),
		selectedIndex: 0,
		emptyMessage: `${providerItem.label} did not return any terminal-selectable models.`,
		parent,
	};
}

function loginProviderPickerState(providers: readonly LoginProviderOption[]): InkSessionPickerState {
	return {
		kind: "command-menu",
		action: "login-provider",
		commandName: "login",
		title: "Select login provider",
		items: providers.map((provider) => ({ id: provider.id, kind: "command-option", label: provider.label, description: provider.description, value: provider, disabled: provider.disabled })),
		selectedIndex: 0,
		emptyMessage: "No login providers are available.",
	};
}

function loginMethodPickerState(providerItem: InkSessionPickerItem, methods: readonly CommandResultMenuItem[], parent: InkSessionPickerState): InkSessionPickerState {
	return {
		kind: "command-menu",
		action: "login-method",
		commandName: "login",
		title: `Select auth method for ${providerItem.label}`,
		items: methods.map((method) => ({ id: method.id, kind: "command-option", label: method.label, description: method.description, value: { ...method, provider: providerItem.id }, disabled: method.disabled })),
		selectedIndex: 0,
		emptyMessage: `${providerItem.label} did not return any terminal auth methods.`,
		parent,
	};
}

function forkCandidatePickerState(items: readonly CommandResultMenuItem[]): InkSessionPickerState {
	return {
		kind: "command-menu",
		action: "fork-candidate",
		commandName: "fork-candidates",
		title: "Select fork candidate",
		items: items.map((item) => ({ id: item.id, kind: "command-option", label: item.label, description: item.description, value: item, disabled: item.disabled })),
		selectedIndex: 0,
		emptyMessage: "No fork candidates are available.",
	};
}

function modelProviderItemsFromActionResult(rawResult: unknown, descriptor: CommandResultDescriptor): ModelProviderOption[] {
	const raw = unwrapActionPayload(rawResult);
	const providers = recordsField(raw, "providers");
	if (providers.length > 0) return providers.map((provider, index) => ({
		id: stringField(provider, "id") ?? stringField(provider, "provider") ?? `provider-${index}`,
		label: stringField(provider, "label") ?? stringField(provider, "name") ?? stringField(provider, "provider") ?? `Provider ${index + 1}`,
		description: stringField(provider, "description") ?? (provider.disabled === true ? stringField(provider, "reason") : undefined),
		disabled: provider.disabled === true,
		models: recordsField(provider, "models").map((model, modelIndex) => ({
			id: stringField(model, "id") ?? stringField(model, "model") ?? `model-${modelIndex}`,
			label: stringField(model, "label") ?? stringField(model, "name") ?? stringField(model, "model") ?? stringField(model, "id") ?? `Model ${modelIndex + 1}`,
			description: stringField(model, "description") ?? (model.disabled === true ? stringField(model, "reason") : undefined),
			disabled: model.disabled === true,
			value: model,
		})),
	}));
	return descriptor.kind === "menu" ? descriptor.items.map((item) => ({ ...item, models: [] })) : [];
}

function loginProviderItemsFromActionResult(rawResult: unknown, descriptor: CommandResultDescriptor): LoginProviderOption[] {
	const raw = unwrapActionPayload(rawResult);
	const providers = recordsField(raw, "providers");
	if (providers.length > 0) return providers.map((provider, index) => {
		const id = stringField(provider, "id") ?? stringField(provider, "provider") ?? `provider-${index}`;
		const configured = provider.configured === true ? "configured" : provider.configured === false ? "not configured" : undefined;
		return {
			id,
			label: stringField(provider, "label") ?? stringField(provider, "name") ?? id,
			description: [configured, stringField(provider, "description")].filter(Boolean).join(" | ") || undefined,
			disabled: provider.disabled === true,
			authMethods: authMethodItems(provider),
		};
	});
	return descriptor.kind === "menu" ? descriptor.items.map((item) => ({ ...item, authMethods: [] })) : [];
}

function authMethodItems(provider: Record<string, unknown>): CommandResultMenuItem[] {
	const records = recordsField(provider, "authMethods");
	if (records.length > 0) return records.map((method, index) => ({
		id: stringField(method, "id") ?? stringField(method, "method") ?? `method-${index}`,
		label: authMethodLabel(stringField(method, "label") ?? stringField(method, "name") ?? stringField(method, "method") ?? stringField(method, "id") ?? `Method ${index + 1}`),
		description: stringField(method, "description") ?? stringField(method, "reason"),
		disabled: method.disabled === true,
		value: method,
	}));
	return arrayStringField(provider, "authMethods").map((method) => ({ id: method, label: authMethodLabel(method), description: authMethodDescription(method) }));
}

function authMethodLabel(method: string): string {
	if (method === "device_code") return "Device code / OAuth";
	if (method === "api_key") return "API key";
	return method;
}

function authMethodDescription(method: string): string | undefined {
	if (method === "device_code") return "Open a URL and complete sign-in in any browser.";
	if (method === "api_key") return "Secret input is not echoed; this flow shows safe setup instructions.";
	return undefined;
}

function unwrapActionPayload(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const record = value as Record<string, unknown>;
	if (record.ok === true && "result" in record) return record.result;
	if (record.success === true && "data" in record) return record.data;
	return value;
}

function recordsField(value: unknown, key: string): Record<string, unknown>[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const field = (value as Record<string, unknown>)[key];
	return Array.isArray(field) ? field.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function arrayStringField(value: unknown, key: string): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const field = (value as Record<string, unknown>)[key];
	return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string") : [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function applyCommandResultToState(
	current: InkSessionAppState,
	command: CliSessionSlashCommand,
	descriptor: CommandResultDescriptor,
	status?: CliRuntimeStatus,
): InkSessionAppState {
	return normalizeInkRowSelection({
		...current,
		...(status ? { status } : {}),
		mode: "transcript",
		picker: undefined,
		slashSuggestions: undefined,
		overlayStack: undefined,
		rows: appendCommandResultRows(current.rows, command, descriptor, status, current.session),
		message: undefined,
		error: undefined,
	});
}

export function appendCommandResultRows(
	rows: readonly CompactTerminalRow[],
	command: CliSessionSlashCommand,
	descriptor: CommandResultDescriptor,
	status?: CliRuntimeStatus,
	session?: CliSessionSummary,
): CompactTerminalRow[] {
	return [...rows, ...commandResultDescriptorRows(command, descriptor, status, session, rows.length)];
}

export function commandResultDescriptorRows(
	command: CliSessionSlashCommand,
	descriptor: CommandResultDescriptor,
	status?: CliRuntimeStatus,
	session?: CliSessionSummary,
	startIndex = 0,
): CompactTerminalRow[] {
	const commandLabel = command.raw || `/${command.name}${command.args ? ` ${command.args}` : ""}`;
	const commandRow: CompactTerminalRow = {
		id: `cli-command:${startIndex}:${command.name}`,
		kind: "execution.command",
		status: descriptor.kind === "error" ? "error" : "done",
		lines: [{ prefix: "bullet", tokens: [{ text: `Ran ${commandLabel}`, tone: "yellow", weight: "semibold" }] }],
		sourceNodeIds: [`cli-command:${startIndex}:${command.name}`],
	};
	const resultRow = commandResultDescriptorRow(command, descriptor, status, session, startIndex + 1);
	return resultRow ? [commandRow, resultRow] : [commandRow];
}

function commandResultDescriptorRow(
	command: CliSessionSlashCommand,
	descriptor: CommandResultDescriptor,
	status: CliRuntimeStatus | undefined,
	session: CliSessionSummary | undefined,
	index: number,
): CompactTerminalRow | undefined {
	const id = `cli-command-result:${index}:${command.name}`;
	if (descriptor.kind === "status") {
		return {
			id,
			kind: "tool.status",
			status: "done",
			lines: [],
			output: commandStatusRowOutput(descriptor.status, status, session),
			sourceNodeIds: [id],
		};
	}
	if (descriptor.kind === "error") {
		return { id, kind: "error", status: "error", lines: [], error: descriptor.message, sourceNodeIds: [id] };
	}
	return {
		id,
		kind: "execution.command",
		status: descriptor.kind === "unsupported" ? "error" : "done",
		lines: [],
		output: renderCommandResultDescriptorText(descriptor, session),
		sourceNodeIds: [id],
	};
}

function commandStatusRowOutput(rawStatus: unknown, status?: CliRuntimeStatus, session?: CliSessionSummary): Record<string, unknown> {
	const descriptorStatus = rawStatus && typeof rawStatus === "object" && !Array.isArray(rawStatus) ? rawStatus as Record<string, unknown> : {};
	return {
		...descriptorStatus,
		activeOwnerLabel: status?.activeOwnerLabel,
		activeOwnerScope: status?.activeOwnerScope ?? session?.ownerScope,
		piboSessionId: session?.id ?? status?.activeSessionId ?? descriptorStatus.piboSessionId,
		sessionTitle: session?.title,
		profile: session?.profile ?? session?.agentId ?? status?.activeAgentId,
		activeModel: status?.activeModel ?? descriptorStatus.activeModel,
		mode: status?.mode ?? descriptorStatus.mode,
		connected: status?.connected,
		queuedMessages: status?.queuedMessages ?? descriptorStatus.queuedMessages,
		processing: status?.processing ?? descriptorStatus.processing,
		streaming: status?.streaming ?? descriptorStatus.streaming,
		cwd: status?.cwd ?? descriptorStatus.cwd,
		contextUsage: status?.contextUsage ?? descriptorStatus.contextUsage,
		providerUsage: status?.providerUsage ?? descriptorStatus.providerUsage,
		activeTools: status?.activeTools ?? descriptorStatus.activeTools,
		enabledTools: status?.enabledTools ?? descriptorStatus.enabledTools,
		disposed: status?.disposed ?? descriptorStatus.disposed,
		thinkingLevel: status?.thinkingLevel ?? descriptorStatus.thinkingLevel,
		fastMode: status?.fastMode ?? descriptorStatus.fastMode,
		warnings: status?.warnings ?? descriptorStatus.warnings,
		errors: status?.errors ?? descriptorStatus.errors,
		message: status?.message ?? descriptorStatus.message,
	};
}

export function renderCommandResultDescriptorText(descriptor: CommandResultDescriptor, session?: CliSessionSummary): string {
	if (descriptor.kind === "text") return [descriptor.title, descriptor.text].filter(Boolean).join(": ");
	if (descriptor.kind === "unsupported") return `${descriptor.command}: ${descriptor.reason}`;
	if (descriptor.kind === "error") return `${descriptor.title ?? "Error"}: ${descriptor.message}`;
	if (descriptor.kind === "session-link") return `${descriptor.title}: ${descriptor.label ?? "session"} ${descriptor.sessionId}${descriptor.roomId ? ` in ${descriptor.roomId}` : ""}`;
	if (descriptor.kind === "status") return renderCliStatusCardText(descriptor.status as CliRuntimeStatus, session, descriptor.title);
	if (descriptor.kind === "menu") return [descriptor.title, ...descriptor.items.map((item) => `  ${item.disabled ? "-" : "•"} ${item.label}${item.description ? ` — ${item.description}` : ""}`)].join("\n");
	return `${descriptor.title ?? "Result"}: ${redactCliSessionStatusText(JSON.stringify(descriptor.value, null, 2))}`;
}

export function renderCliStatusCardText(status: CliRuntimeStatus | undefined, session?: CliSessionSummary, title = "Status"): string {
	const summary = formatCliSessionStatus(status, session);
	const viewModel = buildTerminalStatusViewModel(statusViewModelInput(status, session));
	const lines = [`${title}: ${summary}`];
	for (const field of viewModel.fields) lines.push(`  ${field.label}: ${field.value}`);
	for (const progress of viewModel.progress) lines.push(`  ${progress.label}: ${progressBarText(progress, progress.state === "available" ? 18 : 12)} — ${progress.text}`);
	for (const warning of viewModel.warnings) lines.push(`  Warning: ${warning}`);
	for (const error of viewModel.errors) lines.push(`  Error: ${error}`);
	return lines.join("\n");
}

function statusViewModelInput(status: CliRuntimeStatus | undefined, session?: CliSessionSummary): BuildTerminalStatusInput {
	const runtimeState = status?.connected === false ? "disconnected" : status?.processing ? "processing" : status?.streaming ? "streaming" : status?.mode ?? "unknown";
	return {
		owner: { label: status?.activeOwnerLabel, scope: status?.activeOwnerScope ?? session?.ownerScope },
		session: { id: session?.id ?? status?.activeSessionId, title: session?.title, profile: session?.profile ?? session?.agentId ?? status?.activeAgentId, status: session?.status },
		model: status?.activeModel ?? session?.model ?? { provider: "unknown", id: "unknown", label: "unknown" },
		runtime: { state: runtimeState, connected: status?.connected, queuedMessages: status?.queuedMessages, processing: status?.processing, streaming: status?.streaming, disposed: status?.disposed },
		cwd: status?.cwd,
		contextUsage: status?.contextUsage,
		providerUsage: status?.providerUsage,
		tools: { enabled: status?.enabledTools, active: status?.activeTools },
		thinking: status?.thinkingLevel ? { level: status.thinkingLevel } : undefined,
		fastMode: status?.fastMode,
		warnings: status?.warnings,
		errors: status?.errors,
		message: status?.message,
	};
}

function compactOverlayTitle(title: string): string {
	return title
		.replace(/^Select effective owner$/i, "select owner")
		.replace(/^Select existing agent\/profile$/i, "select agent")
		.replace(/^Select thinking level$/i, "select thinking level")
		.replace(/^Select model provider$/i, "select model provider")
		.replace(/^Select login provider$/i, "select login provider")
		.replace(/^Select fork candidate$/i, "select fork candidate")
		.replace(/^Select auth method for /i, "select login method — ")
		.replace(/^Select model for /i, "select model — ")
		.replace(/^Select session in /i, "select session — ")
		.replace(/^Select room for new session for /i, "select room — new session for ")
		.replace(/^Select active room for /i, "select room — ")
		.replace(/^Select room for sessions for /i, "select room — sessions for ")
		.replace(/^Select room for /i, "select room — ")
		.replace(/^Select /i, "select ");
}

function formatOverlayItemLine(item: InkSessionPickerItem, selected: boolean, _max: number): string {
	const marker = selected ? "❯" : " ";
	const disabled = item.disabled === true;
	const availability = disabled ? "× " : "";
	const secondary = item.description ? ` · ${redactCliSessionStatusText(item.description)}` : "";
	return `${marker} ${availability}${redactCliSessionStatusText(item.label)}${secondary}`;
}

function overlayItemColor(selected: boolean, disabled: boolean): string {
	if (disabled) return "gray";
	return selected ? "green" : "white";
}

function abbreviateIdentifier(value: string | undefined, _max = 24): string | undefined {
	return value;
}

function itemMetadata(...parts: Array<string | undefined | false>): string | undefined {
	return parts.filter(Boolean).join(" · ") || undefined;
}

function ownerKindLabel(owner: CliOwnerSummary): string {
	if (owner.kind === "web-user") return "Web user";
	if (owner.kind === "root-recovery") return "Root recovery";
	if (owner.kind === "legacy") return "Legacy owner";
	return "Local owner";
}

function modelLabel(model: CliSessionSummary["model"]): string | undefined {
	if (!model) return undefined;
	return `${model.provider}/${model.id}`;
}

function ownerPickerItem(owner: CliOwnerSummary): InkSessionPickerItem {
	return {
		id: owner.ownerScope,
		kind: "owner",
		ownerScope: owner.ownerScope,
		label: owner.label,
		description: itemMetadata(ownerKindLabel(owner), abbreviateIdentifier(owner.ownerScope), owner.description),
	};
}

function roomPickerItem(room: CliRoomSummary): InkSessionPickerItem {
	const label = room.title || abbreviateIdentifier(room.id) || room.id;
	return {
		id: room.id,
		kind: "room",
		roomId: room.id,
		ownerScope: room.ownerScope,
		label,
		description: itemMetadata(room.isDefault ? "default" : undefined, room.description, `room ${abbreviateIdentifier(room.id)}`),
	};
}

function sessionPickerItem(session: CliSessionSummary): InkSessionPickerItem {
	return {
		id: session.id,
		kind: "session",
		roomId: session.roomId,
		ownerScope: session.ownerScope,
		label: session.title || abbreviateIdentifier(session.id) || session.id,
		description: itemMetadata(session.status, session.profile || session.agentId, modelLabel(session.model), session.updatedAt ? `updated ${session.updatedAt}` : undefined, abbreviateIdentifier(session.id)),
	};
}

function agentPickerItem(agent: CliAgentSummary): InkSessionPickerItem {
	return {
		id: agent.id,
		label: agent.name || agent.id,
		description: itemMetadata(agent.profileName, agent.description, IDENTIFIER_PATTERN.test(agent.id) ? abbreviateIdentifier(agent.id) : undefined),
	};
}

function renderBoundedTextLines(value: string, color: string, _max: number, keyPrefix: string): React.ReactElement[] {
	return value.split(/\r?\n/).map((line, index) => React.createElement(Text, { key: `${keyPrefix}-${index}`, color }, line));
}

export function formatStatusHeaderLines(state: InkSessionAppState, max = 220): string[] {
	const source = state.status?.source ?? "starting";
	const owner = statusHeaderOwner(state);
	const room = statusHeaderRoom(state);
	const session = state.session?.title ?? state.status?.activeSessionId ?? "no session";
	const agent = state.session?.agentId ?? state.session?.profile ?? state.status?.activeAgentId ?? "default";
	const model = state.status?.activeModel ? `${state.status.activeModel.provider}/${state.status.activeModel.id}` : "model unknown";
	const mode = state.mode === "transcript" ? "transcript" : state.mode;
	const parts = [`pibo sessions`, source, mode, `owner ${owner}`, room ? `room ${room}` : undefined, `session ${session}`, `agent ${agent}`, `model ${model}`].filter(Boolean);
	const full = parts.join(" · ");
	if (max >= 112 || full.length <= max) return [full];
	return [
		`pibo sessions · ${source} · ${mode}`,
		`owner ${owner}${room ? ` · room ${room}` : ""}`,
		`session ${session}`,
		`agent ${agent} · model ${model}`,
	];
}

function statusHeaderOwner(state: InkSessionAppState): string {
	return state.status?.activeOwnerLabel
		?? state.activeOwner?.label
		?? state.status?.activeOwnerScope
		?? state.session?.ownerScope
		?? "owner unknown";
}

function statusHeaderRoom(state: InkSessionAppState): string | undefined {
	const title = state.activeRoom?.title?.trim();
	if (title) return title;
	return state.status?.activeRoomId ?? state.session?.roomId;
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
