import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, Code2, ExternalLink, Layers, Link2, Loader2, RefreshCw } from "lucide-react";
import {
	getWorkflowAdapterPicker,
	getWorkflowHandlerPicker,
	getWorkflowProfilePicker,
	getWorkflowVersionPicker,
	type WorkflowHandlerPickerOption,
	type WorkflowHandlerPickerResponse,
	type WorkflowProfilePickerOption,
	type WorkflowProfilePickerResponse,
	type WorkflowRegisteredRefPickerResponse,
	type WorkflowVersionPickerResponse,
} from "../api-workflows";
import { DEFAULT_AGENT_PROMPT_TEMPLATE } from "./workflow-node-defaults";
import { handlerOptionLabel, profileOptionLabel, registeredRefOptionLabel, workflowVersionOptionKey, workflowVersionOptionLabel } from "./workflow-picker-labels";
import { HandlerSchemaPreview, RegisteredRefOptionCard, WorkflowInspectorPickerDiagnostics } from "./workflow-registry-cards";
import { parseWorkflowVersionKey, workflowVersionViewerPath, type WorkflowVersionSelection } from "./workflow-routes";
import { WorkflowPill } from "./workflow-shared-ui";
import { WorkflowVersionDiagnostics, WorkflowVersionOptionCard, WorkflowVersionSelectionSummary } from "./WorkflowVersionViewer";

export function WorkflowBuilderNodeEditors() {
	return (
		<>
			<WorkflowBuilderAgentNodeEditor />
			<WorkflowBuilderCodeNodeEditor />
			<WorkflowBuilderAdapterNodeEditor />
			<WorkflowBuilderWorkflowNodeEditor />
		</>
	);
}

function WorkflowBuilderAgentNodeEditor() {
	const [selectedProfileId, setSelectedProfileId] = useState(readInitialProfileRef);
	const [promptTemplate, setPromptTemplate] = useState(DEFAULT_AGENT_PROMPT_TEMPLATE);
	const [picker, setPicker] = useState<WorkflowProfilePickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowProfilePicker(selectedProfileId || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow profile picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedProfileId]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedProfileId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Brain size={13} />
						Agent node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a non-archived Agent Designer profile and edit the direct prompt template stored on the Pibo Workflow IR node.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshProfilePicker(selectedProfileId, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Agent Designer profile</span>
				<select
					aria-label="Agent Designer profile"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedProfileId ?? ""}
					onChange={(event) => setSelectedProfileId(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a non-archived profile</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{profileOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow profile picker."}
				</div>
			) : null}

			{selectedOption ? <ProfileSelectionSummary option={selectedOption} /> : null}

			{diagnostics.length ? (
				<div className="grid gap-2" aria-label="Agent profile diagnostics">
					{diagnostics.map((diagnostic) => (
						<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
							<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
							<div className="mt-1">{diagnostic.message}</div>
							<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
						</div>
					))}
				</div>
			) : null}

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Prompt template</span>
				<textarea
					aria-label="Agent prompt template"
					className="min-h-28 resize-y rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 font-mono text-xs leading-5 text-slate-100 outline-none transition focus:border-[#11a4d4]"
					value={promptTemplate}
					onChange={(event) => setPromptTemplate(event.target.value)}
				/>
				<span className="text-[11px] font-normal leading-5 text-slate-500">
					This editor is enabled for Agent nodes with a direct <code className="rounded bg-slate-900 px-1 text-slate-300">promptTemplate</code>. Nodes backed by registered prompt builders remain registry-controlled.
				</span>
			</label>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Archived profiles are intentionally omitted from the picker. If a loaded draft already references one, the API returns a structured diagnostic and keeps the selection empty.
			</div>
		</div>
	);
}

function WorkflowBuilderCodeNodeEditor() {
	const [selectedHandlerId, setSelectedHandlerId] = useState(readInitialHandlerRef);
	const [picker, setPicker] = useState<WorkflowHandlerPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowHandlerPicker(selectedHandlerId || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow handler picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedHandlerId]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedHandlerId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Code2 size={13} />
						Code node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a registered Workflow Registry handler ref. The UI stores only the handler id on the Pibo Workflow IR node and never opens inline TypeScript, JavaScript, shell, or eval code.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshHandlerPicker(selectedHandlerId, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Registered code handler</span>
				<select
					aria-label="Registered code handler"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedHandlerId ?? ""}
					onChange={(event) => setSelectedHandlerId(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a registered handler ref</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{handlerOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow handler picker."}
				</div>
			) : null}

			{selectedOption ? <HandlerSelectionSummary option={selectedOption} /> : null}

			{diagnostics.length ? (
				<div className="grid gap-2" aria-label="Code handler diagnostics">
					{diagnostics.map((diagnostic) => (
						<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
							<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
							<div className="mt-1">{diagnostic.message}</div>
							<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
						</div>
					))}
				</div>
			) : null}

			<div className="grid gap-3" aria-label="Registered handler picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered handler refs</div>
				{picker?.options.map((option) => <HandlerOptionCard key={option.id} option={option} />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Missing handler refs return structured <code className="rounded bg-slate-900 px-1 text-slate-300">WorkflowGraphError.unknownHandlerRef</code> diagnostics and block publish/run paths once executable validation is invoked.
			</div>
		</div>
	);
}

function WorkflowBuilderAdapterNodeEditor() {
	const [selectedAdapterRef, setSelectedAdapterRef] = useState(readInitialAdapterRef);
	const [picker, setPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowAdapterPicker(selectedAdapterRef || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow adapter picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedAdapterRef]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedRefId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Link2 size={13} />
						Adapter node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a registered deterministic adapter ref for visible adapter nodes. The UI stores only the registry ref and never opens inline transformation code.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshAdapterPicker(selectedAdapterRef, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Registered adapter</span>
				<select
					aria-label="Registered adapter"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedRefId ?? ""}
					onChange={(event) => setSelectedAdapterRef(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a registered adapter ref</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow adapter picker."}
				</div>
			) : null}

			{selectedOption ? <RegisteredRefOptionCard option={selectedOption} badge="registered adapter" /> : null}
			<WorkflowInspectorPickerDiagnostics diagnostics={diagnostics} />

			<div className="grid gap-3" aria-label="Registered adapter picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered adapter refs</div>
				{picker?.options.map((option) => <RegisteredRefOptionCard key={option.id} option={option} badge="registered adapter" />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Adapter nodes are visible graph nodes for schema transformation. Incompatible edges can alternatively use the compatible edge adapter dialog to keep the adapter on the edge.
			</div>
		</div>
	);
}

function WorkflowBuilderWorkflowNodeEditor() {
	const [selection, setSelection] = useState<WorkflowVersionSelection>(readInitialWorkflowSelection);
	const [picker, setPicker] = useState<WorkflowVersionPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowVersionPicker({
			selectedWorkflowId: selection.workflowId || undefined,
			selectedWorkflowVersion: selection.workflowVersion || undefined,
		})
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow version picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selection.workflowId, selection.workflowVersion]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedWorkflowId && option.version === picker.selectedWorkflowVersion),
		[picker],
	);
	const selectedKey = selectedOption ? workflowVersionOptionKey(selectedOption) : "";
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Layers size={13} />
						Workflow node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a published workflow id/version from registry metadata. The parent graph stores only this reference and opens the child workflow separately.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshWorkflowVersionPicker(selection, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Nested workflow version</span>
				<select
					aria-label="Nested workflow picker"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={selectedKey}
					onChange={(event) => setSelection(parseWorkflowVersionKey(event.target.value) ?? { workflowId: "", workflowVersion: "" })}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a published workflow version</option>
					{picker?.options.map((option) => (
						<option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow version picker."}
				</div>
			) : null}

			{selectedOption ? <WorkflowVersionSelectionSummary option={selectedOption} /> : null}

			<WorkflowVersionDiagnostics diagnostics={diagnostics} ariaLabel="Nested workflow diagnostics" />

			<a
				className={`inline-flex items-center justify-center gap-2 rounded-sm border px-3 py-2 text-xs font-semibold transition ${selectedOption ? "border-[#11a4d4]/50 text-[#8bdcf4] hover:border-[#11a4d4] hover:text-slate-100" : "pointer-events-none border-slate-800 text-slate-600"}`}
				href={selectedOption ? workflowVersionViewerPath(selectedOption.id, selectedOption.version) : "#"}
				aria-disabled={!selectedOption}
			>
				<ExternalLink size={13} />
				Open workflow
			</a>

			<div className="grid gap-3" aria-label="Nested workflow picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Published workflow refs</div>
				{picker?.options.map((option) => <WorkflowVersionOptionCard key={workflowVersionOptionKey(option)} option={option} />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Nested workflow internals stay collapsed in the parent graph for V2. Use <span className="font-semibold text-slate-300">Open workflow</span> to navigate to the child workflow viewer instead of inline-expanding its graph.
			</div>
		</div>
	);
}

function readInitialProfileRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("profileRef") ?? "";
}

function readInitialHandlerRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("handlerRef") ?? "";
}

function readInitialAdapterRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("adapterRef") ?? "";
}

function readInitialWorkflowSelection(): WorkflowVersionSelection {
	if (typeof window === "undefined") return { workflowId: "", workflowVersion: "" };
	const searchParams = new URL(window.location.href).searchParams;
	const workflowRef = searchParams.get("workflowRef");
	if (workflowRef) return parseWorkflowVersionKey(workflowRef) ?? { workflowId: workflowRef, workflowVersion: "" };
	return {
		workflowId: searchParams.get("workflowId") ?? "",
		workflowVersion: searchParams.get("workflowVersion") ?? "",
	};
}

async function refreshProfilePicker(
	selectedProfileId: string,
	setPicker: (picker: WorkflowProfilePickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowProfilePicker(selectedProfileId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow profile picker");
		setLoadState("error");
	}
}

async function refreshHandlerPicker(
	selectedHandlerId: string,
	setPicker: (picker: WorkflowHandlerPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowHandlerPicker(selectedHandlerId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow handler picker");
		setLoadState("error");
	}
}

async function refreshAdapterPicker(
	selectedRefId: string,
	setPicker: (picker: WorkflowRegisteredRefPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowAdapterPicker(selectedRefId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow adapter picker");
		setLoadState("error");
	}
}

async function refreshWorkflowVersionPicker(
	selection: WorkflowVersionSelection,
	setPicker: (picker: WorkflowVersionPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowVersionPicker({
			selectedWorkflowId: selection.workflowId || undefined,
			selectedWorkflowVersion: selection.workflowVersion || undefined,
		}));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow version picker");
		setLoadState("error");
	}
}

function ProfileSelectionSummary({ option }: { option: WorkflowProfilePickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected profile: {option.displayName}</div>
			{option.description ? <div className="mt-1 text-slate-500">{option.description}</div> : null}
			<div className="mt-2 flex flex-wrap gap-2 text-[11px]">
				<WorkflowPill label={option.source === "custom" ? "Custom Agent" : "Global profile"} />
				<WorkflowPill label={`${option.nativeTools.length} native tools`} />
				<WorkflowPill label={`${option.skills.length} skills`} />
				<WorkflowPill label={`${option.contextFiles.length} context files`} />
			</div>
		</div>
	);
}

function HandlerSelectionSummary({ option }: { option: WorkflowHandlerPickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected handler: {option.displayName}</div>
			<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<HandlerSchemaPreview label="inputSchema" schema={option.inputSchema} />
				<HandlerSchemaPreview label="outputSchema" schema={option.outputSchema} />
			</div>
		</div>
	);
}

function HandlerOptionCard({ option }: { option: WorkflowHandlerPickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="font-semibold text-slate-200">{option.displayName}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
				</div>
				<WorkflowPill label="registered handler" />
			</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<HandlerSchemaPreview label="inputSchema" schema={option.inputSchema} />
				<HandlerSchemaPreview label="outputSchema" schema={option.outputSchema} />
			</div>
		</div>
	);
}
