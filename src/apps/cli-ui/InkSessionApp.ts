import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { buildCompactTerminalRows, type CompactTerminalRow } from "../../session-ui/index.js";
import type { CliOpenSession, CliRuntimeStatus, CliSessionSource, CliSessionSummary } from "../../cli-session/index.js";
import { InkTerminalView } from "./InkTerminalView.js";

export type InkSessionAppState = {
	loading: boolean;
	status?: CliRuntimeStatus;
	session?: CliSessionSummary;
	rows: readonly CompactTerminalRow[];
	input: string;
	mode: "transcript" | "picker" | "detail";
	message?: string;
	error?: string;
};

export type InkSessionAppProps = {
	source: CliSessionSource;
	initialSessionId?: string;
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

export function InkSessionApp({ source, initialSessionId, maxRows, maxLineChars, onExit }: InkSessionAppProps): React.ReactElement {
	const app = useApp();
	const [state, setState] = useState<InkSessionAppState>(INITIAL_STATE);

	useEffect(() => {
		let cancelled = false;
		let opened: CliOpenSession | undefined;
		let unsubscribe: (() => void) | undefined;

		const update = (patch: Partial<InkSessionAppState>) => {
			if (!cancelled) setState((current) => ({ ...current, ...patch }));
		};

		void (async () => {
			try {
				const sessions = await source.listSessions();
				const sessionId = initialSessionId ?? sessions[0]?.id;
				if (!sessionId) {
					update({
						loading: false,
						status: await source.getStatus(),
						message: "No sessions found. Use /new after command support is enabled.",
					});
					return;
				}
				opened = await source.openSession(sessionId);
				const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });
				update({ loading: false, status: opened.status, session: opened.session, rows });
				unsubscribe = opened.subscribe((sourceUpdate) => {
					setState((current) => ({
						...current,
						session: sourceUpdate.session ?? current.session,
						status: sourceUpdate.status ?? current.status,
						rows: sourceUpdate.traceView === undefined ? current.rows : buildCompactTerminalRows(sourceUpdate.traceView, { showThinking: false }),
						error: sourceUpdate.error?.message ?? current.error,
					}));
				});
			} catch (error) {
				update({ loading: false, error: error instanceof Error ? error.message : String(error) });
			}
		})();

		return () => {
			cancelled = true;
			unsubscribe?.();
			void opened?.close();
			void source.close();
		};
	}, [source, initialSessionId]);

	useInput((input, key) => {
		if (key.ctrl && input === "c") {
			onExit?.();
			app.exit();
			return;
		}
		if (key.escape) {
			setState((current) => reduceInkSessionInputState(current, { type: "escape" }));
			return;
		}
		if (key.return) {
			setState((current) => reduceInkSessionInputState(current, { type: "enter" }));
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
	const statusText = useMemo(() => formatStatusLine(state), [state]);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		React.createElement(Text, { color: state.status?.connected === false ? "red" : "cyan" }, statusText),
		React.createElement(Text, { color: "gray" }, "Commands: /help /new /session /agent /status /clear /exit /quit"),
		state.loading ? React.createElement(Text, { color: "yellow" }, "Loading CLI session…") : null,
		state.error ? React.createElement(Text, { color: "red" }, boundedLine(`Error: ${state.error}`)) : null,
		state.message ? React.createElement(Text, { color: "gray" }, boundedLine(state.message)) : null,
		React.createElement(InkTerminalView, { rows: state.rows, maxRows, maxLineChars }),
		React.createElement(Text, { color: state.mode === "transcript" ? "green" : "yellow" }, `› ${state.input}`),
	);
}

export type InkSessionInputAction =
	| { type: "text"; value: string }
	| { type: "backspace" }
	| { type: "enter" }
	| { type: "escape" };

export function reduceInkSessionInputState(state: InkSessionAppState, action: InkSessionInputAction): InkSessionAppState {
	if (action.type === "text") return { ...state, input: state.input + action.value, message: undefined };
	if (action.type === "backspace") return { ...state, input: state.input.slice(0, -1) };
	if (action.type === "escape") return { ...state, input: "", mode: "transcript", message: "Canceled." };
	return {
		...state,
		input: "",
		message: state.input.trim().length > 0 ? "Input captured. Message sending is enabled by the next command-flow story." : state.message,
	};
}

function formatStatusLine(state: InkSessionAppState): string {
	const source = state.status?.source ?? "starting";
	const session = state.session?.title ?? state.status?.activeSessionId ?? "no session";
	const agent = state.session?.agentId ?? state.session?.profile ?? state.status?.activeAgentId ?? "default";
	const model = state.status?.activeModel ? `${state.status.activeModel.provider}/${state.status.activeModel.id}` : "model unknown";
	const mode = state.mode === "transcript" ? "transcript" : state.mode;
	return boundedLine(`Pibo CLI Sessions | ${source} | ${session} | ${agent} | ${model} | ${mode}`);
}

function boundedLine(value: string, max = 220): string {
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 12))}… truncated`;
}
