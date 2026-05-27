import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Power, PowerOff, Trash2 } from "lucide-react";
import { THINKING_LEVELS, type ModelCatalog, type ModelProfile, type ThinkingLevel } from "../types";
import { CATALOG_GROUP_RENDER_LIMIT, piPackageMeta, type CatalogGroup, type PiPackageCatalogItem } from "./agent-designer-model";

export function DesignerPanel({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="border border-slate-700 bg-[#1a262b] rounded-sm p-4">
			<div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{title}</div>
			<div className="grid gap-3">{children}</div>
		</div>
	);
}

export function CatalogSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<DesignerPanel title={title}>
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">{children}</div>
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
					<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">{visibleItems.map(renderItem)}</div>
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
				{description ? <span className="block text-xs text-slate-500 truncate">{description}</span> : null}
				{meta ? <span className={`block font-mono text-[10px] mt-1 ${metaClass ?? "text-slate-600"}`}>{meta}</span> : null}
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


export function AgentRuntimeOptions({
	title,
	modelTitle,
	model,
	thinking,
	fast,
	modelCatalog,
	readOnly,
	modelHint,
	configuredProvidersOnly = false,
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
	configuredProvidersOnly?: boolean;
	onModelChange: (value: ModelProfile | undefined) => void;
	onThinkingChange: (value: ThinkingLevel | undefined) => void;
	onFastChange: (value: boolean) => void;
}) {
	return (
		<div className="grid gap-2 border border-slate-800 rounded-sm p-3">
			<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
			<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(150px,190px)_auto] lg:items-start">
				<ModelSelector
					title={modelTitle}
					catalog={modelCatalog}
					value={model}
					allowUnset
					readOnly={readOnly}
					hint={modelHint}
					emptyProviderLabel="Default"
					configuredProvidersOnly={configuredProvidersOnly}
					onChange={onModelChange}
				/>
				<ThinkingLevelSelector
					title="Thinking"
					value={thinking}
					readOnly={readOnly}
					reserveHintSpace
					onChange={onThinkingChange}
				/>
				<div className="grid gap-2 pb-1">
					<div className="text-[11px] uppercase tracking-wider text-slate-500">Fast</div>
					<div className="h-4" aria-hidden="true" />
					<button
						type="button"
						disabled={readOnly}
						onClick={() => onFastChange(!fast)}
						className="inline-flex h-9 w-fit items-center gap-2 text-left text-sm text-slate-300 hover:text-slate-100 disabled:opacity-60"
					>
						<SelectionCheckbox checked={fast === true} disabled={readOnly} />
						<span>{fast ? "Fast on" : "Fast off"}</span>
					</button>
				</div>
			</div>
		</div>
	);
}

function ThinkingLevelSelector({
	title,
	value,
	readOnly,
	hint,
	reserveHintSpace = false,
	onChange,
}: {
	title: string;
	value?: ThinkingLevel;
	readOnly: boolean;
	hint?: string;
	reserveHintSpace?: boolean;
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
			{hint ? <div className="text-xs text-slate-500">{hint}</div> : reserveHintSpace ? <div className="h-4" aria-hidden="true" /> : null}
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
