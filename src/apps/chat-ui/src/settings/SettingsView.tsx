import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BookA,
	ChevronDown,
	ChevronRight,
	Edit3,
	ExternalLink,
	Key,
	Keyboard,
	Layers,
	Plus,
	Power,
	PowerOff,
	Settings,
	Trash2,
	Wrench,
} from "lucide-react";
import { createUserSkill, deletePiPackage, deleteUserSkill, getUserSkill, installUserSkill, patchPiPackage, postPiPackage, updateUserSkill } from "../api-agent-designer";
import { getUserSettings, patchModelDefaults, patchUserSettings } from "../api-settings";
import { piPackageMeta, type PiPackageCatalogItem } from "../agents/agent-designer-model";
import { AgentRuntimeOptions, DesignerPanel, EmptyCatalog, InlineCheckboxToggle, PiPackageDetails } from "../agents/designer-ui";
import { writeStoredExpandThinking, writeStoredShowThinking } from "../app-storage";
import type { ModelCatalog, ModelDefaults, ModelProfile, UserSkill } from "../types";
import {
	DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT,
	normalizeShortcutLabel,
	notifyWebAnnotationShortcutChanged,
	readStoredWebAnnotationToggleShortcut,
	writeStoredWebAnnotationToggleShortcut,
} from "../web-annotation-storage";
import { ProviderSettingsView } from "./ProviderSettingsView";
import type { SettingsPanel } from "./types";

export function SettingsView({
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
	onProviderAuthChanged,
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
	onProviderAuthChanged?: () => void | Promise<void>;
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
				<ProviderSettingsView piboSessionId={piboSessionId} onProviderAuthChanged={onProviderAuthChanged} />
			</div>
		);
	}

	if (activePanel === "shortcuts") {
		return (
			<div className="p-6 overflow-auto">
				<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
					<Keyboard size={16} />
					Shortcuts
				</h1>
				<ShortcutsSettings />
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
				<UserTimezoneSettings />
				<InlineCheckboxToggle
					checked={showThinking}
					title="Show thinking blocks"
					onToggle={() => {
						const next = !showThinking;
						setShowThinking(next);
						writeStoredShowThinking(next);
					}}
				/>
				<InlineCheckboxToggle
					checked={expandThinking}
					disabled={!showThinking}
					title="Expand thinking blocks"
					onToggle={() => {
						const next = !expandThinking;
						setExpandThinking(next);
						writeStoredExpandThinking(next);
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

const FALLBACK_TIMEZONES = [
	"UTC",
	"Europe/Berlin",
	"Europe/London",
	"Europe/Paris",
	"Europe/Madrid",
	"Europe/Rome",
	"Europe/Amsterdam",
	"Europe/Vienna",
	"Europe/Zurich",
	"Europe/Warsaw",
	"Europe/Istanbul",
	"America/New_York",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"America/Toronto",
	"America/Sao_Paulo",
	"America/Mexico_City",
	"Asia/Dubai",
	"Asia/Jerusalem",
	"Asia/Kolkata",
	"Asia/Bangkok",
	"Asia/Singapore",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Asia/Seoul",
	"Australia/Sydney",
	"Australia/Melbourne",
	"Pacific/Auckland",
] as const;

function UserTimezoneSettings() {
	const queryClient = useQueryClient();
	const { data, isLoading } = useQuery({ queryKey: ["user-settings"], queryFn: getUserSettings });
	const timezoneOptions = useMemo(() => buildTimezoneOptions(data?.timezone), [data?.timezone]);
	const [draft, setDraft] = useState("UTC");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (data?.timezone) setDraft(data.timezone);
	}, [data?.timezone]);

	const save = async (timezone = draft) => {
		setSaving(true);
		setError(null);
		try {
			const saved = await patchUserSettings({ timezone });
			setDraft(saved.timezone);
			queryClient.setQueryData(["user-settings"], saved);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="border-b border-slate-800 pb-4 mb-4">
			<div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">App timezone</div>
			<div className="max-w-xl">
				<select
					value={draft}
					disabled={isLoading || saving}
					onChange={(event) => {
						const timezone = event.target.value;
						setDraft(timezone);
						void save(timezone);
					}}
					className="w-full min-w-0 rounded-sm border border-slate-700 bg-[#0e1116] px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
				>
					{timezoneOptions.map((option) => (
						<option key={option.value} value={option.value}>{option.label}</option>
					))}
				</select>
			</div>
			<div className="mt-2 text-[11px] text-slate-500">Choose a city-based timezone. Changes are saved automatically and loaded into every runtime context together with the current Pibo Session ID.</div>
			{saving ? <div className="mt-2 text-xs text-slate-400">Saving…</div> : null}
			{error ? <div className="mt-2 text-xs text-red-300">{error}</div> : null}
		</div>
	);
}

function ShortcutsSettings() {
	const queryClient = useQueryClient();
	const { data, isLoading } = useQuery({ queryKey: ["user-settings"], queryFn: getUserSettings });
	const [draft, setDraft] = useState(DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT);
	const [recording, setRecording] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const shortcut = data?.shortcuts?.webAnnotationsToggle || readStoredWebAnnotationToggleShortcut();
		setDraft(shortcut);
		writeStoredWebAnnotationToggleShortcut(shortcut);
		notifyWebAnnotationShortcutChanged(shortcut);
	}, [data?.shortcuts?.webAnnotationsToggle]);

	const save = async (shortcut: string) => {
		const normalized = normalizeShortcutLabel(shortcut) || DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT;
		setDraft(normalized);
		setSaving(true);
		setError(null);
		try {
			const saved = await patchUserSettings({ shortcuts: { webAnnotationsToggle: normalized } });
			queryClient.setQueryData(["user-settings"], saved);
			writeStoredWebAnnotationToggleShortcut(saved.shortcuts.webAnnotationsToggle);
			notifyWebAnnotationShortcutChanged(saved.shortcuts.webAnnotationsToggle);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<DesignerPanel title="Shortcuts">
			<div className="grid max-w-2xl gap-3 rounded-sm border border-slate-800 bg-[#151f24] p-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><BookA size={15} /> Toggle annotation mode</div>
						<div className="mt-1 text-xs text-slate-500">Toggles the Web Annotation element mode with the pencil button.</div>
					</div>
					<kbd className="rounded-sm border border-slate-700 bg-[#0e1116] px-2 py-1 font-mono text-xs text-[#7dd3fc]">{draft}</kbd>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						disabled={isLoading || saving}
						aria-pressed={recording}
						onClick={() => setRecording((current) => !current)}
						onKeyDown={(event) => {
							if (!recording) return;
							const shortcut = shortcutFromKeyboardEvent(event);
							if (!shortcut) return;
							event.preventDefault();
							event.stopPropagation();
							setRecording(false);
							void save(shortcut);
						}}
						className={`rounded-sm border px-3 py-2 text-xs font-medium ${recording ? "border-[#11a4d4] bg-[#11a4d4]/10 text-sky-100" : "border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#7dd3fc]"} disabled:opacity-50`}
					>
						{recording ? "Press shortcut…" : "Record shortcut"}
					</button>
					<button type="button" disabled={saving || draft === DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT} onClick={() => void save(DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT)} className="rounded-sm border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-[#11a4d4] hover:text-[#7dd3fc] disabled:opacity-50">
						Reset
					</button>
					{saving ? <span className="text-xs text-slate-400">Saving…</span> : null}
				</div>
				<div className="text-[11px] text-slate-500">Default: {DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT}. Use a modifier combination to avoid conflicts with normal typing.</div>
				{error ? <div className="text-xs text-red-300">{error}</div> : null}
			</div>
		</DesignerPanel>
	);
}

function shortcutFromKeyboardEvent(event: { key: string; code?: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): string | null {
	if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return null;
	const key = event.code?.match(/^Key[A-Z]$/) ? event.code.slice(3) : event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
	const parts = [];
	if (event.ctrlKey) parts.push("Ctrl");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	if (event.metaKey) parts.push("Meta");
	parts.push(key);
	return parts.join("+");
}

function buildTimezoneOptions(currentTimezone: string | undefined): Array<{ value: string; label: string }> {
	const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
	const zones = new Set<string>(["UTC", ...(intl.supportedValuesOf?.("timeZone") ?? FALLBACK_TIMEZONES)]);
	if (currentTimezone) zones.add(currentTimezone);
	return [...zones]
		.map((timezone) => ({ value: timezone, label: timezoneLabel(timezone), offset: timezoneOffsetMinutes(timezone) }))
		.sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label))
		.map(({ value, label }) => ({ value, label }));
}

function timezoneLabel(timezone: string): string {
	const city = timezone === "UTC" ? "UTC" : timezone.split("/").pop()?.replaceAll("_", " ") ?? timezone;
	const region = timezone.includes("/") ? timezone.split("/")[0].replaceAll("_", " ") : undefined;
	const offset = timezoneOffsetLabel(timezone);
	return `${city}${region ? ` (${region})` : ""} — ${offset}`;
}

function timezoneOffsetLabel(timezone: string): string {
	try {
		const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" }).formatToParts(new Date());
		return parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "UTC") ?? timezone;
	} catch {
		return timezone;
	}
}

function timezoneOffsetMinutes(timezone: string): number {
	const label = timezoneOffsetLabel(timezone);
	const match = /^UTC(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/.exec(label);
	if (!match?.groups?.sign) return 0;
	const direction = match.groups.sign === "-" ? -1 : 1;
	return direction * (Number(match.groups.hours) * 60 + Number(match.groups.minutes ?? 0));
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
			<AgentRuntimeOptions
				title="Main Agent"
				modelTitle="Main Agent Default"
				model={draft.main}
				thinking={draft.mainThinking}
				fast={draft.mainFast ?? false}
				modelCatalog={modelCatalog}
				readOnly={saving}
				modelHint="Unset to use provider fallback."
				configuredProvidersOnly
				onModelChange={(main) => void save({ ...draft, main })}
				onThinkingChange={(mainThinking) => void save({ ...draft, mainThinking })}
				onFastChange={(mainFast) => void save({ ...draft, mainFast })}
			/>
			<AgentRuntimeOptions
				title="Subagent"
				modelTitle="Subagent Default"
				model={draft.subagent}
				thinking={draft.subagentThinking}
				fast={draft.subagentFast ?? false}
				modelCatalog={modelCatalog}
				readOnly={saving}
				modelHint="Unset to use provider fallback."
				configuredProvidersOnly
				onModelChange={(subagent) => void save({ ...draft, subagent })}
				onThinkingChange={(subagentThinking) => void save({ ...draft, subagentThinking })}
				onFastChange={(subagentFast) => void save({ ...draft, subagentFast })}
			/>
			{error ? <div className="text-xs text-amber-100">{error}</div> : null}
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


function SettingsModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div className="w-full max-w-2xl rounded-sm border border-slate-700 bg-[#151f24] shadow-2xl">
				{children}
			</div>
			<button type="button" className="absolute inset-0 -z-10" onClick={onClose} aria-label="Close modal" />
		</div>
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
		<SettingsModal onClose={onClose}>
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
		</SettingsModal>
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
		<SettingsModal onClose={onClose}>
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
		</SettingsModal>
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
