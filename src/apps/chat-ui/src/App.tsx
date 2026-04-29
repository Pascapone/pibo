import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Archive,
	ArchiveRestore,
	Bug,
	Check,
	Edit3,
	LogOut,
	MessageSquarePlus,
	RefreshCw,
	Settings,
	UserRound,
	X,
} from "lucide-react";
import { getBootstrap, getTrace, patchSession, postAction, postMessage, postSession, signInWithGoogle, signOut } from "./api";
import type { BootstrapData, PiboSessionTraceView, PiboWebSessionNode } from "./types";
import { adaptTrace } from "./tracing/adapt";
import { TraceTimeline } from "./tracing/TraceTimeline";
import { JsonRenderer } from "./tracing/JsonRenderer";

type Area = "sessions" | "agents" | "settings";

type ForkActionResponse = {
	result: {
		piboSessionId?: string;
		cancelled?: boolean;
		selectedText?: string;
	};
};

export function App() {
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [traceView, setTraceView] = useState<PiboSessionTraceView | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
	const [area, setArea] = useState<Area>("sessions");
	const [error, setError] = useState<string | null>(null);
	const [showThinking, setShowThinking] = useState(() => localStorage.getItem("pibo.chat.showThinking") === "true");
	const [showRawEvents, setShowRawEvents] = useState(() => localStorage.getItem("pibo.chat.showRawEvents") === "true");
	const [showArchived, setShowArchived] = useState(() => localStorage.getItem("pibo.chat.showArchived") === "true");
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [creatingSession, setCreatingSession] = useState(false);
	const showArchivedRef = useRef(showArchived);
	const bootstrapRequestId = useRef(0);
	const traceRequestId = useRef(0);

	useEffect(() => {
		showArchivedRef.current = showArchived;
	}, [showArchived]);

	const loadBootstrap = useCallback(async (piboSessionId?: string, includeArchived = showArchivedRef.current) => {
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const data = await getBootstrap(piboSessionId, includeArchived);
		if (requestId !== bootstrapRequestId.current) return data;
		setBootstrap(data);
		setSelectedPiboSessionId(data.selectedPiboSessionId);
		return data;
	}, []);

	const loadTrace = useCallback(async (piboSessionId: string) => {
		const requestId = traceRequestId.current + 1;
		traceRequestId.current = requestId;
		const trace = await getTrace(piboSessionId);
		if (requestId !== traceRequestId.current) return;
		setTraceView(trace);
	}, []);

	useEffect(() => {
		loadBootstrap().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
	}, [loadBootstrap]);

	useEffect(() => {
		if (!selectedPiboSessionId || area !== "sessions") return;
		loadTrace(selectedPiboSessionId).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
		const events = new EventSource(`/api/chat/events?piboSessionId=${encodeURIComponent(selectedPiboSessionId)}`);
		let refreshTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		let refreshInFlight = false;
		let refreshPending = false;
		const runRefresh = () => {
			if (refreshInFlight) {
				refreshPending = true;
				return;
			}
			refreshInFlight = true;
			loadTrace(selectedPiboSessionId)
				.catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
				.finally(() => {
					refreshInFlight = false;
					if (refreshPending) {
						refreshPending = false;
						scheduleRefresh(0);
					}
				});
		};
		const scheduleRefresh = (delayMs: number) => {
			if (refreshTimer) return;
			refreshTimer = setTimeout(() => {
				refreshTimer = undefined;
				runRefresh();
			}, delayMs);
		};
		const scheduleBootstrapRefresh = (delayMs: number) => {
			if (bootstrapTimer) return;
			bootstrapTimer = setTimeout(() => {
				bootstrapTimer = undefined;
				loadBootstrap(selectedPiboSessionId).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
			}, delayMs);
		};
		events.addEventListener("pibo", (message) => {
			const type = eventType(message);
			const immediate = type === "assistant_message" || type === "message_finished" || type === "session_error";
			scheduleRefresh(immediate ? 0 : 80);
			if (type && type !== "assistant_delta" && type !== "thinking_delta") {
				scheduleBootstrapRefresh(immediate ? 0 : 150);
			}
		});
		return () => {
			if (refreshTimer) clearTimeout(refreshTimer);
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			events.close();
		};
	}, [area, loadBootstrap, loadTrace, selectedPiboSessionId]);

	const selectedTrace = useMemo(() => {
		if (!traceView) return null;
		return adaptTrace(traceView.piboSessionId, traceView.title, traceView.nodes);
	}, [traceView]);

	useEffect(() => {
		if (!selectedPiboSessionId || area !== "sessions" || selectedTrace?.status !== "UNSET") return;
		const timer = setInterval(() => {
			loadTrace(selectedPiboSessionId).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
			loadBootstrap(selectedPiboSessionId).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
		}, 1000);
		return () => clearInterval(timer);
	}, [area, loadBootstrap, loadTrace, selectedPiboSessionId, selectedTrace?.status]);

	const rawEvents = useMemo(() => compactRawEvents(traceView?.rawEvents ?? []), [traceView?.rawEvents]);

	const slashCommands = useMemo(() => {
		const actions = bootstrap?.capabilities.actions ?? [];
		const commands = actions.flatMap((action) =>
			action.slashCommands
				.filter((command) => command !== "tree")
				.map((command) => ({ slash: `/${command}`, action: action.name, description: action.description ?? action.name })),
		);
		commands.push({
			slash: "/thinking-show",
			action: "thinking-show",
			description: "Toggle historical thinking display in this browser.",
		});
		return commands;
	}, [bootstrap]);

	const selectSession = async (piboSessionId: string) => {
		setSelectedPiboSessionId(piboSessionId);
		const data = await loadBootstrap(piboSessionId);
		if (area === "sessions") await loadTrace(data.selectedPiboSessionId);
	};

	const createSession = async () => {
		if (creatingSession) return;
		setCreatingSession(true);
		try {
			const created = await postSession();
			setArea("sessions");
			const data = await loadBootstrap(created.session.id);
			await loadTrace(data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setCreatingSession(false);
		}
	};

	const toggleArchivedSessions = async () => {
		const next = !showArchived;
		setShowArchived(next);
		localStorage.setItem("pibo.chat.showArchived", String(next));
		try {
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, next);
			if (area === "sessions") await loadTrace(data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const renameSession = async (piboSessionId: string, title: string | null) => {
		try {
			await patchSession(piboSessionId, { title });
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined);
			if (area === "sessions") await loadTrace(data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const setSessionArchived = async (piboSessionId: string, archived: boolean) => {
		try {
			await patchSession(piboSessionId, { archived });
			const keepSelected = !(archived && !showArchived && selectedPiboSessionId === piboSessionId);
			const data = await loadBootstrap(keepSelected ? (selectedPiboSessionId ?? undefined) : undefined);
			if (area === "sessions") await loadTrace(data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const runCommand = async (text: string) => {
		if (!selectedPiboSessionId) return false;
		const commandText = text.trim().split(/\s+/)[0];
		const command = slashCommands.find((candidate) => candidate.slash === commandText);
		if (!command) return false;
		if (command.action === "thinking-show") {
			const next = !showThinking;
			setShowThinking(next);
			localStorage.setItem("pibo.chat.showThinking", String(next));
			return true;
		}
		const level = text.match(/^\/thinking\s+(\S+)/)?.[1];
		const result = await postAction(selectedPiboSessionId, command.action, level ? { level } : undefined);
		const derivedPiboSessionId = getResultPiboSessionId(result);
		if ((command.action === "session.clone" || command.action === "session.fork") && derivedPiboSessionId) {
			await selectSession(derivedPiboSessionId);
		} else {
			await loadBootstrap(selectedPiboSessionId);
			await loadTrace(selectedPiboSessionId);
		}
		return true;
	};

	const forkFrom = async (entryId: string) => {
		if (!selectedPiboSessionId) return;
		const result = parseForkActionResponse(await postAction(selectedPiboSessionId, "session.fork", { entryId }));
		if (result?.result.cancelled) return;
		if (!result) throw new Error("Unexpected fork action response");
		if (typeof result.result.selectedText === "string") {
			setComposerText(result.result.selectedText);
			setComposerFocusSignal((current) => current + 1);
		}
		if (result.result.piboSessionId) {
			await selectSession(result.result.piboSessionId);
		}
	};

	if (error && !bootstrap) {
		return <SignedOut message={error} />;
	}

	if (!bootstrap) {
		return <div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">Loading Pibo Chat...</div>;
	}

	return (
		<div className="h-screen overflow-hidden bg-[#101d22] text-slate-200 grid grid-rows-[56px_1fr]">
			<header className="flex items-center justify-between gap-3 px-4 bg-[#1a262b] border-b border-slate-800">
				<div className="font-extrabold tracking-[0.08em] uppercase text-lg">Pibo Chat</div>
				<nav className="flex gap-1">
					{(["sessions", "agents", "settings"] as const).map((item) => (
						<button
							key={item}
							type="button"
							onClick={() => setArea(item)}
							className={`h-8 px-3 border rounded-sm text-xs uppercase tracking-wider ${
								area === item ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-700 text-slate-400"
							}`}
						>
							{item}
						</button>
					))}
				</nav>
				<div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
					<UserRound size={14} />
					<span className="truncate">{bootstrap.identity.email || bootstrap.identity.name || bootstrap.identity.userId}</span>
					<button type="button" onClick={() => void signOut().then(() => location.reload())} className="p-1 border border-slate-700 rounded-sm">
						<LogOut size={14} />
					</button>
				</div>
			</header>

			<div
				className={`min-h-0 grid ${
					showRawEvents
						? "grid-cols-[300px_minmax(0,1fr)_320px] max-[980px]:grid-cols-[240px_minmax(0,1fr)]"
						: "grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-[240px_minmax(0,1fr)]"
				}`}
			>
				<aside className="min-h-0 overflow-auto bg-[#1a262b] border-r border-slate-800">
					<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
						<span>{area}</span>
						<div className="flex items-center gap-1">
							{area === "sessions" ? (
								<button
									type="button"
									onClick={() => void createSession()}
									disabled={creatingSession}
									title="New Session"
									aria-label="New Session"
									className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
								>
									<MessageSquarePlus size={13} />
								</button>
							) : null}
							{area === "sessions" ? (
								<button
									type="button"
									onClick={() => void toggleArchivedSessions()}
									title={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
									aria-label={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
									className={`p-1 border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${
										showArchived ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
									}`}
								>
									{showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
								</button>
							) : null}
							<button
								type="button"
								onClick={() => void loadBootstrap(selectedPiboSessionId ?? undefined)}
								title="Refresh"
								aria-label="Refresh"
								className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							>
								<RefreshCw size={13} />
							</button>
						</div>
					</div>
					{area === "sessions" ? (
						<div className="p-2">
							{bootstrap.sessions.map((session) => (
								<SessionNode
									key={session.piboSessionId}
									node={session}
									selectedPiboSessionId={selectedPiboSessionId}
									onSelect={(piboSessionId) => void selectSession(piboSessionId)}
									onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
									onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
								/>
							))}
						</div>
					) : area === "agents" ? (
						<div className="p-3 text-sm text-slate-400">Profile inventory. V1 speichert keine Agent Templates.</div>
					) : (
						<div className="p-3 text-sm text-slate-400">Browser-local settings.</div>
					)}
				</aside>

				<main className="min-h-0 flex flex-col">
					{area === "sessions" ? (
						<>
							<div className="h-14 px-4 bg-[#151f24] border-b border-slate-800 flex items-center justify-between">
								<div className="min-w-0">
									<h1 className="text-base font-semibold truncate">{traceView?.title ?? selectedPiboSessionId}</h1>
									<div className="font-mono text-[11px] text-slate-500 truncate">
										{traceView?.piboSessionId} {traceView ? `· ${traceView.piSessionId}` : ""}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => {
											const next = !showRawEvents;
											setShowRawEvents(next);
											localStorage.setItem("pibo.chat.showRawEvents", String(next));
										}}
										title={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
										aria-label={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
										className={`h-8 w-8 inline-flex items-center justify-center border rounded-sm ${
											showRawEvents ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
										}`}
									>
										<Bug size={14} />
									</button>
									<button
										type="button"
										onClick={() => {
											const next = !showThinking;
											setShowThinking(next);
											localStorage.setItem("pibo.chat.showThinking", String(next));
										}}
										className="px-3 py-1.5 text-xs border border-slate-700 rounded-sm"
									>
										{showThinking ? "Thinking On" : "Thinking Off"}
									</button>
								</div>
							</div>
							<TraceTimeline
								trace={selectedTrace}
								showThinking={showThinking}
								onFork={forkFrom}
								onOpenSession={(piboSessionId) => void selectSession(piboSessionId)}
							/>
							<Composer
								commands={slashCommands}
								value={composerText}
								focusSignal={composerFocusSignal}
								onValueChange={setComposerText}
								onCommand={runCommand}
								onSend={async (text) => {
									if (!selectedPiboSessionId) return;
									await postMessage(selectedPiboSessionId, text);
									await loadBootstrap(selectedPiboSessionId);
									await loadTrace(selectedPiboSessionId);
								}}
							/>
						</>
					) : area === "agents" ? (
						<AgentsView agents={bootstrap.agents} />
					) : (
						<SettingsView showThinking={showThinking} setShowThinking={setShowThinking} />
					)}
				</main>

				{showRawEvents ? (
					<aside className="min-h-0 overflow-auto bg-[#0e1116] border-l border-slate-800 max-[980px]:hidden">
						<div className="h-11 px-3 border-b border-slate-800 flex items-center text-xs font-bold uppercase tracking-wider">Raw Events</div>
						<div className="p-3 flex flex-col gap-2">
							{rawEvents.slice(-80).reverse().map((event) => (
								<div key={event.id} className="border-l-2 border-[#11a4d4] bg-[#151f24] p-2">
									<div className="flex items-center justify-between gap-2 text-[#11a4d4] font-mono text-[11px] mb-1">
										<span>{event.type}</span>
										{event.count > 1 ? <span className="text-slate-500">x{event.count}</span> : null}
									</div>
									<JsonRenderer value={event.payload} showControls={false} />
								</div>
							))}
						</div>
					</aside>
				) : null}
			</div>

		</div>
	);
}

function SignedOut({ message }: { message: string }) {
	return (
		<div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">
			<div className="border border-slate-700 bg-[#1a262b] p-5 rounded-sm">
				<div className="mb-4 text-sm text-slate-400">{message}</div>
				<button type="button" onClick={() => void signInWithGoogle()} className="px-3 py-2 bg-[#11a4d4] rounded-sm">
					Sign in with Google
				</button>
			</div>
		</div>
	);
}

function SessionNode({
	node,
	selectedPiboSessionId,
	onSelect,
	onRename,
	onArchive,
	depth = 0,
}: {
	node: PiboWebSessionNode;
	selectedPiboSessionId: string | null;
	onSelect: (piboSessionId: string) => void;
	onRename: (piboSessionId: string, title: string | null) => void;
	onArchive: (piboSessionId: string, archived: boolean) => void;
	depth?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(node.title);

	useEffect(() => {
		if (!editing) setDraftTitle(node.title);
	}, [editing, node.title]);

	const submitRename = () => {
		const title = draftTitle.trim();
		onRename(node.piboSessionId, title ? title : null);
		setEditing(false);
	};

	return (
		<div>
			<div
				className={`group w-full grid grid-cols-[1fr_auto] gap-1 items-center mb-1 border rounded-sm ${
					node.piboSessionId === selectedPiboSessionId ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
				}`}
				style={{ paddingLeft: 8 + depth * 14 }}
				title={node.piboSessionId}
			>
				{editing ? (
					<form
						className="min-w-0 grid grid-cols-[1fr_auto_auto] gap-1 py-1 pr-1"
						onSubmit={(event) => {
							event.preventDefault();
							submitRename();
						}}
					>
						<input
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setEditing(false);
									setDraftTitle(node.title);
								}
							}}
							autoFocus
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4]"
						/>
						<button
							type="submit"
							title="Save Session Title"
							aria-label="Save Session Title"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<Check size={13} />
						</button>
						<button
							type="button"
							onClick={() => {
								setEditing(false);
								setDraftTitle(node.title);
							}}
							title="Cancel Rename"
							aria-label="Cancel Rename"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<X size={13} />
						</button>
					</form>
				) : (
					<button
						type="button"
						onClick={() => onSelect(node.piboSessionId)}
						className="min-w-0 grid grid-cols-[16px_1fr_auto] gap-2 items-center text-left px-2 py-2"
					>
						<span className="text-slate-500">{node.children.length ? "▾" : ""}</span>
						<span className="min-w-0">
							<span className={`block text-sm truncate ${node.archived ? "text-slate-500" : "text-slate-200"}`}>{node.title}</span>
							<span className="block text-[10px] font-mono truncate text-slate-500">{node.piboSessionId}</span>
						</span>
						<span className={`h-2 w-2 rounded-full ${node.status === "running" ? "bg-[#0bda57]" : node.status === "error" ? "bg-red-500" : "bg-slate-600"}`} />
					</button>
				)}
				{editing ? null : (
					<div className="flex items-center gap-1 pr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
						<button
							type="button"
							onClick={() => setEditing(true)}
							title="Rename Session"
							aria-label="Rename Session"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<Edit3 size={13} />
						</button>
						<button
							type="button"
							onClick={() => onArchive(node.piboSessionId, !node.archived)}
							title={node.archived ? "Restore Session" : "Archive Session"}
							aria-label={node.archived ? "Restore Session" : "Archive Session"}
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							{node.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
						</button>
					</div>
				)}
			</div>
			{node.children.map((child) => (
				<SessionNode
					key={child.piboSessionId}
					node={child}
					selectedPiboSessionId={selectedPiboSessionId}
					onSelect={onSelect}
					onRename={onRename}
					onArchive={onArchive}
					depth={depth + 1}
				/>
			))}
		</div>
	);
}

function Composer({
	commands,
	value,
	focusSignal,
	onValueChange,
	onCommand,
	onSend,
}: {
	commands: Array<{ slash: string; action: string; description: string }>;
	value: string;
	focusSignal: number;
	onValueChange: (value: string) => void;
	onCommand: (text: string) => Promise<boolean>;
	onSend: (text: string) => Promise<void>;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const filtered = value.trim().startsWith("/")
		? commands.filter((command) => command.slash.startsWith(value.trim().split(/\s+/)[0]))
		: [];

	useEffect(() => {
		if (focusSignal <= 0) return;
		inputRef.current?.focus();
		inputRef.current?.setSelectionRange(value.length, value.length);
	}, [focusSignal, value]);

	const submit = async () => {
		const text = value.trim();
		if (!text) return;
		if (filtered.length && !commands.some((command) => command.slash === text.split(/\s+/)[0])) {
			onValueChange(filtered[Math.min(activeIndex, filtered.length - 1)].slash);
			return;
		}
		onValueChange("");
		if (text.startsWith("/") && (await onCommand(text))) return;
		await onSend(text);
	};

	return (
		<div className="relative p-3 bg-[#151f24] border-t border-slate-800">
			{filtered.length ? (
				<div className="absolute left-3 bottom-20 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-[#11a4d4] rounded-sm shadow-xl">
					{filtered.map((command, index) => (
						<button
							key={command.slash}
							type="button"
							onClick={() => {
								onValueChange(command.slash);
								setActiveIndex(index);
							}}
							className={`w-full grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-left border-b border-slate-800 ${index === activeIndex ? "bg-[#11a4d4]/15" : ""}`}
						>
							<span className="font-mono text-[#11a4d4]">{command.slash}</span>
							<span className="text-xs text-slate-400">{command.description}</span>
						</button>
					))}
				</div>
			) : null}
			<div className="grid grid-cols-[1fr_auto] gap-2">
				<textarea
					ref={inputRef}
					value={value}
					onChange={(event) => onValueChange(event.target.value)}
					onKeyDown={(event) => {
						if (filtered.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filtered.length : (current - 1 + filtered.length) % filtered.length,
							);
							return;
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
						}
					}}
					placeholder="Message selected session or type /"
					className="min-h-12 max-h-40 resize-y bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4]"
				/>
				<button type="button" onClick={() => void submit()} className="px-4 bg-[#11a4d4] rounded-sm">
					Send
				</button>
			</div>
		</div>
	);
}

function AgentsView({ agents }: { agents: BootstrapData["agents"] }) {
	return (
		<div className="p-6 overflow-auto">
			<h1 className="text-sm font-bold uppercase tracking-wider mb-4">Agents</h1>
			<div className="grid gap-3">
				{agents.map((agent) => (
					<div key={agent.name} className="border border-slate-700 bg-[#1a262b] rounded-sm p-4">
						<div className="font-semibold">{agent.name}</div>
						<div className="text-sm text-slate-400 mt-1">{agent.description || "No description"}</div>
					</div>
				))}
			</div>
		</div>
	);
}

function SettingsView({ showThinking, setShowThinking }: { showThinking: boolean; setShowThinking: (value: boolean) => void }) {
	return (
		<div className="p-6 overflow-auto">
			<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
				<Settings size={16} />
				Settings
			</h1>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={showThinking}
					onChange={(event) => {
						setShowThinking(event.target.checked);
						localStorage.setItem("pibo.chat.showThinking", String(event.target.checked));
					}}
				/>
				Show thinking blocks
			</label>
		</div>
	);
}

type RawEvent = PiboSessionTraceView["rawEvents"][number];
type CompactRawEvent = RawEvent & { count: number };

function eventType(message: MessageEvent): string | undefined {
	try {
		const parsed = JSON.parse(message.data) as { type?: unknown };
		return typeof parsed.type === "string" ? parsed.type : undefined;
	} catch {
		return undefined;
	}
}

function compactRawEvents(events: RawEvent[]): CompactRawEvent[] {
	const compacted: CompactRawEvent[] = [];
	for (const event of events) {
		const previous = compacted[compacted.length - 1];
		if (previous && canMergeRawDelta(previous, event)) {
			previous.count += 1;
			previous.createdAt = event.createdAt;
			previous.payload = {
				...(isRecord(previous.payload) ? previous.payload : {}),
				text: `${textFromPayload(previous.payload)}${textFromPayload(event.payload)}`,
			};
			continue;
		}
		compacted.push({ ...event, count: 1 });
	}
	return compacted;
}

function canMergeRawDelta(left: RawEvent, right: RawEvent): boolean {
	if (left.type !== right.type) return false;
	if (left.type !== "assistant_delta" && left.type !== "thinking_delta") return false;
	const leftPayload = isRecord(left.payload) ? left.payload : {};
	const rightPayload = isRecord(right.payload) ? right.payload : {};
	return leftPayload.piboSessionId === rightPayload.piboSessionId && leftPayload.eventId === rightPayload.eventId;
}

function textFromPayload(payload: unknown): string {
	if (!isRecord(payload)) return "";
	return typeof payload.text === "string" ? payload.text : "";
}

function parseForkActionResponse(value: unknown): ForkActionResponse | null {
	if (!isRecord(value) || !isRecord(value.result)) return null;
	return value as ForkActionResponse;
}

function getResultPiboSessionId(value: unknown): string | undefined {
	if (!isRecord(value) || !isRecord(value.result)) return undefined;
	return typeof value.result.piboSessionId === "string" ? value.result.piboSessionId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
