import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
	Archive,
	ArchiveRestore,
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Edit3,
	MessageSquarePlus,
	Plus,
	RefreshCw,
	Server,
	Trash2,
	X,
} from "lucide-react";
import { deleteAgentFolder, deleteCustomAgent, getCustomAgents, patchAgentFolder, patchCustomAgent, postAgentFolder, postCustomAgent } from "../api-agent-designer";
import type { SaveState } from "../api";
import { listContextFiles, postContextFile } from "../api-context-files";
import type { AgentCatalog, AgentRuntimeCapabilityDelivery, BootstrapData, CustomAgent, CustomAgentFolder, CustomAgentSubagent, ModelCatalog, ModelProfile } from "../types";
import {
	BUILTIN_TOOL_DESCRIPTIONS,
	DEFAULT_BUILTIN_TOOL_NAMES,
	agentDesignerUnavailableMessage,
	agentDraftToSaveInput,
	agentToDraft,
	buildContextFileGroups,
	buildNativeToolGroups,
	buildSkillGroups,
	contextFileMeta,
	copyCustomAgentToDraft,
	copyProfileToDraft,
	createBlankAgentDraft,
	isNotFoundError,
	isPiPackageSelected,
	isSelectablePiPackage,
	modelCatalogForRuntime,
	normalizeBuiltinToolNames,
	reasoningValuesForModel,
	profileToDraft,
	selectExistingAgentDraft,
	skillMeta,
	toggleName,
	togglePiPackageSelection,
	uniqueDraftAgentName,
	uniqueProfileOptions,
	validateAgentName,
	type AgentDraft,
	type PiPackageCatalogItem,
} from "./agent-designer-model";
import {
	AgentRuntimeOptions,
	AgentRuntimeSelector,
	CatalogGroupGrid,
	CatalogSection,
	CatalogToggle,
	DesignerPanel,
	EmptyCatalog,
	InlineCheckboxToggle,
	PiPackageCard,
	SelectionCheckbox,
} from "./designer-ui";
import { AgentsSidebar } from "./AgentsSidebar";

const AGENT_AUTOSAVE_DELAY_MS = 900;
const PENDING_AGENT_DRAFT_STORAGE_KEY = "pibo.chat.agentDesigner.pendingDraft.v1";

type PendingAgentDraft = {
	draft: AgentDraft;
	savedSignature: string | null;
};

function agentDraftSignature(draft: AgentDraft): string {
	return JSON.stringify(agentDraftToSaveInput(draft));
}

function readPendingAgentDraft(): PendingAgentDraft | null {
	try {
		const raw = sessionStorage.getItem(PENDING_AGENT_DRAFT_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<PendingAgentDraft>;
		if (!parsed.draft || parsed.draft.source !== "custom") return null;
		const draft: AgentDraft = {
			...parsed.draft,
			runtimeInstanceId: typeof parsed.draft.runtimeInstanceId === "string" && parsed.draft.runtimeInstanceId.trim()
				? parsed.draft.runtimeInstanceId
				: "pi",
			runtimeOptions: parsed.draft.runtimeOptions && typeof parsed.draft.runtimeOptions === "object" && !Array.isArray(parsed.draft.runtimeOptions)
				? parsed.draft.runtimeOptions
				: {},
			nativeSubagents: typeof parsed.draft.nativeSubagents === "boolean"
				? parsed.draft.nativeSubagents
				: undefined,
			autoContextFiles: typeof parsed.draft.autoContextFiles === "boolean"
				? parsed.draft.autoContextFiles
				: true,
		};
		if (validateAgentName(draft.displayName)) {
			sessionStorage.removeItem(PENDING_AGENT_DRAFT_STORAGE_KEY);
			return null;
		}
		return { draft, savedSignature: typeof parsed.savedSignature === "string" ? parsed.savedSignature : null };
	} catch {
		return null;
	}
}

function writePendingAgentDraft(draft: AgentDraft, savedSignature: string | null): void {
	try {
		sessionStorage.setItem(PENDING_AGENT_DRAFT_STORAGE_KEY, JSON.stringify({ draft, savedSignature } satisfies PendingAgentDraft));
	} catch {
		// Autosave still persists to the server when browser storage is unavailable.
	}
}

function clearPendingAgentDraft(): void {
	try {
		sessionStorage.removeItem(PENDING_AGENT_DRAFT_STORAGE_KEY);
	} catch {
		// Browser storage is only the recovery fallback.
	}
}

function autosaveStateLabel(state: SaveState): string {
	if (state === "saving") return "Saving…";
	if (state === "saved") return "Saved";
	if (state === "error") return "Save failed";
	return "Unsaved";
}

export function AgentsView({
	agents,
	initialCustomAgents,
	initialAgentFolders,
	initialCatalog,
	modelCatalog,
	onSelect,
	onCreateSession,
	onEditContextFile,
	onEditMcpServer,
	onAgentsChanged,
	onAutosaveHandlerChange,
	creatingSession,
	mobileSidebarOpen,
	isMobileSidebarViewport,
	onCloseMobileSidebar,
}: {
	agents: BootstrapData["agents"];
	initialCustomAgents: CustomAgent[];
	initialAgentFolders: CustomAgentFolder[];
	initialCatalog?: AgentCatalog;
	modelCatalog?: ModelCatalog;
	onSelect: (profile: string) => void;
	onCreateSession: (profile: string) => void;
	onEditContextFile: (key: string) => void;
	onEditMcpServer: (name: string) => void;
	onAgentsChanged: () => void;
	onAutosaveHandlerChange: (handler: (() => Promise<void>) | null) => void;
	creatingSession: boolean;
	mobileSidebarOpen: boolean;
	isMobileSidebarViewport: boolean;
	onCloseMobileSidebar: () => void;
}) {
	const [initialDraftState] = useState(() => {
		const pending = readPendingAgentDraft();
		const initialDraft = pending?.draft ?? selectExistingAgentDraft(agents, initialCustomAgents, initialCatalog);
		return {
			draft: initialDraft,
			savedSignature: pending ? pending.savedSignature : agentDraftSignature(initialDraft),
			restored: Boolean(pending),
		};
	});
	const [catalog, setCatalog] = useState<AgentCatalog | null>(initialCatalog ?? null);
	const [customAgents, setCustomAgents] = useState(initialCustomAgents);
	const [agentFolders, setAgentFolders] = useState(initialAgentFolders);
	const [draft, setDraft] = useState<AgentDraft>(initialDraftState.draft);
	const [showUnsavedAgentDraft, setShowUnsavedAgentDraft] = useState(Boolean(initialDraftState.restored && !initialDraftState.draft.id));
	const [saveState, setSaveState] = useState<SaveState>(initialDraftState.restored ? "idle" : "saved");
	const [editingName, setEditingName] = useState(false);
	const [saving, setSaving] = useState(false);
	const [refreshingContextFiles, setRefreshingContextFiles] = useState(false);
	const autoRefreshedBrokenContextFilesRef = useRef(new Set<string>());
	const [showArchivedAgents, setShowArchivedAgents] = useState(() => localStorage.getItem("pibo.chat.showArchivedAgents") === "true");
	const [deleteConfirmName, setDeleteConfirmName] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);
	const [runtimeOptionsError, setRuntimeOptionsError] = useState<string | null>(null);
	const [newContextFileName, setNewContextFileName] = useState("");
	const [newContextFileScope, setNewContextFileScope] = useState<"global" | "agent">("agent");
	const currentDraftRef = useRef(draft);
	const customAgentsRef = useRef(customAgents);
	const savedSignatureRef = useRef<string | null>(initialDraftState.savedSignature);
	const savePromiseRef = useRef<Promise<void> | null>(null);
	const runtimeOptionsErrorRef = useRef<string | null>(null);
	const autosaveTimerRef = useRef<number | null>(null);
	const mountedRef = useRef(true);
	const catalogRef = useRef<AgentCatalog | null>(catalog);
	const onSelectRef = useRef(onSelect);
	const onAgentsChangedRef = useRef(onAgentsChanged);
	const designerAvailable = Boolean(catalog);

	useEffect(() => {
		catalogRef.current = catalog;
		customAgentsRef.current = customAgents;
		onSelectRef.current = onSelect;
		onAgentsChangedRef.current = onAgentsChanged;
	}, [catalog, customAgents, onAgentsChanged, onSelect]);

	const clearAutosaveTimer = useCallback(() => {
		if (autosaveTimerRef.current !== null) {
			window.clearTimeout(autosaveTimerRef.current);
			autosaveTimerRef.current = null;
		}
	}, []);

	const updateRuntimeOptionsError = useCallback((message: string | null) => {
		runtimeOptionsErrorRef.current = message;
		setRuntimeOptionsError(message);
	}, []);

	const activateDraft = useCallback((nextDraft: AgentDraft, savedSignature: string | null, showUnsaved = nextDraft.source === "custom" && !nextDraft.id) => {
		clearAutosaveTimer();
		currentDraftRef.current = nextDraft;
		savedSignatureRef.current = savedSignature;
		setDraft(nextDraft);
		setShowUnsavedAgentDraft(showUnsaved);
		setEditingName(false);
		setSaveState(savedSignature === agentDraftSignature(nextDraft) ? "saved" : "idle");
		runtimeOptionsErrorRef.current = null;
		setRuntimeOptionsError(null);
		setLocalError(null);
		if (savedSignature === agentDraftSignature(nextDraft)) clearPendingAgentDraft();
		else writePendingAgentDraft(nextDraft, savedSignature);
	}, [clearAutosaveTimer]);

	const persistIfNeeded = useCallback(async function persistIfNeeded(): Promise<void> {
		clearAutosaveTimer();
		if (savePromiseRef.current) {
			await savePromiseRef.current;
			return persistIfNeeded();
		}

		const snapshot = currentDraftRef.current;
		if (snapshot.source === "profile" || snapshot.archivedAt) return;
		if (runtimeOptionsErrorRef.current) {
			const message = `Runtime options are invalid: ${runtimeOptionsErrorRef.current}`;
			if (mountedRef.current) {
				setSaveState("error");
				setLocalError(message);
			}
			throw new Error(message);
		}
		const input = agentDraftToSaveInput(snapshot);
		const submittedSignature = JSON.stringify(input);
		if (submittedSignature === savedSignatureRef.current) {
			clearPendingAgentDraft();
			if (mountedRef.current) setSaveState("saved");
			return;
		}
		const nameError = validateAgentName(snapshot.displayName);
		if (nameError) {
			if (mountedRef.current) {
				setSaveState("idle");
				setLocalError(nameError);
			}
			throw new Error(nameError);
		}
		if (!catalogRef.current) {
			const message = agentDesignerUnavailableMessage();
			if (mountedRef.current) {
				setSaveState("error");
				setLocalError(message);
			}
			throw new Error(message);
		}

		writePendingAgentDraft(snapshot, savedSignatureRef.current);
		if (mountedRef.current) {
			setSaveState("saving");
			setSaving(true);
		}

		let shouldSaveAgain = false;
		const acceptSavedAgent = (savedAgent: CustomAgent) => {
			const current = currentDraftRef.current;
			const sameDraft = snapshot.id ? current.id === snapshot.id : !current.id;
			if (sameDraft) {
				const nextDraft: AgentDraft = {
					...current,
					id: savedAgent.id,
					profileName: savedAgent.profileName,
					archivedAt: savedAgent.archivedAt,
					source: "custom",
				};
				currentDraftRef.current = nextDraft;
				savedSignatureRef.current = submittedSignature;
				shouldSaveAgain = agentDraftSignature(nextDraft) !== submittedSignature;
				if (shouldSaveAgain) writePendingAgentDraft(nextDraft, submittedSignature);
				else clearPendingAgentDraft();
				if (mountedRef.current) {
					setDraft(nextDraft);
					setShowUnsavedAgentDraft(false);
				}
			}
			const withoutSaved = customAgentsRef.current.filter((agent) => agent.id !== savedAgent.id);
			const nextAgents = [savedAgent, ...withoutSaved];
			customAgentsRef.current = nextAgents;
			if (mountedRef.current) {
				setCustomAgents(nextAgents);
				setLocalError(null);
			}
			onSelectRef.current(savedAgent.profileName);
			onAgentsChangedRef.current();
		};
		const savePromise = (async () => {
			try {
				const response = snapshot.id ? await patchCustomAgent(snapshot.id, input) : await postCustomAgent(input);
				acceptSavedAgent(response.agent);
			} catch (caught) {
				if (!snapshot.id) {
					try {
						const existing = (await getCustomAgents()).agents.find((agent) =>
							agent.profileName === input.displayName && agentDraftSignature(agentToDraft(agent)) === submittedSignature,
						);
						if (existing) {
							acceptSavedAgent(existing);
							return;
						}
					} catch {
						// Preserve the original save error when reconciliation is unavailable.
					}
				}
				throw caught;
			}
		})();
		savePromiseRef.current = savePromise;

		try {
			await savePromise;
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			if (mountedRef.current) {
				setSaveState("error");
				setLocalError(isNotFoundError(message) ? agentDesignerUnavailableMessage() : message);
			}
			throw caught;
		} finally {
			if (savePromiseRef.current === savePromise) savePromiseRef.current = null;
			if (mountedRef.current) setSaving(false);
		}

		if (shouldSaveAgain) return persistIfNeeded();
		if (mountedRef.current) setSaveState("saved");
	}, [clearAutosaveTimer]);

	useEffect(() => {
		currentDraftRef.current = draft;
		if (draft.source === "profile" || draft.archivedAt) {
			clearAutosaveTimer();
			setSaveState("saved");
			clearPendingAgentDraft();
			return;
		}
		const signature = agentDraftSignature(draft);
		if (signature === savedSignatureRef.current) {
			clearAutosaveTimer();
			setSaveState("saved");
			clearPendingAgentDraft();
			return;
		}
		clearAutosaveTimer();
		setSaveState((current) => current === "saving" ? current : "idle");
		const nameError = validateAgentName(draft.displayName);
		if (editingName || nameError) return;
		writePendingAgentDraft(draft, savedSignatureRef.current);
		if (runtimeOptionsError || !catalogRef.current) return;
		autosaveTimerRef.current = window.setTimeout(() => {
			autosaveTimerRef.current = null;
			void persistIfNeeded().catch(() => undefined);
		}, AGENT_AUTOSAVE_DELAY_MS);
	}, [clearAutosaveTimer, designerAvailable, draft, editingName, persistIfNeeded, runtimeOptionsError]);

	useEffect(() => {
		onAutosaveHandlerChange(persistIfNeeded);
		return () => onAutosaveHandlerChange(null);
	}, [onAutosaveHandlerChange, persistIfNeeded]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			clearAutosaveTimer();
			void persistIfNeeded().catch(() => undefined);
		};
	}, [clearAutosaveTimer, persistIfNeeded]);

	const refreshContextFileRegistry = useCallback(async () => {
		setRefreshingContextFiles(true);
		try {
			const files = await listContextFiles();
			const knownKeys = new Set(files.map((file) => file.key));
			setCatalog((current) => current ? { ...current, contextFiles: files } : current);
			setCustomAgents((current) => current.map((agent) => ({
				...agent,
				brokenContextFiles: (agent.brokenContextFiles ?? []).filter((key) => !knownKeys.has(key)),
			})));
			setDraft((current) => ({
				...current,
				brokenContextFiles: (current.brokenContextFiles ?? []).filter((key) => !knownKeys.has(key)),
			}));
			onAgentsChangedRef.current();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setRefreshingContextFiles(false);
		}
	}, []);

	useEffect(() => setCustomAgents(initialCustomAgents), [initialCustomAgents]);
	useEffect(() => setAgentFolders(initialAgentFolders), [initialAgentFolders]);
	useEffect(() => {
		if (initialCatalog) setCatalog(initialCatalog);
	}, [initialCatalog]);
	useEffect(() => {
		const keys = draft.brokenContextFiles ?? [];
		if (!keys.length || refreshingContextFiles) return;
		const signature = keys.slice().sort().join("\n");
		if (autoRefreshedBrokenContextFilesRef.current.has(signature)) return;
		autoRefreshedBrokenContextFilesRef.current.add(signature);
		void refreshContextFileRegistry();
	}, [draft.brokenContextFiles, refreshContextFileRegistry, refreshingContextFiles]);
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
	const unsavedAgentDraftVisible = showUnsavedAgentDraft && draft.source === "custom" && !draft.id;
	const noAgentSelected = draft.source === "custom" && !draft.id && !unsavedAgentDraftVisible;
	const readOnly = draft.source === "profile" || archivedDraft || noAgentSelected;
	const agentNameError = readOnly ? null : validateAgentName(draft.displayName);
	const draftProfileName = noAgentSelected ? "No agent selected" : draft.profileName ?? (agentNameError ? "new custom profile" : draft.displayName);
	const draftFolderName = draft.folderId ? agentFolders.find((folder) => folder.id === draft.folderId)?.name ?? "Missing folder" : "Unfiled";
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
	const selectedRuntime = catalog?.agentRuntimes?.find((runtime) => runtime.id === draft.runtimeInstanceId);
	const runtimeUnavailableReason = selectedRuntime
		? selectedRuntime.available
			? null
			: selectedRuntime.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message ?? "The selected runtime is unavailable."
		: `Runtime instance "${draft.runtimeInstanceId}" is not registered.`;
	const piboToolsUnavailableReason = runtimeUnavailableReason ?? unsupportedDeliveryReason(selectedRuntime?.capabilities.tools.piboManaged, "Pibo-managed tools");
	const piboToolsUseMcp = selectedRuntime?.capabilities.tools.piboManaged.support === "mcp";
	const nativeToolYieldingUnavailableReason = selectedRuntime?.capabilities.tools.nativeToolYielding.support === "unsupported"
		? `Private harness-native tools cannot be yielded by pibo_run_start: ${selectedRuntime.capabilities.tools.nativeToolYielding.reason}`
		: null;
	const skillsUnavailableReason = runtimeUnavailableReason ?? unsupportedDeliveryReason(selectedRuntime?.capabilities.skills, "Skills");
	const contextUnavailableReason = runtimeUnavailableReason ?? unsupportedDeliveryReason(selectedRuntime?.capabilities.context, "Context delivery");
	const contextDiscovery = selectedRuntime?.capabilities.contextDiscovery;
	const nativeSubagents = selectedRuntime?.capabilities.nativeSubagents;
	const intentTracing = selectedRuntime?.capabilities.tools.intentTracing;
	const effectiveIntentTracing = typeof draft.runtimeOptions.intentTracing === "boolean"
		? draft.runtimeOptions.intentTracing
		: intentTracing?.enabledByDefault ?? false;
	const automaticContextChecked = (contextDiscovery?.configurable
		? draft.autoContextFiles
		: contextDiscovery?.enabledByDefault ?? draft.autoContextFiles) ?? true;
	const effectiveNativeSubagents = draft.nativeSubagents ?? nativeSubagents?.enabledByDefault ?? false;
	const mcpUnavailableReason = runtimeUnavailableReason ?? unsupportedDeliveryReason(selectedRuntime?.capabilities.mcp.externalServers, "External MCP servers");
	const piPackagesUnavailableReason = runtimeUnavailableReason ?? (selectedRuntime?.adapterId !== "pi" ? "Pi packages are available only to Pi-backed runtime instances." : null);
	const piBuiltinToolsUnavailableReason = runtimeUnavailableReason ?? (selectedRuntime?.adapterId !== "pi" ? "Pi built-in tool overrides do not apply to this runtime; its native tools remain unchanged." : null);
	const modelUnavailableReason = runtimeUnavailableReason ?? (selectedRuntime && !selectedRuntime.capabilities.models.catalog ? "This runtime does not expose a model catalog to Agent Designer." : null);
	const reasoningUnavailableReason = runtimeUnavailableReason ?? (selectedRuntime && !selectedRuntime.capabilities.reasoning.supported ? "This runtime does not support profile-level reasoning control." : null);
	const runtimeModelCatalog = useMemo(
		() => modelCatalogForRuntime(selectedRuntime, modelCatalog),
		[selectedRuntime, modelCatalog],
	);
	const mainReasoningValues = reasoningValuesForModel(selectedRuntime?.capabilities.reasoning.values, runtimeModelCatalog, draft.mainModel);
	const mainReasoningUnavailableReason = reasoningUnavailableReason
		?? (draft.mainModel && mainReasoningValues?.length === 0 ? `Model "${draft.mainModel.id}" does not advertise a selectable reasoning effort.` : null);

	const runAfterAutosave = async (action: () => void | Promise<void>) => {
		try {
			await persistIfNeeded();
			await action();
		} catch {
			// Keep the current draft visible so the user can retry the failed autosave.
		}
	};

	const createNewAgentDraft = (folderId?: string) => {
		void runAfterAutosave(() => {
			const usedNames = [
				...agentNamesInUse(agents, customAgents),
				...(unsavedAgentDraftVisible ? [draft.displayName] : []),
			];
			const nextDraft = createBlankAgentDraft(catalog ?? undefined, uniqueDraftAgentName(usedNames), folderId);
			activateDraft(nextDraft, null);
			onCloseMobileSidebar();
		});
	};

	const toggleArchivedAgents = () => {
		const next = !showArchivedAgents;
		setShowArchivedAgents(next);
		localStorage.setItem("pibo.chat.showArchivedAgents", String(next));
		if (next || !archivedDraft) return;

		const nextDraft = selectExistingAgentDraft(agents, customAgents, catalog ?? undefined);
		activateDraft(nextDraft, agentDraftSignature(nextDraft), false);
		if (nextDraft.profileName) onSelect(nextDraft.profileName);
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
			const nextDraft = agentToDraft(response.agent);
			activateDraft(nextDraft, agentDraftSignature(nextDraft));
			setDeleteConfirmName("");
			onAgentsChangedRef.current();
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

	const createFolder = async (name: string) => {
		try {
			const response = await postAgentFolder(name);
			setAgentFolders((current) => [...current, response.folder].sort((left, right) => left.name.localeCompare(right.name)));
			onAgentsChangedRef.current();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
			throw caught;
		}
	};

	const renameFolder = async (folderId: string, name: string) => {
		try {
			const response = await patchAgentFolder(folderId, name);
			setAgentFolders((current) => current.map((folder) => folder.id === folderId ? response.folder : folder).sort((left, right) => left.name.localeCompare(right.name)));
			onAgentsChangedRef.current();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
			throw caught;
		}
	};

	const removeFolder = async (folderId: string) => {
		try {
			await deleteAgentFolder(folderId);
			setAgentFolders((current) => current.filter((folder) => folder.id !== folderId));
			onAgentsChangedRef.current();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
			throw caught;
		}
	};

	const moveAgent = (agent: CustomAgent, folderId?: string) => {
		void runAfterAutosave(async () => {
			try {
				const response = await patchCustomAgent(agent.id, { folderId: folderId ?? null });
				const nextAgents = customAgentsRef.current.map((item) => item.id === response.agent.id ? response.agent : item);
				customAgentsRef.current = nextAgents;
				setCustomAgents(nextAgents);
				if (currentDraftRef.current.source === "custom" && currentDraftRef.current.id === response.agent.id) {
					const nextDraft = agentToDraft(response.agent);
					activateDraft(nextDraft, agentDraftSignature(nextDraft));
				}
				onAgentsChangedRef.current();
				setLocalError(null);
			} catch (caught) {
				setLocalError(caught instanceof Error ? caught.message : String(caught));
			}
		});
	};

	const deleteDraft = async () => {
		if (!draft.id || !draft.profileName || !archivedDraft) return;
		setSaving(true);
		try {
			await deleteCustomAgent(draft.id, deleteConfirmName);
			const remainingAgents = customAgents.filter((agent) => agent.id !== draft.id);
			setCustomAgents(remainingAgents);
			const nextDraft = selectExistingAgentDraft(agents.filter((agent) => agent.name !== draft.profileName), remainingAgents, catalog ?? undefined);
			activateDraft(nextDraft, agentDraftSignature(nextDraft), false);
			if (nextDraft.profileName) onSelectRef.current(nextDraft.profileName);
			setDeleteConfirmName("");
			onAgentsChangedRef.current();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<div
				data-pibo-mobile-sidebar-backdrop
				aria-hidden="true"
				className={`fixed inset-0 z-30 bg-black/60 min-[981px]:hidden transition-opacity duration-200 ${mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
				onClick={onCloseMobileSidebar}
			/>
			<AgentsSidebar
				folders={agentFolders}
				activeAgents={activeCustomAgents}
				archivedAgents={archivedCustomAgents}
				pluginProfiles={pluginProfiles}
				draft={draft}
				error={localError}
				unsavedAgentDraftVisible={unsavedAgentDraftVisible}
				showArchivedAgents={showArchivedAgents}
				creatingSession={creatingSession}
				mobileSidebarOpen={mobileSidebarOpen}
				isMobileSidebarViewport={isMobileSidebarViewport}
				onCloseMobileSidebar={onCloseMobileSidebar}
				onCreateAgent={createNewAgentDraft}
				onCreateFolder={createFolder}
				onRenameFolder={renameFolder}
				onDeleteFolder={removeFolder}
				onToggleArchivedAgents={toggleArchivedAgents}
				onRefresh={() => void runAfterAutosave(onAgentsChanged)}
				onSelectAgent={(agent) => {
					if (draft.source === "custom" && draft.id === agent.id) {
						onCloseMobileSidebar();
						return;
					}
					void runAfterAutosave(() => {
						const latestAgent = customAgentsRef.current.find((item) => item.id === agent.id) ?? agent;
						const nextDraft = agentToDraft(latestAgent);
						activateDraft(nextDraft, agentDraftSignature(nextDraft));
						if (!latestAgent.archivedAt) onSelect(latestAgent.profileName);
						onCloseMobileSidebar();
					});
				}}
				onCopyAgent={(agent) => void runAfterAutosave(() => {
					const latestAgent = customAgentsRef.current.find((item) => item.id === agent.id) ?? agent;
					activateDraft(copyCustomAgentToDraft(latestAgent), null);
					onCloseMobileSidebar();
				})}
				onMoveAgent={moveAgent}
				onCreateAgentSession={(agent) => void runAfterAutosave(() => {
					onSelect(agent.profileName);
					onCreateSession(agent.profileName);
					onCloseMobileSidebar();
				})}
				onSelectProfile={(profile) => void runAfterAutosave(() => {
					const nextDraft = profileToDraft(profile, catalog ?? undefined);
					activateDraft(nextDraft, agentDraftSignature(nextDraft));
					onSelect(profile.name);
					onCloseMobileSidebar();
				})}
				onCopyProfile={(profile) => void runAfterAutosave(() => {
					activateDraft(copyProfileToDraft(profile, catalog ?? undefined), null);
					onCloseMobileSidebar();
				})}
				onCreateProfileSession={(profile) => void runAfterAutosave(() => {
					onSelect(profile.name);
					onCreateSession(profile.name);
					onCloseMobileSidebar();
				})}
			/>
			<main className="min-h-0 overflow-y-auto bg-[#101d22]" data-pibo-debug="agent-designer-main">
				<div className="sticky top-0 z-20 border-b border-slate-800 bg-[#101d22]/95 backdrop-blur-sm">
					<div className="mx-auto flex min-h-16 max-w-[1180px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
					<div className="min-w-0">
						<h1 className="text-sm font-bold uppercase tracking-wider">Agent Designer</h1>
						<div className="font-mono text-[11px] text-slate-500 truncate">{draftProfileName}</div>
						<div className="text-[11px] uppercase tracking-wider text-slate-500">{noAgentSelected ? "no agent selected" : draft.source === "profile" ? "read-only plugin profile" : archivedDraft ? `archived custom agent · ${draftFolderName}` : `custom agent · ${draftFolderName}`}</div>
					</div>
					<div className="flex items-center gap-2">
						{draft.source === "custom" && !archivedDraft && !noAgentSelected ? (
							<div className={`text-xs ${saveState === "error" ? "text-red-300" : saveState === "saved" ? "text-emerald-300" : "text-slate-400"}`} aria-live="polite" data-agent-autosave-state={saveState}>
								{autosaveStateLabel(saveState)}
							</div>
						) : null}
						{saveState === "error" && !readOnly ? (
							<button type="button" onClick={() => void persistIfNeeded().catch(() => undefined)} disabled={saving || Boolean(agentNameError)} className="h-8 px-2 border border-red-500/60 rounded-sm text-xs text-red-200 hover:border-red-300 disabled:opacity-50">
								Retry
							</button>
						) : null}
						<button type="button" onClick={() => void runAfterAutosave(() => { if (draft.profileName) { onSelect(draft.profileName); onCreateSession(draft.profileName); } })} disabled={!draft.profileName || creatingSession || archivedDraft} title="New Session With Agent" aria-label="New Session With Agent" className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							<MessageSquarePlus size={14} />
						</button>
						{draft.source === "custom" && draft.id ? (
							<button type="button" onClick={() => void runAfterAutosave(() => setDraftArchived(!archivedDraft))} disabled={saving} title={archivedDraft ? "Restore Agent" : "Archive Agent"} aria-label={archivedDraft ? "Restore Agent" : "Archive Agent"} className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
								{archivedDraft ? <ArchiveRestore size={14} /> : <Archive size={14} />}
							</button>
						) : null}
					</div>
					</div>
				</div>
				<div className="mx-auto grid max-w-[1180px] gap-4 px-4 py-4 sm:px-6 sm:py-6">
				{designerAvailable ? null : <div className="border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">{agentDesignerUnavailableMessage()}</div>}
				{noAgentSelected ? <div className="mb-3 border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-sm rounded-sm">Select an existing agent or use New Agent to create one.</div> : null}
				{draft.source === "profile" ? <div className="mb-3 border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-sm rounded-sm">This profile is registered by a plugin. Copy it to create an editable custom agent.</div> : null}
				{archivedDraft ? <div className="mb-3 border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">This agent is archived. Restore it before editing or starting new sessions.</div> : null}
				{localError ? <div role="alert" className="mb-3 border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{localError}</div> : null}
				<div className="grid gap-4">
					<DesignerPanel title="Identity">
						<label className="grid gap-1" htmlFor="agent-designer-name">
							<span className="text-[11px] uppercase tracking-wider text-slate-500">Agent name</span>
						<input
							id="agent-designer-name"
							name="agentName"
							value={draft.displayName}
							disabled={readOnly}
							onFocus={() => setEditingName(true)}
							onBlur={() => setEditingName(false)}
							onChange={(event) => {
								setLocalError(null);
								setDraft((current) => ({ ...current, displayName: event.target.value }));
							}}
							className={`min-w-0 bg-[#0e1116] border rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60 ${agentNameError ? "border-[#f59e0b]" : "border-slate-700"}`}
							placeholder="agent-name"
						/>
						</label>
						{agentNameError ? <div className="text-xs text-amber-100">{agentNameError}</div> : null}
						<label className="grid gap-1" htmlFor="agent-designer-description">
							<span className="text-[11px] uppercase tracking-wider text-slate-500">Description</span>
							<textarea id="agent-designer-description" name="agentDescription" value={draft.description} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-[88px] bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="What should this agent be used for?" />
						</label>
					</DesignerPanel>
					<DesignerPanel title="Runtime">
						<AgentRuntimeSelector
							runtimes={catalog?.agentRuntimes ?? []}
							runtimeInstanceId={draft.runtimeInstanceId}
							runtimeOptions={draft.runtimeOptions}
							readOnly={readOnly}
							onRuntimeChange={(runtimeInstanceId) => {
								updateRuntimeOptionsError(null);
								const nextRuntime = catalog?.agentRuntimes.find((runtime) => runtime.id === runtimeInstanceId);
								setDraft((current) => ({
									...current,
									runtimeInstanceId,
									runtimeOptions: {},
									nativeSubagents: undefined,
									...(nextRuntime && !nextRuntime.capabilities.contextDiscovery.configurable
										? { autoContextFiles: true }
										: {}),
								}));
							}}
							onRuntimeOptionsChange={(runtimeOptions) => setDraft((current) => ({ ...current, runtimeOptions }))}
							onRuntimeOptionsError={updateRuntimeOptionsError}
						/>
						{intentTracing?.configurable ? (
							<div className="grid gap-1 border-t border-slate-800 pt-3">
								<InlineCheckboxToggle
									disabled={readOnly || Boolean(runtimeUnavailableReason)}
									checked={effectiveIntentTracing}
									title="Tool intent tracing"
									onToggle={() => setDraft((current) => ({
										...current,
										runtimeOptions: { ...current.runtimeOptions, intentTracing: !effectiveIntentTracing },
									}))}
								/>
								<div className="text-[11px] text-slate-500">Adds a required concise intent to every Pi tool call. Disabled by default.</div>
							</div>
						) : null}
					</DesignerPanel>
					<DesignerPanel title="Main Agent">
						{draft.source === "profile" && draft.hardPinnedModel ? (
							<div className="border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-xs rounded-sm">
								This plugin profile hard-pins <span className="font-mono">{formatModelProfile(draft.hardPinnedModel)}</span> when no session or parent subagent override selects another model.
							</div>
						) : null}
						<AgentRuntimeOptions
							title="Model & Reasoning"
							modelTitle="Main Agent Model"
							model={draft.mainModel}
							thinking={draft.mainThinkingLevel}
							fast={draft.mainFast ?? false}
							modelCatalog={runtimeModelCatalog}
							readOnly={readOnly}
							modelHint="Unset to use the settings default."
							modelUnavailableReason={modelUnavailableReason}
							thinkingUnavailableReason={mainReasoningUnavailableReason}
							thinkingValues={mainReasoningValues}
							onModelChange={(mainModel) => setDraft((current) => ({ ...current, mainModel }))}
							onThinkingChange={(mainThinkingLevel) => setDraft((current) => ({ ...current, mainThinkingLevel }))}
							onFastChange={(mainFast) => setDraft((current) => ({ ...current, mainFast }))}
						/>
						{nativeSubagents?.configurable ? (
							<InlineCheckboxToggle
								disabled={readOnly || Boolean(runtimeUnavailableReason)}
								checked={effectiveNativeSubagents}
								title="Native Subagents"
								onToggle={() => setDraft((current) => ({
									...current,
									nativeSubagents: !(current.nativeSubagents ?? nativeSubagents.enabledByDefault),
								}))}
							/>
						) : null}
						{contextDiscovery?.supported ? (
							<InlineCheckboxToggle
								disabled={readOnly || !contextDiscovery.configurable || Boolean(contextUnavailableReason)}
								checked={automaticContextChecked}
								title={contextDiscovery.configurable
									? "Automatic Context Discovery"
									: `${selectedRuntime?.displayName ?? "This runtime"} discovers project context files natively; Pibo cannot override this setting.`}
								onToggle={() => setDraft((current) => ({ ...current, autoContextFiles: !(current.autoContextFiles ?? true) }))}
							/>
						) : null}
						<BuiltinToolsDesigner draft={draft} setDraft={setDraft} readOnly={readOnly} capabilityUnavailableReason={piBuiltinToolsUnavailableReason} />
					</DesignerPanel>
					<DesignerPanel title="Tools">
						{piboToolsUnavailableReason ? <RuntimeCapabilityNotice reason={piboToolsUnavailableReason} /> : null}
						<CatalogGroupGrid
							groups={nativeToolGroups}
							empty={catalog ? <EmptyCatalog message="No native tools registered" /> : <EmptyCatalog />}
							renderItem={(tool) => {
								const portabilityReason = piboToolsUseMcp && tool.portable === false
									? "Legacy Pi-native definition; unavailable through the session-scoped MCP bridge."
									: null;
								const unavailableReason = piboToolsUnavailableReason ?? portabilityReason;
								return <CatalogToggle
									key={tool.name}
									disabled={readOnly || Boolean(unavailableReason && !draft.nativeTools.includes(tool.name))}
									checked={draft.nativeTools.includes(tool.name)}
									title={tool.name}
									description={tool.description}
									meta={unavailableReason ?? (tool.yieldable ? "portable / yieldable" : "portable / direct only")}
									onToggle={() => setDraft((current) => ({ ...current, nativeTools: toggleName(current.nativeTools, tool.name) }))}
								/>;
							}}
						/>
					</DesignerPanel>
					<DesignerPanel title="Skills">
						{skillsUnavailableReason ? <RuntimeCapabilityNotice reason={skillsUnavailableReason} /> : null}
						<CatalogGroupGrid
							groups={skillGroups}
							empty={catalog ? <EmptyCatalog message="No skills registered" /> : <EmptyCatalog />}
							renderItem={(skill) => (
								<CatalogToggle
									key={skill.name}
									disabled={readOnly || Boolean(skillsUnavailableReason && !draft.skills.includes(skill.name))}
									checked={draft.skills.includes(skill.name)}
									title={skill.name}
									description={skill.path}
									meta={skillsUnavailableReason ?? skillMeta(skill)}
									metaClass={skill.kind === "user" ? "text-amber-200" : "text-[#11a4d4]"}
									onToggle={() => setDraft((current) => ({ ...current, skills: toggleName(current.skills, skill.name) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<CatalogSection title="Packages">
						{piboToolsUnavailableReason ? <div className="col-span-full"><RuntimeCapabilityNotice reason={piboToolsUnavailableReason} /></div> : null}
						{draft.runControl && nativeToolYieldingUnavailableReason ? <div className="col-span-full"><RuntimeCapabilityNotice reason={nativeToolYieldingUnavailableReason} /></div> : null}
						<CatalogToggle disabled={readOnly || Boolean(piboToolsUnavailableReason && !draft.goalControl)} checked={draft.goalControl} title="pibo-goal-control" description="Expose get_goal, create_goal, and update_goal for persisted Goal Loop lifecycle and accounting." meta={piboToolsUnavailableReason ?? "portable package"} onToggle={() => setDraft((current) => ({ ...current, goalControl: !current.goalControl }))} />
						<CatalogToggle disabled={readOnly || Boolean(piboToolsUnavailableReason && !draft.runControl)} checked={draft.runControl} title="pibo-run-control" description="Expose pibo_run_* for Pibo-managed tools and subagents. Private harness-native tools are included only when the runtime declares native-tool yielding." meta={piboToolsUnavailableReason ?? nativeToolYieldingUnavailableReason ?? "portable + runtime-native"} onToggle={() => setDraft((current) => ({ ...current, runControl: !current.runControl }))} />
					</CatalogSection>
					<PiPackagesDesigner
						packages={catalog?.piPackages}
						draft={draft}
						setDraft={setDraft}
						readOnly={readOnly}
						capabilityUnavailableReason={piPackagesUnavailableReason}
					/>
					<DesignerPanel title="Context Files">
						{contextUnavailableReason ? <RuntimeCapabilityNotice reason={contextUnavailableReason} /> : null}
						{draft.brokenContextFiles?.length ? (
							<div className="border border-red-500/60 bg-red-500/10 rounded-sm p-3 space-y-2">
								<div className="flex items-start gap-2 text-red-100">
									<AlertTriangle size={14} className="mt-0.5 shrink-0" />
									<div className="space-y-1">
										<div className="text-sm font-medium">This agent references missing or unregistered context files.</div>
										<div className="text-xs text-red-200/90">Re-check context files before removing links that may still exist on disk.</div>
									</div>
								</div>
								<button
									type="button"
									disabled={refreshingContextFiles}
									onClick={() => void refreshContextFileRegistry()}
									className="inline-flex w-fit items-center gap-2 border border-red-500/50 rounded-sm px-2 py-1 text-xs font-medium text-red-100 hover:border-red-300 hover:text-white disabled:opacity-50"
									title="Re-check Context Files"
								>
									<RefreshCw size={12} className={refreshingContextFiles ? "animate-spin" : undefined} />
									{refreshingContextFiles ? "Re-checking..." : "Re-check context files"}
								</button>
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
							<input id="agent-designer-new-context-file" name="newContextFile" aria-label="New context file" value={newContextFileName} disabled={readOnly || Boolean(contextUnavailableReason)} onChange={(event) => setNewContextFileName(event.target.value)} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="New context file" />
							<button type="button" disabled={readOnly || Boolean(contextUnavailableReason) || saving || !newContextFileName.trim() || Boolean(agentNameError)} onClick={() => void createContextFileForDraft()} title="Create Context File" aria-label="Create Context File" className="h-9 w-9 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50">
								<Plus size={14} />
							</button>
						</div>
						<div className="inline-flex w-fit gap-1 border border-slate-800 bg-[#0e1116] rounded-sm p-1">
							<button type="button" disabled={readOnly || Boolean(contextUnavailableReason)} onClick={() => setNewContextFileScope("agent")} className={`px-2 py-1 text-xs rounded-sm ${newContextFileScope === "agent" ? "bg-[#11a4d4]/20 text-sky-100" : "text-slate-500 hover:text-slate-300"}`}>Agent</button>
							<button type="button" disabled={readOnly || Boolean(contextUnavailableReason)} onClick={() => setNewContextFileScope("global")} className={`px-2 py-1 text-xs rounded-sm ${newContextFileScope === "global" ? "bg-[#11a4d4]/20 text-sky-100" : "text-slate-500 hover:text-slate-300"}`}>Global</button>
						</div>
						<CatalogGroupGrid
							groups={contextFileGroups}
							empty={catalog ? <EmptyCatalog message="No context files registered" /> : <EmptyCatalog />}
							renderItem={(contextFile) => (
								<CatalogToggle
									key={contextFile.key}
									disabled={readOnly || Boolean(contextUnavailableReason && !draft.contextFiles.includes(contextFile.key))}
									checked={draft.contextFiles.includes(contextFile.key)}
									title={contextFile.label ?? contextFile.key}
									description={contextFile.path}
									meta={contextUnavailableReason ?? contextFileMeta(contextFile)}
									metaClass="text-[#11a4d4]"
									actionLabel="Edit"
									actionIcon={<Edit3 size={12} />}
									onAction={() => void runAfterAutosave(() => onEditContextFile(contextFile.key))}
									onToggle={() => setDraft((current) => ({ ...current, contextFiles: toggleName(current.contextFiles, contextFile.key) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<SubagentDesigner
						draft={draft}
						setDraft={setDraft}
						profileOptions={profileOptions}
						agents={agents}
						customAgents={activeCustomAgents}
						catalog={catalog ?? undefined}
						legacyModelCatalog={modelCatalog}
						readOnly={readOnly}
						capabilityUnavailableReason={piboToolsUnavailableReason}
					/>
					<McpServersDesigner
						servers={catalog?.mcpServers}
						draft={draft}
						setDraft={setDraft}
						readOnly={readOnly}
						capabilityUnavailableReason={mcpUnavailableReason}
						onEditServer={(name) => void runAfterAutosave(() => onEditMcpServer(name))}
					/>
					{archivedDraft && draft.profileName ? (
						<DesignerPanel title="Delete Agent">
							<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
								Permanently deleting this agent also deletes all Chat sessions that use profile <span className="font-mono">{draft.profileName}</span>.
							</div>
							<input name="deleteAgentConfirmation" aria-label="Confirm agent name for permanent deletion" value={deleteConfirmName} onChange={(event) => setDeleteConfirmName(event.target.value)} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500" placeholder={draft.profileName} />
							<button type="button" onClick={() => void deleteDraft()} disabled={saving || deleteConfirmName !== draft.profileName} className="h-8 w-fit inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50">
								<Trash2 size={14} />
								Delete permanently
							</button>
						</DesignerPanel>
					) : null}
				</div>
				</div>
			</main>
		</>
	);
}

function RuntimeCapabilityNotice({ reason }: { reason: string }) {
	return (
		<div className="border border-[#f59e0b]/50 bg-[#f59e0b]/10 px-3 py-2 text-xs text-amber-100 rounded-sm">
			{reason} Existing selections remain visible so they can be removed.
		</div>
	);
}

function PiPackagesDesigner({
	packages,
	draft,
	setDraft,
	readOnly,
	capabilityUnavailableReason,
}: {
	packages?: PiPackageCatalogItem[];
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
	capabilityUnavailableReason: string | null;
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
			{capabilityUnavailableReason ? <RuntimeCapabilityNotice reason={capabilityUnavailableReason} /> : null}
			<div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
				{packageList.length} available / {selectedCount} selected / {allPackages.length} registered
			</div>
			{packages ? (
				packageList.length ? (
					<div className="grid gap-2">
						{packageList.map((pkg) => {
							const selected = isPiPackageSelected(draft.piPackages, pkg);
							return <PiPackageCard
								key={pkg.id}
								pkg={pkg}
								selected={selected}
								readOnly={readOnly || Boolean(capabilityUnavailableReason && !selected)}
								expanded={expanded.has(pkg.id)}
								busy={false}
								onToggleSelected={() => {
									if (!readOnly) {
										setDraft((current) => ({ ...current, piPackages: togglePiPackageSelection(current.piPackages, pkg) }));
									}
								}}
								onToggleExpanded={() => toggleExpanded(pkg.id)}
							/>;
						})}
					</div>
				) : <EmptyCatalog message="No installed and enabled Pi packages available. Manage Pi Packages in Settings." />
			) : <EmptyCatalog />}
		</DesignerPanel>
	);
}

function BuiltinToolsDesigner({
	draft,
	setDraft,
	readOnly,
	capabilityUnavailableReason,
}: {
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
	capabilityUnavailableReason: string | null;
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
				<div className="border-t border-slate-800 p-2 grid gap-2">
					{capabilityUnavailableReason ? <RuntimeCapabilityNotice reason={capabilityUnavailableReason} /> : null}
					<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
						{DEFAULT_BUILTIN_TOOL_NAMES.map((toolName) => (
							<CatalogToggle
								key={toolName}
								disabled={readOnly || Boolean(capabilityUnavailableReason && !selectedTools.includes(toolName))}
								checked={selectedTools.includes(toolName)}
								title={toolName}
								description={BUILTIN_TOOL_DESCRIPTIONS[toolName]}
								meta={capabilityUnavailableReason ?? "built-in"}
								onToggle={() => toggleBuiltinTool(toolName)}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function SubagentDesigner({
	draft,
	setDraft,
	profileOptions,
	agents,
	customAgents,
	catalog,
	legacyModelCatalog,
	readOnly,
	capabilityUnavailableReason,
}: {
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	profileOptions: Array<{ value: string; label: string }>;
	agents: BootstrapData["agents"];
	customAgents: CustomAgent[];
	catalog?: AgentCatalog;
	legacyModelCatalog?: ModelCatalog;
	readOnly: boolean;
	capabilityUnavailableReason: string | null;
}) {
	const updateSubagent = (index: number, patch: Partial<CustomAgentSubagent>) => {
		setDraft((current) => ({
			...current,
			subagents: current.subagents.map((subagent, itemIndex) => itemIndex === index ? { ...subagent, ...patch } : subagent),
		}));
	};
	const configurationReadOnly = readOnly || Boolean(capabilityUnavailableReason);

	return (
		<DesignerPanel title="Subagents">
			{capabilityUnavailableReason ? <RuntimeCapabilityNotice reason={capabilityUnavailableReason} /> : null}
			<div className="flex items-center justify-between gap-3">
				<div className="text-xs text-slate-500">Descriptions are shown to the parent agent. Model and thinking settings apply to newly created child sessions.</div>
				<button
					type="button"
					disabled={configurationReadOnly}
					onClick={() => setDraft((current) => ({
						...current,
						subagents: [...current.subagents, { name: "helper", targetProfile: profileOptions[0]?.value ?? "base", maxDepth: 1 }],
					}))}
					className="h-7 w-7 shrink-0 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					title="Add Subagent"
					aria-label="Add Subagent"
				>
					<Plus size={13} />
				</button>
			</div>
			<div className="grid gap-3">
				{draft.subagents.map((subagent, index) => {
					const runtimeInstanceId = subagentTargetRuntimeInstanceId(subagent.targetProfile, draft, agents, customAgents);
					const runtime = catalog?.agentRuntimes.find((candidate) => candidate.id === runtimeInstanceId);
					const runtimeUnavailableReason = !catalog
						? null
						: runtime
							? runtime.available
								? null
								: runtime.diagnostics.find((diagnostic) => diagnostic.severity === "error")?.message ?? "The target runtime is unavailable."
							: `Runtime instance "${runtimeInstanceId}" is not registered.`;
					const targetModelCatalog = runtime
						? modelCatalogForRuntime(runtime, legacyModelCatalog)
						: runtimeInstanceId === "pi" ? legacyModelCatalog : undefined;
					const modelUnavailableReason = runtimeUnavailableReason
						?? (runtime && !runtime.capabilities.models.catalog ? "The target runtime does not expose a model catalog to Agent Designer." : null);
					const reasoningValues = reasoningValuesForModel(runtime?.capabilities.reasoning.values, targetModelCatalog, subagent.model);
					const thinkingUnavailableReason = runtimeUnavailableReason
						?? (runtime && !runtime.capabilities.reasoning.supported ? "The target runtime does not support profile-level reasoning control." : null)
						?? (subagent.model && reasoningValues?.length === 0 ? `Model "${subagent.model.id}" does not advertise a selectable reasoning effort.` : null);
					return (
						<div key={index} className="grid gap-3 border border-slate-800 bg-[#151f24] p-3 rounded-sm">
							<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_100px_auto] max-[1100px]:grid-cols-1 gap-2">
								<label className="grid gap-1">
									<span className="text-[10px] uppercase tracking-wider text-slate-500">Name</span>
									<input name={`subagents.${index}.name`} aria-label={`Subagent ${index + 1} name`} value={subagent.name} disabled={configurationReadOnly} onChange={(event) => updateSubagent(index, { name: event.target.value })} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="name" />
								</label>
								<label className="grid gap-1">
									<span className="text-[10px] uppercase tracking-wider text-slate-500">Target profile</span>
									<select name={`subagents.${index}.targetProfile`} aria-label={`Subagent ${index + 1} target profile`} value={subagent.targetProfile} disabled={configurationReadOnly} onChange={(event) => updateSubagent(index, { targetProfile: event.target.value, model: undefined, thinkingLevel: undefined })} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60">
										{profileOptions.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
									</select>
								</label>
								<label className="grid gap-1">
									<span className="text-[10px] uppercase tracking-wider text-slate-500">Max depth</span>
									<input name={`subagents.${index}.maxDepth`} aria-label={`Subagent ${index + 1} max depth`} type="number" min={1} disabled={configurationReadOnly} value={subagent.maxDepth ?? 1} onChange={(event) => updateSubagent(index, { maxDepth: Number(event.target.value) || 1 })} className="min-w-0 w-full bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" />
								</label>
								<div className="grid content-end">
									<button type="button" disabled={readOnly} onClick={() => setDraft((current) => ({ ...current, subagents: current.subagents.filter((_, itemIndex) => itemIndex !== index) }))} className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-500 hover:text-red-300 disabled:opacity-50" title="Remove Subagent" aria-label="Remove Subagent">
										<X size={14} />
									</button>
								</div>
							</div>
							<label className="grid gap-1">
								<span className="text-[10px] uppercase tracking-wider text-slate-500">Parent-visible description</span>
								<textarea
									name={`subagents.${index}.description`}
									aria-label={`Subagent ${index + 1} description`}
									value={subagent.description ?? ""}
									disabled={configurationReadOnly}
									onChange={(event) => updateSubagent(index, { description: event.target.value })}
									className="min-h-[64px] bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1.5 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
									placeholder="Describe when the parent agent should delegate to this subagent."
								/>
							</label>
							<AgentRuntimeOptions
								title={`Execution / ${runtime?.displayName ?? runtimeInstanceId}`}
								modelTitle="Subagent Model"
								model={subagent.model}
								thinking={subagent.thinkingLevel}
								modelCatalog={targetModelCatalog}
								readOnly={configurationReadOnly}
								modelHint="Unset to use the target profile or Settings default."
								modelUnavailableReason={modelUnavailableReason}
								thinkingUnavailableReason={thinkingUnavailableReason}
								thinkingValues={reasoningValues}
								showFast={false}
								onModelChange={(model) => updateSubagent(index, { model })}
								onThinkingChange={(thinkingLevel) => updateSubagent(index, { thinkingLevel })}
							/>
						</div>
					);
				})}
				{draft.subagents.length === 0 ? <div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">No subagents configured</div> : null}
			</div>
		</DesignerPanel>
	);
}

function subagentTargetRuntimeInstanceId(
	targetProfile: string,
	draft: AgentDraft,
	agents: BootstrapData["agents"],
	customAgents: CustomAgent[],
): string {
	if (targetProfile === draft.profileName || targetProfile === draft.displayName) return draft.runtimeInstanceId;
	const customAgent = customAgents.find((agent) => agent.profileName === targetProfile || agent.profileAliases?.includes(targetProfile));
	if (customAgent) return customAgent.runtimeInstanceId;
	const profile = agents.find((agent) => agent.name === targetProfile || agent.aliases.includes(targetProfile));
	return profile?.runtimeInstanceId ?? "pi";
}

function McpServersDesigner({
	servers,
	draft,
	setDraft,
	readOnly,
	capabilityUnavailableReason,
	onEditServer,
}: {
	servers?: AgentCatalog["mcpServers"];
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
	capabilityUnavailableReason: string | null;
	onEditServer: (serverName: string) => void;
}) {
	return (
		<DesignerPanel title="MCP Servers">
			{capabilityUnavailableReason ? <RuntimeCapabilityNotice reason={capabilityUnavailableReason} /> : null}
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
				{servers ? servers.map((server) => {
					const selected = draft.mcpServers.includes(server.name);
					const selectionDisabled = readOnly || (!server.hasDescription && !selected) || Boolean(capabilityUnavailableReason && !selected);
					return (
						<div key={server.name} className={`border rounded-sm bg-[#151f24] p-2 ${selected ? "border-[#11a4d4]" : server.hasDescription ? "border-slate-800" : "border-[#f59e0b]/60"}`}>
							<button
								type="button"
								disabled={selectionDisabled}
								onClick={() => setDraft((current) => ({ ...current, mcpServers: toggleName(current.mcpServers, server.name) }))}
								className="grid w-full min-w-0 grid-cols-[18px_1fr] gap-2 text-left disabled:opacity-60"
							>
								<SelectionCheckbox checked={selected} disabled={selectionDisabled} className="mt-0.5" />
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
function agentNamesInUse(agents: BootstrapData["agents"], customAgents: CustomAgent[]): string[] {
	return [
		...agents.flatMap((agent) => [agent.name, ...agent.aliases]),
		...customAgents.flatMap((agent) => [agent.profileName, ...(agent.profileAliases ?? []), agent.displayName]),
	];
}

function unsupportedDeliveryReason(delivery: AgentRuntimeCapabilityDelivery | undefined, label: string): string | null {
	if (!delivery || delivery.support !== "unsupported") return null;
	return `${label} are unavailable for this runtime: ${delivery.reason}`;
}

function formatModelProfile(model: ModelProfile): string {
	return `${model.provider}/${model.id}`;
}
