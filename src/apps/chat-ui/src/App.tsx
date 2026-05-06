import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	Archive,
	ArchiveRestore,
	AlertTriangle,
	BookOpenText,
	Brain,
	Bug,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronsDown,
	ChevronsUp,
	CopyPlus,
	Edit3,
	EyeOff,
	ExternalLink,
	FolderPlus,
	Key,
	Layers,
	Lock,
	LogOut,
	Menu,
	MessageSquarePlus,
	Plus,
	Power,
	PowerOff,
	RefreshCw,
	Save,
	Server,
	Settings,
	SendHorizontal,
	Trash2,
	UserRound,
	User,
	Wrench,
	X,
} from "lucide-react";
import { createUserSkill, deleteCustomAgent, deletePiPackage, deleteRoom, deleteSession, deleteUserSkill, getBootstrap, getTrace, getUserSkill, installUserSkill, listUserSkills, patchCustomAgent, patchModelDefaults, patchPiPackage, patchRoom, patchSession, postAction, postContextFile, postCustomAgent, postMessage, postPiPackage, postRoom, postSession, signInWithGoogle, signOut, updateUserSkill, type SaveCustomAgentInput } from "./api";
import { THINKING_LEVELS } from "./types";
import type { AgentCatalog, BootstrapData, CustomAgent, CustomAgentSubagent, ModelCatalog, ModelDefaults, ModelProfile, PiboRoom, PiboSession, PiboSessionTraceView, PiboTraceNode, PiboTraceOrderKey, PiboWebSessionNode, ThinkingLevel, UserSkill } from "./types";
import type { ChatWebStoredEvent } from "../../../shared/trace-types.js";
import { adaptTrace } from "./tracing/adapt";
import { collectBackendNodes } from "./tracing/snapshotCollector";
import { type SessionBreadcrumbItem, type SessionDerivationLink, type SessionOriginLink } from "./tracing/TraceTimeline";
import { JsonRenderer } from "./tracing/JsonRenderer";
import { countRender } from "./renderMetrics";
import { parseTraceStreamFrameId } from "../../../shared/trace-order.js";
import { patchTraceViewWithEvent } from "../../../shared/trace-engine.js";
import { applyTraceLiveEvents } from "./traceLiveReducer";
import { ContextFilesView } from "./context/ContextFilesView";
import { BasePromptView } from "./context/BasePromptView";
import { CompactionPromptView } from "./context/CompactionPromptView";
import { PiboToolsView } from "./context/PiboToolsView";
import { McpToolsView } from "./context/McpToolsView";
import { getChatSessionView, listChatSessionViews } from "./session-views/registry";
import { DEFAULT_CHAT_SESSION_VIEW_ID, type ChatSessionViewId } from "./session-views/types";
import {
	BOOTSTRAP_GC_TIME_MS,
	BOOTSTRAP_STALE_TIME_MS,
	DEFAULT_RAW_EVENTS_LIMIT,
	TRACE_GC_TIME_MS,
	chatBootstrapQueryKey,
	chatTraceQueryKey,
	isTraceView,
	setChatNavigationCache,
	traceQueriesForSession,
} from "./cache";

type Area = "sessions" | "agents" | "context" | "settings";
type ContextPanel = "context-files" | "base-prompt" | "compaction-prompt" | "pibo-tools" | "mcp-tools";
type SettingsPanel = "general" | "pi-packages" | "skills" | "providers";

export type ChatAppRoute =
	| { area: "sessions"; roomId?: string; piboSessionId?: string; sessionViewId?: ChatSessionViewId }
	| { area: "agents" }
	| { area: "context" }
	| { area: "settings"; panel?: SettingsPanel };

type ForkActionResponse = {
	result: {
		piboSessionId?: string;
		cancelled?: boolean;
		selectedText?: string;
	};
};

type SlashCommand = {
	slash: string;
	action: string;
	description: string;
};

type LoadBootstrapOptions = {
	selectSession?: boolean;
	force?: boolean;
};

type NavigationOptions = {
	closeMobileSidebar?: boolean;
};

const LAST_SELECTION_STORAGE_KEY = "pibo.chat.lastSelection";
const SESSION_VIEW_STORAGE_KEY = "pibo.chat.sessionView";
const COMPOSER_DRAFT_STORAGE_PREFIX = "pibo.chat.composerDraft.";
const COMPOSER_HISTORY_STORAGE_KEY = "pibo.chat.composerHistory";
const COMPOSER_HISTORY_LIMIT = 100;
const SESSION_DELETE_CONFIRM_TEXT = "Delete this session";
const RECENT_SESSION_ACTIVITY_SIGNAL_MS = 3_000;

type StoredSelection = {
	roomId?: string;
	piboSessionId?: string;
	sessionsByRoom?: Record<string, string>;
};

async function loadBootstrapQueryData(
	queryClient: QueryClient,
	input: {
		piboSessionId?: string;
		includeArchived?: boolean;
		roomId?: string;
		markRead?: boolean;
		force?: boolean;
	},
): Promise<BootstrapData> {
	const queryKey = chatBootstrapQueryKey(input.piboSessionId, input.includeArchived, input.roomId);
	if (input.markRead) {
		const data = await getBootstrap(input.piboSessionId, input.includeArchived, input.roomId, true);
		queryClient.setQueryData(queryKey, data);
		setChatNavigationCache(queryClient.setQueryData.bind(queryClient), data, input.includeArchived, input.roomId);
		return data;
	}
	if (input.force) {
		await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
	}
	const data = await queryClient.fetchQuery({
		queryKey,
		queryFn: () => getBootstrap(input.piboSessionId, input.includeArchived, input.roomId, false),
		staleTime: BOOTSTRAP_STALE_TIME_MS,
		gcTime: BOOTSTRAP_GC_TIME_MS,
	});
	setChatNavigationCache(queryClient.setQueryData.bind(queryClient), data, input.includeArchived, input.roomId);
	return data;
}

async function loadTraceQueryData(
	queryClient: QueryClient,
	piboSessionId: string,
	options: { includeRawEvents?: boolean; rawEventsLimit?: number } = {},
): Promise<PiboSessionTraceView> {
	const queryKey = chatTraceQueryKey(piboSessionId, options);
	const cached = queryClient.getQueryData<PiboSessionTraceView>(queryKey);
	const response = await getTrace(piboSessionId, {
		includeRawEvents: options.includeRawEvents,
		rawEventsLimit: options.rawEventsLimit,
		knownVersion: cached?.version,
	});
	if (response.notModified && cached) return cached;
	if (!response.trace) throw new Error("Trace response missing payload.");
	return response.trace;
}

export function App({ route }: { route: ChatAppRoute }) {
	countRender("App");
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const area = route.area;
	const routeRoomId = route.area === "sessions" ? route.roomId : undefined;
	const routePiboSessionId = route.area === "sessions" ? route.piboSessionId : undefined;
	const routeSessionViewId = route.area === "sessions" ? route.sessionViewId : undefined;
	const settingsPanel: SettingsPanel = route.area === "settings" ? route.panel ?? "general" : "general";
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
	const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showThinking, setShowThinking] = useState(() => localStorage.getItem("pibo.chat.showThinking") !== "false");
	const [expandThinking, setExpandThinking] = useState(() => localStorage.getItem("pibo.chat.expandThinking") !== "false");
	const [showRawEvents, setShowRawEvents] = useState(() => localStorage.getItem("pibo.chat.showRawEvents") === "true");
	const [showArchived, setShowArchived] = useState(() => localStorage.getItem("pibo.chat.showArchived") === "true");
	const [showArchivedRooms, setShowArchivedRooms] = useState(() => localStorage.getItem("pibo.chat.showArchivedRooms") === "true");
	const [newSessionProfile, setNewSessionProfile] = useState(() => localStorage.getItem("pibo.chat.newSessionProfile") ?? "");
	const [sessionViewId, setSessionViewId] = useState<ChatSessionViewId>(() => routeSessionViewId ?? readStoredSessionView());
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [creatingSession, setCreatingSession] = useState(false);
	const [contextPanel, setContextPanel] = useState<ContextPanel>("context-files");
	const [selectedContextFileKey, setSelectedContextFileKey] = useState<string | null>(null);
	const [selectedMcpServerName, setSelectedMcpServerName] = useState<string | null>(null);
	const [creatingRoom, setCreatingRoom] = useState(false);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [deleteRoomTarget, setDeleteRoomTarget] = useState<PiboRoom | null>(null);
	const [deleteRoomConfirmName, setDeleteRoomConfirmName] = useState("");
	const [deletingRoom, setDeletingRoom] = useState(false);
	const [deleteSessionTarget, setDeleteSessionTarget] = useState<PiboWebSessionNode | null>(null);
	const [gatewayMode, setGatewayMode] = useState<"main" | "fallback" | null>(null);
	const [signalNow, setSignalNow] = useState(() => Date.now());
	const [deleteSessionConfirmText, setDeleteSessionConfirmText] = useState("");
	const [deletingSession, setDeletingSession] = useState(false);
	const showArchivedRef = useRef(showArchived);
	const bootstrapRequestId = useRef(0);
	const activeRoomId = selectedRoomId ?? bootstrap?.selectedRoomId ?? null;
	const selectedRoom = activeRoomId && bootstrap ? findRoomById(bootstrap.rooms, activeRoomId) ?? bootstrap.room : undefined;
	const selectedRoomArchived = selectedRoom ? isArchivedRoom(selectedRoom) : false;

	useEffect(() => {
		showArchivedRef.current = showArchived;
	}, [showArchived]);

	useEffect(() => {
		setSignalNow(Date.now());
	}, [bootstrap]);

	useEffect(() => {
		const nextExpiryMs = bootstrap ? nextRecentSessionSignalExpiryMs(bootstrap.sessions, signalNow) : undefined;
		if (nextExpiryMs === undefined) return;
		const timer = setTimeout(() => setSignalNow(Date.now()), Math.max(50, nextExpiryMs));
		return () => clearTimeout(timer);
	}, [bootstrap, signalNow]);

	useEffect(() => {
		const check = async () => {
			try {
				const res = await fetch("/health", { signal: AbortSignal.timeout(3000) });
				if (res.ok) {
					const data = await res.json();
					setGatewayMode(data.mode === "fallback" ? "fallback" : "main");
				} else {
					setGatewayMode(null);
				}
			} catch {
				setGatewayMode(null);
			}
		};
		void check();
		const id = setInterval(check, 5000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		if (area !== "sessions") return;
		const next = routeSessionViewId ?? readStoredSessionView();
		setSessionViewId((current) => (current === next ? current : next));
	}, [area, routeSessionViewId]);

	useEffect(() => {
		writeStoredSessionView(sessionViewId);
	}, [sessionViewId]);
	const navigateToRoute = useCallback(
		(target: ChatAppRoute, replace = false, nextSessionViewId = sessionViewId, options: NavigationOptions = {}) => {
			if (options.closeMobileSidebar !== false) setMobileSidebarOpen(false);
			const sessionViewSearch = { view: nextSessionViewId };
			if (target.area === "agents") {
				void navigate({ to: "/agents", replace });
				return;
			}
			if (target.area === "context") {
				void navigate({ to: "/context", replace });
				return;
			}
			if (target.area === "settings") {
				if (target.panel === "pi-packages") {
					void navigate({ to: "/settings/pi-packages", replace });
				} else if (target.panel === "skills") {
					void navigate({ to: "/settings/skills", replace });
				} else if (target.panel === "providers") {
					void navigate({ to: "/settings/providers", replace });
				} else {
					void navigate({ to: "/settings", replace });
				}
				return;
			}
			if (target.roomId && target.piboSessionId) {
				void navigate({
					to: "/rooms/$roomId/sessions/$piboSessionId",
					params: { roomId: target.roomId, piboSessionId: target.piboSessionId },
					search: sessionViewSearch,
					replace,
				});
				return;
			}
			if (target.roomId) {
				void navigate({ to: "/rooms/$roomId", params: { roomId: target.roomId }, search: sessionViewSearch, replace });
				return;
			}
			if (target.piboSessionId) {
				void navigate({
					to: "/sessions/$piboSessionId",
					params: { piboSessionId: target.piboSessionId },
					search: sessionViewSearch,
					replace,
				});
				return;
			}
			void navigate({ to: "/", search: sessionViewSearch, replace });
		},
		[navigate, sessionViewId],
	);

	const navigateToSelectedSession = useCallback(
		(roomId: string | undefined, piboSessionId: string | undefined, replace = false, options: NavigationOptions = {}) => {
			if (!piboSessionId) {
				navigateToRoute({ area: "sessions", ...(roomId ? { roomId } : {}) }, replace, sessionViewId, options);
				return;
			}
			navigateToRoute({ area: "sessions", ...(roomId ? { roomId } : {}), piboSessionId }, replace, sessionViewId, options);
		},
		[navigateToRoute, sessionViewId],
	);

	const openContextFileEditor = useCallback((key: string) => {
		setSelectedContextFileKey(key);
		setContextPanel("context-files");
		navigateToRoute({ area: "context" });
	}, [navigateToRoute]);

	const openMcpToolsEditor = useCallback((name: string) => {
		setSelectedMcpServerName(name);
		setContextPanel("mcp-tools");
		navigateToRoute({ area: "context" });
	}, [navigateToRoute]);

	const updateMcpServerInBootstrap = useCallback((server: AgentCatalog["mcpServers"][number]) => {
		setBootstrap((current) => current ? {
			...current,
			agentCatalog: current.agentCatalog ? {
				...current.agentCatalog,
				mcpServers: current.agentCatalog.mcpServers.map((candidate) => candidate.name === server.name ? server : candidate),
			} : current.agentCatalog,
		} : current);
	}, []);

	const upsertPiPackageInBootstrap = useCallback((pkg: PiPackageCatalogItem) => {
		const applyPackage = (current: BootstrapData | null | undefined) => {
			if (!current?.agentCatalog) return current;
			const others = current.agentCatalog.piPackages.filter((candidate) => candidate.id !== pkg.id);
			return {
				...current,
				agentCatalog: {
					...current.agentCatalog,
					piPackages: [...others, pkg].sort((left, right) => left.name.localeCompare(right.name)),
				},
			};
		};
		setBootstrap((current) => applyPackage(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applyPackage(current) ?? undefined);
	}, [queryClient]);

	const removePiPackageFromBootstrap = useCallback((pkg: PiPackageCatalogItem) => {
		const applyRemoval = (current: BootstrapData | null | undefined) => current?.agentCatalog ? {
			...current,
			agentCatalog: {
				...current.agentCatalog,
				piPackages: current.agentCatalog.piPackages.filter((candidate) => candidate.id !== pkg.id),
			},
		} : current;
		setBootstrap((current) => applyRemoval(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applyRemoval(current) ?? undefined);
	}, [queryClient]);

	const upsertUserSkillInBootstrap = useCallback((skill: UserSkill) => {
		const applySkill = (current: BootstrapData | null | undefined) => {
			if (!current?.agentCatalog) return current;
			const others = current.agentCatalog.userSkills.filter((candidate) => candidate.id !== skill.id);
			return {
				...current,
				agentCatalog: {
					...current.agentCatalog,
					userSkills: [...others, skill].sort((left, right) => left.name.localeCompare(right.name)),
				},
			};
		};
		setBootstrap((current) => applySkill(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applySkill(current) ?? undefined);
	}, [queryClient]);

	const removeUserSkillFromBootstrap = useCallback((skillId: string) => {
		const applyRemoval = (current: BootstrapData | null | undefined) => current?.agentCatalog ? {
			...current,
			agentCatalog: {
				...current.agentCatalog,
				userSkills: current.agentCatalog.userSkills.filter((candidate) => candidate.id !== skillId),
			},
		} : current;
		setBootstrap((current) => applyRemoval(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applyRemoval(current) ?? undefined);
	}, [queryClient]);

	const loadBootstrap = useCallback(async (
		piboSessionId?: string,
		includeArchived = showArchivedRef.current,
		roomId?: string,
		options: LoadBootstrapOptions = {},
	) => {
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const data = await loadBootstrapQueryData(queryClient, {
			piboSessionId,
			includeArchived,
			roomId,
			markRead: options.selectSession !== false,
			force: options.force,
		});
		if (requestId !== bootstrapRequestId.current) return data;
		setBootstrap(data);
		if (options.selectSession !== false) setSelectedPiboSessionId(data.selectedPiboSessionId);
		setSelectedRoomId(data.selectedRoomId);
		return data;
	}, [queryClient]);

	useEffect(() => {
		const stored = readStoredSelection();
		const storedPiboSessionId = routeRoomId ? stored.sessionsByRoom?.[routeRoomId] : stored.piboSessionId;
		const requestedRoomId = route.area === "sessions" ? (routeRoomId ?? (!routePiboSessionId ? stored.roomId : undefined)) : stored.roomId;
		const requestedPiboSessionId = route.area === "sessions"
			? (routePiboSessionId ?? (!routePiboSessionId ? storedPiboSessionId : undefined))
			: stored.piboSessionId;

		const canonicalizeSessionsRoute = (data: BootstrapData, replace = true) => {
			if (route.area !== "sessions") return;
			if (!data.selectedPiboSessionId) return;
			if (route.roomId === data.selectedRoomId && route.piboSessionId === data.selectedPiboSessionId) return;
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, replace);
		};

		loadBootstrap(requestedPiboSessionId, showArchivedRef.current, requestedRoomId)
			.then((data) => {
				canonicalizeSessionsRoute(data);
				setError(null);
			})
			.catch((caught) => {
				if (route.area === "sessions" && routeRoomId && !routePiboSessionId && requestedPiboSessionId) {
					removeStoredRoomSelection(routeRoomId);
					loadBootstrap(undefined, showArchivedRef.current, routeRoomId)
						.then((data) => {
							canonicalizeSessionsRoute(data);
							setError(null);
						})
						.catch((fallbackCaught) =>
							setError(fallbackCaught instanceof Error ? fallbackCaught.message : String(fallbackCaught)),
						);
					return;
				}
				const explicitRouteSelection = route.area === "sessions" && Boolean(routeRoomId || routePiboSessionId);
				if (explicitRouteSelection || (!requestedPiboSessionId && !requestedRoomId)) {
					setError(caught instanceof Error ? caught.message : String(caught));
					return;
				}
				clearStoredSelection();
				loadBootstrap()
					.then((data) => {
						canonicalizeSessionsRoute(data);
						setError(null);
					})
					.catch((fallbackCaught) =>
						setError(fallbackCaught instanceof Error ? fallbackCaught.message : String(fallbackCaught)),
					);
			});
	}, [loadBootstrap, navigateToSelectedSession, route.area, routePiboSessionId, routeRoomId]);

	useEffect(() => {
		if (!selectedRoomId && !selectedPiboSessionId) return;
		writeStoredSelection({
			roomId: selectedRoomId ?? undefined,
			piboSessionId: selectedPiboSessionId ?? undefined,
		});
	}, [selectedPiboSessionId, selectedRoomId]);

	useEffect(() => {
		setComposerText(selectedPiboSessionId ? readStoredComposerDraft(selectedPiboSessionId) : "");
	}, [selectedPiboSessionId]);

	const updateComposerText: Dispatch<SetStateAction<string>> = useCallback((next) => {
		setComposerText((current) => {
			const resolved = typeof next === "function" ? next(current) : next;
			if (selectedPiboSessionId) writeStoredComposerDraft(selectedPiboSessionId, resolved);
			return resolved;
		});
	}, [selectedPiboSessionId]);

	const sessionViews = useMemo(() => listChatSessionViews(), []);
	const currentSessionView = useMemo(() => getChatSessionView(sessionViewId), [sessionViewId]);

	useEffect(() => {
		if (!bootstrap?.agents.length) return;
		const preferredProfile = newSessionProfile || bootstrap.session.profile;
		const matchedProfile = findAgentProfile(bootstrap.agents, preferredProfile);
		if (matchedProfile) {
			if (newSessionProfile !== matchedProfile.name) {
				setNewSessionProfile(matchedProfile.name);
				localStorage.setItem("pibo.chat.newSessionProfile", matchedProfile.name);
			}
			return;
		}
		const fallbackProfile = findAgentProfile(bootstrap.agents, bootstrap.session.profile)?.name ?? bootstrap.agents[0].name;
		setNewSessionProfile(fallbackProfile);
		localStorage.setItem("pibo.chat.newSessionProfile", fallbackProfile);
	}, [bootstrap, newSessionProfile]);

	const setPreferredNewSessionProfile = useCallback((profile: string) => {
		setNewSessionProfile(profile);
		localStorage.setItem("pibo.chat.newSessionProfile", profile);
	}, []);

	const refreshTrace = useCallback(async (piboSessionId: string) => {
		await queryClient.invalidateQueries({ queryKey: ["chat", "trace", piboSessionId], refetchType: "none" });
		await queryClient.refetchQueries({ queryKey: ["chat", "trace", piboSessionId], type: "active" });
	}, [queryClient]);
	const refreshSelectedTrace = useCallback(
		() => selectedPiboSessionId ? refreshTrace(selectedPiboSessionId) : Promise.resolve(),
		[refreshTrace, selectedPiboSessionId],
	);
	const refreshSelectedBootstrap = useCallback(
		() => loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true }),
		[loadBootstrap, selectedPiboSessionId, selectedRoomId],
	);

	const updateBootstrapCache = useCallback((updater: (data: BootstrapData) => BootstrapData) => {
		setBootstrap((current) => current ? updater(current) : current);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => current ? updater(current) : current);
	}, [queryClient]);

	const restoreBootstrapSnapshot = useCallback((snapshot: BootstrapMutationSnapshot | undefined) => {
		if (!snapshot) return;
		setBootstrap(snapshot.localBootstrap);
		for (const [queryKey, data] of snapshot.queryData) queryClient.setQueryData(queryKey, data);
	}, [queryClient]);

	const createSessionMutation = useMutation({
		mutationFn: ({ profile, roomId }: { profile: string; roomId?: string }) => postSession(profile || undefined, roomId),
		onMutate: async ({ profile }) => {
			await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			const tempId = `optimistic-session-${createClientTxnId()}`;
			setBootstrap((current) => current ? addSessionNodeToBootstrap(current, createOptimisticSessionNode(tempId, profile || current.session.profile)) : current);
			return { snapshot, tempId };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: (created, _variables, context) => {
			setBootstrap((current) => current ? replaceOptimisticSessionNode(current, context?.tempId, sessionNodeFromSession(created.session)) : current);
		},
	});

	const renameSessionMutation = useMutation({
		mutationFn: ({ piboSessionId, title }: { piboSessionId: string; title: string | null }) => patchSession(piboSessionId, { title }),
		onMutate: async ({ piboSessionId, title }) => {
			await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, piboSessionId, (node) => ({ ...node, title: title || "Untitled Session" })));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: ({ session }) => updateBootstrapCache((data) => updateSessionFromPiboSession(data, session)),
	});

	const archiveSessionMutation = useMutation({
		mutationFn: ({ piboSessionId, archived }: { piboSessionId: string; archived: boolean }) => patchSession(piboSessionId, { archived }),
		onMutate: async ({ piboSessionId, archived }) => {
			await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, piboSessionId, (node) => ({ ...node, archived, unreadCount: archived ? 0 : node.unreadCount })));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: ({ session }) => updateBootstrapCache((data) => updateSessionFromPiboSession(data, session)),
	});

	const sendMessageMutation = useMutation({
		mutationFn: ({ piboSessionId, text, clientTxnId, roomId }: { piboSessionId: string; text: string; clientTxnId: string; roomId?: string }) =>
			postMessage(piboSessionId, text, clientTxnId, roomId),
		onMutate: async ({ piboSessionId, text, clientTxnId }) => {
			await queryClient.cancelQueries({ queryKey: traceQueriesForSession(piboSessionId) });
			const queryData = queryClient.getQueriesData<PiboSessionTraceView>({ queryKey: traceQueriesForSession(piboSessionId) });
			queryClient.setQueriesData<PiboSessionTraceView>({ queryKey: traceQueriesForSession(piboSessionId) }, (current) =>
				current ? appendOptimisticUserMessageToTrace(current, piboSessionId, text, clientTxnId) : current,
			);
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, piboSessionId, (node) => ({ ...node, status: "running", lastActivityAt: new Date().toISOString() })));
			return { queryData };
		},
		onError: (_error, variables, context) => {
			for (const [queryKey, data] of context?.queryData ?? []) queryClient.setQueryData(queryKey, data);
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, variables.piboSessionId, (node) => ({ ...node, status: "error" })));
		},
	});

	const updateSelectedSessionProfile = useCallback(async (profile: string) => {
		if (!selectedPiboSessionId || !bootstrap || profile === bootstrap.session.profile) return;
		try {
			await patchSession(selectedPiboSessionId, { profile });
			setPreferredNewSessionProfile(profile);
			const data = await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			await refreshTrace(selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [area, bootstrap, loadBootstrap, navigateToSelectedSession, refreshTrace, selectedPiboSessionId, selectedRoomId, setPreferredNewSessionProfile]);

	const slashCommands = useMemo<SlashCommand[]>(() => {
		const actions = bootstrap?.capabilities.actions ?? [];
		const commands = actions.flatMap((action): SlashCommand[] =>
			action.slashCommands
				.filter((command) => command !== "tree")
				.map((command): SlashCommand => ({
					slash: `/${command}`,
					action: action.name,
					description: action.name === "thinking" && command === "thinking"
						? "Show thinking level or use /thinking <level>."
						: action.description ?? action.name,
				})),
		);
		commands.push({
			slash: "/thinking-show",
			action: "thinking-show",
			description: "Toggle historical thinking display in this browser.",
		});
		return commands;
	}, [bootstrap]);

	const skills = useMemo(() => {
		if (!bootstrap) return [];
		const catalogSkills = bootstrap.agentCatalog?.skills ?? [];
		const userSkills = bootstrap.agentCatalog?.userSkills ?? [];
		const allSkills = [...catalogSkills, ...userSkills];

		const selectedSessionProfile = selectedPiboSessionId
			? findSessionNode(bootstrap.sessions, selectedPiboSessionId)?.profile ?? bootstrap.session.profile
			: bootstrap.session.profile;

		const agentSkills = [
			...bootstrap.agents.map((agent) => ({ name: agent.name, skills: agent.skills })),
			...bootstrap.customAgents.map((agent) => ({ name: agent.profileName, skills: agent.skills })),
		];
		const currentAgent = agentSkills.find((agent) => agent.name === selectedSessionProfile);
		const allowedSkillNames = new Set(currentAgent?.skills ?? []);

		return allSkills.filter((skill) => allowedSkillNames.has(skill.name));
	}, [bootstrap, selectedPiboSessionId]);

	const selectSession = useCallback(async (piboSessionId: string) => {
		setSelectedPiboSessionId(piboSessionId);
		setMobileSidebarOpen(false);
		const data = await loadBootstrap(piboSessionId);
		navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
	}, [loadBootstrap, navigateToSelectedSession]);

	const selectRoom = useCallback(async (roomId: string) => {
		setMobileSidebarOpen(false);
		const storedPiboSessionId = readStoredSelection().sessionsByRoom?.[roomId];
		setSelectedRoomId(roomId);
		setSelectedPiboSessionId(storedPiboSessionId ?? null);
		try {
			const data = await loadBootstrap(storedPiboSessionId, showArchivedRef.current, roomId);
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
		} catch (caught) {
			if (!storedPiboSessionId) throw caught;
			removeStoredRoomSelection(roomId);
			setSelectedPiboSessionId(null);
			const data = await loadBootstrap(undefined, showArchivedRef.current, roomId);
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
		}
	}, [loadBootstrap, navigateToSelectedSession]);

	const createSession = async (profile = newSessionProfile) => {
		if (creatingSession || selectedRoomArchived) return;
		setCreatingSession(true);
		try {
			const created = await createSessionMutation.mutateAsync({ profile, roomId: selectedRoomId ?? undefined });
			setSelectedPiboSessionId(created.session.id);
			const data = await loadBootstrap(created.session.id, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
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
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, next, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const renameSession = async (piboSessionId: string, title: string | null) => {
		try {
			await renameSessionMutation.mutateAsync({ piboSessionId, title });
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
			if (area === "sessions") await refreshTrace(data.selectedPiboSessionId);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const setSessionArchived = async (piboSessionId: string, archived: boolean) => {
		try {
			await archiveSessionMutation.mutateAsync({ piboSessionId, archived });
			const keepSelected = !(archived && !showArchived && selectedPiboSessionId === piboSessionId);
			const data = await loadBootstrap(
				keepSelected ? (selectedPiboSessionId ?? undefined) : undefined,
				showArchivedRef.current,
				selectedRoomId ?? undefined,
				{ force: true },
			);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const requestSessionDelete = (node: PiboWebSessionNode) => {
		setDeleteSessionTarget(node);
		setDeleteSessionConfirmText("");
	};

	const permanentlyDeleteSession = async () => {
		if (!deleteSessionTarget) return;
		setDeletingSession(true);
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const optimisticDeletedIds = sessionSubtreeIds(deleteSessionTarget);
		const optimisticDeletedSelected = selectedPiboSessionId ? optimisticDeletedIds.has(selectedPiboSessionId) : false;
		if (optimisticDeletedSelected) setSelectedPiboSessionId(null);
		updateBootstrapCache((data) => removeSessionsFromBootstrap(data, optimisticDeletedIds));
		try {
			const deleted = await deleteSession(deleteSessionTarget.piboSessionId, deleteSessionConfirmText);
			const deletedSelected = selectedPiboSessionId ? deleted.deletedSessionIds.includes(selectedPiboSessionId) : optimisticDeletedSelected;
			if (deletedSelected) {
				setSelectedPiboSessionId(null);
			}
			const data = await loadBootstrap(
				deletedSelected ? undefined : (selectedPiboSessionId ?? undefined),
				showArchivedRef.current,
				selectedRoomId ?? undefined,
				{ force: true },
			);
			if (area === "sessions") {
				navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			}
			setDeleteSessionTarget(null);
			setDeleteSessionConfirmText("");
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			if (optimisticDeletedSelected) setSelectedPiboSessionId(selectedPiboSessionId);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingSession(false);
		}
	};

	const createRoom = async () => {
		if (creatingRoom) return;
		setCreatingRoom(true);
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const tempId = `optimistic-room-${createClientTxnId()}`;
		const optimisticRoom = createOptimisticRoom(tempId, bootstrap?.identity.userId ?? "user", "New Chat");
		setSelectedRoomId(tempId);
		setSelectedPiboSessionId(null);
		updateBootstrapCache((data) => addRoomToBootstrap(data, optimisticRoom));
		try {
			const created = await postRoom({ name: "New Chat" });
			updateBootstrapCache((data) => replaceRoomInBootstrap(data, tempId, created.room));
			await selectRoom(created.room.id);
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			setSelectedRoomId(selectedRoomId);
			setSelectedPiboSessionId(selectedPiboSessionId);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setCreatingRoom(false);
		}
	};

	const updateRoom = async (roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null }) => {
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, (room) => ({
			...room,
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.topic !== undefined ? { topic: input.topic ?? undefined } : {}),
			...(input.workspace !== undefined ? { workspace: input.workspace ?? undefined } : {}),
			updatedAt: new Date().toISOString(),
		})));
		try {
			const { room } = await patchRoom(roomId, input);
			updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, () => room));
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, roomId, { force: true });
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const setRoomArchived = async (roomId: string, archived: boolean) => {
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		if (archived) {
			setShowArchivedRooms(true);
			localStorage.setItem("pibo.chat.showArchivedRooms", "true");
		}
		updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, (room) => roomWithArchivedState(room, archived)));
		try {
			const { room } = await patchRoom(roomId, { archived });
			updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, () => room));
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const requestRoomDelete = (room: PiboRoom) => {
		setDeleteRoomTarget(room);
		setDeleteRoomConfirmName("");
	};

	const permanentlyDeleteRoom = async () => {
		if (!deleteRoomTarget) return;
		setDeletingRoom(true);
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const optimisticDeletedRoomIds = roomSubtreeIds(deleteRoomTarget);
		const optimisticDeletedSelected = selectedRoomId ? optimisticDeletedRoomIds.has(selectedRoomId) : false;
		if (optimisticDeletedSelected) {
			setSelectedRoomId(null);
			setSelectedPiboSessionId(null);
		}
		updateBootstrapCache((data) => removeRoomsFromBootstrap(data, optimisticDeletedRoomIds));
		try {
			await deleteRoom(deleteRoomTarget.id, deleteRoomConfirmName);
			if (selectedRoomId === deleteRoomTarget.id) {
				setSelectedRoomId(null);
				setSelectedPiboSessionId(null);
			}
			const data = await loadBootstrap(undefined, showArchivedRef.current, undefined, { force: true });
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setDeleteRoomTarget(null);
			setDeleteRoomConfirmName("");
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			if (optimisticDeletedSelected) {
				setSelectedRoomId(selectedRoomId);
				setSelectedPiboSessionId(selectedPiboSessionId);
			}
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingRoom(false);
		}
	};

	const runCommand = useCallback(async (text: string) => {
		if (!selectedPiboSessionId || selectedRoomArchived) return false;
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
			const data = await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			await refreshTrace(selectedPiboSessionId);
		}
		return true;
	}, [area, loadBootstrap, navigateToSelectedSession, refreshTrace, selectSession, selectedPiboSessionId, selectedRoomArchived, selectedRoomId, showThinking, slashCommands]);

	const forkFrom = useCallback(async (entryId: string) => {
		if (!selectedPiboSessionId || selectedRoomArchived) return;
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
	}, [selectSession, selectedPiboSessionId, selectedRoomArchived]);

	const openSession = useCallback((piboSessionId: string) => void selectSession(piboSessionId), [selectSession]);
	const selectSessionView = useCallback(
		(nextViewId: ChatSessionViewId) => {
			setSessionViewId(nextViewId);
			if (area !== "sessions") return;
			navigateToRoute(
				{
					area: "sessions",
					...(selectedRoomId ? { roomId: selectedRoomId } : {}),
					...(selectedPiboSessionId ? { piboSessionId: selectedPiboSessionId } : {}),
				},
				false,
				nextViewId,
			);
		},
		[area, navigateToRoute, selectedPiboSessionId, selectedRoomId],
	);

	if (error && !bootstrap) {
		return <SignedOut message={error} />;
	}

	if (!bootstrap) {
		return <div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">Loading Pibo Chat...</div>;
	}
	const roomsSupported = Boolean(bootstrap.selectedRoomId || bootstrap.room || bootstrap.rooms.length);
	const sessionGroups = splitSessionNodesByArchive(bootstrap.sessions);
	const newSessionProfileOptions = bootstrap.agents;
	const selectedSessionNode = selectedPiboSessionId ? findSessionNode(bootstrap.sessions, selectedPiboSessionId) : undefined;
	const selectedSessionActiveModel = resolveSessionActiveModelLabel(bootstrap, selectedSessionNode ?? {
		profile: bootstrap.session.profile,
		parentId: bootstrap.session.parentId,
	});
	const personalRoom = findPersonalRoom(bootstrap.rooms);
	const roomGroups = splitRoomNodes(bootstrap.rooms);
	const totalRoomUnreadCount = countUnreadRooms(bootstrap.rooms);
	const contextAgentProfiles = [...new Set([...bootstrap.agents.map((agent) => agent.name), ...bootstrap.customAgents.map((agent) => agent.profileName)])];

	return (
		<>
			{gatewayMode === "fallback" && (
				<div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center text-sm font-bold py-1.5 px-4 flex items-center justify-center gap-2 shadow-lg">
					<AlertTriangle size={16} />
					Recovery Mode: Main gateway is down. You are connected to a fallback instance.
				</div>
			)}
			<div className="h-dvh overflow-hidden bg-[#101d22] text-slate-200 grid grid-rows-[auto_1fr]">
				<header className="flex items-center justify-between gap-3 px-4 bg-[#1a262b] border-b border-slate-800 min-h-14 max-[980px]:flex-wrap max-[980px]:py-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setMobileSidebarOpen(true)}
							className="min-[981px]:hidden p-1.5 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							title="Open sidebar"
							aria-label="Open sidebar"
						>
							<Menu size={16} />
						</button>
						<img src="/apps/chat/assets/logo.png" alt="Logo" className="h-5 w-auto" />
						<div className="font-extrabold tracking-[0.08em] uppercase text-lg">Pibo Chat</div>
					</div>
					<nav className="flex gap-1 flex-wrap">
					{(["sessions", "agents", "context", "settings"] as const).map((item) => (
						<button
							key={item}
							type="button"
							onClick={() => {
								if (item === "sessions") {
									navigateToSelectedSession(selectedRoomId ?? bootstrap.selectedRoomId, selectedPiboSessionId ?? bootstrap.selectedPiboSessionId);
									return;
								}
								navigateToRoute({ area: item });
							}}
							className={`h-8 px-3 border rounded-sm text-xs uppercase tracking-wider max-[980px]:h-7 max-[980px]:px-2 ${
								area === item ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-700 text-slate-400"
							}`}
						>
							<span className="inline-flex items-center gap-1.5">
								<span>{item}</span>
								{item === "sessions" ? <MobileUnreadBadge count={totalRoomUnreadCount} /> : null}
							</span>
						</button>
					))}
				</nav>
				<div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
					<UserRound size={14} />
					<span className="truncate max-[600px]:hidden">{bootstrap.identity.email || bootstrap.identity.name || bootstrap.identity.userId}</span>
					<button type="button" onClick={() => void signOut().then(() => location.reload())} className="p-1 border border-slate-700 rounded-sm">
						<LogOut size={14} />
					</button>
				</div>
			</header>

			<div
				className={`min-h-0 ${
					area === "agents" ? "h-full overflow-hidden" : `grid ${
						area === "sessions" && showRawEvents
						? "grid-cols-[300px_minmax(0,1fr)_320px] max-[980px]:grid-cols-1"
						: "grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-1"
					}`
				}`}
			>
				{area === "agents" ? (
					<AgentsView
						agents={bootstrap.agents}
						initialCustomAgents={bootstrap.customAgents}
						initialCatalog={bootstrap.agentCatalog}
						modelCatalog={bootstrap.modelCatalog}
						onSelect={setPreferredNewSessionProfile}
						onCreateSession={(profile) => void createSession(profile)}
						onEditContextFile={openContextFileEditor}
						onEditMcpServer={openMcpToolsEditor}
						onAgentsChanged={() => void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { selectSession: false })}
						creatingSession={creatingSession || selectedRoomArchived}
					/>
				) : (
				<>
				{/* Mobile sidebar backdrop */}
				<div
					className={`fixed inset-0 z-30 bg-black/60 min-[981px]:hidden transition-opacity duration-200 ${
						mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
					}`}
					onClick={() => setMobileSidebarOpen(false)}
				/>
				<aside
					className={`min-h-0 overflow-auto bg-[#1a262b] border-r border-slate-800 max-[980px]:fixed max-[980px]:left-0 max-[980px]:top-0 max-[980px]:bottom-0 max-[980px]:z-40 max-[980px]:w-[280px] max-[980px]:transition-transform max-[980px]:duration-200 ${
						mobileSidebarOpen ? "max-[980px]:translate-x-0" : "max-[980px]:-translate-x-full"
					}`}
				>
					<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider max-[980px]:h-auto max-[980px]:py-2 max-[980px]:flex-wrap">
						<span>{area}</span>
						<div className="flex items-center gap-1">
							{area === "sessions" ? (
								<button
									type="button"
									onClick={() =>
										void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true }).then((data) => {
											if (selectedPiboSessionId) void refreshTrace(selectedPiboSessionId);
											if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
										})
									}
									title="Refresh"
									aria-label="Refresh"
									className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
								>
									<RefreshCw size={13} />
								</button>
							) : null}
							<button
								type="button"
								onClick={() => setMobileSidebarOpen(false)}
								className="min-[981px]:hidden p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
								title="Close sidebar"
								aria-label="Close sidebar"
							>
								<X size={13} />
							</button>
						</div>
					</div>
					{area === "sessions" ? (
						<div className="p-2 space-y-3">
								{roomsSupported ? (
									<div>
										{personalRoom ? (
											<div className="mb-3">
												<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Personal Chat</div>
												<RoomNode
													room={personalRoom}
													selectedRoomId={selectedRoomId}
													onSelect={(roomId) => void selectRoom(roomId)}
													onUpdate={(roomId, input) => void updateRoom(roomId, input)}
													onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
													onDelete={requestRoomDelete}
												/>
											</div>
										) : null}
										<div className="flex items-center justify-between gap-2 px-1 pb-1">
											<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rooms</div>
											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => void createRoom()}
													disabled={creatingRoom}
													title="New Room"
													aria-label="New Room"
													className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
												>
													<Plus size={12} />
												</button>
												<button
													type="button"
													onClick={() => {
														const next = !showArchivedRooms;
														setShowArchivedRooms(next);
														localStorage.setItem("pibo.chat.showArchivedRooms", String(next));
													}}
													title={showArchivedRooms ? "Hide Archived Rooms" : "Show Archived Rooms"}
													aria-label={showArchivedRooms ? "Hide Archived Rooms" : "Show Archived Rooms"}
													className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedRooms ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
												>
													{showArchivedRooms ? <ArchiveRestore size={12} /> : <Archive size={12} />}
												</button>
											</div>
										</div>
										{roomGroups.active.map((room) => (
											<RoomNode
												key={room.id}
												room={room}
												selectedRoomId={selectedRoomId}
												onSelect={(roomId) => void selectRoom(roomId)}
												onUpdate={(roomId, input) => void updateRoom(roomId, input)}
												onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
												onDelete={requestRoomDelete}
											/>
										))}
										{roomGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No rooms</div> : null}
										{showArchivedRooms ? (
											<div className="mt-3">
												<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Rooms</div>
												{roomGroups.archived.map((room) => (
													<RoomNode
														key={room.id}
														room={room}
														selectedRoomId={selectedRoomId}
														onSelect={(roomId) => void selectRoom(roomId)}
														onUpdate={(roomId, input) => void updateRoom(roomId, input)}
														onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
														onDelete={requestRoomDelete}
													/>
												))}
												{roomGroups.archived.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived rooms</div> : null}
											</div>
										) : null}
									</div>
								) : null}
							<div>
								<div className="flex items-center justify-between gap-2 px-1 pb-1">
									<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sessions</div>
									<div className="flex items-center gap-1">
										<select
											value={newSessionProfile}
											onChange={(event) => setPreferredNewSessionProfile(event.target.value)}
											disabled={!newSessionProfileOptions.length || selectedRoomArchived}
											title="Agent for new sessions"
											aria-label="Agent for new sessions"
											className="h-6 w-28 rounded-sm border border-slate-700 bg-[#101d22] px-1.5 text-[11px] font-medium normal-case tracking-normal text-slate-300 outline-none hover:border-[#11a4d4] focus:border-[#11a4d4] disabled:opacity-50"
										>
											{newSessionProfileOptions.map((profile) => (
												<option key={profile.name} value={profile.name} title={profile.description ?? profile.name}>
													{profile.name}
												</option>
											))}
										</select>
										<button
											type="button"
											onClick={() => void createSession()}
											disabled={creatingSession || selectedRoomArchived}
											title="New Session"
											aria-label="New Session"
											className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
										>
											<Plus size={12} />
										</button>
										<button
											type="button"
											onClick={() => void toggleArchivedSessions()}
											title={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
											aria-label={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
											className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${
												showArchived ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
											}`}
										>
											{showArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
										</button>
									</div>
								</div>
								{sessionGroups.active.map((session) => (
									<SessionNode
										key={session.piboSessionId}
										node={session}
										signalNow={signalNow}
										selectedPiboSessionId={selectedPiboSessionId}
										onSelect={(piboSessionId) => void selectSession(piboSessionId)}
										onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
										onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
										onDelete={requestSessionDelete}
									/>
								))}
								{sessionGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No active sessions</div> : null}
							</div>
							{showArchived ? (
								<div>
									<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Sessions</div>
									{sessionGroups.archived.map((session) => (
										<SessionNode
											key={session.piboSessionId}
											node={session}
											signalNow={signalNow}
											selectedPiboSessionId={selectedPiboSessionId}
											onSelect={(piboSessionId) => void selectSession(piboSessionId)}
											onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
											onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
											onDelete={requestSessionDelete}
										/>
									))}
									{sessionGroups.archived.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived sessions</div> : null}
								</div>
							) : null}
						</div>
					) : area === "context" ? (
						<ContextSidebar
							activePanel={contextPanel}
							onSelect={setContextPanel}
							toolCount={bootstrap.agentCatalog?.piboTools.length ?? 0}
							mcpServerCount={bootstrap.agentCatalog?.mcpServers.length ?? 0}
						/>
					) : (
						<SettingsSidebar
							activePanel={settingsPanel}
							onSelect={(panel) => navigateToRoute({ area: "settings", panel })}
							piPackageCount={bootstrap.agentCatalog?.piPackages.length ?? 0}
							userSkillCount={bootstrap.agentCatalog?.userSkills.length ?? 0}
						/>
					)}
				</aside>

				{area === "sessions" ? (
					<SessionTracePane
						bootstrap={bootstrap}
						selectedPiboSessionId={selectedPiboSessionId}
						selectedRoomId={selectedRoomId}
						selectedRoomArchived={selectedRoomArchived}
						selectedSessionProfile={selectedSessionNode?.profile ?? bootstrap.session.profile}
						selectedSessionActiveModel={selectedSessionActiveModel}
						sessionViewId={sessionViewId}
						sessionViews={sessionViews}
						currentSessionView={currentSessionView}
						creatingSession={creatingSession}
						showRawEvents={showRawEvents}
						showThinking={showThinking}
						expandThinking={expandThinking}
						commands={slashCommands}
						skills={skills}
						composerText={composerText}
						composerFocusSignal={composerFocusSignal}
						onComposerTextChange={updateComposerText}
						onToggleRawEvents={() => {
							const next = !showRawEvents;
							setShowRawEvents(next);
							localStorage.setItem("pibo.chat.showRawEvents", String(next));
						}}
						onToggleThinking={() => {
							const next = !showThinking;
							setShowThinking(next);
							localStorage.setItem("pibo.chat.showThinking", String(next));
						}}
						onToggleExpandThinking={() => {
							const next = !expandThinking;
							setExpandThinking(next);
							localStorage.setItem("pibo.chat.expandThinking", String(next));
						}}
						onSessionAgentProfileChange={(profile) => void updateSelectedSessionProfile(profile)}
						onFork={forkFrom}
						onOpenSession={openSession}
						onSelectSessionView={selectSessionView}
						onCommand={runCommand}
						onThinkingLevelChange={(level) => void runCommand(`/thinking ${level}`)}
						onRefreshTrace={refreshSelectedTrace}
						onRefreshBootstrap={refreshSelectedBootstrap}
						onSend={async (text) => {
							if (!selectedPiboSessionId || selectedRoomArchived) return;
							try {
								await sendMessageMutation.mutateAsync({
									piboSessionId: selectedPiboSessionId,
									text,
									clientTxnId: createClientTxnId(),
									roomId: selectedRoomId ?? undefined,
								});
								await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
								setError(null);
							} catch (caught) {
								setError(caught instanceof Error ? caught.message : String(caught));
							}
						}}
						onError={setError}
					/>
					) : (
						<main className="min-h-0 flex flex-col">
							{area === "context" ? (
								contextPanel === "pibo-tools" ? (
									<PiboToolsView tools={bootstrap.agentCatalog?.piboTools ?? []} />
								) : contextPanel === "mcp-tools" ? (
									<McpToolsView
										servers={bootstrap.agentCatalog?.mcpServers ?? []}
										selectedServerName={selectedMcpServerName}
										onServerSaved={updateMcpServerInBootstrap}
									/>
								) : contextPanel === "base-prompt" ? (
									<BasePromptView />
								) : contextPanel === "compaction-prompt" ? (
									<CompactionPromptView />
								) : (
									<ContextFilesView agentProfiles={contextAgentProfiles} selectedFileKey={selectedContextFileKey} />
								)
							) : (
								<SettingsView
									activePanel={settingsPanel}
									showThinking={showThinking}
									setShowThinking={setShowThinking}
									expandThinking={expandThinking}
									setExpandThinking={setExpandThinking}
									modelDefaults={bootstrap.modelDefaults}
									modelCatalog={bootstrap.modelCatalog}
									onModelDefaultsChanged={(modelDefaults) => {
										setBootstrap((current) => current ? { ...current, modelDefaults } : current);
									}}
									piPackages={bootstrap.agentCatalog?.piPackages}
									onPiPackageChanged={upsertPiPackageInBootstrap}
									onPiPackageRemoved={removePiPackageFromBootstrap}
									userSkills={bootstrap.agentCatalog?.userSkills}
									onUserSkillChanged={upsertUserSkillInBootstrap}
									onUserSkillRemoved={removeUserSkillFromBootstrap}
									piboSessionId={selectedPiboSessionId}
								/>
							)}
						</main>
					)}
					{deleteRoomTarget ? (
						<DeleteRoomModal
							room={deleteRoomTarget}
							confirmName={deleteRoomConfirmName}
							deleting={deletingRoom}
							onConfirmNameChange={setDeleteRoomConfirmName}
							onCancel={() => {
								setDeleteRoomTarget(null);
								setDeleteRoomConfirmName("");
							}}
							onDelete={() => void permanentlyDeleteRoom()}
						/>
					) : null}
					{deleteSessionTarget ? (
					<DeleteSessionModal
						session={deleteSessionTarget}
						confirmText={deleteSessionConfirmText}
						deleting={deletingSession}
						onConfirmTextChange={setDeleteSessionConfirmText}
						onCancel={() => {
							setDeleteSessionTarget(null);
							setDeleteSessionConfirmText("");
						}}
						onDelete={() => void permanentlyDeleteSession()}
					/>
				) : null}
				</>
				)}
			</div>

		</div>
	</>
	);
}

function SessionTracePane({
	bootstrap,
	selectedPiboSessionId,
	selectedRoomId,
	selectedRoomArchived,
	selectedSessionProfile,
	selectedSessionActiveModel,
	sessionViewId,
	sessionViews,
	currentSessionView,
	creatingSession,
	showRawEvents,
	showThinking,
	expandThinking,
	commands,
	skills,
	composerText,
	composerFocusSignal,
	onComposerTextChange,
	onToggleRawEvents,
	onToggleThinking,
	onToggleExpandThinking,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
	onSelectSessionView,
	onCommand,
	onThinkingLevelChange,
	onRefreshTrace,
	onRefreshBootstrap,
	onSend,
	onError,
}: {
	bootstrap: BootstrapData;
	selectedPiboSessionId: string | null;
	selectedRoomId: string | null;
	selectedRoomArchived: boolean;
	selectedSessionProfile: string;
	selectedSessionActiveModel?: string;
	sessionViewId: ChatSessionViewId;
	sessionViews: ReturnType<typeof listChatSessionViews>;
	currentSessionView: ReturnType<typeof getChatSessionView>;
	creatingSession: boolean;
	showRawEvents: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	commands: SlashCommand[];
	skills: Array<{ name: string; description?: string; path?: string }>;
	composerText: string;
	composerFocusSignal: number;
	onComposerTextChange: Dispatch<SetStateAction<string>>;
	onToggleRawEvents: () => void;
	onToggleThinking: () => void;
	onToggleExpandThinking: () => void;
	onSessionAgentProfileChange: (profile: string) => void;
	onFork: (entryId: string) => void;
	onOpenSession: (piboSessionId: string) => void;
	onSelectSessionView: (viewId: ChatSessionViewId) => void;
	onCommand: (text: string) => Promise<boolean>;
	onThinkingLevelChange: (level: ThinkingLevel) => void;
	onRefreshTrace: () => Promise<void>;
	onRefreshBootstrap: () => Promise<BootstrapData>;
	onSend: (text: string) => Promise<void>;
	onError: (message: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const pendingStreamEventsBySession = useRef(new Map<string, ChatStreamEvent[]>());
	const pendingStreamFrame = useRef<number | undefined>(undefined);
	const liveEventSeqRef = useRef(0);
	const [liveTraceOverlay, setLiveTraceOverlay] = useState<LiveTraceOverlay | null>(null);
	const traceQueryKey = useMemo(
		() =>
			selectedPiboSessionId
				? chatTraceQueryKey(selectedPiboSessionId, { includeRawEvents: true, rawEventsLimit: DEFAULT_RAW_EVENTS_LIMIT })
				: null,
		[selectedPiboSessionId],
	);
	const traceQuery = useQuery({
		queryKey: traceQueryKey ?? ["chat", "trace", "idle", "compact", DEFAULT_RAW_EVENTS_LIMIT],
		queryFn: () => {
			if (!selectedPiboSessionId) throw new Error("Session is required");
			return loadTraceQueryData(queryClient, selectedPiboSessionId, {
				includeRawEvents: true,
				rawEventsLimit: DEFAULT_RAW_EVENTS_LIMIT,
			});
		},
		enabled: Boolean(selectedPiboSessionId),
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});

	// Keep the complete server-built trace as the canonical base. Raw events are only a
	// bounded debug/live tail, so using them as the full render source truncates history.
	useEffect(() => {
		if (!traceQuery.data) return;
		const maxSeq = traceQuery.data.rawEvents
			.map((e) => e.eventSequence ?? 0)
			.reduce((a, b) => Math.max(a, b), 0);
		liveEventSeqRef.current = Math.max(liveEventSeqRef.current, maxSeq + 1);
		setLiveTraceOverlay((current) => trimLiveOverlayForBaseTrace(current, traceQuery.data));
	}, [traceQuery.data]);

	const currentTraceView = useMemo(() => {
		if (!selectedPiboSessionId || !bootstrap) return null;
		if (traceQuery.data?.piboSessionId !== selectedPiboSessionId) return null;
		const sessionStatus = bootstrap.sessions.find((s) => s.piboSessionId === selectedPiboSessionId)?.status ?? "idle";
		const overlayEvents = liveTraceOverlay?.piboSessionId === selectedPiboSessionId
			? liveTraceOverlay.events
			: [];
		if (!overlayEvents.length) return reconcileOptimisticUserMessages(traceQuery.data);
		const liveTrace = patchTraceViewWithEvents(traceQuery.data, overlayEvents, sessionStatus);
		annotateLiveTraceForkEntryIds(liveTrace.nodes, traceQuery.data.nodes);
		return reconcileOptimisticUserMessages(liveTrace);
	}, [liveTraceOverlay, selectedPiboSessionId, bootstrap, traceQuery.data]);

	const flushPendingStreamEvents = useCallback((piboSessionId: string) => {
		const pending = pendingStreamEventsBySession.current.get(piboSessionId);
		if (!pending?.length) return;
		setLiveTraceOverlay((current) => {
			const currentEvents = current?.piboSessionId === piboSessionId ? current.events : [];
			return {
				piboSessionId,
				events: applyTraceLiveEvents({
					currentEvents,
					streamEvents: pending,
					piboSessionId,
					nextSequence: () => liveEventSeqRef.current++,
				}),
			};
		});
		pendingStreamEventsBySession.current.delete(piboSessionId);
	}, []);

	const schedulePendingStreamFlush = useCallback(() => {
		if (pendingStreamFrame.current !== undefined || !selectedPiboSessionId) return;
		pendingStreamFrame.current = requestAnimationFrame(() => {
			pendingStreamFrame.current = undefined;
			flushPendingStreamEvents(selectedPiboSessionId);
		});
	}, [flushPendingStreamEvents, selectedPiboSessionId]);

	const enqueueStreamEvent = useCallback((piboSessionId: string, event: ChatStreamEvent, flushImmediately = false) => {
		const pending = pendingStreamEventsBySession.current.get(piboSessionId) ?? [];
		pending.push(event);
		pendingStreamEventsBySession.current.set(piboSessionId, pending);
		if (flushImmediately || piboSessionId !== selectedPiboSessionId) {
			flushPendingStreamEvents(piboSessionId);
		} else {
			schedulePendingStreamFlush();
		}
	}, [flushPendingStreamEvents, schedulePendingStreamFlush, selectedPiboSessionId]);

	useEffect(() => {
		return () => {
			if (pendingStreamFrame.current !== undefined) {
				cancelAnimationFrame(pendingStreamFrame.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!selectedPiboSessionId || !traceQueryKey) return;
		if (!currentTraceView || currentTraceView.piboSessionId !== selectedPiboSessionId) return;
		const params = selectedRoomId
			? new URLSearchParams({ roomId: selectedRoomId, piboSessionId: selectedPiboSessionId })
			: new URLSearchParams({ piboSessionId: selectedPiboSessionId });
		if (currentTraceView?.latestStreamId !== undefined) {
			params.set("since", `${currentTraceView.latestStreamId}:999999`);
		}
		const events = new EventSource(`/api/chat/events?${params.toString()}`);
		let traceTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		let settledBootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleTraceRefresh = (delayMs: number, reset = false) => {
			if (traceTimer) {
				if (!reset) return;
				clearTimeout(traceTimer);
			}
			traceTimer = setTimeout(() => {
				traceTimer = undefined;
				onRefreshTrace().catch((caught) => onError(errorMessage(caught)));
			}, delayMs);
		};
		const refreshBootstrap = () => {
			onRefreshBootstrap().catch((caught) => onError(errorMessage(caught)));
		};
		const scheduleBootstrapRefresh = (delayMs: number, reset = false) => {
			if (bootstrapTimer) {
				if (!reset) return;
				clearTimeout(bootstrapTimer);
			}
			bootstrapTimer = setTimeout(() => {
				bootstrapTimer = undefined;
				refreshBootstrap();
			}, delayMs);
		};
		const scheduleTerminalBootstrapRefresh = () => {
			scheduleBootstrapRefresh(650, true);
			if (settledBootstrapTimer) clearTimeout(settledBootstrapTimer);
			settledBootstrapTimer = setTimeout(() => {
				settledBootstrapTimer = undefined;
				refreshBootstrap();
			}, 2500);
		};
		events.addEventListener("pibo", (message) => {
			const event = chatStreamEvent(message);
			if (!event) return;
			const targetPiboSessionId = event.piboSessionId || selectedPiboSessionId;
			const flushImmediately = event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "REASONING_MESSAGE_CONTENT";
			if (targetPiboSessionId === selectedPiboSessionId) {
				enqueueStreamEvent(targetPiboSessionId, event, flushImmediately);
			}
			const traceRefreshDelay = eventTraceRefreshDelay(event);
			if (targetPiboSessionId === selectedPiboSessionId && traceRefreshDelay !== undefined) {
				scheduleTraceRefresh(traceRefreshDelay, true);
			} else if (targetPiboSessionId === selectedPiboSessionId && event.type !== "ready" && event.type !== "RAW_EVENT") {
				scheduleTraceRefresh(1500, true);
			}
			if (eventShouldRefreshNavigation(event)) {
				const terminal = event.type === "RUN_FINISHED" || event.type === "RUN_ERROR" || event.type === "TEXT_MESSAGE_END";
				if (terminal) {
					scheduleTerminalBootstrapRefresh();
				} else {
					scheduleBootstrapRefresh(targetPiboSessionId === selectedPiboSessionId ? 0 : 150);
				}
			}
		});
		return () => {
			if (traceTimer) clearTimeout(traceTimer);
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			if (settledBootstrapTimer) clearTimeout(settledBootstrapTimer);
			events.close();
		};
	}, [currentTraceView?.latestStreamId, currentTraceView?.piboSessionId, enqueueStreamEvent, onError, onRefreshBootstrap, onRefreshTrace, selectedPiboSessionId, selectedRoomId, traceQueryKey]);

	const selectedTrace = useMemo(() => {
		if (!currentTraceView) return null;
		return adaptTrace(currentTraceView.piboSessionId, currentTraceView.title, currentTraceView.nodes);
	}, [currentTraceView]);
	const sessionBreadcrumbs = useMemo(
		() => selectedPiboSessionId ? createSessionBreadcrumbs(bootstrap.sessions, selectedPiboSessionId) : [],
		[bootstrap.sessions, selectedPiboSessionId],
	);
	const originSession = useMemo(
		() => selectedPiboSessionId ? createOriginSessionLink(bootstrap.sessions, selectedPiboSessionId) : undefined,
		[bootstrap.sessions, selectedPiboSessionId],
	);
	const derivedSessions = useMemo(
		() => selectedPiboSessionId ? createDerivedSessionLinks(bootstrap.sessions, selectedPiboSessionId) : [],
		[bootstrap.sessions, selectedPiboSessionId],
	);
	const rawEvents = useMemo(
		() => (showRawEvents ? compactRawEvents(currentTraceView?.rawEvents ?? []) : []),
		[showRawEvents, currentTraceView?.rawEvents],
	);
	const loadingTrace = Boolean(selectedPiboSessionId) && traceQuery.isFetching && !currentTraceView;
	const traceError = traceQuery.error ? errorMessage(traceQuery.error) : null;

	useEffect(() => {
		if (!currentTraceView?.piboSessionId) return;
		flushPendingStreamEvents(currentTraceView.piboSessionId);
	}, [currentTraceView?.piboSessionId, flushPendingStreamEvents]);

	useEffect(() => {
		const handleVisibilityChange = () => {
			if (!currentTraceView?.piboSessionId) return;
			collectBackendNodes(currentTraceView.piboSessionId, `tab:${document.visibilityState}`, currentTraceView.nodes, {
				traceVersion: currentTraceView.version,
				latestStreamId: currentTraceView.latestStreamId,
				lastRawEventId: currentTraceView.rawEvents.at(-1)?.id,
			});
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, [currentTraceView]);

	return (
		<>
			<main className="min-h-0 flex flex-col">
				<div className="h-14 px-4 bg-[#151f24] border-b border-slate-800 flex items-center justify-between max-[980px]:h-auto max-[980px]:flex-wrap max-[980px]:py-2 max-[980px]:gap-2">
					<div className="min-w-0">
						<h1 className="text-base font-semibold truncate">
							{currentTraceView?.title ?? selectedPiboSessionId ?? bootstrap.room?.name ?? selectedRoomId}
						</h1>
						<div className="font-mono text-[11px] text-slate-500 truncate">
							{bootstrap.room?.name ?? selectedRoomId ?? "Room"} · {currentTraceView?.piboSessionId ?? selectedPiboSessionId ?? ""}{" "}
							{currentTraceView ? `· ${currentTraceView.piSessionId}` : ""}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<div className="flex items-center rounded-sm border border-slate-700 bg-[#0e1116] p-0.5">
							{sessionViews.map((view) => (
								<button
									key={view.id}
									type="button"
									onClick={() => onSelectSessionView(view.id)}
									title={view.description ?? view.label}
									aria-label={`Switch to ${view.label} view`}
									className={`min-w-20 px-2.5 py-1 text-[11px] font-bold tracking-wide max-[980px]:min-w-0 max-[980px]:px-1.5 ${
										sessionViewId === view.id
											? "bg-[#11a4d4]/10 text-[#11a4d4]"
											: "text-slate-400 hover:text-[#11a4d4]"
									}`}
								>
									{view.label}
								</button>
							))}
						</div>
						<HeaderIconButton
							onClick={onToggleRawEvents}
							title={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
							ariaLabel={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
							active={showRawEvents}
						>
							<Bug size={14} />
						</HeaderIconButton>
						<HeaderIconButton
							onClick={onToggleThinking}
							title={showThinking ? "Hide Thinking" : "Show Thinking"}
							ariaLabel={showThinking ? "Hide Thinking" : "Show Thinking"}
							active={showThinking}
						>
							{showThinking ? <Brain size={14} /> : <EyeOff size={14} />}
						</HeaderIconButton>
						{showThinking ? (
							<HeaderIconButton
								onClick={onToggleExpandThinking}
								title={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
								ariaLabel={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
								active={expandThinking}
							>
								{expandThinking ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
							</HeaderIconButton>
						) : null}
					</div>
				</div>
				{traceError && !currentTraceView ? (
					<div className="min-h-0 flex-1 p-4 text-sm text-red-200">{traceError}</div>
				) : (
					currentSessionView.render({
						traceView: currentTraceView,
						selectedTrace,
						isLoading: loadingTrace,
						showThinking,
						expandThinking,
						sessionAgentProfile: selectedSessionProfile,
						sessionActiveModel: selectedSessionActiveModel,
						sessionBreadcrumbs,
						originSession,
						derivedSessions,
						agentProfiles: bootstrap.agents,
						sessionProfileChangeDisabled: creatingSession || selectedRoomArchived,
						onSessionAgentProfileChange,
						onFork,
						onOpenSession,
						onThinkingLevelChange,
						onModelChanged: async () => {
							await onRefreshBootstrap();
							await onRefreshTrace();
						},
					})
				)}
				<Composer
					sessionId={selectedPiboSessionId}
					disabled={!selectedPiboSessionId || selectedRoomArchived}
					commands={commands}
					skills={skills}
					value={composerText}
					focusSignal={composerFocusSignal}
					onValueChange={onComposerTextChange}
					onCommand={onCommand}
					onSend={onSend}
				/>
			</main>

			{showRawEvents ? (
				<aside className="min-h-0 overflow-auto bg-[#0e1116] border-l border-slate-800 max-[980px]:hidden">
					<div className="h-11 px-3 border-b border-slate-800 flex items-center text-xs font-bold uppercase tracking-wider">Raw Events</div>
					<div className="p-3 flex flex-col gap-2">
						{rawEvents.slice(-DEFAULT_RAW_EVENTS_LIMIT).reverse().map((event) => (
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
		</>
	);
}

function patchTraceViewWithEvents(
	view: PiboSessionTraceView,
	events: ChatWebStoredEvent[],
	sessionStatus: PiboWebSessionNode["status"],
): PiboSessionTraceView {
	return events.reduce((current, event) => patchTraceViewWithEvent(current, event, sessionStatus), view);
}

type BootstrapMutationSnapshot = {
	localBootstrap: BootstrapData | null;
	queryData: Array<[readonly unknown[], BootstrapData | undefined]>;
};

function createBootstrapMutationSnapshot(queryClient: QueryClient, localBootstrap: BootstrapData | null): BootstrapMutationSnapshot {
	return {
		localBootstrap,
		queryData: queryClient.getQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }),
	};
}

function addSessionNodeToBootstrap(data: BootstrapData, node: PiboWebSessionNode): BootstrapData {
	if (findSessionNode(data.sessions, node.piboSessionId)) return data;
	return { ...data, sessions: [node, ...data.sessions] };
}

function removeSessionsFromBootstrap(data: BootstrapData, piboSessionIds: ReadonlySet<string>): BootstrapData {
	const sessions = removeSessionNodes(data.sessions, piboSessionIds);
	const selectedDeleted = piboSessionIds.has(data.selectedPiboSessionId);
	return {
		...data,
		selectedPiboSessionId: selectedDeleted ? "" : data.selectedPiboSessionId,
		sessions,
	};
}

function removeSessionNodes(nodes: PiboWebSessionNode[], piboSessionIds: ReadonlySet<string>): PiboWebSessionNode[] {
	let changed = false;
	const next: PiboWebSessionNode[] = [];
	for (const node of nodes) {
		if (piboSessionIds.has(node.piboSessionId)) {
			changed = true;
			continue;
		}
		const children = removeSessionNodes(node.children, piboSessionIds);
		if (children !== node.children) {
			changed = true;
			next.push({ ...node, children });
		} else {
			next.push(node);
		}
	}
	return changed ? next : nodes;
}

function sessionSubtreeIds(node: PiboWebSessionNode): Set<string> {
	const ids = new Set<string>([node.piboSessionId]);
	for (const child of node.children) {
		for (const id of sessionSubtreeIds(child)) ids.add(id);
	}
	return ids;
}

function replaceOptimisticSessionNode(
	data: BootstrapData,
	tempId: string | undefined,
	node: PiboWebSessionNode,
): BootstrapData {
	if (!tempId) return addSessionNodeToBootstrap(data, node);
	let replaced = false;
	const sessions = replaceSessionNode(data.sessions, tempId, () => {
		replaced = true;
		return node;
	});
	return {
		...data,
		selectedPiboSessionId: data.selectedPiboSessionId === tempId ? node.piboSessionId : data.selectedPiboSessionId,
		session: data.session.id === tempId ? piboSessionFromSessionNode(node, data.session) : data.session,
		sessions: replaced ? sessions : [node, ...sessions],
	};
}

function updateSessionFromPiboSession(data: BootstrapData, session: PiboSession): BootstrapData {
	const archived = typeof session.metadata?.chatWebArchivedAt === "string";
	return {
		...data,
		session: data.session.id === session.id ? session : data.session,
		sessions: replaceSessionNode(data.sessions, session.id, (node) => ({
			...node,
			profile: session.profile,
			activeModel: session.activeModel,
			title: session.title || node.title || "Untitled Session",
			archived,
		})),
	};
}

function updateSessionNodeInBootstrap(
	data: BootstrapData,
	piboSessionId: string,
	updater: (node: PiboWebSessionNode) => PiboWebSessionNode,
): BootstrapData {
	const session = data.session.id === piboSessionId ? piboSessionFromSessionNode(updater(sessionNodeFromSession(data.session)), data.session) : data.session;
	return { ...data, session, sessions: replaceSessionNode(data.sessions, piboSessionId, updater) };
}

function addRoomToBootstrap(data: BootstrapData, room: PiboRoom): BootstrapData {
	if (findRoomById(data.rooms, room.id)) return data;
	return {
		...data,
		room,
		selectedRoomId: room.id,
		selectedPiboSessionId: "",
		rooms: [room, ...data.rooms],
	};
}

function replaceRoomInBootstrap(data: BootstrapData, roomId: string, room: PiboRoom): BootstrapData {
	return {
		...data,
		room: data.room?.id === roomId ? room : data.room,
		selectedRoomId: data.selectedRoomId === roomId ? room.id : data.selectedRoomId,
		rooms: replaceRoomNode(data.rooms, roomId, () => room),
	};
}

function updateRoomInBootstrap(data: BootstrapData, roomId: string, updater: (room: PiboRoom) => PiboRoom): BootstrapData {
	return {
		...data,
		room: data.room?.id === roomId ? updater(data.room) : data.room,
		rooms: replaceRoomNode(data.rooms, roomId, updater),
	};
}

function removeRoomsFromBootstrap(data: BootstrapData, roomIds: ReadonlySet<string>): BootstrapData {
	const selectedDeleted = roomIds.has(data.selectedRoomId);
	return {
		...data,
		room: data.room && roomIds.has(data.room.id) ? undefined : data.room,
		selectedRoomId: selectedDeleted ? "" : data.selectedRoomId,
		selectedPiboSessionId: selectedDeleted ? "" : data.selectedPiboSessionId,
		rooms: removeRoomNodes(data.rooms, roomIds),
	};
}

function replaceRoomNode(nodes: PiboRoom[], roomId: string, updater: (room: PiboRoom) => PiboRoom): PiboRoom[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.id === roomId) {
			changed = true;
			return updater(node);
		}
		const originalChildren = node.children ?? [];
		const children = replaceRoomNode(originalChildren, roomId, updater);
		if (children === originalChildren) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
}

function removeRoomNodes(nodes: PiboRoom[], roomIds: ReadonlySet<string>): PiboRoom[] {
	let changed = false;
	const next: PiboRoom[] = [];
	for (const node of nodes) {
		if (roomIds.has(node.id)) {
			changed = true;
			continue;
		}
		const originalChildren = node.children ?? [];
		const children = removeRoomNodes(originalChildren, roomIds);
		if (children !== originalChildren) {
			changed = true;
			next.push({ ...node, children });
		} else {
			next.push(node);
		}
	}
	return changed ? next : nodes;
}

function createOptimisticRoom(id: string, userId: string, name: string): PiboRoom {
	const now = new Date().toISOString();
	return {
		id,
		ownerScope: `user:${userId}`,
		name,
		type: "chat",
		createdAt: now,
		updatedAt: now,
		metadata: {},
		children: [],
	};
}

function roomWithArchivedState(room: PiboRoom, archived: boolean): PiboRoom {
	const metadata = { ...room.metadata };
	if (archived) metadata.chatRoomArchivedAt = new Date().toISOString();
	else delete metadata.chatRoomArchivedAt;
	return { ...room, metadata, updatedAt: new Date().toISOString() };
}

function roomSubtreeIds(room: PiboRoom): Set<string> {
	const ids = new Set<string>([room.id]);
	for (const child of room.children ?? []) {
		for (const id of roomSubtreeIds(child)) ids.add(id);
	}
	return ids;
}

function replaceSessionNode(
	nodes: PiboWebSessionNode[],
	piboSessionId: string,
	updater: (node: PiboWebSessionNode) => PiboWebSessionNode,
): PiboWebSessionNode[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.piboSessionId === piboSessionId) {
			changed = true;
			return updater(node);
		}
		const children = replaceSessionNode(node.children, piboSessionId, updater);
		if (children === node.children) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
}

function createOptimisticSessionNode(piboSessionId: string, profile: string): PiboWebSessionNode {
	return {
		piboSessionId,
		piSessionId: "pending",
		profile,
		title: "New Session",
		status: "idle",
		lastActivityAt: new Date().toISOString(),
		derivedSessions: [],
		children: [],
	};
}

function sessionNodeFromSession(session: PiboSession): PiboWebSessionNode {
	return {
		piboSessionId: session.id,
		piSessionId: session.piSessionId,
		profile: session.profile,
		activeModel: session.activeModel,
		title: session.title || "Untitled Session",
		archived: typeof session.metadata?.chatWebArchivedAt === "string",
		status: "idle",
		lastActivityAt: session.updatedAt,
		derivedSessions: [],
		children: [],
	};
}

function piboSessionFromSessionNode(node: PiboWebSessionNode, base: PiboSession): PiboSession {
	return {
		...base,
		id: node.piboSessionId,
		piSessionId: node.piSessionId,
		profile: node.profile,
		activeModel: node.activeModel,
		title: node.title,
		updatedAt: node.lastActivityAt ?? base.updatedAt,
	};
}

function appendOptimisticUserMessageToTrace(
	view: PiboSessionTraceView,
	piboSessionId: string,
	text: string,
	clientTxnId: string,
): PiboSessionTraceView {
	if (view.piboSessionId !== piboSessionId) return view;
	const now = new Date().toISOString();
	const id = `optimistic:user-message:${clientTxnId}`;
	if (traceHasNode(view.nodes, id)) return view;
	const node: PiboTraceNode = {
		id,
		piboSessionId,
		type: "user.message",
		title: "User Message",
		status: "done",
		startedAt: now,
		summary: text,
		output: text,
		source: "event-log",
		stableKey: id,
		children: [],
	};
	return {
		...view,
		version: `${view.version}:optimistic:${clientTxnId}`,
		nodes: [...view.nodes, node],
	};
}

function traceHasNode(nodes: PiboTraceNode[], nodeId: string): boolean {
	return nodes.some((node) => node.id === nodeId || traceHasNode(node.children, nodeId));
}

function reconcileOptimisticUserMessages(view: PiboSessionTraceView): PiboSessionTraceView {
	const persistedByText = new Map<string, number>();
	collectPersistedUserMessageText(view.nodes, persistedByText);
	if (!persistedByText.size) return view;
	const { nodes, changed } = dropReplacedOptimisticUserMessages(view.nodes, persistedByText);
	return changed ? { ...view, nodes } : view;
}

function collectPersistedUserMessageText(nodes: readonly PiboTraceNode[], byText: Map<string, number>): void {
	for (const node of nodes) {
		if (node.type === "user.message" && !isOptimisticUserMessageNode(node)) {
			const text = traceNodeText(node);
			if (text) byText.set(text, (byText.get(text) ?? 0) + 1);
		}
		collectPersistedUserMessageText(node.children, byText);
	}
}

function dropReplacedOptimisticUserMessages(
	nodes: readonly PiboTraceNode[],
	persistedByText: Map<string, number>,
): { nodes: PiboTraceNode[]; changed: boolean } {
	let changed = false;
	const next: PiboTraceNode[] = [];
	for (const node of nodes) {
		if (isOptimisticUserMessageNode(node)) {
			const text = traceNodeText(node);
			const persistedCount = text ? persistedByText.get(text) ?? 0 : 0;
			if (persistedCount > 0) {
				persistedByText.set(text, persistedCount - 1);
				changed = true;
				continue;
			}
		}
		const childResult = dropReplacedOptimisticUserMessages(node.children, persistedByText);
		changed = changed || childResult.changed;
		next.push(childResult.changed ? { ...node, children: childResult.nodes } : node);
	}
	return { nodes: changed ? next : nodes as PiboTraceNode[], changed };
}

function isOptimisticUserMessageNode(node: PiboTraceNode): boolean {
	return node.type === "user.message" && (node.id.startsWith("optimistic:user-message:") || node.stableKey?.startsWith("optimistic:user-message:") === true);
}

function trimLiveOverlayForBaseTrace(overlay: LiveTraceOverlay | null, baseTrace: PiboSessionTraceView): LiveTraceOverlay | null {
	if (!overlay || overlay.piboSessionId !== baseTrace.piboSessionId) return overlay;
	const latestStreamId = baseTrace.latestStreamId;
	const events = latestStreamId === undefined
		? overlay.events
		: overlay.events.filter((event) => event.streamId === undefined || event.streamId > latestStreamId);
	return events.length ? { ...overlay, events } : null;
}

function errorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
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

function HeaderIconButton({
	title,
	ariaLabel,
	active,
	onClick,
	children,
}: {
	title: string;
	ariaLabel: string;
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-label={ariaLabel}
			className={`h-8 w-8 inline-flex items-center justify-center border rounded-sm transition-colors ${
				active
					? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]"
					: "border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
			}`}
		>
			{children}
		</button>
	);
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
			<div className="w-full max-w-lg border border-slate-700 bg-[#1a262b] rounded-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
				{children}
			</div>
		</div>
	);
}

function DeleteSessionModal({
	session,
	confirmText,
	deleting,
	onConfirmTextChange,
	onCancel,
	onDelete,
}: {
	session: PiboWebSessionNode;
	confirmText: string;
	deleting: boolean;
	onConfirmTextChange: (value: string) => void;
	onCancel: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
			<div className="w-full max-w-lg border border-red-500/70 bg-[#1a262b] rounded-sm shadow-xl">
				<div className="px-4 py-3 border-b border-red-500/50 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-bold uppercase tracking-wider text-red-200">Delete Session</h2>
						<div className="font-mono text-[11px] text-slate-500 truncate">{session.piboSessionId}</div>
					</div>
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						title="Cancel"
						aria-label="Cancel"
						className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						<X size={14} />
					</button>
				</div>
				<div className="p-4 grid gap-3">
					<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
						This permanently deletes the archived session, its child sessions, and their Chat events. This cannot be undone.
					</div>
					<div className="text-sm text-slate-300">
						Type <span className="font-mono text-red-200">{SESSION_DELETE_CONFIRM_TEXT}</span> to confirm.
					</div>
					<input
						value={confirmText}
						onChange={(event) => onConfirmTextChange(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
						placeholder={SESSION_DELETE_CONFIRM_TEXT}
						autoFocus
					/>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onCancel}
							disabled={deleting}
							className="h-8 inline-flex items-center border border-slate-700 rounded-sm px-3 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={onDelete}
							disabled={deleting || confirmText !== SESSION_DELETE_CONFIRM_TEXT}
							className="h-8 inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50"
						>
							<Trash2 size={14} />
							Delete permanently
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function DeleteRoomModal({
	room,
	confirmName,
	deleting,
	onConfirmNameChange,
	onCancel,
	onDelete,
}: {
	room: PiboRoom;
	confirmName: string;
	deleting: boolean;
	onConfirmNameChange: (value: string) => void;
	onCancel: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
			<div className="w-full max-w-lg border border-red-500/70 bg-[#1a262b] rounded-sm shadow-xl">
				<div className="px-4 py-3 border-b border-red-500/50 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-bold uppercase tracking-wider text-red-200">Delete Room</h2>
						<div className="font-mono text-[11px] text-slate-500 truncate">{room.id}</div>
					</div>
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						title="Cancel"
						aria-label="Cancel"
						className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						<X size={14} />
					</button>
				</div>
				<div className="p-4 grid gap-3">
					<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
						This permanently deletes the archived room, child rooms, all contained sessions, subagent sessions, and their Chat events. This cannot be undone.
					</div>
					<div className="text-sm text-slate-300">
						Type <span className="font-mono text-red-200">{room.name}</span> to confirm.
					</div>
					<input
						value={confirmName}
						onChange={(event) => onConfirmNameChange(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
						placeholder={room.name}
						autoFocus
					/>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onCancel}
							disabled={deleting}
							className="h-8 inline-flex items-center border border-slate-700 rounded-sm px-3 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={onDelete}
							disabled={deleting || confirmName !== room.name}
							className="h-8 inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50"
						>
							<Trash2 size={14} />
							Delete permanently
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function unreadBadgeLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
}

function UnreadBadge({ count }: { count?: number }) {
	if (!count || count <= 0) return null;
	return (
		<span
			className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#38bdf8] text-[#0e1116] text-[10px] font-bold tabular-nums leading-none"
			aria-label={`${count} unread messages`}
			title={`${count} unread messages`}
		>
			{unreadBadgeLabel(count)}
		</span>
	);
}

function MobileUnreadBadge({ count }: { count?: number }) {
	if (!count || count <= 0) return null;
	return (
		<span
			className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#38bdf8] text-[#0e1116] text-[10px] font-bold tabular-nums leading-none"
			aria-label={`${count} unread messages across all rooms`}
			title={`${count} unread messages across all rooms`}
		>
			{unreadBadgeLabel(count)}
		</span>
	);
}

function RoomNode({
	room,
	selectedRoomId,
	onSelect,
	onUpdate,
	onArchive,
	onDelete,
	depth = 0,
}: {
	room: PiboRoom;
	selectedRoomId: string | null;
	onSelect: (roomId: string) => void;
	onUpdate: (roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null }) => void;
	onArchive: (roomId: string, archived: boolean) => void;
	onDelete: (room: PiboRoom) => void;
	depth?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [draftName, setDraftName] = useState(room.name);
	const [draftTopic, setDraftTopic] = useState(room.topic ?? "");
	const [draftWorkspace, setDraftWorkspace] = useState(room.workspace ?? "");
	const personal = isPersonalRoom(room);
	const archived = isArchivedRoom(room);

	useEffect(() => {
		if (!editing) {
			setDraftName(room.name);
			setDraftTopic(room.topic ?? "");
			setDraftWorkspace(room.workspace ?? "");
		}
	}, [editing, room.name, room.topic, room.workspace]);

	const submit = () => {
		const name = draftName.trim();
		if (!name) return;
		onUpdate(room.id, { name, topic: draftTopic.trim() || null, workspace: draftWorkspace.trim() || null });
		setEditing(false);
	};

	return (
		<div>
			<div
				className={`group mb-1 border rounded-sm ${
					personal
						? room.id === selectedRoomId
							? "border-[#0bda57] bg-[#0bda57]/10"
							: "border-[#0bda57]/50 bg-[#0bda57]/5"
						: room.id === selectedRoomId
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: archived
								? "border-[#f59e0b]/40 bg-[#f59e0b]/5"
								: "border-transparent"
				}`}
				style={{ marginLeft: depth * 12 }}
				title={room.id}
			>
				{editing && !personal ? (
					<form
						className="grid gap-1 p-1"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<input
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4]"
							autoFocus
						/>
						<input
							value={draftTopic}
							onChange={(event) => setDraftTopic(event.target.value)}
							placeholder="Topic"
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-xs outline-none focus:border-[#11a4d4]"
						/>
						<input
							value={draftWorkspace}
							onChange={(event) => setDraftWorkspace(event.target.value)}
							placeholder="Workspace (/absolute/path)"
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-[#11a4d4]"
						/>
						<div className="flex justify-end gap-1">
							<button type="submit" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
								<Check size={13} />
							</button>
							<button
								type="button"
								onClick={() => setEditing(false)}
								className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							>
								<X size={13} />
							</button>
						</div>
					</form>
				) : (
					<div className="grid grid-cols-[1fr_auto] items-center gap-1 py-1 pr-1">
						<button
							type="button"
							onClick={() => onSelect(room.id)}
							className="min-w-0 text-left px-2 py-1 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center"
						>
							<span className={`h-6 w-6 inline-flex items-center justify-center rounded-sm ${personal ? "bg-[#0bda57]/15 text-[#0bda57]" : archived ? "bg-[#f59e0b]/15 text-[#f59e0b]" : "bg-[#151f24] text-slate-500"}`}>
								{personal ? <Lock size={13} /> : archived ? <Archive size={13} /> : <FolderPlus size={13} />}
							</span>
							<span className="min-w-0">
								<span className={`block text-sm truncate ${archived ? "text-slate-500" : "text-slate-200"}`}>{room.name}</span>
								<span className="block text-[10px] font-mono truncate text-slate-500">{personal ? "locked personal room" : archived ? "archived" : formatRoomSummary(room)}</span>
							</span>
							<UnreadBadge count={room.unreadCount} />
						</button>
						<div className="flex items-center gap-1 pr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
							{personal ? (
								<span title="Personal Chat is locked" aria-label="Personal Chat is locked" className="h-7 w-7 inline-flex items-center justify-center border border-[#0bda57]/50 rounded-sm text-[#0bda57]">
									<Lock size={13} />
								</span>
							) : archived ? (
								<>
									<button
										type="button"
										onClick={() => onArchive(room.id, false)}
										title="Restore Room"
										aria-label="Restore Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
									>
										<ArchiveRestore size={13} />
									</button>
									<button
										type="button"
										onClick={() => onDelete(room)}
										title="Delete Room"
										aria-label="Delete Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-red-500/70 rounded-sm text-red-300 hover:bg-red-500/10"
									>
										<Trash2 size={13} />
									</button>
								</>
							) : (
								<>
									<button
										type="button"
										onClick={() => setEditing(true)}
										title="Edit Room"
										aria-label="Edit Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
									>
										<Edit3 size={13} />
									</button>
									<button
										type="button"
										onClick={() => onArchive(room.id, true)}
										title="Archive Room"
										aria-label="Archive Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
									>
										<Archive size={13} />
									</button>
								</>
							)}
						</div>
					</div>
				)}
			</div>
			{(room.children ?? []).map((child) => (
				<RoomNode
					key={child.id}
					room={child}
						selectedRoomId={selectedRoomId}
						onSelect={onSelect}
						onUpdate={onUpdate}
						onArchive={onArchive}
						onDelete={onDelete}
						depth={depth + 1}
					/>
			))}
		</div>
	);
}

function SessionNode({
	node,
	signalNow,
	selectedPiboSessionId,
	onSelect,
	onRename,
	onArchive,
	onDelete,
	depth = 0,
}: {
	node: PiboWebSessionNode;
	signalNow: number;
	selectedPiboSessionId: string | null;
	onSelect: (piboSessionId: string) => void;
	onRename: (piboSessionId: string, title: string | null) => void;
	onArchive: (piboSessionId: string, archived: boolean) => void;
	onDelete: (node: PiboWebSessionNode) => void;
	depth?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(node.title);
	const hasChildren = node.children.length > 0;
	const hasSelectedDescendant = selectedPiboSessionId ? sessionTreeHasSession(node.children, selectedPiboSessionId) : false;
	const [expanded, setExpanded] = useState(hasSelectedDescendant);

	useEffect(() => {
		if (!editing) setDraftTitle(node.title);
	}, [editing, node.title]);

	useEffect(() => {
		if (hasSelectedDescendant) setExpanded(true);
	}, [hasSelectedDescendant]);

	const submitRename = () => {
		const title = draftTitle.trim();
		onRename(node.piboSessionId, title ? title : null);
		setEditing(false);
	};
	const signal = sessionNodeSignal(node, signalNow);

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
					<div className="min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center py-1 pr-1">
						<button
							type="button"
							onClick={() => {
								if (hasChildren && node.piboSessionId === selectedPiboSessionId) {
									setExpanded((current) => !current);
									return;
								}
								onSelect(node.piboSessionId);
							}}
							className="min-w-0 text-left px-1 py-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center"
						>
							<span className="min-w-0">
								<span className={`block text-sm truncate ${node.archived ? "text-slate-500" : "text-slate-200"}`}>{node.title}</span>
								<span className="block text-[10px] font-mono truncate text-slate-500">{node.piboSessionId}</span>
							</span>
						</button>
						<span className="grid grid-rows-[16px_16px] place-items-center gap-0.5">
							<span className={signal.className} title={signal.title} aria-label={signal.title} />
							{hasChildren ? (
								<button
									type="button"
									onClick={() => setExpanded((current) => !current)}
									aria-expanded={expanded}
									title={expanded ? "Collapse Subsessions" : "Expand Subsessions"}
									aria-label={expanded ? "Collapse Subsessions" : "Expand Subsessions"}
									className={`h-4 w-4 inline-flex items-center justify-center rounded-sm transition-colors ${
										expanded ? "text-[#0bda57]" : "text-slate-600 hover:text-[#11a4d4]"
									}`}
								>
									<Layers size={13} />
								</button>
							) : (
								<span className="h-4 w-4" />
							)}
						</span>
					</div>
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
						{node.archived ? (
							<button
								type="button"
								onClick={() => onDelete(node)}
								title="Delete Session"
								aria-label="Delete Session"
								className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-500 hover:text-red-300"
							>
								<Trash2 size={13} />
							</button>
						) : null}
					</div>
				)}
			</div>
			{expanded ? node.children.map((child) => (
				<SessionNode
					key={child.piboSessionId}
					node={child}
					signalNow={signalNow}
					selectedPiboSessionId={selectedPiboSessionId}
					onSelect={onSelect}
					onRename={onRename}
					onArchive={onArchive}
					onDelete={onDelete}
					depth={depth + 1}
				/>
			)) : null}
		</div>
	);
}

function sessionNodeSignal(node: PiboWebSessionNode, now: number): { className: string; title: string } {
	const base = "session-signal h-2 w-2 rounded-full";
	if (node.status === "error") {
		return { className: `${base} session-signal-error`, title: "Run failed" };
	}
	if (node.status === "running") {
		return { className: `${base} session-signal-running`, title: "Runtime is working" };
	}
	if ((node.unreadCount ?? 0) > 0 || sessionWasRecentlyActive(node, now)) {
		return { className: `${base} session-signal-unread`, title: "New completed assistant message" };
	}
	return { className: `${base} session-signal-idle`, title: "Idle" };
}

function sessionWasRecentlyActive(node: PiboWebSessionNode, now: number): boolean {
	if (!node.lastActivityAt) return false;
	const timestamp = Date.parse(node.lastActivityAt);
	return Number.isFinite(timestamp) && now - timestamp < RECENT_SESSION_ACTIVITY_SIGNAL_MS;
}

function nextRecentSessionSignalExpiryMs(nodes: readonly PiboWebSessionNode[], now: number): number | undefined {
	let nextMs: number | undefined;
	const visit = (node: PiboWebSessionNode) => {
		if (node.status !== "running" && node.status !== "error" && (node.unreadCount ?? 0) === 0 && node.lastActivityAt) {
			const timestamp = Date.parse(node.lastActivityAt);
			if (Number.isFinite(timestamp)) {
				const remainingMs = RECENT_SESSION_ACTIVITY_SIGNAL_MS - (now - timestamp);
				if (remainingMs > 0) nextMs = nextMs === undefined ? remainingMs : Math.min(nextMs, remainingMs);
			}
		}
		for (const child of node.children) visit(child);
	};
	for (const node of nodes) visit(node);
	return nextMs === undefined ? undefined : nextMs + 50;
}

function sessionTreeHasSession(nodes: PiboWebSessionNode[], piboSessionId: string): boolean {
	return nodes.some((node) => node.piboSessionId === piboSessionId || sessionTreeHasSession(node.children, piboSessionId));
}

function createOriginSessionLink(nodes: PiboWebSessionNode[], piboSessionId: string): SessionOriginLink | undefined {
	const selected = findSessionNode(nodes, piboSessionId);
	if (!selected?.originId) return undefined;
	const origin = findSessionNode(nodes, selected.originId);
	return {
		piboSessionId: selected.originId,
		label: origin ? sessionBreadcrumbLabel(origin, 0) : selected.originId,
	};
}

function createDerivedSessionLinks(nodes: PiboWebSessionNode[], piboSessionId: string): SessionDerivationLink[] {
	const selected = findSessionNode(nodes, piboSessionId);
	return selected?.derivedSessions.map((session) => ({
		piboSessionId: session.piboSessionId,
		label: sessionLabel(session),
		profile: session.profile,
		status: session.status,
	})) ?? [];
}

function createSessionBreadcrumbs(nodes: PiboWebSessionNode[], piboSessionId: string): SessionBreadcrumbItem[] {
	const path = findSessionPath(nodes, piboSessionId);
	return path.map((node, index) => ({
		piboSessionId: node.piboSessionId,
		label: sessionBreadcrumbLabel(node, index),
	}));
}

function resolveSessionActiveModelLabel(
	bootstrap: BootstrapData,
	session: Pick<PiboWebSessionNode, "profile" | "parentId" | "activeModel">,
): string | undefined {
	const model = resolveSessionActiveModel(bootstrap, session);
	return model ? formatModelProfile(model) : undefined;
}

function resolveSessionActiveModel(
	bootstrap: BootstrapData,
	session: Pick<PiboWebSessionNode, "profile" | "parentId" | "activeModel">,
): ModelProfile | undefined {
	if (session.activeModel) return session.activeModel;
	const staticAgent = bootstrap.agents.find((agent) => agent.name === session.profile);
	if (staticAgent?.model) return staticAgent.model;

	const customAgent = bootstrap.customAgents.find((agent) => agent.profileName === session.profile);
	const profileModel = staticAgent ?? customAgent;
	if (session.parentId) return profileModel?.subagentModel ?? bootstrap.modelDefaults?.subagent;
	return profileModel?.mainModel ?? bootstrap.modelDefaults?.main;
}

function findSessionNode(nodes: PiboWebSessionNode[], piboSessionId: string): PiboWebSessionNode | undefined {
	for (const node of nodes) {
		if (node.piboSessionId === piboSessionId) return node;
		const child = findSessionNode(node.children, piboSessionId);
		if (child) return child;
	}
	return undefined;
}

function findSessionPath(
	nodes: PiboWebSessionNode[],
	piboSessionId: string,
	path: PiboWebSessionNode[] = [],
): PiboWebSessionNode[] {
	for (const node of nodes) {
		const nextPath = [...path, node];
		if (node.piboSessionId === piboSessionId) return nextPath;
		const childPath = findSessionPath(node.children, piboSessionId, nextPath);
		if (childPath.length) return childPath;
	}
	return [];
}

function sessionBreadcrumbLabel(node: PiboWebSessionNode, index: number): string {
	if (!index) return node.profile || node.title;
	if (node.subagentName && node.subagentName !== node.profile) return `${node.subagentName} (${node.profile})`;
	return node.profile || node.subagentName || node.title;
}

function sessionLabel(session: Pick<PiboWebSessionNode, "title" | "profile" | "subagentName">): string {
	if (session.subagentName && session.subagentName !== session.profile) return `${session.subagentName} (${session.profile})`;
	return session.title || session.profile || session.subagentName || "Untitled Session";
}

function splitSessionNodesByArchive(nodes: PiboWebSessionNode[]): {
	active: PiboWebSessionNode[];
	archived: PiboWebSessionNode[];
} {
	const active: PiboWebSessionNode[] = [];
	const archived: PiboWebSessionNode[] = [];
	for (const node of nodes) {
		if (node.archived) {
			archived.push(node);
			continue;
		}
		const children = splitSessionNodesByArchive(node.children);
		active.push({ ...node, children: children.active });
		archived.push(...children.archived);
	}
	return { active, archived };
}

function findPersonalRoom(rooms: PiboRoom[]): PiboRoom | undefined {
	for (const room of rooms) {
		if (isPersonalRoom(room)) return room;
		const child = findPersonalRoom(room.children ?? []);
		if (child) return child;
	}
	return undefined;
}

function findRoomById(rooms: PiboRoom[], roomId: string): PiboRoom | undefined {
	for (const room of rooms) {
		if (room.id === roomId) return room;
		const child = findRoomById(room.children ?? [], roomId);
		if (child) return child;
	}
	return undefined;
}

function countUnreadRooms(rooms: readonly PiboRoom[]): number {
	return rooms.reduce((sum, room) => sum + (room.unreadCount ?? 0), 0);
}

function splitRoomNodes(nodes: PiboRoom[]): {
	active: PiboRoom[];
	archived: PiboRoom[];
} {
	const active: PiboRoom[] = [];
	const archived: PiboRoom[] = [];
	for (const node of nodes) {
		if (isPersonalRoom(node)) {
			const children = splitRoomNodes(node.children ?? []);
			active.push(...children.active);
			archived.push(...children.archived);
			continue;
		}
		if (isArchivedRoom(node)) {
			archived.push(node);
			continue;
		}
		const children = splitRoomNodes(node.children ?? []);
		active.push({ ...node, children: children.active });
		archived.push(...children.archived);
	}
	return { active, archived };
}

function isPersonalRoom(room: PiboRoom): boolean {
	return room.metadata.default === true;
}

function isArchivedRoom(room: PiboRoom): boolean {
	return typeof room.metadata.chatRoomArchivedAt === "string";
}

function formatRoomSummary(room: PiboRoom): string {
	if (room.topic && room.workspace) return `${room.topic} | ${room.workspace}`;
	if (room.topic) return room.topic;
	if (room.workspace) return room.workspace;
	return room.type;
}

function Composer({
	sessionId,
	disabled = false,
	commands,
	skills,
	value,
	focusSignal,
	onValueChange,
	onCommand,
	onSend,
}: {
	sessionId: string | null;
	disabled?: boolean;
	commands: SlashCommand[];
	skills: Array<{ name: string; description?: string; path?: string }>;
	value: string;
	focusSignal: number;
	onValueChange: (value: string) => void;
	onCommand: (text: string) => Promise<boolean>;
	onSend: (text: string) => Promise<void>;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const activeCommandRef = useRef<HTMLButtonElement>(null);
	const activeSkillRef = useRef<HTMLButtonElement>(null);
	const historyNavRef = useRef<{ entries: string[]; index: number; draft: string } | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [activeSkillIndex, setActiveSkillIndex] = useState(0);
	const [cursorPos, setCursorPos] = useState(0);

	const skillTrigger = useMemo(() => {
		for (let i = cursorPos - 1; i >= 0; i--) {
			const char = value[i];
			if (char === " " || char === "\n" || char === "\t") break;
			if (char === "$") {
				if (i > 0 && value[i - 1] === "\\") continue;
				const query = value.slice(i + 1, cursorPos).toLowerCase();
				return { query, startPos: i, endPos: cursorPos };
			}
		}
		return null;
	}, [value, cursorPos]);

	const filteredSkills = useMemo(() => {
		if (!skillTrigger) return [];
		return skills.filter((skill) => skill.name.toLowerCase().startsWith(skillTrigger.query));
	}, [skillTrigger, skills]);

	const filtered = value.trim().startsWith("/")
		? commands.filter((command) => command.slash.startsWith(value.trim().split(/\s+/)[0]))
		: [];

	useEffect(() => {
		if (!filtered.length || activeIndex < filtered.length) return;
		setActiveIndex(0);
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		if (!filteredSkills.length || activeSkillIndex < filteredSkills.length) return;
		setActiveSkillIndex(0);
	}, [activeSkillIndex, filteredSkills.length]);

	useEffect(() => {
		activeCommandRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		activeSkillRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeSkillIndex, filteredSkills.length]);

	useEffect(() => {
		historyNavRef.current = null;
	}, [sessionId]);

	useEffect(() => {
		if (focusSignal <= 0) return;
		const input = inputRef.current;
		if (!input) return;
		const cursorPosition = input.value.length;
		input.focus();
		input.setSelectionRange(cursorPosition, cursorPosition);
		setCursorPos(cursorPosition);
	}, [focusSignal]);

	useLayoutEffect(() => {
		resizeComposerInput(inputRef.current);
	}, [value]);

	const insertSkill = (skillName: string) => {
		if (!skillTrigger || !inputRef.current) return;
		const before = value.slice(0, skillTrigger.startPos);
		const after = value.slice(skillTrigger.endPos);
		const newValue = before + "$" + skillName + after;
		onValueChange(newValue);
		const newCursorPos = skillTrigger.startPos + 1 + skillName.length;
		requestAnimationFrame(() => {
			inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
			setCursorPos(newCursorPos);
		});
	};

	const setHistoryValue = (text: string) => {
		onValueChange(text);
		requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			const cursorPosition = input.value.length;
			input.setSelectionRange(cursorPosition, cursorPosition);
			setCursorPos(cursorPosition);
		});
	};

	const navigateHistory = (direction: "previous" | "next") => {
		const existing = historyNavRef.current;
		if (!existing) {
			if (direction === "next" || value !== "") return false;
			const entries = readStoredComposerHistory();
			if (!entries.length) return false;
			const index = direction === "previous" ? entries.length - 1 : 0;
			historyNavRef.current = { entries, index, draft: value };
			setHistoryValue(entries[index]);
			return true;
		}

		if (direction === "previous") {
			const index = Math.max(0, existing.index - 1);
			historyNavRef.current = { ...existing, index };
			setHistoryValue(existing.entries[index]);
			return true;
		}

		const index = existing.index + 1;
		if (index >= existing.entries.length) {
			historyNavRef.current = null;
			setHistoryValue(existing.draft);
			return true;
		}
		historyNavRef.current = { ...existing, index };
		setHistoryValue(existing.entries[index]);
		return true;
	};

	const submit = async () => {
		if (disabled) return;
		const text = value.trim();
		if (!text) return;
		if (filteredSkills.length) {
			insertSkill(filteredSkills[Math.min(activeSkillIndex, filteredSkills.length - 1)].name);
			return;
		}
		if (filtered.length && !commands.some((command) => command.slash === text.split(/\s+/)[0])) {
			onValueChange(filtered[Math.min(activeIndex, filtered.length - 1)].slash);
			return;
		}
		historyNavRef.current = null;
		appendStoredComposerHistory(text);
		onValueChange("");
		if (text.startsWith("/") && (await onCommand(text))) return;
		await onSend(text);
	};

	return (
		<div className="relative p-3 bg-[#151f24] border-t border-slate-800 max-[980px]:p-2">
			{filteredSkills.length ? (
				<div className="absolute left-3 bottom-full mb-2 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-emerald-500 rounded-sm shadow-xl">
					{filteredSkills.map((skill, index) => (
						<button
							key={skill.name}
							ref={index === activeSkillIndex ? activeSkillRef : null}
							type="button"
							onClick={() => insertSkill(skill.name)}
							className={`w-full grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-left border-b border-slate-800 ${index === activeSkillIndex ? "bg-emerald-500/15" : ""}`}
						>
							<span className="font-mono text-emerald-400">${skill.name}</span>
							<span className="text-xs text-slate-400">{skill.description ?? skill.path ?? ""}</span>
						</button>
					))}
				</div>
			) : null}
			{filtered.length ? (
				<div className="absolute left-3 bottom-full mb-2 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-[#11a4d4] rounded-sm shadow-xl">
					{filtered.map((command, index) => (
						<button
							key={command.slash}
							ref={index === activeIndex ? activeCommandRef : null}
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
			<div className="grid grid-cols-[1fr_auto] items-end gap-2">
				<textarea
					ref={inputRef}
					rows={1}
					value={value}
					disabled={disabled}
					onChange={(event) => {
						historyNavRef.current = null;
						onValueChange(event.target.value);
						setCursorPos(event.target.selectionStart);
					}}
					onKeyDown={(event) => {
						if (filteredSkills.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveSkillIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filteredSkills.length : (current - 1 + filteredSkills.length) % filteredSkills.length,
							);
							return;
						}
						if (filtered.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filtered.length : (current - 1 + filtered.length) % filtered.length,
							);
							return;
						}
						if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.altKey && !event.ctrlKey && !event.metaKey) {
							if (navigateHistory(event.key === "ArrowUp" ? "previous" : "next")) {
								event.preventDefault();
								return;
							}
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
						}
					}}
					placeholder={disabled ? "Select a session to message" : "Message selected session, type / for commands or $ for skills"}
					className="h-10 min-h-10 resize-none overflow-hidden bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm leading-5 outline-none focus:border-[#11a4d4] disabled:opacity-50 [scrollbar-gutter:stable]"
				/>
				<button
					type="button"
					disabled={disabled}
					onClick={() => void submit()}
					title="Send message"
					aria-label="Send message"
					className="h-10 w-10 self-end inline-flex items-center justify-center bg-[#11a4d4] rounded-sm text-white disabled:opacity-50"
				>
					<SendHorizontal size={16} />
				</button>
			</div>
		</div>
	);
}

function resizeComposerInput(input: HTMLTextAreaElement | null) {
	if (!input) return;
	const style = window.getComputedStyle(input);
	const lineHeight = cssPx(style.lineHeight, 20);
	const borderFrame = cssPx(style.borderTopWidth) + cssPx(style.borderBottomWidth);
	const maxScrollHeight = lineHeight * 5 + cssPx(style.paddingTop) + cssPx(style.paddingBottom);

	input.style.height = "auto";
	const scrollHeight = input.scrollHeight;
	const hasOverflow = scrollHeight > maxScrollHeight;
	input.style.height = `${Math.min(scrollHeight, maxScrollHeight) + borderFrame}px`;
	input.style.overflowY = hasOverflow ? "auto" : "hidden";
	if (hasOverflow && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
		input.scrollTop = scrollHeight;
	}
}

function cssPx(value: string, fallback = 0): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function createClientTxnId(): string {
	const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
	return `web-${Date.now().toString(36)}-${randomId}`;
}

function AgentsView({
	agents,
	initialCustomAgents,
	initialCatalog,
	modelCatalog,
	onSelect,
	onCreateSession,
	onEditContextFile,
	onEditMcpServer,
	onAgentsChanged,
	creatingSession,
}: {
	agents: BootstrapData["agents"];
	initialCustomAgents: CustomAgent[];
	initialCatalog?: AgentCatalog;
	modelCatalog?: ModelCatalog;
	onSelect: (profile: string) => void;
	onCreateSession: (profile: string) => void;
	onEditContextFile: (key: string) => void;
	onEditMcpServer: (name: string) => void;
	onAgentsChanged: () => void;
	creatingSession: boolean;
}) {
	const [catalog, setCatalog] = useState<AgentCatalog | null>(initialCatalog ?? null);
	const [customAgents, setCustomAgents] = useState(initialCustomAgents);
	const [draft, setDraft] = useState<AgentDraft>(() => createBlankAgentDraft(initialCatalog));
	const [saving, setSaving] = useState(false);
	const [showArchivedAgents, setShowArchivedAgents] = useState(() => localStorage.getItem("pibo.chat.showArchivedAgents") === "true");
	const [deleteConfirmName, setDeleteConfirmName] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);
	const [newContextFileName, setNewContextFileName] = useState("");
	const [newContextFileScope, setNewContextFileScope] = useState<"global" | "agent">("agent");
	const designerAvailable = Boolean(catalog);

	useEffect(() => setCustomAgents(initialCustomAgents), [initialCustomAgents]);
	useEffect(() => {
		if (initialCatalog) setCatalog(initialCatalog);
	}, [initialCatalog]);
	const customProfileNames = useMemo(() => new Set(customAgents.map((agent) => agent.profileName)), [customAgents]);
	const pluginProfiles = useMemo(
		() => agents.filter((agent) => !customProfileNames.has(agent.name)),
		[agents, customProfileNames],
	);
	const activeCustomAgents = useMemo(() => customAgents.filter((agent) => !agent.archivedAt), [customAgents]);
	const archivedCustomAgents = useMemo(() => customAgents.filter((agent) => agent.archivedAt), [customAgents]);
	const profileOptions = useMemo(
		() => uniqueProfileOptions(agents, activeCustomAgents),
		[agents, activeCustomAgents],
	);
	const archivedDraft = Boolean(draft.archivedAt);
	const readOnly = draft.source === "profile" || archivedDraft;
	const agentNameError = readOnly ? null : validateAgentName(draft.displayName);
	const draftProfileName = draft.profileName ?? (agentNameError ? "new custom profile" : draft.displayName);
	const visibleContextFiles = useMemo(
		() => catalog?.contextFiles.filter((contextFile) => {
			if ((contextFile.scope ?? "global") !== "agent") return true;
			return contextFile.agentProfileName === draftProfileName || draft.contextFiles.includes(contextFile.key);
		}) ?? [],
		[catalog, draft.contextFiles, draftProfileName],
	);
	const nativeToolGroups = useMemo(
		() => buildNativeToolGroups(catalog?.nativeTools ?? [], draft.nativeTools),
		[catalog?.nativeTools, draft.nativeTools],
	);
	const skillGroups = useMemo(
		() => buildSkillGroups(catalog?.skills ?? [], draft.skills),
		[catalog?.skills, draft.skills],
	);
	const contextFileGroups = useMemo(
		() => buildContextFileGroups(visibleContextFiles, draft.contextFiles),
		[visibleContextFiles, draft.contextFiles],
	);

	const saveDraft = async () => {
		if (readOnly) return;
		if (agentNameError) {
			setLocalError(agentNameError);
			return;
		}
		if (!designerAvailable) {
			setLocalError(agentDesignerUnavailableMessage());
			return;
		}
		setSaving(true);
		try {
			const input: SaveCustomAgentInput = {
				displayName: draft.displayName.trim(),
				description: (draft.description ?? "").trim() || undefined,
				nativeTools: draft.nativeTools,
				skills: draft.skills,
				contextFiles: draft.contextFiles,
				subagents: draft.subagents.filter((item) => item.name.trim() && item.targetProfile.trim()),
				mcpServers: draft.mcpServers,
				piPackages: draft.piPackages,
				mainModel: draft.mainModel,
				subagentModel: draft.subagentModel,
				thinkingLevel: draft.thinkingLevel ?? null,
				builtinTools: draft.builtinTools,
				builtinToolNames: draft.builtinToolNames,
				autoContextFiles: draft.autoContextFiles,
				runControl: draft.runControl,
			};
			const response = draft.id ? await patchCustomAgent(draft.id, input) : await postCustomAgent(input);
			setCustomAgents((current) => {
				const withoutSaved = current.filter((agent) => agent.id !== response.agent.id);
				return [response.agent, ...withoutSaved];
			});
			setDraft(agentToDraft(response.agent));
			onSelect(response.agent.profileName);
			onAgentsChanged();
			setLocalError(null);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			setLocalError(isNotFoundError(message) ? agentDesignerUnavailableMessage() : message);
		} finally {
			setSaving(false);
		}
	};

	const setDraftArchived = async (archived: boolean) => {
		if (!draft.id || draft.source !== "custom") return;
		setSaving(true);
		try {
			const response = await patchCustomAgent(draft.id, { archived });
			if (archived) {
				setShowArchivedAgents(true);
				localStorage.setItem("pibo.chat.showArchivedAgents", "true");
			}
			setCustomAgents((current) => current.map((agent) => (agent.id === response.agent.id ? response.agent : agent)));
			setDraft(agentToDraft(response.agent));
			setDeleteConfirmName("");
			onAgentsChanged();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	const createContextFileForDraft = async () => {
		if (readOnly || !designerAvailable || !newContextFileName.trim()) return;
		if (agentNameError) {
			setLocalError(agentNameError);
			return;
		}
		setSaving(true);
		try {
			const response = await postContextFile({
				label: newContextFileName.trim(),
				scope: newContextFileScope,
				agentProfileName: newContextFileScope === "agent" ? draftProfileName : undefined,
				markdown: "",
			});
			const file = response.file;
			setCatalog((current) => current ? { ...current, contextFiles: [...current.contextFiles, file] } : current);
			setDraft((current) => ({
				...current,
				contextFiles: current.contextFiles.includes(file.key) ? current.contextFiles : [...current.contextFiles, file.key],
			}));
			setNewContextFileName("");
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	const deleteDraft = async () => {
		if (!draft.id || !draft.profileName || !archivedDraft) return;
		setSaving(true);
		try {
			await deleteCustomAgent(draft.id, deleteConfirmName);
			setCustomAgents((current) => current.filter((agent) => agent.id !== draft.id));
			setDraft(createBlankAgentDraft(catalog ?? undefined));
			setDeleteConfirmName("");
			onAgentsChanged();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="h-full min-h-0 overflow-hidden grid grid-cols-[300px_minmax(0,1fr)] max-[920px]:grid-cols-1">
			<aside className="border-r border-slate-800 bg-[#1a262b] min-h-0 overflow-auto">
				<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
					<span>Agents</span>
					<div className="flex items-center gap-1">
						<button type="button" onClick={() => setDraft(createBlankAgentDraft(catalog ?? undefined))} title="New Agent" aria-label="New Agent" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
							<Plus size={13} />
						</button>
						<button
							type="button"
							onClick={() => {
								const next = !showArchivedAgents;
								setShowArchivedAgents(next);
								localStorage.setItem("pibo.chat.showArchivedAgents", String(next));
							}}
							title={showArchivedAgents ? "Hide Archived Agents" : "Show Archived Agents"}
							aria-label={showArchivedAgents ? "Hide Archived Agents" : "Show Archived Agents"}
							className={`p-1 border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedAgents ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
						>
							{showArchivedAgents ? <ArchiveRestore size={13} /> : <Archive size={13} />}
						</button>
						<button type="button" onClick={onAgentsChanged} title="Refresh" aria-label="Refresh" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
							<RefreshCw size={13} />
						</button>
					</div>
				</div>
				<div className="p-2">
					<AgentList title="Custom Agents">
						{activeCustomAgents.map((agent) => (
							<AgentSidebarRow
								key={agent.id}
								title={agent.displayName}
								subtitle={agent.profileName}
								selected={draft.source === "custom" && draft.id === agent.id}
								onSelect={() => {
									setDraft(agentToDraft(agent));
									onSelect(agent.profileName);
								}}
								onCopy={() => setDraft(copyCustomAgentToDraft(agent))}
								onCreateSession={() => {
									onSelect(agent.profileName);
									onCreateSession(agent.profileName);
								}}
								createSessionDisabled={creatingSession}
							/>
						))}
						{activeCustomAgents.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No custom agents</div> : null}
					</AgentList>
					{showArchivedAgents ? (
						<AgentList title="Archived Custom Agents">
							{archivedCustomAgents.map((agent) => (
								<AgentSidebarRow
									key={agent.id}
									title={agent.displayName}
									subtitle={agent.profileName}
									selected={draft.source === "custom" && draft.id === agent.id}
									onSelect={() => {
										setDraft(agentToDraft(agent));
									}}
									onCopy={() => setDraft(copyCustomAgentToDraft(agent))}
									onCreateSession={() => {}}
									createSessionDisabled
								/>
							))}
							{archivedCustomAgents.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived agents</div> : null}
						</AgentList>
					) : null}
					<AgentList title="Read-only Profiles">
						{pluginProfiles.map((agent) => (
							<AgentSidebarRow
								key={agent.name}
								title={agent.name}
								subtitle={agent.aliases.join(", ") || "plugin"}
								selected={draft.source === "profile" && draft.profileName === agent.name}
								onSelect={() => {
									setDraft(profileToDraft(agent, catalog ?? undefined));
									onSelect(agent.name);
								}}
								onCopy={() => setDraft(copyProfileToDraft(agent, catalog ?? undefined))}
								onCreateSession={() => {
									onSelect(agent.name);
									onCreateSession(agent.name);
								}}
								createSessionDisabled={creatingSession}
							/>
						))}
					</AgentList>
				</div>
			</aside>
			<section className="min-h-0 overflow-auto p-5">
				<div className="flex items-center justify-between gap-3 mb-4">
					<div className="min-w-0">
						<h1 className="text-sm font-bold uppercase tracking-wider">Agent Designer</h1>
						<div className="font-mono text-[11px] text-slate-500 truncate">{draftProfileName}</div>
						<div className="text-[11px] uppercase tracking-wider text-slate-500">{draft.source === "profile" ? "read-only plugin profile" : archivedDraft ? "archived custom agent" : "custom agent"}</div>
					</div>
					<div className="flex items-center gap-2">
						<button type="button" onClick={() => { if (draft.profileName) { onSelect(draft.profileName); onCreateSession(draft.profileName); } }} disabled={!draft.profileName || creatingSession || archivedDraft} title="New Session With Agent" aria-label="New Session With Agent" className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							<MessageSquarePlus size={14} />
						</button>
						{draft.source === "custom" && draft.id ? (
							<button type="button" onClick={() => void setDraftArchived(!archivedDraft)} disabled={saving} title={archivedDraft ? "Restore Agent" : "Archive Agent"} aria-label={archivedDraft ? "Restore Agent" : "Archive Agent"} className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
								{archivedDraft ? <ArchiveRestore size={14} /> : <Archive size={14} />}
							</button>
						) : null}
						<button type="button" onClick={() => void saveDraft()} disabled={readOnly || !designerAvailable || saving || Boolean(agentNameError)} title="Save Agent" aria-label="Save Agent" className="h-8 w-8 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50">
							<Save size={14} />
						</button>
					</div>
				</div>
				{designerAvailable ? null : <div className="mb-3 border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">{agentDesignerUnavailableMessage()}</div>}
				{draft.source === "profile" ? <div className="mb-3 border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-sm rounded-sm">This profile is registered by a plugin. Copy it to create an editable custom agent.</div> : null}
				{archivedDraft ? <div className="mb-3 border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">This agent is archived. Restore it before editing or starting new sessions.</div> : null}
				{localError ? <div className="mb-3 border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{localError}</div> : null}
				<div className="grid gap-4">
					<DesignerPanel title="Basics">
						<input value={draft.displayName} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} className={`min-w-0 bg-[#0e1116] border rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60 ${agentNameError ? "border-[#f59e0b]" : "border-slate-700"}`} placeholder="agent-name" />
						{agentNameError ? <div className="text-xs text-amber-100">{agentNameError}</div> : null}
						<textarea value={draft.description} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px] bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="Description" />
						{draft.source === "profile" && draft.hardPinnedModel ? (
							<div className="border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-xs rounded-sm">
								This plugin profile hard-pins <span className="font-mono">{formatModelProfile(draft.hardPinnedModel)}</span>. Main-agent and subagent defaults do not apply.
							</div>
						) : null}
						<ModelSelector
							title="Main Agent Model"
							catalog={modelCatalog}
							value={draft.mainModel}
							allowUnset
							readOnly={readOnly}
							hint="Unset to use the settings default."
							emptyProviderLabel="Default"
							onChange={(mainModel) => setDraft((current) => ({ ...current, mainModel }))}
						/>
						<ModelSelector
							title="Subagent Model"
							catalog={modelCatalog}
							value={draft.subagentModel}
							allowUnset
							readOnly={readOnly}
							hint="Unset to use the settings default."
							emptyProviderLabel="Default"
							onChange={(subagentModel) => setDraft((current) => ({ ...current, subagentModel }))}
						/>
						<ThinkingLevelSelector
							title="Thinking Level"
							value={draft.thinkingLevel}
							readOnly={readOnly}
							hint="Unset to use the settings default."
							onChange={(thinkingLevel) => setDraft((current) => ({ ...current, thinkingLevel }))}
						/>
						<InlineCheckboxToggle disabled={readOnly} checked={draft.autoContextFiles} title="Load AGENTS.md / CLAUDE.md" onToggle={() => setDraft((current) => ({ ...current, autoContextFiles: !current.autoContextFiles }))} />
						<BuiltinToolsDesigner draft={draft} setDraft={setDraft} readOnly={readOnly} />
					</DesignerPanel>
					<DesignerPanel title="Tools">
						<CatalogGroupGrid
							groups={nativeToolGroups}
							empty={catalog ? <EmptyCatalog message="No native tools registered" /> : <EmptyCatalog />}
							renderItem={(tool) => (
								<CatalogToggle
									key={tool.name}
									disabled={readOnly}
									checked={draft.nativeTools.includes(tool.name)}
									title={tool.name}
									description={tool.description}
									meta={tool.yieldable ? "yieldable" : "direct only"}
									onToggle={() => setDraft((current) => ({ ...current, nativeTools: toggleName(current.nativeTools, tool.name) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<DesignerPanel title="Skills">
						<CatalogGroupGrid
							groups={skillGroups}
							empty={catalog ? <EmptyCatalog message="No skills registered" /> : <EmptyCatalog />}
							renderItem={(skill) => (
								<CatalogToggle
									key={skill.name}
									disabled={readOnly}
									checked={draft.skills.includes(skill.name)}
									title={skill.name}
									description={skill.path}
									meta={skillMeta(skill)}
									metaClass={skill.kind === "user" ? "text-amber-200" : "text-[#11a4d4]"}
									onToggle={() => setDraft((current) => ({ ...current, skills: toggleName(current.skills, skill.name) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<CatalogSection title="Packages"><CatalogToggle disabled={readOnly} checked={draft.runControl} title="pibo-run-control" description="Expose pibo_run_* as one package for yielded native tools and subagents." meta="package" onToggle={() => setDraft((current) => ({ ...current, runControl: !current.runControl }))} /></CatalogSection>
					<PiPackagesDesigner
						packages={catalog?.piPackages}
						draft={draft}
						setDraft={setDraft}
						readOnly={readOnly}
					/>
					<DesignerPanel title="Context Files">
						{draft.brokenContextFiles?.length ? (
							<div className="border border-red-500/60 bg-red-500/10 rounded-sm p-3 space-y-2">
								<div className="flex items-start gap-2 text-red-100">
									<AlertTriangle size={14} className="mt-0.5 shrink-0" />
									<div className="space-y-1">
										<div className="text-sm font-medium">This agent references missing context files.</div>
										<div className="text-xs text-red-200/90">Remove these broken links and save the agent to persist the cleanup.</div>
									</div>
								</div>
								<div className="grid gap-2">
									{draft.brokenContextFiles.map((contextFileKey) => (
										<div key={contextFileKey} className="flex items-center gap-2 border border-red-500/40 bg-[#2a1417] rounded-sm px-3 py-2">
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm text-red-100">{contextFileKey}</div>
												<div className="text-[11px] uppercase tracking-wider text-red-300/80">Broken link</div>
											</div>
											<button
												type="button"
												disabled={readOnly}
												onClick={() => setDraft((current) => ({
													...current,
													contextFiles: current.contextFiles.filter((item) => item !== contextFileKey),
													brokenContextFiles: (current.brokenContextFiles ?? []).filter((item) => item !== contextFileKey),
												}))}
												className="h-8 w-8 inline-flex items-center justify-center border border-red-500/60 rounded-sm text-red-200 hover:border-red-400 hover:text-red-100 disabled:opacity-50"
												title="Remove Broken Context File"
												aria-label="Remove Broken Context File"
											>
												<X size={14} />
											</button>
										</div>
									))}
								</div>
							</div>
						) : null}
						<div className="grid grid-cols-[1fr_auto] gap-2">
							<input value={newContextFileName} disabled={readOnly} onChange={(event) => setNewContextFileName(event.target.value)} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="New context file" />
							<button type="button" disabled={readOnly || saving || !newContextFileName.trim() || Boolean(agentNameError)} onClick={() => void createContextFileForDraft()} title="Create Context File" aria-label="Create Context File" className="h-9 w-9 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50">
								<Plus size={14} />
							</button>
						</div>
						<div className="inline-flex w-fit gap-1 border border-slate-800 bg-[#0e1116] rounded-sm p-1">
							<button type="button" disabled={readOnly} onClick={() => setNewContextFileScope("agent")} className={`px-2 py-1 text-xs rounded-sm ${newContextFileScope === "agent" ? "bg-[#11a4d4]/20 text-sky-100" : "text-slate-500 hover:text-slate-300"}`}>Agent</button>
							<button type="button" disabled={readOnly} onClick={() => setNewContextFileScope("global")} className={`px-2 py-1 text-xs rounded-sm ${newContextFileScope === "global" ? "bg-[#11a4d4]/20 text-sky-100" : "text-slate-500 hover:text-slate-300"}`}>Global</button>
						</div>
						<CatalogGroupGrid
							groups={contextFileGroups}
							empty={catalog ? <EmptyCatalog message="No context files registered" /> : <EmptyCatalog />}
							renderItem={(contextFile) => (
								<CatalogToggle
									key={contextFile.key}
									disabled={readOnly}
									checked={draft.contextFiles.includes(contextFile.key)}
									title={contextFile.label ?? contextFile.key}
									description={contextFile.path}
									meta={contextFileMeta(contextFile)}
									metaClass="text-[#11a4d4]"
									actionLabel="Edit"
									actionIcon={<Edit3 size={12} />}
									onAction={() => onEditContextFile(contextFile.key)}
									onToggle={() => setDraft((current) => ({ ...current, contextFiles: toggleName(current.contextFiles, contextFile.key) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<SubagentDesigner draft={draft} setDraft={setDraft} profileOptions={profileOptions} readOnly={readOnly} />
					<McpServersDesigner
						servers={catalog?.mcpServers}
						draft={draft}
						setDraft={setDraft}
						readOnly={readOnly}
						onEditServer={onEditMcpServer}
					/>
					{archivedDraft && draft.profileName ? (
						<DesignerPanel title="Delete Agent">
							<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
								Permanently deleting this agent also deletes all Chat sessions that use profile <span className="font-mono">{draft.profileName}</span>.
							</div>
							<input value={deleteConfirmName} onChange={(event) => setDeleteConfirmName(event.target.value)} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500" placeholder={draft.profileName} />
							<button type="button" onClick={() => void deleteDraft()} disabled={saving || deleteConfirmName !== draft.profileName} className="h-8 w-fit inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50">
								<Trash2 size={14} />
								Delete permanently
							</button>
						</DesignerPanel>
					) : null}
				</div>
			</section>
		</div>
	);
}

type AgentDraft = SaveCustomAgentInput & {
	id?: string;
	profileName?: string;
	archivedAt?: string;
	hardPinnedModel?: ModelProfile;
	thinkingLevel?: ThinkingLevel;
	brokenContextFiles?: string[];
	source: "custom" | "profile";
};

function createBlankAgentDraft(catalog?: AgentCatalog): AgentDraft {
	return {
		displayName: "new-agent",
		description: "",
		nativeTools: [],
		skills: hasBuiltinSkill(catalog, "pi-agent-harness") ? ["pi-agent-harness"] : [],
		contextFiles: [],
		subagents: [],
		mcpServers: [],
		piPackages: [],
		mainModel: undefined,
		subagentModel: undefined,
		thinkingLevel: undefined,
		builtinTools: "default",
		builtinToolNames: [...DEFAULT_BUILTIN_TOOL_NAMES],
		autoContextFiles: true,
		runControl: false,
		brokenContextFiles: [],
		hardPinnedModel: undefined,
		source: "custom",
	};
}

function agentToDraft(agent: CustomAgent): AgentDraft {
	return {
		id: agent.id,
		profileName: agent.profileName,
		displayName: agent.displayName,
		description: agent.description ?? "",
		nativeTools: agent.nativeTools,
		skills: agent.skills,
		contextFiles: agent.contextFiles,
		subagents: agent.subagents,
		mcpServers: agent.mcpServers,
		piPackages: agent.piPackages ?? [],
		mainModel: agent.mainModel,
		subagentModel: agent.subagentModel,
		thinkingLevel: agent.thinkingLevel,
		builtinTools: agent.builtinTools,
		builtinToolNames: normalizeBuiltinToolNames(agent.builtinToolNames, agent.builtinTools),
		autoContextFiles: agent.autoContextFiles ?? true,
		runControl: agent.runControl,
		brokenContextFiles: agent.brokenContextFiles ?? [],
		archivedAt: agent.archivedAt,
		hardPinnedModel: undefined,
		source: "custom",
	};
}

function profileToDraft(profile: BootstrapData["agents"][number], catalog?: AgentCatalog): AgentDraft {
	return {
		displayName: profile.name,
		description: profile.description ?? "",
		nativeTools: profile.nativeTools ?? [],
		skills: profile.skills ?? (hasBuiltinSkill(catalog, "pi-agent-harness") ? ["pi-agent-harness"] : []),
		contextFiles: profile.contextFiles ?? [],
		subagents: profile.subagents ?? [],
		mcpServers: profile.mcpServers ?? [],
		piPackages: profile.piPackages ?? [],
		mainModel: profile.mainModel ?? profile.model,
		subagentModel: profile.subagentModel ?? profile.model,
		thinkingLevel: profile.thinkingLevel,
		builtinTools: profile.builtinTools ?? "default",
		builtinToolNames: normalizeBuiltinToolNames(profile.builtinToolNames, profile.builtinTools),
		autoContextFiles: profile.autoContextFiles ?? true,
		runControl: profile.runControl ?? false,
		brokenContextFiles: [],
		hardPinnedModel: profile.model,
		profileName: profile.name,
		source: "profile",
	};
}

function copyProfileToDraft(profile: BootstrapData["agents"][number], catalog?: AgentCatalog): AgentDraft {
	const draft = profileToDraft(profile, catalog);
	return {
		...draft,
		displayName: `${profile.name}-copy`,
		id: undefined,
		hardPinnedModel: undefined,
		profileName: undefined,
		source: "custom",
	};
}

function copyCustomAgentToDraft(agent: CustomAgent): AgentDraft {
	const draft = agentToDraft(agent);
	return {
		...draft,
		displayName: `${agent.profileName}-copy`,
		id: undefined,
		profileName: undefined,
		archivedAt: undefined,
		source: "custom",
	};
}

function uniqueProfileOptions(
	agents: BootstrapData["agents"],
	customAgents: CustomAgent[],
): Array<{ value: string; label: string }> {
	const options = new Map<string, string>();
	for (const agent of agents) options.set(agent.name, agent.name);
	for (const agent of customAgents) options.set(agent.profileName, agent.displayName);
	return [...options.entries()].map(([value, label]) => ({ value, label }));
}

function validateAgentName(name: string): string | null {
	if (!name.trim()) return "Agent name is required.";
	if (name.length > 120) return "Agent name is too long.";
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
		return "Use lowercase kebab-case only, for example test-agent.";
	}
	return null;
}

function toggleName(names: string[], name: string): string[] {
	return names.includes(name) ? names.filter((item) => item !== name) : [...names, name];
}

function normalizeBuiltinToolNames(names: string[] | undefined, mode: "default" | "disabled" = "default"): string[] {
	if (mode === "disabled") return [];
	const selected = new Set(names ?? DEFAULT_BUILTIN_TOOL_NAMES);
	return DEFAULT_BUILTIN_TOOL_NAMES.filter((name) => selected.has(name));
}

type NativeToolCatalogItem = AgentCatalog["nativeTools"][number];
type ContextFileCatalogItem = AgentCatalog["contextFiles"][number];
type PiPackageCatalogItem = AgentCatalog["piPackages"][number];
type SkillCatalogItem = AgentCatalog["skills"][number];
type CatalogGroupKind = "builtin" | "plugin" | "custom" | "user";
const CODEX_COMPAT_TOOL_NAMES = new Set([
	"apply_patch",
	"web_search",
	"view_image",
]);
const DEFAULT_BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;
const BUILTIN_TOOL_DESCRIPTIONS: Record<(typeof DEFAULT_BUILTIN_TOOL_NAMES)[number], string> = {
	read: "Read workspace files.",
	bash: "Run shell commands.",
	edit: "Edit existing files.",
	write: "Create or overwrite files.",
};
type CatalogGroup<T> = {
	key: string;
	title: string;
	description: string;
	kind: CatalogGroupKind;
	items: T[];
	selectedCount: number;
	totalCount: number;
	defaultOpen: boolean;
};

function buildNativeToolGroups(tools: NativeToolCatalogItem[], selectedNames: string[]): CatalogGroup<NativeToolCatalogItem>[] {
	const selected = new Set(selectedNames);
	const groups = new Map<string, CatalogGroup<NativeToolCatalogItem>>();
	for (const tool of tools) {
		const pluginId = tool.pluginId ?? (CODEX_COMPAT_TOOL_NAMES.has(tool.name) ? "pibo.codex-compat" : undefined);
		const pluginName = tool.pluginName ?? (pluginId === "pibo.codex-compat" ? "Codex Compat" : undefined);
		const isNative = !pluginId || pluginId === "pibo.core";
		const key = isNative ? "builtin" : `plugin:${pluginId}`;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: isNative ? "Built-in Tools" : pluginDisplayName(pluginId, pluginName),
			description: isNative ? "Built-in Pibo tool catalog" : pluginId ?? "plugin",
			kind: isNative ? "builtin" : "plugin",
		});
		group.items.push(tool);
		if (selected.has(tool.name)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "plugin"]);
}

function buildSkillGroups(skills: SkillCatalogItem[], selectedNames: string[]): CatalogGroup<SkillCatalogItem>[] {
	const selected = new Set(selectedNames);
	const groups = new Map<string, CatalogGroup<SkillCatalogItem>>();
	for (const skill of skills) {
		const kind = skill.kind;
		const key = kind === "plugin" ? `plugin:${skill.pluginId ?? skill.name}` : kind;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: skillGroupTitle(skill),
			description: skillGroupDescription(skill),
			kind: skill.kind,
		});
		group.items.push(skill);
		if (selected.has(skill.name)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "plugin", "user"]);
}

function buildContextFileGroups(files: ContextFileCatalogItem[], selectedKeys: string[]): CatalogGroup<ContextFileCatalogItem>[] {
	const selected = new Set(selectedKeys);
	const groups = new Map<string, CatalogGroup<ContextFileCatalogItem>>();
	for (const file of files) {
		const isCustom = !file.pluginId;
		const key = isCustom ? "custom" : `plugin:${file.pluginId}`;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: isCustom ? "Custom" : pluginDisplayName(file.pluginId, file.pluginName),
			description: isCustom ? "Loose context files without a plugin owner" : file.pluginId ?? "plugin",
			kind: isCustom ? "custom" : "plugin",
		});
		group.items.push(file);
		if (selected.has(file.key)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["custom", "plugin"]);
}

function getOrCreateCatalogGroup<T>(
	groups: Map<string, CatalogGroup<T>>,
	key: string,
	options: Pick<CatalogGroup<T>, "title" | "description" | "kind">,
): CatalogGroup<T> {
	const existing = groups.get(key);
	if (existing) return existing;
	const created: CatalogGroup<T> = {
		key,
		title: options.title,
		description: options.description,
		kind: options.kind,
		items: [],
		selectedCount: 0,
		totalCount: 0,
		defaultOpen: false,
	};
	groups.set(key, created);
	return created;
}

function finalizeCatalogGroups<T>(
	groups: Map<string, CatalogGroup<T>>,
	kindOrder: CatalogGroupKind[],
): CatalogGroup<T>[] {
	const order = new Map(kindOrder.map((kind, index) => [kind, index]));
	const sorted = [...groups.values()].sort((left, right) => {
		const leftOrder = order.get(left.kind) ?? kindOrder.length;
		const rightOrder = order.get(right.kind) ?? kindOrder.length;
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		return left.title.localeCompare(right.title);
	});
	return sorted.map((group, index) => ({
		...group,
		defaultOpen: group.kind !== "plugin" && (group.selectedCount > 0 || (index === 0 && sorted.length === 1)),
	}));
}

function pluginDisplayName(pluginId: string | undefined, pluginName: string | undefined): string {
	if (pluginId === "pibo.codex-compat") return "Codex Compat";
	if (pluginName) return pluginName;
	if (!pluginId) return "Plugin";
	const lastSegment = pluginId.split(".").filter(Boolean).at(-1) ?? pluginId;
	return lastSegment.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function skillGroupTitle(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "Built-in Skills";
	if (skill.kind === "user") return "User Skills";
	return pluginDisplayName(skill.pluginId, skill.pluginName);
}

function skillGroupDescription(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "Pibo-owned built-in skill catalog";
	if (skill.kind === "user") return "User-managed skills";
	return skill.pluginId ?? "plugin";
}

function skillMeta(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "built-in skill";
	if (skill.kind === "user") return "user skill";
	return skill.pluginName ?? skill.pluginId ?? "plugin skill";
}

function hasBuiltinSkill(catalog: AgentCatalog | undefined, name: string): boolean {
	return catalog?.skills.some((skill) => skill.kind === "builtin" && skill.name === name) ?? false;
}

function AgentList({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="mb-4">
			<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
			{children}
		</div>
	);
}

function AgentSidebarRow({
	title,
	subtitle,
	selected,
	onSelect,
	onCopy,
	onCreateSession,
	createSessionDisabled,
}: {
	title: string;
	subtitle: string;
	selected: boolean;
	onSelect: () => void;
	onCopy?: () => void;
	onCreateSession: () => void;
	createSessionDisabled: boolean;
}) {
	return (
		<div className={`mb-1 border rounded-sm ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent hover:border-slate-700"}`}>
			<div className="grid grid-cols-[1fr_auto_auto] items-center gap-1 p-1">
				<button type="button" onClick={onSelect} className="min-w-0 text-left px-1 py-1">
					<span className="block text-sm truncate text-slate-200">{title}</span>
					<span className="block text-[10px] font-mono truncate text-slate-500">{subtitle}</span>
				</button>
				{onCopy ? (
					<button type="button" onClick={onCopy} title="Copy To Custom Agent" aria-label="Copy To Custom Agent" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						<CopyPlus size={13} />
					</button>
				) : (
					<span className="h-7 w-7" />
				)}
				<button type="button" onClick={onCreateSession} disabled={createSessionDisabled} title="New Session With Profile" aria-label="New Session With Profile" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
					<MessageSquarePlus size={13} />
				</button>
			</div>
		</div>
	);
}

function SettingsSidebar({
	activePanel,
	onSelect,
	piPackageCount,
	userSkillCount,
}: {
	activePanel: SettingsPanel;
	onSelect: (panel: SettingsPanel) => void;
	piPackageCount: number;
	userSkillCount: number;
}) {
	return (
		<div className="p-2">
			<div className="mb-4">
				<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Settings</div>
				<button
					type="button"
					onClick={() => onSelect("general")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "general"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Settings size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">General</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">browser + runtime</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("pi-packages")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "pi-packages"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Layers size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Pi Packages</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">runtime-packages</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{piPackageCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("skills")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "skills"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Wrench size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Skills</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">user-managed</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{userSkillCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("providers")}
					className={`flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "providers"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Key size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Providers</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">auth + api keys</span>
					</div>
				</button>
			</div>
		</div>
	);
}

function ContextSidebar({
	activePanel,
	onSelect,
	toolCount,
	mcpServerCount,
}: {
	activePanel: ContextPanel;
	onSelect: Dispatch<SetStateAction<ContextPanel>>;
	toolCount: number;
	mcpServerCount: number;
}) {
	return (
		<div className="p-2">
			<div className="mb-4">
				<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Context</div>
				<button
					type="button"
					onClick={() => onSelect("context-files")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "context-files"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Layers size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Context Files</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">managed-editor</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("base-prompt")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "base-prompt"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<BookOpenText size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Base Prompt</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">system-prompt</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("compaction-prompt")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "compaction-prompt"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Brain size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Compaction Prompt</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">summary-prompt</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("pibo-tools")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "pibo-tools"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Wrench size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Pibo Tools</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">installed-tool-context</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{toolCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("mcp-tools")}
					className={`flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "mcp-tools"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Server size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">MCP Tools</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">mcp-context</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{mcpServerCount}
					</span>
				</button>
			</div>
		</div>
	);
}

function DesignerPanel({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="border border-slate-700 bg-[#1a262b] rounded-sm p-4">
			<div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{title}</div>
			<div className="grid gap-3">{children}</div>
		</div>
	);
}

function CatalogSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<DesignerPanel title={title}>
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">{children}</div>
		</DesignerPanel>
	);
}

function CatalogGroupGrid<T>({
	groups,
	empty,
	renderItem,
}: {
	groups: CatalogGroup<T>[];
	empty: ReactNode;
	renderItem: (item: T) => ReactNode;
}) {
	if (groups.length === 0) return <>{empty}</>;
	return (
		<div className="grid gap-2">
			{groups.map((group) => (
				<CatalogGroupCard key={group.key} group={group} renderItem={renderItem} />
			))}
		</div>
	);
}

function CatalogGroupCard<T>({
	group,
	renderItem,
}: {
	group: CatalogGroup<T>;
	renderItem: (item: T) => ReactNode;
}) {
	const [open, setOpen] = useState(group.defaultOpen);
	const accentClass = group.kind === "custom" || group.kind === "user"
		? "border-[#f59e0b]/70 text-amber-100 bg-[#f59e0b]/10"
		: "border-[#11a4d4]/70 text-sky-100 bg-[#11a4d4]/10";
	return (
		<div className={`border rounded-sm ${open ? "border-slate-700 bg-[#101d22]" : "border-slate-800 bg-[#151f24] hover:border-slate-700"}`}>
			<button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-2 p-2 text-left">
				<span className={`h-6 w-6 shrink-0 inline-flex items-center justify-center border rounded-sm ${accentClass}`}>
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-slate-100">{group.title}</span>
					<span className="block truncate font-mono text-[10px] text-slate-500">{group.description}</span>
				</span>
				<span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums" aria-label={`${group.selectedCount} of ${group.totalCount} selected`}>
					<span className="text-[#11a4d4]">{group.selectedCount}</span>
					<span className="text-slate-500">/{group.totalCount}</span>
				</span>
			</button>
			{open ? (
				<div className="border-t border-slate-800 p-2">
					<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">{group.items.map(renderItem)}</div>
				</div>
			) : null}
		</div>
	);
}

function CatalogToggle({
	checked,
	disabled,
	title,
	description,
	meta,
	metaClass,
	actionLabel,
	actionIcon,
	actionDisabled,
	onAction,
	onToggle,
}: {
	checked: boolean;
	disabled?: boolean;
	title: string;
	description?: string;
	meta?: string;
	metaClass?: string;
	actionLabel?: string;
	actionIcon?: ReactNode;
	actionDisabled?: boolean;
	onAction?: () => void;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={() => {
				if (!disabled) onToggle();
			}}
			aria-disabled={disabled}
			className={`min-w-0 border rounded-sm p-2 text-left grid grid-cols-[18px_1fr] gap-2 ${disabled && !onAction ? "opacity-60" : ""} ${
				checked ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24] hover:border-slate-700"
			}`}
		>
			<SelectionCheckbox checked={checked} className="mt-0.5" />
			<span className="min-w-0">
				<span className="flex items-start justify-between gap-2">
					<span className="min-w-0 flex-1">
						<span className="block text-sm truncate text-slate-200">{title}</span>
					</span>
					{actionLabel && onAction ? (
						<span className="shrink-0">
							<span
								role="button"
								tabIndex={0}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									if (!actionDisabled) onAction();
								}}
								onKeyDown={(event) => {
									if ((event.key === "Enter" || event.key === " ") && !actionDisabled) {
										event.preventDefault();
										event.stopPropagation();
										onAction();
									}
								}}
								className={`inline-flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] uppercase tracking-wider ${
									actionDisabled
										? "border-slate-800 text-slate-600"
										: "border-[#11a4d4]/70 text-[#7dd3fc] hover:border-[#11a4d4] hover:text-sky-100"
								}`}
							>
								{actionIcon}
								{actionLabel}
							</span>
						</span>
					) : null}
				</span>
				{description ? <span className="block text-xs text-slate-500 truncate">{description}</span> : null}
				{meta ? <span className={`block font-mono text-[10px] mt-1 ${metaClass ?? "text-slate-600"}`}>{meta}</span> : null}
			</span>
		</button>
	);
}

function PiPackagesDesigner({
	packages,
	draft,
	setDraft,
	readOnly,
}: {
	packages?: PiPackageCatalogItem[];
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
}) {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const allPackages = packages ?? [];
	const packageList = allPackages.filter(isSelectablePiPackage);
	const selectedCount = packageList.filter((pkg) => isPiPackageSelected(draft.piPackages, pkg)).length;

	const toggleExpanded = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<DesignerPanel title="Pi Packages">
			<div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
				{packageList.length} available / {selectedCount} selected / {allPackages.length} registered
			</div>
			{packages ? (
				packageList.length ? (
					<div className="grid gap-2">
						{packageList.map((pkg) => (
							<PiPackageCard
								key={pkg.id}
								pkg={pkg}
								selected={isPiPackageSelected(draft.piPackages, pkg)}
								readOnly={readOnly}
								expanded={expanded.has(pkg.id)}
								busy={false}
								onToggleSelected={() => {
									if (!readOnly) {
										setDraft((current) => ({ ...current, piPackages: togglePiPackageSelection(current.piPackages, pkg) }));
									}
								}}
								onToggleExpanded={() => toggleExpanded(pkg.id)}
							/>
						))}
					</div>
				) : <EmptyCatalog message="No installed and enabled Pi packages available. Manage Pi Packages in Settings." />
			) : <EmptyCatalog />}
		</DesignerPanel>
	);
}

function PiPackageCard({
	pkg,
	selected,
	readOnly,
	expanded,
	busy,
	onToggleSelected,
	onToggleExpanded,
	onToggleEnabled,
	onUnregister,
}: {
	pkg: PiPackageCatalogItem;
	selected: boolean;
	readOnly: boolean;
	expanded: boolean;
	busy: boolean;
	onToggleSelected: () => void;
	onToggleExpanded: () => void;
	onToggleEnabled?: () => void;
	onUnregister?: () => void;
}) {
	const hasErrors = pkg.diagnostics.some((diagnostic) => diagnostic.type === "error");
	const selectable = !readOnly && (pkg.enabled || selected);
	return (
		<div className={`border rounded-sm ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24]"} ${!pkg.enabled ? "opacity-75" : ""}`}>
			<div className="grid grid-cols-[1fr_auto] gap-2 p-2">
				<button type="button" disabled={!selectable} onClick={onToggleSelected} className="min-w-0 grid grid-cols-[18px_1fr] gap-2 text-left disabled:cursor-not-allowed">
					<SelectionCheckbox checked={selected} disabled={!selectable} className="mt-0.5" />
					<span className="min-w-0">
						<span className="flex items-center gap-2">
							<span className="min-w-0 truncate text-sm text-slate-200">{pkg.name}</span>
							<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${pkg.enabled ? "border-[#11a4d4]/60 text-[#7dd3fc]" : "border-slate-700 text-slate-500"}`}>{pkg.enabled ? "enabled" : "disabled"}</span>
						</span>
						<span className="block text-xs text-slate-500 truncate">{pkg.description ?? pkg.source}</span>
						<span className={`block font-mono text-[10px] mt-1 ${hasErrors ? "text-[#f59e0b]" : "text-[#11a4d4]"}`}>{piPackageMeta(pkg)}</span>
					</span>
				</button>
				<div className="flex items-start gap-1">
					<button type="button" onClick={onToggleExpanded} title={expanded ? "Hide Details" : "Show Details"} aria-label={expanded ? "Hide Details" : "Show Details"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					</button>
					{onToggleEnabled ? (
						<button type="button" disabled={busy} onClick={onToggleEnabled} title={pkg.enabled ? "Disable Package" : "Enable Package"} aria-label={pkg.enabled ? "Disable Package" : "Enable Package"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							{pkg.enabled ? <PowerOff size={13} /> : <Power size={13} />}
						</button>
					) : null}
					{onUnregister ? (
						<button type="button" disabled={busy} onClick={onUnregister} title="Unregister Package" aria-label="Unregister Package" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-400 hover:text-red-300 disabled:opacity-50">
							<Trash2 size={13} />
						</button>
					) : null}
				</div>
			</div>
			{expanded ? <PiPackageDetails pkg={pkg} /> : null}
		</div>
	);
}

function PiPackageDetails({ pkg }: { pkg: PiPackageCatalogItem }) {
	return (
		<div className="border-t border-slate-800 p-3 grid gap-3 text-xs text-slate-300">
			<PackageDetailGrid rows={[
				["Source", pkg.source],
				["Install", pkg.installSpec],
				["Version", pkg.version],
				["Added", pkg.addedAt],
				["Updated", pkg.updatedAt],
			]} />
			{pkg.repositoryUrl ? (
				<a href={pkg.repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-[#7dd3fc] hover:text-sky-100">
					<ExternalLink size={12} />
					Source repository
				</a>
			) : null}
			<PackageResourceList title="Extensions" values={pkg.extensionPaths} />
			<PackageResourceList title="Skills" values={pkg.skillNames} />
			<PackageResourceList title="Prompts" values={pkg.promptNames} />
			<PackageResourceList title="Themes" values={pkg.themeNames} />
			<PackageResourceList title="Tools" values={pkg.discoveredToolNames} />
			{pkg.diagnostics.length ? (
				<div className="grid gap-1">
					<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Diagnostics</div>
					{pkg.diagnostics.map((diagnostic, index) => (
						<div key={`${diagnostic.type}:${index}`} className={`border px-2 py-1 rounded-sm ${diagnostic.type === "error" ? "border-red-500/50 text-red-200 bg-red-500/10" : diagnostic.type === "warning" ? "border-[#f59e0b]/50 text-amber-100 bg-[#f59e0b]/10" : "border-slate-700 text-slate-400 bg-[#0e1116]"}`}>
							<span className="font-mono uppercase text-[10px] mr-2">{diagnostic.type}</span>
							{diagnostic.message}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function PackageDetailGrid({ rows }: { rows: Array<[string, string | undefined]> }) {
	const visibleRows = rows.filter(([, value]) => value);
	if (visibleRows.length === 0) return null;
	return (
		<div className="grid gap-1">
			{visibleRows.map(([label, value]) => (
				<div key={label} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
					<span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
					<span className="min-w-0 break-all font-mono text-[11px] text-slate-300">{value}</span>
				</div>
			))}
		</div>
	);
}

function PackageResourceList({ title, values }: { title: string; values?: string[] }) {
	if (!values?.length) return null;
	return (
		<div className="grid gap-1">
			<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
			<div className="flex flex-wrap gap-1">
				{values.map((value) => <span key={value} className="max-w-full break-all border border-slate-700 bg-[#0e1116] px-2 py-1 font-mono text-[11px] text-slate-300 rounded-sm">{value}</span>)}
			</div>
		</div>
	);
}

function BuiltinToolsDesigner({
	draft,
	setDraft,
	readOnly,
}: {
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
}) {
	const selectedTools = normalizeBuiltinToolNames(draft.builtinToolNames, draft.builtinTools);
	const [open, setOpen] = useState(selectedTools.length !== DEFAULT_BUILTIN_TOOL_NAMES.length);
	const toggleBuiltinTool = (name: string) => {
		setDraft((current) => {
			const currentSelection = normalizeBuiltinToolNames(current.builtinToolNames, current.builtinTools);
			const nextSelection = toggleName(currentSelection, name);
			return {
				...current,
				builtinTools: nextSelection.length === 0 ? "disabled" : "default",
				builtinToolNames: nextSelection,
			};
		});
	};

	return (
		<div className={`border rounded-sm ${open ? "border-slate-700 bg-[#101d22]" : "border-slate-800 bg-[#151f24] hover:border-slate-700"}`}>
			<button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-2 p-2 text-left">
				<span className="h-6 w-6 shrink-0 inline-flex items-center justify-center border rounded-sm border-[#11a4d4]/70 text-sky-100 bg-[#11a4d4]/10">
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-slate-100">Pi Built-in Tools</span>
					<span className="block truncate font-mono text-[10px] text-slate-500">basic model tools</span>
				</span>
				<span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums" aria-label={`${selectedTools.length} of ${DEFAULT_BUILTIN_TOOL_NAMES.length} enabled`}>
					<span className="text-[#11a4d4]">{selectedTools.length}</span>
					<span className="text-slate-500">/{DEFAULT_BUILTIN_TOOL_NAMES.length}</span>
				</span>
			</button>
			{open ? (
				<div className="border-t border-slate-800 p-2">
					<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
						{DEFAULT_BUILTIN_TOOL_NAMES.map((toolName) => (
							<CatalogToggle
								key={toolName}
								disabled={readOnly}
								checked={selectedTools.includes(toolName)}
								title={toolName}
								description={BUILTIN_TOOL_DESCRIPTIONS[toolName]}
								meta="built-in"
								onToggle={() => toggleBuiltinTool(toolName)}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function InlineCheckboxToggle({
	checked,
	disabled,
	title,
	onToggle,
}: {
	checked: boolean;
	disabled?: boolean;
	title: string;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			aria-pressed={checked}
			onClick={onToggle}
			className="inline-flex w-fit items-center gap-2 text-left text-sm text-slate-300 hover:text-slate-100 disabled:opacity-60"
		>
			<SelectionCheckbox checked={checked} disabled={disabled} />
			<span>{title}</span>
		</button>
	);
}

function SelectionCheckbox({
	checked,
	disabled,
	className = "",
}: {
	checked: boolean;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<span className={`h-4 w-4 shrink-0 border rounded-sm inline-flex items-center justify-center ${checked ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-600 text-transparent"} ${disabled ? "opacity-70" : ""} ${className}`}>
			{checked ? <Check size={12} /> : null}
		</span>
	);
}

function contextFileMeta(contextFile: AgentCatalog["contextFiles"][number]): string {
	const source = contextFile.source ?? "plugin";
	const scope = contextFile.scope ?? "global";
	if (source === "plugin") return "plugin global";
	if (scope === "agent") return contextFile.agentProfileName ? `agent ${contextFile.agentProfileName}` : "agent local";
	return "managed global";
}

function isPiPackageSelected(selected: string[], pkg: PiPackageCatalogItem): boolean {
	return selected.includes(pkg.id) || selected.includes(pkg.name);
}

function togglePiPackageSelection(selected: string[], pkg: PiPackageCatalogItem): string[] {
	if (isPiPackageSelected(selected, pkg)) return selected.filter((name) => name !== pkg.id && name !== pkg.name);
	return [...selected, pkg.id];
}

function isSelectablePiPackage(pkg: PiPackageCatalogItem): boolean {
	return pkg.enabled && pkg.installStatus === "installed";
}

function piPackageMeta(pkg: AgentCatalog["piPackages"][number]): string {
	const resources = pkg.resourceTypes.length ? pkg.resourceTypes.join(" + ") : "resources pending";
	const version = pkg.version ? `v${pkg.version}` : pkg.installStatus;
	const diagnostics = pkg.diagnostics.some((diagnostic) => diagnostic.type === "error") ? " / needs attention" : "";
	const enabled = pkg.enabled ? "enabled" : "disabled";
	return `${resources} / ${version} / ${enabled}${diagnostics}`;
}

function EmptyCatalog({ message = "Agent Designer API unavailable" }: { message?: string }) {
	return <div className="text-xs text-amber-100 border border-dashed border-[#f59e0b]/50 bg-[#f59e0b]/10 rounded-sm p-3">{message}</div>;
}

function agentDesignerUnavailableMessage(): string {
	return "Agent Designer API unavailable. Restart the Pibo web gateway after pulling/building the latest backend.";
}

function isNotFoundError(message: string): boolean {
	return message.toLowerCase().includes("not found") || message.includes("404");
}

function SubagentDesigner({
	draft,
	setDraft,
	profileOptions,
	readOnly,
}: {
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	profileOptions: Array<{ value: string; label: string }>;
	readOnly: boolean;
}) {
	const updateSubagent = (index: number, patch: Partial<CustomAgentSubagent>) => {
		setDraft((current) => ({
			...current,
			subagents: current.subagents.map((subagent, itemIndex) => itemIndex === index ? { ...subagent, ...patch } : subagent),
		}));
	};

	return (
		<DesignerPanel title="Subagents">
			<div className="flex justify-end">
				<button
					type="button"
					disabled={readOnly}
					onClick={() => setDraft((current) => ({
						...current,
						subagents: [...current.subagents, { name: "helper", targetProfile: profileOptions[0]?.value ?? "codex-compat-openai-web", maxDepth: 3 }],
					}))}
					className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					title="Add Subagent"
					aria-label="Add Subagent"
				>
					<Plus size={13} />
				</button>
			</div>
			<div className="grid gap-2">
				{draft.subagents.map((subagent, index) => (
					<div key={index} className="grid grid-cols-[1fr_1fr_80px_auto] max-[1100px]:grid-cols-1 gap-2 border border-slate-800 bg-[#151f24] p-2 rounded-sm">
						<input value={subagent.name} disabled={readOnly} onChange={(event) => updateSubagent(index, { name: event.target.value })} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="name" />
						<select value={subagent.targetProfile} disabled={readOnly} onChange={(event) => updateSubagent(index, { targetProfile: event.target.value })} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60">
							{profileOptions.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
						</select>
						<input type="number" min={1} disabled={readOnly} value={subagent.maxDepth ?? 3} onChange={(event) => updateSubagent(index, { maxDepth: Number(event.target.value) || 1 })} className="bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" />
						<button type="button" disabled={readOnly} onClick={() => setDraft((current) => ({ ...current, subagents: current.subagents.filter((_, itemIndex) => itemIndex !== index) }))} className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-500 hover:text-red-300 disabled:opacity-50" title="Remove Subagent" aria-label="Remove Subagent">
							<X size={14} />
						</button>
					</div>
				))}
				{draft.subagents.length === 0 ? <div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">No subagents configured</div> : null}
			</div>
		</DesignerPanel>
	);
}

function McpServersDesigner({
	servers,
	draft,
	setDraft,
	readOnly,
	onEditServer,
}: {
	servers?: AgentCatalog["mcpServers"];
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
	onEditServer: (serverName: string) => void;
}) {
	return (
		<DesignerPanel title="MCP Servers">
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
				{servers ? servers.map((server) => {
					const selectionDisabled = readOnly || !server.hasDescription;
					return (
						<div key={server.name} className={`border rounded-sm bg-[#151f24] p-2 ${draft.mcpServers.includes(server.name) ? "border-[#11a4d4]" : server.hasDescription ? "border-slate-800" : "border-[#f59e0b]/60"}`}>
							<button
								type="button"
								disabled={selectionDisabled}
								onClick={() => setDraft((current) => ({ ...current, mcpServers: toggleName(current.mcpServers, server.name) }))}
								className="grid w-full min-w-0 grid-cols-[18px_1fr] gap-2 text-left disabled:opacity-60"
							>
								<SelectionCheckbox checked={draft.mcpServers.includes(server.name)} disabled={selectionDisabled} className="mt-0.5" />
								<span className="min-w-0">
									<span className="flex items-center gap-2">
										<Server size={13} className="text-[#11a4d4]" />
										<span className="block text-sm truncate text-slate-200">{server.name}</span>
									</span>
									<span className="block font-mono text-[10px] mt-1 text-slate-600">
										{server.transport}{server.descriptionSource ? ` / ${server.descriptionSource}` : ""}
									</span>
								</span>
							</button>
							{server.hasDescription ? (
								<div className="mt-2 text-xs text-slate-400">{server.description}</div>
							) : (
								<div className="mt-2 flex items-center gap-2 text-xs text-amber-100">
									<AlertTriangle size={13} />
									Missing agent description
								</div>
							)}
							<div className="mt-2 flex justify-end">
								<button
									type="button"
									onClick={() => onEditServer(server.name)}
									title="Edit MCP Tool Context"
									aria-label="Edit MCP Tool Context"
									className="inline-flex h-6 items-center justify-center gap-1 border border-[#11a4d4]/70 px-1.5 text-[10px] uppercase tracking-wider text-[#7dd3fc] hover:border-[#11a4d4] hover:text-sky-100"
								>
									<Edit3 size={12} />
									Edit
								</button>
							</div>
						</div>
					);
				}) : <EmptyCatalog />}
				{servers && servers.length === 0 ? <div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">No MCP servers configured</div> : null}
			</div>
		</DesignerPanel>
	);
}

import { ProviderSettingsView } from "./settings/ProviderSettingsView";

function SettingsView({
	activePanel,
	showThinking,
	setShowThinking,
	expandThinking,
	setExpandThinking,
	modelDefaults,
	modelCatalog,
	onModelDefaultsChanged,
	piPackages,
	onPiPackageChanged,
	onPiPackageRemoved,
	userSkills,
	onUserSkillChanged,
	onUserSkillRemoved,
	piboSessionId,
}: {
	activePanel: SettingsPanel;
	showThinking: boolean;
	setShowThinking: (value: boolean) => void;
	expandThinking: boolean;
	setExpandThinking: (value: boolean) => void;
	modelDefaults?: ModelDefaults;
	modelCatalog?: ModelCatalog;
	onModelDefaultsChanged: (value: ModelDefaults) => void;
	piPackages?: PiPackageCatalogItem[];
	onPiPackageChanged: (pkg: PiPackageCatalogItem) => void;
	onPiPackageRemoved: (pkg: PiPackageCatalogItem) => void;
	userSkills?: UserSkill[];
	onUserSkillChanged: (skill: UserSkill) => void;
	onUserSkillRemoved: (skillId: string) => void;
	piboSessionId?: string | null;
}) {
	if (activePanel === "pi-packages") {
		return (
			<div className="p-6 overflow-auto">
				<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
					<Layers size={16} />
					Pi Packages
				</h1>
				<PiPackagesSettings packages={piPackages} onPackageChanged={onPiPackageChanged} onPackageRemoved={onPiPackageRemoved} />
			</div>
		);
	}

	if (activePanel === "skills") {
		return (
			<div className="overflow-auto p-6 max-[640px]:p-3">
				<h1 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
					<Wrench size={16} />
					Skills
				</h1>
				<UserSkillsSettings skills={userSkills} onSkillChanged={onUserSkillChanged} onSkillRemoved={onUserSkillRemoved} />
			</div>
		);
	}

	if (activePanel === "providers") {
		return (
			<div className="p-6 overflow-auto">
				<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
					<Key size={16} />
					Providers
				</h1>
				<ProviderSettingsView piboSessionId={piboSessionId} />
			</div>
		);
	}

	return (
		<div className="p-6 overflow-auto">
			<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
				<Settings size={16} />
				General
			</h1>
			<DesignerPanel title="General">
				<InlineCheckboxToggle
					checked={showThinking}
					title="Show thinking blocks"
					onToggle={() => {
						const next = !showThinking;
						setShowThinking(next);
						localStorage.setItem("pibo.chat.showThinking", String(next));
					}}
				/>
				<InlineCheckboxToggle
					checked={expandThinking}
					disabled={!showThinking}
					title="Expand thinking blocks"
					onToggle={() => {
						const next = !expandThinking;
						setExpandThinking(next);
						localStorage.setItem("pibo.chat.expandThinking", String(next));
					}}
				/>
				<ModelDefaultsSettings
					modelDefaults={modelDefaults}
					modelCatalog={modelCatalog}
					onChanged={onModelDefaultsChanged}
				/>
			</DesignerPanel>
		</div>
	);
}

function ModelDefaultsSettings({
	modelDefaults,
	modelCatalog,
	onChanged,
}: {
	modelDefaults?: ModelDefaults;
	modelCatalog?: ModelCatalog;
	onChanged: (value: ModelDefaults) => void;
}) {
	const [draft, setDraft] = useState<ModelDefaults>(modelDefaults ?? {});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setDraft(modelDefaults ?? {});
	}, [modelDefaults]);

	const save = async (next: ModelDefaults) => {
		setDraft(next);
		setSaving(true);
		try {
			const saved = await patchModelDefaults(next);
			onChanged(saved);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="grid gap-3 border-t border-slate-800 pt-3">
			<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Runtime Model Defaults</div>
			<ModelSelector
				title="Main Agent Default"
				catalog={modelCatalog}
				value={draft.main}
				allowUnset
				readOnly={saving}
				hint="Unset to use provider fallback."
				configuredProvidersOnly
				onChange={(main) => void save({ ...draft, main })}
			/>
			<ModelSelector
				title="Subagent Default"
				catalog={modelCatalog}
				value={draft.subagent}
				allowUnset
				readOnly={saving}
				hint="Unset to use provider fallback."
				configuredProvidersOnly
				onChange={(subagent) => void save({ ...draft, subagent })}
			/>
			<ThinkingLevelSelector
				title="Default Thinking Level"
				value={draft.thinking}
				readOnly={saving}
				hint="Unset to use the provider/runtime fallback."
				onChange={(thinking) => void save({ ...draft, thinking })}
			/>
			{error ? <div className="text-xs text-amber-100">{error}</div> : null}
		</div>
	);
}

function ThinkingLevelSelector({
	title,
	value,
	readOnly,
	hint,
	onChange,
}: {
	title: string;
	value?: ThinkingLevel;
	readOnly: boolean;
	hint?: string;
	onChange: (value: ThinkingLevel | undefined) => void;
}) {
	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
				<button
					type="button"
					disabled={readOnly || !value}
					onClick={() => onChange(undefined)}
					className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 disabled:opacity-50"
				>
					Unset
				</button>
			</div>
			{hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
			<select
				value={value ?? ""}
				disabled={readOnly}
				onChange={(event) => onChange(event.target.value ? (event.target.value as ThinkingLevel) : undefined)}
				className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
			>
				<option value="">Default</option>
				{THINKING_LEVELS.map((level) => (
					<option key={level} value={level}>{level}</option>
				))}
			</select>
		</div>
	);
}

function ModelSelector({
	title,
	catalog,
	value,
	allowUnset,
	readOnly,
	hint,
	emptyProviderLabel = "Select provider",
	configuredProvidersOnly = false,
	onChange,
}: {
	title: string;
	catalog?: ModelCatalog;
	value?: ModelProfile;
	allowUnset: boolean;
	readOnly: boolean;
	hint?: string;
	emptyProviderLabel?: string;
	configuredProvidersOnly?: boolean;
	onChange: (value: ModelProfile | undefined) => void;
}) {
	const [providerId, setProviderId] = useState(value?.provider ?? "");
	const [modelId, setModelId] = useState(value?.id ?? "");
	const catalogProviders = catalog?.providers ?? [];
	const providers = catalogProviders.filter((provider) => !configuredProvidersOnly || provider.authConfigured);
	const selectedProvider = providers.find((provider) => provider.id === providerId);
	const unconfiguredSelectedProvider = configuredProvidersOnly
		? catalogProviders.find((provider) => provider.id === providerId && !provider.authConfigured)
		: undefined;
	const hasStaleProvider = Boolean(providerId) && !selectedProvider;
	const staleProviderLabel = hasStaleProvider
		? unconfiguredSelectedProvider
			? `${unconfiguredSelectedProvider.label} (not configured)`
			: `${providerId} (unknown provider)`
		: "";
	const selectedModel = selectedProvider?.models.find((model) => model.id === modelId);
	const hasStaleModel = Boolean(providerId && modelId && selectedProvider && !selectedModel);
	const providerModels = selectedProvider?.models ?? [];
	const providerAuthConfigured = selectedProvider?.authConfigured;

	useEffect(() => {
		setProviderId(value?.provider ?? "");
		setModelId(value?.id ?? "");
	}, [value?.id, value?.provider]);

	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
				{allowUnset ? (
					<button
						type="button"
						disabled={readOnly || (!providerId && !modelId)}
						onClick={() => {
							setProviderId("");
							setModelId("");
							onChange(undefined);
						}}
						className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 disabled:opacity-50"
					>
						Unset
					</button>
				) : null}
			</div>
			{hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
			{providers.length === 0 ? (
				<div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">
					{catalogProviders.length === 0
						? "Model catalog unavailable."
						: "No configured providers. Configure a provider under Settings > Providers."}
				</div>
			) : null}
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
				<select
					value={providerId}
					disabled={readOnly}
					onChange={(event) => {
						const nextProviderId = event.target.value;
						setProviderId(nextProviderId);
						setModelId("");
					}}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
				>
					<option value="">{emptyProviderLabel}</option>
					{providers.map((provider) => (
						<option key={provider.id} value={provider.id}>
							{provider.label}
						</option>
					))}
					{hasStaleProvider ? <option value={providerId}>{staleProviderLabel}</option> : null}
				</select>
				<select
					value={modelId}
					disabled={readOnly}
					onChange={(event) => {
						const nextModelId = event.target.value;
						setModelId(nextModelId);
						if (providerId && nextModelId) onChange({ provider: providerId, id: nextModelId });
					}}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
				>
					<option value="">{providerId ? "Select model" : "Select provider first"}</option>
					{providerModels.map((model) => (
						<option key={model.id} value={model.id}>
							{model.label}
						</option>
					))}
					{hasStaleModel ? <option value={modelId}>{`${modelId} (unknown model)`}</option> : null}
				</select>
			</div>
			{providerId ? (
				<div className="text-xs text-slate-500">
					{hasStaleProvider
						? unconfiguredSelectedProvider
							? "Stored provider is no longer configured."
							: "Stored provider is no longer present in the catalog."
						: providerAuthConfigured
							? "Provider auth configured."
							: "Provider auth missing."}
				</div>
			) : null}
			{hasStaleModel ? <div className="text-xs text-amber-100">Stored model is no longer present in the catalog.</div> : null}
		</div>
	);
}

function formatModelProfile(model: ModelProfile): string {
	return `${model.provider}/${model.id}`;
}

function PiPackagesSettings({
	packages,
	onPackageChanged,
	onPackageRemoved,
}: {
	packages?: PiPackageCatalogItem[];
	onPackageChanged: (pkg: PiPackageCatalogItem) => void;
	onPackageRemoved: (pkg: PiPackageCatalogItem) => void;
}) {
	const [source, setSource] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const packageList = packages ?? [];
	const installedCount = packageList.filter((pkg) => pkg.installStatus === "installed").length;
	const enabledCount = packageList.filter((pkg) => pkg.enabled).length;

	const addPackage = async () => {
		if (busy) return;
		setBusy("add");
		try {
			const pkg = await postPiPackage(source);
			onPackageChanged(pkg);
			setSource("");
			setExpanded((current) => new Set(current).add(pkg.id));
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const toggleEnabled = async (pkg: PiPackageCatalogItem) => {
		if (busy) return;
		setBusy(`${pkg.id}:enabled`);
		try {
			const next = await patchPiPackage(pkg.id, { enabled: !pkg.enabled });
			onPackageChanged(next);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const unregisterPackage = async (pkg: PiPackageCatalogItem) => {
		if (busy) return;
		if (!window.confirm(`Unregister Pi package "${pkg.name}"?`)) return;
		setBusy(`${pkg.id}:delete`);
		try {
			const removed = await deletePiPackage(pkg.id);
			onPackageRemoved(removed);
			setExpanded((current) => {
				const next = new Set(current);
				next.delete(pkg.id);
				return next;
			});
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const toggleExpanded = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<DesignerPanel title="Pi Package Management">
			<div className="grid gap-2">
				<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
					<input
						value={source}
						disabled={!packages || busy === "add"}
						onChange={(event) => setSource(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
						placeholder="https://pi.dev/packages/package-name"
					/>
					<button type="button" disabled={!packages || busy === "add" || !source.trim()} onClick={() => void addPackage()} title="Add Pi Package" aria-label="Add Pi Package" className="h-9 w-9 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50">
						<Plus size={14} />
					</button>
				</div>
				<div className="text-[11px] text-slate-500">Extensions execute code in the Pi runtime. Review package source before adding it.</div>
				{error ? <div className="border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{error}</div> : null}
				<div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
					{packageList.length} registered / {installedCount} installed / {enabledCount} enabled
				</div>
			</div>
			{packages ? (
				packageList.length ? (
					<div className="grid gap-2">
						{packageList.map((pkg) => (
							<PiPackageManagementCard
								key={pkg.id}
								pkg={pkg}
								expanded={expanded.has(pkg.id)}
								busy={busy?.startsWith(`${pkg.id}:`) ?? false}
								onToggleExpanded={() => toggleExpanded(pkg.id)}
								onToggleEnabled={() => void toggleEnabled(pkg)}
								onUnregister={() => void unregisterPackage(pkg)}
							/>
						))}
					</div>
				) : <EmptyCatalog message="No Pi packages registered" />
			) : <EmptyCatalog />}
		</DesignerPanel>
	);
}

function UserSkillsSettings({
	skills,
	onSkillChanged,
	onSkillRemoved,
}: {
	skills?: UserSkill[];
	onSkillChanged: (skill: UserSkill) => void;
	onSkillRemoved: (skillId: string) => void;
}) {
	const [createOpen, setCreateOpen] = useState(false);
	const [installOpen, setInstallOpen] = useState(false);
	const [editSkill, setEditSkill] = useState<UserSkill | null>(null);
	const [editMarkdown, setEditMarkdown] = useState<string>("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const skillList = skills ?? [];
	const enabledCount = skillList.filter((s) => s.enabled).length;

	const toggleEnabled = async (skill: UserSkill) => {
		if (busy) return;
		setBusy(`${skill.id}:enabled`);
		try {
			const next = await updateUserSkill(skill.id, { enabled: !skill.enabled });
			onSkillChanged(next);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const removeSkill = async (skill: UserSkill) => {
		if (busy) return;
		if (!window.confirm(`Delete skill "${skill.name}"?`)) return;
		setBusy(`${skill.id}:delete`);
		try {
			await deleteUserSkill(skill.id);
			onSkillRemoved(skill.id);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const handleCreate = async (input: { name: string; description: string; markdown: string }) => {
		setBusy("create");
		try {
			const skill = await createUserSkill(input);
			onSkillChanged(skill);
			setCreateOpen(false);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const handleInstall = async (url: string) => {
		setBusy("install");
		try {
			const skill = await installUserSkill(url);
			onSkillChanged(skill);
			setInstallOpen(false);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const handleEdit = async (id: string, input: { name: string; description: string; markdown: string }) => {
		setBusy("edit");
		try {
			const skill = await updateUserSkill(id, input);
			onSkillChanged(skill);
			setEditSkill(null);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	return (
		<>
			<DesignerPanel title="Skill Management">
				<div className="grid gap-2">
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							disabled={busy === "create"}
							onClick={() => setCreateOpen(true)}
							className="inline-flex items-center gap-2 border border-[#11a4d4] rounded-sm px-3 py-2 text-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50"
						>
							<Plus size={14} />
							Create Skill
						</button>
						<button
							type="button"
							disabled={busy === "install"}
							onClick={() => setInstallOpen(true)}
							className="inline-flex items-center gap-2 border border-slate-700 rounded-sm px-3 py-2 text-sm text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							<ExternalLink size={14} />
							Install from URL
						</button>
					</div>
					{error ? <div className="border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{error}</div> : null}
					<div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
						{skillList.length} skills / {enabledCount} enabled
					</div>
				</div>
				{skills ? (
					skillList.length ? (
						<div className="grid gap-2">
							{skillList.map((skill) => (
								<div key={skill.id} className={`border rounded-sm p-2 ${skill.enabled ? "border-slate-800 bg-[#151f24]" : "border-slate-800 bg-[#151f24] opacity-75"}`}>
									<div className="flex items-center justify-between gap-2 max-[640px]:items-start">
										<div className="min-w-0 flex-1">
											<div className="flex min-w-0 flex-wrap items-center gap-2">
												<span className="min-w-0 truncate text-sm text-slate-200">{skill.name}</span>
												<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${skill.enabled ? "border-[#11a4d4]/60 text-[#7dd3fc]" : "border-slate-700 text-slate-500"}`}>{skill.enabled ? "enabled" : "disabled"}</span>
												<span className="shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border-slate-700 text-slate-500">{skill.source}</span>
											</div>
											<div className="truncate text-xs text-slate-500">{skill.description || skill.path}</div>
										</div>
										<div className="flex shrink-0 items-center gap-1">
											<button
												type="button"
												disabled={busy?.startsWith(`${skill.id}:`) ?? false}
												onClick={() => void toggleEnabled(skill)}
												className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
											>
												{skill.enabled ? <PowerOff size={13} /> : <Power size={13} />}
											</button>
											<button
												type="button"
												disabled={busy?.startsWith(`${skill.id}:`) ?? false}
												onClick={async () => {
														try {
															const data = await getUserSkill(skill.id);
															setEditSkill(skill);
															setEditMarkdown(data.markdown);
														} catch {
															setEditSkill(skill);
															setEditMarkdown("");
														}
													}}
												className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
											>
												<Edit3 size={13} />
											</button>
											<button
												type="button"
												disabled={busy?.startsWith(`${skill.id}:`) ?? false}
												onClick={() => void removeSkill(skill)}
												className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
											>
												<Trash2 size={13} />
											</button>
										</div>
									</div>
								</div>
							))}
						</div>
					) : <EmptyCatalog message="No user skills" />
				) : <EmptyCatalog />}
			</DesignerPanel>
			{createOpen ? (
				<SkillEditModal
					title="Create Skill"
					onSave={handleCreate}
					onClose={() => setCreateOpen(false)}
					busy={busy === "create"}
				/>
			) : null}
			{installOpen ? (
				<SkillInstallModal
					onInstall={handleInstall}
					onClose={() => setInstallOpen(false)}
					busy={busy === "install"}
				/>
			) : null}
			{editSkill ? (
				<SkillEditModal
					title="Edit Skill"
					initialName={editSkill.name}
					initialDescription={editSkill.description}
					initialMarkdown={editMarkdown}
					onSave={(input) => void handleEdit(editSkill.id, input)}
					onClose={() => setEditSkill(null)}
					busy={busy === "edit"}
				/>
			) : null}
		</>
	);
}

function SkillEditModal({
	title,
	initialName = "",
	initialDescription = "",
	initialMarkdown = "",
	onSave,
	onClose,
	busy,
}: {
	title: string;
	initialName?: string;
	initialDescription?: string;
	initialMarkdown?: string;
	onSave: (input: { name: string; description: string; markdown: string }) => void;
	onClose: () => void;
	busy: boolean;
}) {
	const [name, setName] = useState(initialName);
	const [description, setDescription] = useState(initialDescription);
	const [markdown, setMarkdown] = useState(initialMarkdown);

	return (
		<Modal onClose={onClose}>
			<h2 className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm font-bold uppercase tracking-wider">
				<Edit3 size={16} />
				{title}
			</h2>
			<div className="grid gap-3 p-4">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Skill name (kebab-case)"
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4]"
				/>
				<input
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Short description"
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4]"
				/>
				<textarea
					value={markdown}
					onChange={(e) => setMarkdown(e.target.value)}
					placeholder="Markdown instructions..."
					rows={10}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] resize-vertical"
				/>
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className="px-3 py-2 text-sm border border-slate-700 rounded-sm hover:border-slate-500">Cancel</button>
					<button
						type="button"
						disabled={busy || !name.trim()}
						onClick={() => onSave({ name, description, markdown })}
						className="px-3 py-2 text-sm border border-[#11a4d4] rounded-sm bg-[#11a4d4]/10 text-[#11a4d4] disabled:opacity-50"
					>
						{busy ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
		</Modal>
	);
}

function SkillInstallModal({
	onInstall,
	onClose,
	busy,
}: {
	onInstall: (url: string) => void;
	onClose: () => void;
	busy: boolean;
}) {
	const [url, setUrl] = useState("");

	return (
		<Modal onClose={onClose}>
			<h2 className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm font-bold uppercase tracking-wider">
				<ExternalLink size={16} />
				Install Skill
			</h2>
			<div className="grid gap-3 p-4">
				<input
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://skills.sh/owner/skills/skill-name"
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4]"
				/>
				<div className="text-[11px] text-slate-500">
					Supports skills.sh URLs, GitHub tree URLs, or owner/repo shorthand.
				</div>
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className="px-3 py-2 text-sm border border-slate-700 rounded-sm hover:border-slate-500">Cancel</button>
					<button
						type="button"
						disabled={busy || !url.trim()}
						onClick={() => onInstall(url)}
						className="px-3 py-2 text-sm border border-[#11a4d4] rounded-sm bg-[#11a4d4]/10 text-[#11a4d4] disabled:opacity-50"
					>
						{busy ? "Installing..." : "Install"}
					</button>
				</div>
			</div>
		</Modal>
	);
}

function PiPackageManagementCard({
	pkg,
	expanded,
	busy,
	onToggleExpanded,
	onToggleEnabled,
	onUnregister,
}: {
	pkg: PiPackageCatalogItem;
	expanded: boolean;
	busy: boolean;
	onToggleExpanded: () => void;
	onToggleEnabled: () => void;
	onUnregister: () => void;
}) {
	const hasErrors = pkg.diagnostics.some((diagnostic) => diagnostic.type === "error");
	return (
		<div className={`border rounded-sm ${pkg.enabled ? "border-slate-800 bg-[#151f24]" : "border-slate-800 bg-[#151f24] opacity-75"}`}>
			<div className="grid grid-cols-[1fr_auto] gap-2 p-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="min-w-0 truncate text-sm text-slate-200">{pkg.name}</span>
						<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${pkg.enabled ? "border-[#11a4d4]/60 text-[#7dd3fc]" : "border-slate-700 text-slate-500"}`}>{pkg.enabled ? "enabled" : "disabled"}</span>
						<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${pkg.installStatus === "installed" ? "border-[#0bda57]/50 text-green-300" : "border-[#f59e0b]/50 text-amber-100"}`}>{pkg.installStatus}</span>
					</div>
					<div className="truncate text-xs text-slate-500">{pkg.description ?? pkg.source}</div>
					<div className={`font-mono text-[10px] mt-1 ${hasErrors ? "text-[#f59e0b]" : "text-[#11a4d4]"}`}>{piPackageMeta(pkg)}</div>
				</div>
				<div className="flex items-start gap-1">
					<button type="button" onClick={onToggleExpanded} title={expanded ? "Hide Details" : "Show Details"} aria-label={expanded ? "Hide Details" : "Show Details"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					</button>
					<button type="button" disabled={busy} onClick={onToggleEnabled} title={pkg.enabled ? "Disable Package" : "Enable Package"} aria-label={pkg.enabled ? "Disable Package" : "Enable Package"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
						{pkg.enabled ? <PowerOff size={13} /> : <Power size={13} />}
					</button>
					<button type="button" disabled={busy} onClick={onUnregister} title="Unregister Package" aria-label="Unregister Package" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-400 hover:text-red-300 disabled:opacity-50">
						<Trash2 size={13} />
					</button>
				</div>
			</div>
			{expanded ? <PiPackageDetails pkg={pkg} /> : null}
		</div>
	);
}

type RawEvent = PiboSessionTraceView["rawEvents"][number];
type CompactRawEvent = RawEvent & { count: number };
type LiveTraceOverlay = {
	piboSessionId: string;
	events: ChatWebStoredEvent[];
};

type ChatStreamEventMeta = {
	piboSessionId?: string;
	streamFrameId?: string;
	streamId?: number;
	streamFrameIndex?: number;
};

type ChatStreamEvent = ChatStreamEventMeta & (
	| { type: "ready"; piboSessionId: string }
	| { type: "RUN_STARTED"; runId: string; input?: { text?: string; source?: string } }
	| { type: "RUN_FINISHED"; runId: string }
	| { type: "RUN_ERROR"; runId?: string; message: string }
	| { type: "TEXT_MESSAGE_START"; messageId: string; runId?: string; role: "assistant" }
	| { type: "TEXT_MESSAGE_CONTENT"; messageId: string; runId?: string; delta: string }
	| { type: "TEXT_MESSAGE_END"; messageId: string; runId?: string; finalText?: string }
	| { type: "REASONING_MESSAGE_START"; messageId: string; runId?: string }
	| { type: "REASONING_MESSAGE_CONTENT"; messageId: string; runId?: string; delta: string }
	| { type: "REASONING_MESSAGE_END"; messageId: string; runId?: string; finalText?: string }
	| { type: "TOOL_CALL_START"; toolCallId: string; toolName: string; args?: unknown; runId?: string }
	| { type: "TOOL_CALL_ARGS"; toolCallId: string; args: unknown; argsComplete: boolean }
	| { type: "TOOL_CALL_RESULT"; toolCallId: string; result: unknown; isError: boolean }
	| { type: "AGENT_DELEGATION"; toolCallId?: string; toolName: string; subagentName: string; childPiboSessionId: string; threadKey?: string }
	| { type: "EXECUTION_RESULT"; runId?: string; eventId?: string; action: string; result: unknown }
	| { type: "RAW_EVENT"; event: { type: string; [key: string]: unknown } }
);

function chatStreamEvent(message: MessageEvent): ChatStreamEvent | undefined {
	try {
		const parsed = JSON.parse(message.data) as { type?: unknown };
		if (typeof parsed.type !== "string") return undefined;
		const streamFrame = message.lastEventId ? parseTraceStreamFrameId(message.lastEventId) : undefined;
		return {
			...(parsed as ChatStreamEvent),
			...(message.lastEventId ? { streamFrameId: message.lastEventId } : {}),
			...(streamFrame ? { streamId: streamFrame.streamId, streamFrameIndex: streamFrame.frameIndex } : {}),
		};
	} catch {
		return undefined;
	}
}

function eventTraceRefreshDelay(event: ChatStreamEvent): number | undefined {
	if (
		event.type === "RUN_FINISHED" ||
		event.type === "TEXT_MESSAGE_END"
	) {
		return 300;
	}
	if (event.type === "RUN_ERROR") {
		return 0;
	}
	return undefined;
}

function eventShouldRefreshNavigation(event: ChatStreamEvent): boolean {
	return event.type === "RUN_STARTED" || event.type === "RUN_FINISHED" || event.type === "RUN_ERROR" || event.type === "TEXT_MESSAGE_END";
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

function findAgentProfile(profiles: BootstrapData["agents"], name: string): BootstrapData["agents"][number] | undefined {
	return profiles.find((profile) => profile.name === name || profile.aliases.includes(name));
}

function profileExists(profiles: BootstrapData["agents"], name: string): boolean {
	return Boolean(findAgentProfile(profiles, name));
}

function readStoredSelection(): StoredSelection {
	try {
		const raw = localStorage.getItem(LAST_SELECTION_STORAGE_KEY);
		if (!raw) return {};
		const value = JSON.parse(raw);
		if (!isRecord(value)) return {};
		const sessionsByRoom = isRecord(value.sessionsByRoom)
			? Object.fromEntries(
					Object.entries(value.sessionsByRoom).filter(
						(entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string" && Boolean(entry[1]),
					),
				)
			: undefined;
		return {
			roomId: typeof value.roomId === "string" && value.roomId ? value.roomId : undefined,
			piboSessionId: typeof value.piboSessionId === "string" && value.piboSessionId ? value.piboSessionId : undefined,
			...(sessionsByRoom && Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
		};
	} catch {
		return {};
	}
}

function writeStoredSelection(selection: StoredSelection): void {
	try {
		const previous = readStoredSelection();
		const sessionsByRoom = { ...(previous.sessionsByRoom ?? {}), ...(selection.sessionsByRoom ?? {}) };
		if (selection.roomId && selection.piboSessionId) sessionsByRoom[selection.roomId] = selection.piboSessionId;
		localStorage.setItem(
			LAST_SELECTION_STORAGE_KEY,
			JSON.stringify({
				roomId: selection.roomId,
				piboSessionId: selection.piboSessionId,
				...(Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
			}),
		);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function removeStoredRoomSelection(roomId: string): void {
	try {
		const stored = readStoredSelection();
		if (!stored.sessionsByRoom?.[roomId]) return;
		const { [roomId]: _removed, ...sessionsByRoom } = stored.sessionsByRoom;
		localStorage.setItem(
			LAST_SELECTION_STORAGE_KEY,
			JSON.stringify({
				roomId: stored.roomId,
				piboSessionId: stored.piboSessionId,
				...(Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
			}),
		);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function readStoredComposerDraft(piboSessionId: string): string {
	try {
		return localStorage.getItem(COMPOSER_DRAFT_STORAGE_PREFIX + piboSessionId) ?? "";
	} catch {
		return "";
	}
}

function writeStoredComposerDraft(piboSessionId: string, text: string): void {
	try {
		const key = COMPOSER_DRAFT_STORAGE_PREFIX + piboSessionId;
		if (text) {
			localStorage.setItem(key, text);
		} else {
			localStorage.removeItem(key);
		}
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function readStoredComposerHistory(): string[] {
	try {
		const raw = localStorage.getItem(COMPOSER_HISTORY_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			.slice(-COMPOSER_HISTORY_LIMIT);
	} catch {
		return [];
	}
}

function appendStoredComposerHistory(text: string): void {
	const entry = text.trim();
	if (!entry) return;
	const entries = readStoredComposerHistory();
	if (entries.at(-1) === entry) return;
	try {
		localStorage.setItem(COMPOSER_HISTORY_STORAGE_KEY, JSON.stringify([...entries, entry].slice(-COMPOSER_HISTORY_LIMIT)));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function readStoredSessionView(): ChatSessionViewId {
	try {
		const stored = localStorage.getItem(SESSION_VIEW_STORAGE_KEY);
		return stored === "terminal" ? "terminal" : DEFAULT_CHAT_SESSION_VIEW_ID;
	} catch {
		return DEFAULT_CHAT_SESSION_VIEW_ID;
	}
}

function writeStoredSessionView(viewId: ChatSessionViewId): void {
	try {
		localStorage.setItem(SESSION_VIEW_STORAGE_KEY, viewId);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function clearStoredSelection(): void {
	try {
		localStorage.removeItem(LAST_SELECTION_STORAGE_KEY);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function canMergeRawDelta(left: RawEvent, right: RawEvent): boolean {
	if (left.type !== right.type) return false;
	if (
		left.type !== "assistant_delta" &&
		left.type !== "thinking_delta" &&
		left.type !== "TEXT_MESSAGE_CONTENT" &&
		left.type !== "REASONING_MESSAGE_CONTENT"
	) {
		return false;
	}
	const leftPayload = isRecord(left.payload) ? left.payload : {};
	const rightPayload = isRecord(right.payload) ? right.payload : {};
	return eventKeyFromPayload(leftPayload) === eventKeyFromPayload(rightPayload);
}

function textFromPayload(payload: unknown): string {
	if (!isRecord(payload)) return "";
	if (typeof payload.text === "string") return payload.text;
	return typeof payload.delta === "string" ? payload.delta : "";
}

function eventKeyFromPayload(payload: Record<string, unknown>): unknown {
	return payload.eventId ?? payload.messageId;
}

function parseForkActionResponse(value: unknown): ForkActionResponse | null {
	if (!isRecord(value) || !isRecord(value.result)) return null;
	return value as ForkActionResponse;
}

function getResultPiboSessionId(value: unknown): string | undefined {
	if (!isRecord(value) || !isRecord(value.result)) return undefined;
	return typeof value.result.piboSessionId === "string" ? value.result.piboSessionId : undefined;
}

function annotateLiveTraceForkEntryIds(liveNodes: PiboTraceNode[], persistedNodes: readonly PiboTraceNode[]): void {
	const persistedUserMessages = flattenPiboTraceNodes(persistedNodes)
		.filter((node) => node.type === "user.message" && node.entryId)
		.map((node) => ({ entryId: node.entryId!, text: traceNodeText(node) }));
	if (!persistedUserMessages.length) return;
	const used = new Set<string>();
	for (const node of flattenPiboTraceNodes(liveNodes)) {
		if (node.type !== "user.message" || node.entryId) continue;
		const text = traceNodeText(node);
		const match = persistedUserMessages.find((candidate) => !used.has(candidate.entryId) && candidate.text === text);
		if (!match) continue;
		node.entryId = match.entryId;
		used.add(match.entryId);
	}
}

function flattenPiboTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	const flattened: PiboTraceNode[] = [];
	const visit = (items: readonly PiboTraceNode[]) => {
		for (const item of items) {
			flattened.push(item);
			visit(item.children);
		}
	};
	visit(nodes);
	return flattened;
}

function traceNodeText(node: PiboTraceNode): string {
	return typeof node.output === "string" ? node.output : typeof node.summary === "string" ? node.summary : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
