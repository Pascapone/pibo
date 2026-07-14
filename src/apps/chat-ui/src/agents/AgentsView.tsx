import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
	Archive,
	ArchiveRestore,
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	CopyPlus,
	Edit3,
	MessageSquarePlus,
	Plus,
	RefreshCw,
	Server,
	Trash2,
	X,
} from "lucide-react";
import { deleteCustomAgent, getCustomAgents, patchCustomAgent, postCustomAgent } from "../api-agent-designer";
import type { SaveState } from "../api";
import { listContextFiles, postContextFile } from "../api-context-files";
import type { AgentCatalog, BootstrapData, CustomAgent, CustomAgentSubagent, ModelCatalog, ModelProfile } from "../types";
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
	normalizeBuiltinToolNames,
	profileToDraft,
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
	CatalogGroupGrid,
	CatalogSection,
	CatalogToggle,
	DesignerPanel,
	EmptyCatalog,
	InlineCheckboxToggle,
	PiPackageCard,
	SelectionCheckbox,
} from "./designer-ui";

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
		return { draft: parsed.draft, savedSignature: typeof parsed.savedSignature === "string" ? parsed.savedSignature : null };
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
	initialCatalog,
	modelCatalog,
	onSelect,
	onCreateSession,
	onEditContextFile,
	onEditMcpServer,
	onAgentsChanged,
	onAutosaveHandlerChange,
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
	onAutosaveHandlerChange: (handler: (() => Promise<void>) | null) => void;
	creatingSession: boolean;
}) {
	const [initialDraftState] = useState(() => {
		const pending = readPendingAgentDraft();
		const initialDraft = pending?.draft ?? createBlankAgentDraft(initialCatalog);
		return {
			draft: initialDraft,
			savedSignature: pending ? pending.savedSignature : agentDraftSignature(initialDraft),
			restored: Boolean(pending),
		};
	});
	const [catalog, setCatalog] = useState<AgentCatalog | null>(initialCatalog ?? null);
	const [customAgents, setCustomAgents] = useState(initialCustomAgents);
	const [draft, setDraft] = useState<AgentDraft>(initialDraftState.draft);
	const [showUnsavedAgentDraft, setShowUnsavedAgentDraft] = useState(initialDraftState.restored && !initialDraftState.draft.id);
	const [saveState, setSaveState] = useState<SaveState>(initialDraftState.restored ? "idle" : "saved");
	const [editingName, setEditingName] = useState(false);
	const [saving, setSaving] = useState(false);
	const [refreshingContextFiles, setRefreshingContextFiles] = useState(false);
	const autoRefreshedBrokenContextFilesRef = useRef(new Set<string>());
	const [showArchivedAgents, setShowArchivedAgents] = useState(() => localStorage.getItem("pibo.chat.showArchivedAgents") === "true");
	const [deleteConfirmName, setDeleteConfirmName] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);
	const [newContextFileName, setNewContextFileName] = useState("");
	const [newContextFileScope, setNewContextFileScope] = useState<"global" | "agent">("agent");
	const currentDraftRef = useRef(draft);
	const customAgentsRef = useRef(customAgents);
	const savedSignatureRef = useRef<string | null>(initialDraftState.savedSignature);
	const savePromiseRef = useRef<Promise<void> | null>(null);
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

	const activateDraft = useCallback((nextDraft: AgentDraft, savedSignature: string | null) => {
		clearAutosaveTimer();
		currentDraftRef.current = nextDraft;
		savedSignatureRef.current = savedSignature;
		setDraft(nextDraft);
		setShowUnsavedAgentDraft(nextDraft.source === "custom" && !nextDraft.id);
		setEditingName(false);
		setSaveState(savedSignature === agentDraftSignature(nextDraft) ? "saved" : "idle");
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
		writePendingAgentDraft(draft, savedSignatureRef.current);
		setSaveState((current) => current === "saving" ? current : "idle");
		if (editingName || validateAgentName(draft.displayName) || !catalogRef.current) return;
		clearAutosaveTimer();
		autosaveTimerRef.current = window.setTimeout(() => {
			autosaveTimerRef.current = null;
			void persistIfNeeded().catch(() => undefined);
		}, AGENT_AUTOSAVE_DELAY_MS);
	}, [clearAutosaveTimer, designerAvailable, draft, editingName, persistIfNeeded]);

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

	const runAfterAutosave = async (action: () => void | Promise<void>) => {
		try {
			await persistIfNeeded();
			await action();
		} catch {
			// Keep the current draft visible so the user can retry the failed autosave.
		}
	};

	const createNewAgentDraft = () => {
		void runAfterAutosave(() => {
			const usedNames = [
				...agents.flatMap((agent) => [agent.name, ...agent.aliases]),
				...customAgents.flatMap((agent) => [agent.profileName, agent.displayName]),
				...(unsavedAgentDraftVisible ? [draft.displayName] : []),
			];
			const nextDraft = createBlankAgentDraft(catalog ?? undefined, uniqueDraftAgentName(usedNames));
			activateDraft(nextDraft, null);
		});
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

	const deleteDraft = async () => {
		if (!draft.id || !draft.profileName || !archivedDraft) return;
		setSaving(true);
		try {
			await deleteCustomAgent(draft.id, deleteConfirmName);
			setCustomAgents((current) => current.filter((agent) => agent.id !== draft.id));
			const nextDraft = createBlankAgentDraft(catalog ?? undefined);
			activateDraft(nextDraft, agentDraftSignature(nextDraft));
			setShowUnsavedAgentDraft(false);
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
		<div className="h-full min-h-0 overflow-hidden grid grid-cols-[300px_minmax(0,1fr)] max-[920px]:grid-cols-1">
			<aside className="border-r border-slate-800 bg-[#1a262b] min-h-0 overflow-auto">
				<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
					<span>Agents</span>
					<div className="flex items-center gap-1">
						<button type="button" onClick={createNewAgentDraft} title="New Agent" aria-label="New Agent" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
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
						<button type="button" onClick={() => void runAfterAutosave(onAgentsChanged)} title="Refresh" aria-label="Refresh" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
							<RefreshCw size={13} />
						</button>
					</div>
				</div>
				<div className="p-2">
					<AgentList title="Custom Agents">
						{unsavedAgentDraftVisible ? (
							<AgentSidebarRow
								key="unsaved-agent-draft"
								title={draft.displayName || "new-agent"}
								subtitle="unsaved custom agent"
								selected
								onSelect={() => {}}
								onCreateSession={() => {}}
								createSessionDisabled
							/>
						) : null}
						{activeCustomAgents.map((agent) => (
							<AgentSidebarRow
								key={agent.id}
								title={agent.displayName}
								subtitle={agent.profileName}
								selected={draft.source === "custom" && draft.id === agent.id}
								onSelect={() => {
									if (draft.source === "custom" && draft.id === agent.id) return;
									void runAfterAutosave(() => {
										const latestAgent = customAgentsRef.current.find((item) => item.id === agent.id) ?? agent;
										const nextDraft = agentToDraft(latestAgent);
										activateDraft(nextDraft, agentDraftSignature(nextDraft));
										onSelect(latestAgent.profileName);
									});
								}}
								onCopy={() => void runAfterAutosave(() => {
									const latestAgent = customAgentsRef.current.find((item) => item.id === agent.id) ?? agent;
									activateDraft(copyCustomAgentToDraft(latestAgent), null);
								})}
								onCreateSession={() => void runAfterAutosave(() => {
									onSelect(agent.profileName);
									onCreateSession(agent.profileName);
								})}
								createSessionDisabled={creatingSession}
							/>
						))}
						{activeCustomAgents.length === 0 && !unsavedAgentDraftVisible ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No custom agents</div> : null}
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
										if (draft.source === "custom" && draft.id === agent.id) return;
										void runAfterAutosave(() => {
											const latestAgent = customAgentsRef.current.find((item) => item.id === agent.id) ?? agent;
											const nextDraft = agentToDraft(latestAgent);
											activateDraft(nextDraft, agentDraftSignature(nextDraft));
										});
									}}
									onCopy={() => void runAfterAutosave(() => {
										const latestAgent = customAgentsRef.current.find((item) => item.id === agent.id) ?? agent;
										activateDraft(copyCustomAgentToDraft(latestAgent), null);
									})}
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
								onSelect={() => void runAfterAutosave(() => {
									const nextDraft = profileToDraft(agent, catalog ?? undefined);
									activateDraft(nextDraft, agentDraftSignature(nextDraft));
									onSelect(agent.name);
								})}
								onCopy={() => void runAfterAutosave(() => {
									activateDraft(copyProfileToDraft(agent, catalog ?? undefined), null);
								})}
								onCreateSession={() => void runAfterAutosave(() => {
									onSelect(agent.name);
									onCreateSession(agent.name);
								})}
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
						{draft.source === "custom" && !archivedDraft ? (
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
				{designerAvailable ? null : <div className="mb-3 border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">{agentDesignerUnavailableMessage()}</div>}
				{draft.source === "profile" ? <div className="mb-3 border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-sm rounded-sm">This profile is registered by a plugin. Copy it to create an editable custom agent.</div> : null}
				{archivedDraft ? <div className="mb-3 border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">This agent is archived. Restore it before editing or starting new sessions.</div> : null}
				{localError ? <div className="mb-3 border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{localError}</div> : null}
				<div className="grid gap-4">
					<DesignerPanel title="Basics">
						<input value={draft.displayName} disabled={readOnly} onFocus={() => setEditingName(true)} onBlur={() => setEditingName(false)} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} className={`min-w-0 bg-[#0e1116] border rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60 ${agentNameError ? "border-[#f59e0b]" : "border-slate-700"}`} placeholder="agent-name" />
						{agentNameError ? <div className="text-xs text-amber-100">{agentNameError}</div> : null}
						<textarea value={draft.description} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px] bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="Description" />
						{draft.source === "profile" && draft.hardPinnedModel ? (
							<div className="border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-xs rounded-sm">
								This plugin profile hard-pins <span className="font-mono">{formatModelProfile(draft.hardPinnedModel)}</span>. Main-agent and subagent defaults do not apply.
							</div>
						) : null}
						<AgentRuntimeOptions
							title="Main Agent"
							modelTitle="Main Agent Model"
							model={draft.mainModel}
							thinking={draft.mainThinkingLevel}
							fast={draft.mainFast ?? false}
							modelCatalog={modelCatalog}
							readOnly={readOnly}
							modelHint="Unset to use the settings default."
							onModelChange={(mainModel) => setDraft((current) => ({ ...current, mainModel }))}
							onThinkingChange={(mainThinkingLevel) => setDraft((current) => ({ ...current, mainThinkingLevel }))}
							onFastChange={(mainFast) => setDraft((current) => ({ ...current, mainFast }))}
						/>
						<AgentRuntimeOptions
							title="Subagent"
							modelTitle="Subagent Model"
							model={draft.subagentModel}
							thinking={draft.subagentThinkingLevel}
							fast={draft.subagentFast ?? false}
							modelCatalog={modelCatalog}
							readOnly={readOnly}
							modelHint="Unset to use the settings default."
							onModelChange={(subagentModel) => setDraft((current) => ({ ...current, subagentModel }))}
							onThinkingChange={(subagentThinkingLevel) => setDraft((current) => ({ ...current, subagentThinkingLevel }))}
							onFastChange={(subagentFast) => setDraft((current) => ({ ...current, subagentFast }))}
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
									onAction={() => void runAfterAutosave(() => onEditContextFile(contextFile.key))}
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
						onEditServer={(name) => void runAfterAutosave(() => onEditMcpServer(name))}
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
						subagents: [...current.subagents, { name: "helper", targetProfile: profileOptions[0]?.value ?? "base", maxDepth: 3 }],
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
function formatModelProfile(model: ModelProfile): string {
	return `${model.provider}/${model.id}`;
}
