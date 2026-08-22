import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PiboWebSessionNode } from "../../../chat-ui/src/types";
import { buildSlashCommands, availableSkillsForSession } from "../../../chat-ui/src/app-command-catalog";
import { getBootstrap, postAction, postMessage, postSession, patchSession, deleteSession } from "../../../chat-ui/src/api-chat-sessions";
import { commandActionParams, normalizeDownloadCommandPath } from "../../../chat-ui/src/app-command-actions";
import { downloadChatFile } from "../../../chat-ui/src/api-chat-files";
import { createClientTxnId, resolveSessionActiveModelLabel } from "../../../chat-ui/src/app-session-model";
import { listChatSessionViews, getChatSessionView } from "../../../chat-ui/src/session-views/registry";
import { DEFAULT_CHAT_SESSION_VIEW_ID, type ToolDisplayMode } from "../../../chat-ui/src/session-views/types";
import { readStoredToolDisplayMode, writeStoredToolDisplayMode } from "../../../chat-ui/src/app-storage";
import { SessionTracePane } from "../../../chat-ui/src/session-trace-pane";
import { errorMessage } from "../../../chat-ui/src/error-message";
import { SessionSelector, type SessionSelectorMode } from "./SessionSelector";
import type { PiboRoom } from "../../../chat/types/rooms";

type BootstrapData = Awaited<ReturnType<typeof getBootstrap>>;

type HostToWebView =
	| { type: "pibo/set-selector-mode"; mode: SessionSelectorMode }
	| { type: "pibo/refresh-bootstrap" };

type WebViewToHost =
	| { type: "pibo/select-room"; roomId: string }
	| { type: "pibo/open-external"; uri: string }
	| { type: "pibo/refresh-bootstrap-request" };

declare global {
	interface Window {
		__piboAcquireVsCodeApi?: () => {
			postMessage(message: WebViewToHost): void;
			getState(): unknown;
			setState(state: unknown): void;
		};
	}
}

function readWorkspaceFromUrl(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get("workspace");
}

function readRoomIdFromUrl(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get("roomId");
}

export function ChatTerminalApp() {
	const workspace = useMemo(() => readWorkspaceFromUrl(), []);
	const [roomId, setRoomId] = useState<string | null>(() => readRoomIdFromUrl());
	const [selectorMode, setSelectorMode] = useState<SessionSelectorMode>(() =>
		readRoomIdFromUrl()
			? { kind: "sessions", roomId: readRoomIdFromUrl()!, sessions: [], selectedPiboSessionId: null }
			: { kind: "rooms", candidates: [], workspace: workspace ?? "" },
	);
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [showThinking, setShowThinking] = useState(false);
	const [toolDisplayMode, setToolDisplayMode] = useState<ToolDisplayMode>(readStoredToolDisplayMode);

	const sessionNodes = useMemo<readonly PiboWebSessionNode[]>(() => {
		const nodes = (bootstrap as unknown as { sessionNodes?: readonly PiboWebSessionNode[] } | null)?.sessionNodes;
		return Array.isArray(nodes) ? nodes : [];
	}, [bootstrap]);

	// Fetch bootstrap when roomId changes.
	useEffect(() => {
		if (!roomId) return;
		let cancelled = false;
		(async () => {
			try {
				const data = await getBootstrap(undefined, false, roomId);
				if (cancelled) return;
				setBootstrap(data);
				const firstSession = data.sessions.find((s) => !s.archived) ?? data.sessions[0];
				if (firstSession && !selectedPiboSessionId) {
					setSelectedPiboSessionId(firstSession.piboSessionId);
				}
				setSelectorMode({
					kind: "sessions",
					roomId,
					sessions: data.sessions,
					selectedPiboSessionId: firstSession?.piboSessionId ?? null,
				});
			} catch (caught) {
				if (!cancelled) setError(errorMessage(caught));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [roomId]);

	const refreshBootstrap = useCallback(async () => {
		if (!roomId) return;
		try {
			const data = await getBootstrap(selectedPiboSessionId ?? undefined, false, roomId, true);
			setBootstrap(data);
		} catch (caught) {
			setError(errorMessage(caught));
		}
	}, [roomId, selectedPiboSessionId]);

	const refreshTrace = useCallback(async () => {
		await refreshBootstrap();
	}, [refreshBootstrap]);

	// SSE for live event updates.
	useEffect(() => {
		if (!roomId) return;
		const url = `/api/chat/events?${new URLSearchParams({
			roomId,
			mode: "summary",
			since: "0:999999",
		}).toString()}`;
		const source = new EventSource(url);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const scheduleRefresh = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = undefined;
				void refreshBootstrap();
			}, 200);
		};
		source.addEventListener("change", scheduleRefresh);
		source.addEventListener("trace", scheduleRefresh);
		source.addEventListener("message", scheduleRefresh);
		source.onerror = () => {
			// Browser auto-reconnects. No-op.
		};
		return () => {
			if (timer) clearTimeout(timer);
			source.close();
		};
	}, [roomId, refreshBootstrap]);

	// Listen for postMessage from the extension host.
	useEffect(() => {
		const handler = (event: MessageEvent<HostToWebView>) => {
			const data = event.data;
			if (!data || typeof data !== "object") return;
			if (data.type === "pibo/set-selector-mode") {
				setSelectorMode(data.mode);
				if (data.mode.kind === "sessions") {
					setRoomId(data.mode.roomId);
				}
			} else if (data.type === "pibo/refresh-bootstrap") {
				void refreshBootstrap();
			}
		};
		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, [refreshBootstrap]);

	const slashCommands = useMemo(
		() => (bootstrap ? buildSlashCommands(bootstrap.capabilities.actions) : []),
		[bootstrap],
	);
	const skills = useMemo(
		() => availableSkillsForSession(bootstrap, selectedPiboSessionId),
		[bootstrap, selectedPiboSessionId],
	);

	const sessionsForSelector = useMemo<readonly PiboWebSessionNode[]>(() => {
		if (selectorMode.kind === "sessions") return selectorMode.sessions;
		return sessionNodes;
	}, [selectorMode, sessionNodes]);

	const onSelectSession = useCallback((id: string) => {
		setSelectedPiboSessionId(id);
		setComposerFocusSignal((s) => s + 1);
	}, []);

	const onNewSession = useCallback(async (profile: string) => {
		if (!roomId) return;
		try {
			const created = await postSession(profile, roomId);
			await refreshBootstrap();
			if (created.session?.id) setSelectedPiboSessionId(created.session.id);
		} catch (caught) {
			setError(errorMessage(caught));
		}
	}, [roomId, refreshBootstrap]);

	const onDeleteSession = useCallback(async (id: string) => {
		try {
			await deleteSession(id, "delete");
			await refreshBootstrap();
			if (selectedPiboSessionId === id) setSelectedPiboSessionId(null);
		} catch (caught) {
			setError(errorMessage(caught));
		}
	}, [refreshBootstrap, selectedPiboSessionId]);

	const onRenameSession = useCallback(async (id: string, title: string) => {
		try {
			await patchSession(id, { title });
			await refreshBootstrap();
		} catch (caught) {
			setError(errorMessage(caught));
		}
	}, [refreshBootstrap]);

	const onSelectRoom = useCallback((newRoomId: string) => {
		setRoomId(newRoomId);
		setSelectedPiboSessionId(null);
		setBootstrap(null);
		setSelectorMode({ kind: "sessions", roomId: newRoomId, sessions: [], selectedPiboSessionId: null });
		const params = new URLSearchParams(window.location.search);
		params.set("roomId", newRoomId);
		window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
	}, []);

	const onSend = useCallback(async (text: string) => {
		if (!selectedPiboSessionId || !roomId) return;
		try {
			await postMessage(selectedPiboSessionId, text, createClientTxnId(), roomId);
			setComposerText("");
			setComposerFocusSignal((s) => s + 1);
			await refreshBootstrap();
		} catch (caught) {
			setError(errorMessage(caught));
		}
	}, [selectedPiboSessionId, roomId, refreshBootstrap]);

	const runCommand = useCallback(async (text: string): Promise<boolean> => {
		if (!selectedPiboSessionId) return false;
		const trimmed = text.trim();
		if (!trimmed) return false;
		const commandText = trimmed.split(/\s+/)[0];
		const command = slashCommands.find((candidate) => candidate.slash === commandText);
		if (!command) {
			setError(`Unknown command: ${commandText}`);
			return false;
		}
		if (command.action === "thinking-show") {
			setShowThinking((v) => !v);
			return true;
		}
		if (command.action === "download") {
			const path = normalizeDownloadCommandPath(trimmed.slice(commandText.length));
			if (!path) {
				setError("Usage: /download <path>");
				return true;
			}
			try {
				await downloadChatFile(path, { piboSessionId: selectedPiboSessionId, roomId: roomId ?? undefined });
			} catch (caught) {
				setError(errorMessage(caught));
			}
			return true;
		}
		try {
			const params = commandActionParams(command.action, trimmed.slice(commandText.length).trim());
			await postAction(selectedPiboSessionId, command.action, params);
			await refreshBootstrap();
		} catch (caught) {
			setError(errorMessage(caught));
		}
		return true;
	}, [slashCommands, selectedPiboSessionId, roomId, refreshBootstrap]);

	const sessionViews = useMemo(() => listChatSessionViews(), []);
	const currentSessionView = useMemo(() => getChatSessionView(DEFAULT_CHAT_SESSION_VIEW_ID), []);

	if (!bootstrap) {
		return (
			<div className="pibo-vscode-panel h-full flex flex-col bg-[#0c1820] text-slate-200">
				<SessionSelector
					mode={selectorMode}
					onSelectSession={onSelectSession}
					onNewSession={onNewSession}
					onDeleteSession={onDeleteSession}
					onRenameSession={onRenameSession}
					onSelectRoom={onSelectRoom}
				/>
				<div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
					{error ? `Error: ${error}` : roomId ? "Loading Pibo…" : "Waiting for room…"}
				</div>
			</div>
		);
	}

	if (selectorMode.kind === "rooms") {
		const candidates: readonly PiboRoom[] = (bootstrap as unknown as { rooms?: readonly PiboRoom[] }).rooms ?? selectorMode.candidates;
		return (
			<div className="pibo-vscode-panel h-full flex flex-col bg-[#0c1820] text-slate-200">
				<SessionSelector
					mode={{ kind: "rooms", candidates, workspace: selectorMode.workspace }}
					onSelectSession={onSelectSession}
					onNewSession={onNewSession}
					onDeleteSession={onDeleteSession}
					onRenameSession={onRenameSession}
					onSelectRoom={onSelectRoom}
				/>
				<div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
					Multiple rooms found — pick one above to continue.
				</div>
			</div>
		);
	}

	const selectedSessionNode = bootstrap.sessions.find((s) => s.piboSessionId === selectedPiboSessionId);

	return (
		<div className="pibo-vscode-panel h-full flex flex-col bg-[#0c1820] text-slate-200">
			<SessionSelector
				mode={{
					kind: "sessions",
					roomId: roomId ?? "",
					sessions: sessionsForSelector,
					selectedPiboSessionId,
				}}
				onSelectSession={onSelectSession}
				onNewSession={onNewSession}
				onDeleteSession={onDeleteSession}
				onRenameSession={onRenameSession}
				onSelectRoom={onSelectRoom}
			/>
			{error && (
				<div className="bg-rose-900/40 border-b border-rose-700 text-rose-200 text-xs px-3 py-1.5" role="alert">
					{error}
					<button type="button" className="ml-3 underline" onClick={() => setError(null)}>dismiss</button>
				</div>
			)}
			<div className="flex-1 min-h-0">
				<SessionTracePane
					bootstrap={bootstrap}
					selectedPiboSessionId={selectedPiboSessionId}
					selectedRoomId={roomId}
					selectedRoomArchived={false}
					selectedSessionProfile={selectedSessionNode?.profile ?? "default"}
					selectedSessionActiveModel={
						selectedSessionNode
							? resolveSessionActiveModelLabel(bootstrap, selectedSessionNode) ?? undefined
							: undefined
					}
					selectedSessionStatus={selectedSessionNode?.status}
					sessionViewId={DEFAULT_CHAT_SESSION_VIEW_ID}
					sessionViews={sessionViews}
					currentSessionView={currentSessionView}
					allowedSessionViewIds={["terminal"]}
					creatingSession={false}
					showRawEvents={false}
					showThinking={showThinking}
					expandThinking={false}
					toolDisplayMode={toolDisplayMode}
					commands={slashCommands}
					skills={skills}
					composerText={composerText}
					composerFocusSignal={composerFocusSignal}
					onComposerTextChange={setComposerText}
					onToggleRawEvents={() => undefined}
					onToggleThinking={() => setShowThinking((v) => !v)}
					onToggleExpandThinking={() => undefined}
					onToolDisplayModeChange={(mode) => {
						setToolDisplayMode(mode);
						writeStoredToolDisplayMode(mode);
					}}
					onSessionAgentProfileChange={() => undefined}
					onFork={() => undefined}
					onOpenSession={(id) => setSelectedPiboSessionId(id)}
					onSelectSessionView={() => undefined}
					onCommand={runCommand}
					onThinkingLevelChange={(level) => void runCommand(`/thinking ${level}`)}
					onRefreshTrace={refreshTrace}
					onRefreshBootstrap={refreshBootstrap}
					onSend={onSend}
					onError={setError}
				/>
			</div>
		</div>
	);
}
