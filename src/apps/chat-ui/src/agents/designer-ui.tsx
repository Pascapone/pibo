import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Power, PowerOff, Trash2 } from "lucide-react";
import { THINKING_LEVELS, type AgentRuntimeCapabilityDelivery, type AgentRuntimeCatalogEntry, type ModelCatalog, type ModelProfile, type ThinkingLevel } from "../types";
import { CATALOG_GROUP_RENDER_LIMIT, piPackageMeta, type CatalogGroup, type PiPackageCatalogItem } from "./agent-designer-model";

export function DesignerPanel({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="overflow-hidden border border-slate-700/90 bg-[#1a262b] rounded-sm">
			<div className="border-b border-slate-800 bg-[#151f24] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-300">{title}</div>
			<div className="grid gap-3 p-4">{children}</div>
		</section>
	);
}

export function CatalogSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<DesignerPanel title={title}>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-2">{children}</div>
		</DesignerPanel>
	);
}

export function CatalogGroupGrid<T>({
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
	const visibleItems = group.items.slice(0, CATALOG_GROUP_RENDER_LIMIT);
	const hiddenCount = group.items.length - visibleItems.length;
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
					<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-2">{visibleItems.map(renderItem)}</div>
					{hiddenCount > 0 ? <div className="mt-2 text-xs text-slate-500">Showing first {CATALOG_GROUP_RENDER_LIMIT} of {group.items.length} items. Use Context to manage the full catalog.</div> : null}
				</div>
			) : null}
		</div>
	);
}

export function CatalogToggle({
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
				{description ? <span className="block break-words text-xs leading-4 text-slate-500">{description}</span> : null}
				{meta ? <span className={`mt-1 block break-words font-mono text-[10px] leading-4 ${metaClass ?? "text-slate-600"}`}>{meta}</span> : null}
			</span>
		</button>
	);
}


export function PiPackageCard({
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

export function PiPackageDetails({ pkg }: { pkg: PiPackageCatalogItem }) {
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


export function InlineCheckboxToggle({
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

export function SelectionCheckbox({
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

export function EmptyCatalog({ message = "Agent Designer API unavailable" }: { message?: string }) {
	return <div className="text-xs text-amber-100 border border-dashed border-[#f59e0b]/50 bg-[#f59e0b]/10 rounded-sm p-3">{message}</div>;
}

export function AgentRuntimeSelector({
	runtimes,
	runtimeInstanceId,
	runtimeOptions,
	readOnly,
	onRuntimeChange,
	onRuntimeOptionsChange,
	onRuntimeOptionsError,
}: {
	runtimes: AgentRuntimeCatalogEntry[];
	runtimeInstanceId: string;
	runtimeOptions: Record<string, unknown>;
	readOnly: boolean;
	onRuntimeChange: (runtimeInstanceId: string) => void;
	onRuntimeOptionsChange: (runtimeOptions: Record<string, unknown>) => void;
	onRuntimeOptionsError: (message: string | null) => void;
}) {
	const canonicalOptions = JSON.stringify(runtimeOptions, null, 2);
	const [optionsText, setOptionsText] = useState(canonicalOptions);
	const [optionsError, setOptionsError] = useState<string | null>(null);
	const [editingOptions, setEditingOptions] = useState(false);
	const selected = runtimes.find((runtime) => runtime.id === runtimeInstanceId);
	const diagnostics = selected?.diagnostics ?? [{
		severity: "error" as const,
		code: "runtime_instance_unknown",
		message: `Runtime instance "${runtimeInstanceId}" is not registered.`,
	}];

	useEffect(() => {
		if (!editingOptions) setOptionsText(canonicalOptions);
	}, [canonicalOptions, editingOptions, runtimeInstanceId]);

	const acceptRuntimeOptions = (nextOptions: Record<string, unknown>) => {
		setOptionsText(JSON.stringify(nextOptions, null, 2));
		setOptionsError(null);
		onRuntimeOptionsError(null);
		onRuntimeOptionsChange(nextOptions);
	};
	const updateOptionsText = (text: string) => {
		setOptionsText(text);
		try {
			const parsed = JSON.parse(text) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Runtime options must be a JSON object.");
			setOptionsError(null);
			onRuntimeOptionsError(null);
			onRuntimeOptionsChange(parsed as Record<string, unknown>);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setOptionsError(message);
			onRuntimeOptionsError(message);
		}
	};

	return (
		<div className="grid gap-3 border border-slate-800 bg-[#101d22]/55 rounded-sm p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Agent Runtime</div>
				<span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${selected?.available ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-200" : "border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100"}`}>
					{selected?.available ? "available" : selected?.enabled === false ? "disabled" : "unavailable"}
				</span>
			</div>
			<div className="grid gap-2 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
				<div className="grid gap-2 content-start">
					<label className="text-[11px] uppercase tracking-wider text-slate-500" htmlFor="agent-runtime-instance">Runtime instance</label>
					<select
						id="agent-runtime-instance"
						value={runtimeInstanceId}
						disabled={readOnly}
						onChange={(event) => {
							setOptionsText("{}");
							setOptionsError(null);
							onRuntimeOptionsError(null);
							onRuntimeChange(event.target.value);
						}}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
					>
						{selected ? null : <option value={runtimeInstanceId}>{runtimeInstanceId} (missing)</option>}
						{runtimes.map((runtime) => (
							<option key={runtime.id} value={runtime.id} disabled={!runtime.available && runtime.id !== runtimeInstanceId}>
								{runtime.displayName} · {runtime.id}{runtime.available ? "" : runtime.enabled ? " (unavailable)" : " (disabled)"}
							</option>
						))}
					</select>
					{selected ? (
						<div className="font-mono text-[10px] text-slate-500">
							adapter {selected.adapterId} · {selected.transport}{selected.protocol ? ` · ${selected.protocol.name}` : ""}
						</div>
					) : null}
				</div>
				<div className="grid gap-2">
					<label className="text-[11px] uppercase tracking-wider text-slate-500" htmlFor="agent-runtime-options">Adapter profile options</label>
					<SchemaRuntimeOptionsFields
						schema={selected?.capabilities.models.optionsSchema}
						value={runtimeOptions}
						readOnly={readOnly}
						onChange={acceptRuntimeOptions}
					/>
					<div className="text-[10px] uppercase tracking-wider text-slate-500">Advanced JSON</div>
					<textarea
						id="agent-runtime-options"
						value={optionsText}
						disabled={readOnly}
						onFocus={() => setEditingOptions(true)}
						onBlur={() => setEditingOptions(false)}
						onChange={(event) => updateOptionsText(event.target.value)}
						spellCheck={false}
						className={`min-h-[88px] bg-[#0e1116] border rounded-sm px-3 py-2 font-mono text-xs outline-none focus:border-[#11a4d4] disabled:opacity-60 ${optionsError ? "border-red-500/70" : "border-slate-700"}`}
					/>
					{optionsError ? <div className="text-xs text-red-200">{optionsError}</div> : <div className="text-xs text-slate-500">Options are validated by the selected runtime before saving.</div>}
					{selected?.capabilities.models.optionsSchema ? (
						<details className="border border-slate-800 bg-[#151f24] rounded-sm px-2 py-1.5">
							<summary className="cursor-pointer text-[10px] uppercase tracking-wider text-slate-500">Profile option schema</summary>
							<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-400">{JSON.stringify(selected.capabilities.models.optionsSchema, null, 2)}</pre>
						</details>
					) : null}
				</div>
			</div>
			<div className="grid gap-1">
				{diagnostics.map((diagnostic, index) => (
					<div key={`${diagnostic.code}:${index}`} className={`border px-2 py-1 text-xs rounded-sm ${diagnostic.severity === "error" ? "border-red-500/50 bg-red-500/10 text-red-200" : diagnostic.severity === "warning" ? "border-[#f59e0b]/50 bg-[#f59e0b]/10 text-amber-100" : "border-slate-700 bg-[#0e1116] text-slate-400"}`}>
						<span className="mr-2 font-mono text-[10px] uppercase">{diagnostic.code}</span>{diagnostic.message}
					</div>
				))}
			</div>
			{selected ? <RuntimeCapabilitySummary runtime={selected} /> : null}
		</div>
	);
}

type RuntimeOptionField = {
	key: string;
	title: string;
	description?: string;
	type: "string" | "number" | "integer" | "boolean";
	enumValues?: Array<string | number | boolean>;
	required: boolean;
};

function SchemaRuntimeOptionsFields({
	schema,
	value,
	readOnly,
	onChange,
}: {
	schema?: Record<string, unknown>;
	value: Record<string, unknown>;
	readOnly: boolean;
	onChange: (value: Record<string, unknown>) => void;
}) {
	const fields = runtimeOptionFields(schema);
	if (fields.length === 0) return null;
	const setField = (field: RuntimeOptionField, nextValue: unknown) => {
		const next = { ...value };
		if (nextValue === undefined || nextValue === "") delete next[field.key];
		else next[field.key] = nextValue;
		onChange(next);
	};
	return (
		<div className="grid gap-2 border border-slate-800 bg-[#151f24] rounded-sm p-2" aria-label="Schema generated runtime options">
			{fields.map((field) => {
				const current = value[field.key];
				return (
					<label key={field.key} className="grid gap-1">
						<span className="text-[11px] text-slate-300">{field.title}{field.required ? <span className="text-[#f59e0b]"> *</span> : null}</span>
						{field.description ? <span className="text-[10px] text-slate-500">{field.description}</span> : null}
						{field.enumValues ? (
							<select
								name={`runtimeOption.${field.key}`}
								value={current === undefined ? "" : String(current)}
								disabled={readOnly}
								onChange={(event) => {
									const selected = field.enumValues!.find((candidate) => String(candidate) === event.target.value);
									setField(field, selected);
								}}
								className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1.5 text-xs outline-none focus:border-[#11a4d4] disabled:opacity-60"
							>
								<option value="">Default</option>
								{field.enumValues.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
							</select>
						) : field.type === "boolean" ? (
							<select
								name={`runtimeOption.${field.key}`}
								value={typeof current === "boolean" ? String(current) : ""}
								disabled={readOnly}
								onChange={(event) => setField(field, event.target.value === "" ? undefined : event.target.value === "true")}
								className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1.5 text-xs outline-none focus:border-[#11a4d4] disabled:opacity-60"
							>
								<option value="">Default</option>
								<option value="true">true</option>
								<option value="false">false</option>
							</select>
						) : (
							<input
								name={`runtimeOption.${field.key}`}
								type={field.type === "number" || field.type === "integer" ? "number" : "text"}
								step={field.type === "integer" ? 1 : undefined}
								value={typeof current === "string" || typeof current === "number" ? current : ""}
								disabled={readOnly}
								onChange={(event) => {
									if (event.target.value === "") setField(field, undefined);
									else if (field.type === "number" || field.type === "integer") setField(field, Number(event.target.value));
									else setField(field, event.target.value);
								}}
								className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1.5 text-xs outline-none focus:border-[#11a4d4] disabled:opacity-60"
							/>
						)}
					</label>
				);
			})}
		</div>
	);
}

function runtimeOptionFields(schema: Record<string, unknown> | undefined): RuntimeOptionField[] {
	if (!schema || schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return [];
	const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : []);
	return Object.entries(schema.properties as Record<string, unknown>).flatMap(([key, raw]) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
		const property = raw as Record<string, unknown>;
		const type = property.type;
		if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean") return [];
		const enumValues = Array.isArray(property.enum)
			? property.enum.filter((item): item is string | number | boolean => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
			: undefined;
		return [{
			key,
			title: typeof property.title === "string" ? property.title : key,
			description: typeof property.description === "string" ? property.description : undefined,
			type,
			enumValues: enumValues?.length ? enumValues : undefined,
			required: required.has(key),
		}];
	});
}

function RuntimeCapabilitySummary({ runtime }: { runtime: AgentRuntimeCatalogEntry }) {
	const capabilities = runtime.capabilities;
	const rows: Array<[string, string, boolean]> = [
		["Sessions", capabilities.lifecycle.persistent ? capabilities.lifecycle.resume ? "persistent + resume" : "persistent" : "ephemeral", capabilities.lifecycle.persistent],
		["Pibo tools", deliveryLabel(capabilities.tools.piboManaged), deliverySupported(capabilities.tools.piboManaged)],
		["Native tool inspection", deliveryLabel(capabilities.tools.nativeToolInspection), deliverySupported(capabilities.tools.nativeToolInspection)],
		["Native tool yielding", deliveryLabel(capabilities.tools.nativeToolYielding), deliverySupported(capabilities.tools.nativeToolYielding)],
		["Tool intents", capabilities.tools.intentTracing.supported ? capabilities.tools.intentTracing.configurable ? "optional" : "supported" : "unsupported", capabilities.tools.intentTracing.supported],
		["External MCP", deliveryLabel(capabilities.mcp.externalServers), deliverySupported(capabilities.mcp.externalServers)],
		["Skills", deliveryLabel(capabilities.skills), deliverySupported(capabilities.skills)],
		["Context", deliveryLabel(capabilities.context), deliverySupported(capabilities.context)],
		["Models", capabilities.models.catalog ? "catalog" : "no catalog", capabilities.models.catalog],
		["Reasoning", capabilities.reasoning.supported ? "supported" : "unsupported", capabilities.reasoning.supported],
		["Approvals", capabilities.approvals.supported ? "supported" : "unsupported", capabilities.approvals.supported],
		["History", capabilities.maintenance.history ? "supported" : "unsupported", capabilities.maintenance.history],
	];
	return (
		<div className="grid grid-cols-3 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1 gap-1" aria-label="Effective runtime capabilities">
			{rows.map(([label, value, supported]) => (
				<div key={label} className="border border-slate-800 bg-[#151f24] px-2 py-1.5 rounded-sm">
					<div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
					<div className={`font-mono text-[11px] ${supported ? "text-[#7dd3fc]" : "text-slate-500"}`}>{value}</div>
				</div>
			))}
		</div>
	);
}

function deliverySupported(delivery: AgentRuntimeCapabilityDelivery): boolean {
	return delivery.support !== "unsupported";
}

function deliveryLabel(delivery: AgentRuntimeCapabilityDelivery): string {
	if (delivery.support === "unsupported") return "unsupported";
	if (delivery.support === "mcp") return `mcp:${delivery.transports.join(",")}`;
	if (delivery.support === "materialized") return `materialized:${delivery.modes.join(",")}`;
	if (delivery.support === "degraded") return `degraded:${delivery.mode}`;
	return delivery.support;
}

export function AgentRuntimeOptions({
	title,
	modelTitle,
	model,
	thinking,
	fast,
	modelCatalog,
	readOnly,
	modelHint,
	modelUnavailableReason,
	thinkingUnavailableReason,
	thinkingValues,
	configuredProvidersOnly = false,
	showFast = true,
	onModelChange,
	onThinkingChange,
	onFastChange,
}: {
	title: string;
	modelTitle: string;
	model?: ModelProfile;
	thinking?: ThinkingLevel;
	fast?: boolean;
	modelCatalog?: ModelCatalog;
	readOnly: boolean;
	modelHint?: string;
	modelUnavailableReason?: string | null;
	thinkingUnavailableReason?: string | null;
	thinkingValues?: ThinkingLevel[];
	configuredProvidersOnly?: boolean;
	showFast?: boolean;
	onModelChange: (value: ModelProfile | undefined) => void;
	onThinkingChange: (value: ThinkingLevel | undefined) => void;
	onFastChange?: (value: boolean) => void;
}) {
	return (
		<div className="grid gap-2 border border-slate-800 bg-[#101d22]/45 rounded-sm p-3">
			<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
			<div className={`grid gap-3 ${showFast ? "lg:grid-cols-[minmax(0,1fr)_minmax(150px,190px)_auto]" : "lg:grid-cols-[minmax(0,1fr)_minmax(150px,190px)]"} lg:items-start`}>
				<ModelSelector
					title={modelTitle}
					catalog={modelCatalog}
					value={model}
					allowUnset
					readOnly={readOnly}
					hint={modelHint}
					unavailableReason={modelUnavailableReason}
					emptyProviderLabel="Default"
					configuredProvidersOnly={configuredProvidersOnly}
					onChange={onModelChange}
				/>
				<ThinkingLevelSelector
					title="Thinking"
					value={thinking}
					readOnly={readOnly}
					unavailableReason={thinkingUnavailableReason}
					availableValues={thinkingValues}
					reserveHintSpace
					onChange={onThinkingChange}
				/>
				{showFast ? (
					<div className="grid gap-2 pb-1">
						<div className="text-[11px] uppercase tracking-wider text-slate-500">Fast</div>
						<div className="h-4" aria-hidden="true" />
						<button
							type="button"
							disabled={readOnly}
							onClick={() => onFastChange?.(!fast)}
							className="inline-flex h-9 w-fit items-center gap-2 text-left text-sm text-slate-300 hover:text-slate-100 disabled:opacity-60"
						>
							<SelectionCheckbox checked={fast === true} disabled={readOnly} />
							<span>{fast ? "Fast on" : "Fast off"}</span>
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}

function ThinkingLevelSelector({
	title,
	value,
	readOnly,
	hint,
	unavailableReason,
	availableValues,
	reserveHintSpace = false,
	onChange,
}: {
	title: string;
	value?: ThinkingLevel;
	readOnly: boolean;
	hint?: string;
	unavailableReason?: string | null;
	availableValues?: ThinkingLevel[];
	reserveHintSpace?: boolean;
	onChange: (value: ThinkingLevel | undefined) => void;
}) {
	const values = availableValues ?? [...THINKING_LEVELS];
	const staleValue = value && !values.includes(value) ? value : undefined;
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
			{unavailableReason ? <div className="text-xs text-amber-100">{unavailableReason}</div> : hint ? <div className="text-xs text-slate-500">{hint}</div> : reserveHintSpace ? <div className="h-4" aria-hidden="true" /> : null}
			<select
				name={`${title} thinking`}
				aria-label={title}
				value={value ?? ""}
				disabled={readOnly || Boolean(unavailableReason)}
				onChange={(event) => onChange(event.target.value ? (event.target.value as ThinkingLevel) : undefined)}
				className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
			>
				<option value="">Default</option>
				{values.map((level) => (
					<option key={level} value={level}>{level}</option>
				))}
				{staleValue ? <option value={staleValue}>{staleValue} (unsupported)</option> : null}
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
	unavailableReason,
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
	unavailableReason?: string | null;
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
			{unavailableReason ? <div className="text-xs text-amber-100">{unavailableReason}</div> : hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
			{providers.length === 0 && !unavailableReason ? (
				<div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">
					{catalogProviders.length === 0
						? "Model catalog unavailable."
						: "No configured providers. Configure a provider under Settings > Providers."}
				</div>
			) : null}
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
				<select
					name={`${title} provider`}
					aria-label={`${title} provider`}
					value={providerId}
					disabled={readOnly || Boolean(unavailableReason)}
					onChange={(event) => {
						const nextProviderId = event.target.value;
						setProviderId(nextProviderId);
						setModelId("");
						if (!nextProviderId) onChange(undefined);
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
					name={`${title} model`}
					aria-label={`${title} model`}
					value={modelId}
					disabled={readOnly || Boolean(unavailableReason)}
					onChange={(event) => {
						const nextModelId = event.target.value;
						setModelId(nextModelId);
						if (!nextModelId) {
							if (providerId) onChange(undefined);
						} else {
							onChange({ provider: providerId, id: nextModelId });
						}
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
