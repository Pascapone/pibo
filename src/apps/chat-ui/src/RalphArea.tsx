import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, Loader2, Play, Plus, RefreshCw, Save, Square, Trash2, X, XCircle } from "lucide-react";
import { cancelRalphJob, deleteRalphJob, getRalphConditions, getRalphJobs, getRalphRuns, getRalphStatus, getRalphTemplates, patchRalphJob, postRalphJob, startRalphJob, stopRalphJob, type RalphJobInput } from "./api-ralph";
import { THINKING_LEVELS } from "./types";
import type { AgentProfile, BootstrapData, CustomAgent, ModelCatalog, ModelProfile, PiboRalphJob, PiboRalphJobTemplate, PiboRalphRun, PiboRalphStatus, PiboRalphStopConditionInfo, PiboRalphStopPolicy, ThinkingLevel } from "./types";

type Draft = {
	name: string;
	description: string;
	profile: string;
	prompt: string;
	maxIterations: string;
	stopPolicyText: string;
	targetKind: "room" | "personal";
	roomId: string;
	modelOverride?: ModelProfile;
	thinkingLevel?: ThinkingLevel;
	fastMode?: boolean;
};

type AgentOption = { name: string; label: string; description?: string };

const inputClass = "w-full rounded-sm border border-slate-700 bg-[#101d22] px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#11a4d4] disabled:opacity-50";
const radioClass = "sr-only peer";

export function RalphArea({ bootstrap, mobileSidebarOpen = false, onCloseMobileSidebar }: { bootstrap: BootstrapData; mobileSidebarOpen?: boolean; onCloseMobileSidebar?: () => void }) {
	const rooms = bootstrap.rooms ?? [];
	const agentOptions = useMemo(() => profileOptions(bootstrap.agents, bootstrap.customAgents), [bootstrap.agents, bootstrap.customAgents]);
	const defaultProfile = agentOptions[0]?.name ?? "default";
	const [jobs, setJobs] = useState<PiboRalphJob[]>([]);
	const [runs, setRuns] = useState<PiboRalphRun[]>([]);
	const [status, setStatus] = useState<PiboRalphStatus | null>(null);
	const [conditions, setConditions] = useState<PiboRalphStopConditionInfo[]>([]);
	const [templates, setTemplates] = useState<PiboRalphJobTemplate[]>([]);
	const [selectedTemplateId, setSelectedTemplateId] = useState("");
	const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultProfile, rooms[0]?.id));
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
	const selectedRoomName = useMemo(() => rooms.find((room) => room.id === draft.roomId)?.name ?? draft.roomId, [rooms, draft.roomId]);

	const refresh = async (jobId = selectedJobId) => {
		setLoading(true);
		setError(null);
		try {
			const [statusResponse, jobsResponse, runsResponse, conditionsResponse, templatesResponse] = await Promise.all([
				getRalphStatus(),
				getRalphJobs(true),
				getRalphRuns(jobId ?? undefined, 100),
				getRalphConditions(),
				getRalphTemplates(),
			]);
			setStatus(statusResponse.status);
			setJobs(jobsResponse.jobs);
			setRuns(runsResponse.runs);
			setConditions(conditionsResponse.conditions);
			setTemplates(templatesResponse.templates);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void refresh(null);
		const id = window.setInterval(() => void refresh(selectedJobId), 5000);
		return () => window.clearInterval(id);
	}, [selectedJobId]);

	const selectJob = async (job: PiboRalphJob) => {
		setSelectedJobId(job.id);
		setSelectedTemplateId("");
		setDraft(draftFromJob(job, defaultProfile, rooms[0]?.id));
		onCloseMobileSidebar?.();
		const response = await getRalphRuns(job.id, 100);
		setRuns(response.runs);
	};
	const newJob = () => { setSelectedJobId(null); setSelectedTemplateId(""); setDraft(emptyDraft(defaultProfile, rooms[0]?.id)); setRuns([]); onCloseMobileSidebar?.(); };
	const applyTemplate = (templateId: string) => {
		setSelectedTemplateId(templateId);
		if (!templateId) { setDraft(emptyDraft(defaultProfile, rooms[0]?.id)); return; }
		const template = templates.find((item) => item.id === templateId);
		if (!template) return;
		setSelectedJobId(null);
		setRuns([]);
		setDraft(draftFromTemplate(template, defaultProfile, rooms[0]?.id));
	};
	const save = async () => { setSaving(true); setError(null); try { const input = inputFromDraft(draft); const response = selectedJob ? await patchRalphJob(selectedJob.id, input) : await postRalphJob(input); setSelectedJobId(response.job.id); setDraft(draftFromJob(response.job, defaultProfile, rooms[0]?.id)); await refresh(response.job.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); } };
	const remove = async () => { if (!selectedJob || !window.confirm(`Delete Ralph job "${selectedJob.name}"?`)) return; setSaving(true); try { await deleteRalphJob(selectedJob.id); newJob(); await refresh(null); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); } };
	const action = async (kind: "start" | "stop" | "cancel") => { if (!selectedJob) return; setSaving(true); try { if (kind === "start") await startRalphJob(selectedJob.id); if (kind === "stop") await stopRalphJob(selectedJob.id); if (kind === "cancel") await cancelRalphJob(selectedJob.id); await refresh(selectedJob.id); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); } };

	return (
		<div className="min-h-0 grid grid-cols-[340px_minmax(0,1fr)] max-[980px]:grid-cols-1 h-full overflow-hidden">
			<div
				className={`fixed inset-0 z-30 bg-black/60 min-[981px]:hidden transition-opacity duration-200 ${
					mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
				}`}
				onClick={onCloseMobileSidebar}
			/>
			<aside
				className={`min-h-0 overflow-auto bg-[#1a262b] border-r border-slate-800 max-[980px]:fixed max-[980px]:left-0 max-[980px]:top-0 max-[980px]:bottom-0 max-[980px]:z-40 max-[980px]:w-[280px] max-[980px]:transition-transform max-[980px]:duration-200 ${
					mobileSidebarOpen ? "max-[980px]:translate-x-0" : "max-[980px]:-translate-x-full"
				}`}
			>
				<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider max-[980px]:h-auto max-[980px]:py-2">
					<span className="inline-flex items-center gap-2"><Bot size={14} /> Ralph Jobs</span>
					<div className="flex items-center gap-1">
						<button type="button" onClick={() => void refresh()} title="Refresh" aria-label="Refresh" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><RefreshCw size={13} /></button>
						<button type="button" onClick={newJob} title="New Ralph Job" aria-label="New Ralph Job" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><Plus size={13} /></button>
						<button type="button" onClick={onCloseMobileSidebar} title="Close sidebar" aria-label="Close sidebar" className="min-[981px]:hidden p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><X size={13} /></button>
					</div>
				</div>
				<div className="p-3 space-y-3">
					<div className="grid grid-cols-3 gap-2 text-center text-[11px]">
						<Stat label="Jobs" value={status?.jobs ?? jobs.length} />
						<Stat label="Running" value={status?.running ?? 0} />
						<Stat label="Templates" value={templates.length || "-"} />
					</div>
					{loading && jobs.length === 0 ? <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading Ralph jobs…</div> : null}
					{jobs.length === 0 && !loading ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No Ralph jobs yet.</div> : null}
					<div className="space-y-2">
						{jobs.map((job) => (
							<button key={job.id} type="button" onClick={() => void selectJob(job)} className={`w-full text-left rounded-sm border px-3 py-2 ${selectedJobId === job.id ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 hover:border-slate-700 hover:bg-slate-900/40"}`}>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<div className="truncate text-sm font-medium text-slate-100">{job.name}</div>
										<div className="truncate text-[11px] text-slate-500">{job.state.completedIterations ?? 0}{job.maxIterations ? `/${job.maxIterations}` : ""} iterations · {job.state.lastStatus ?? "new"}</div>
									</div>
									<JobStatusBadge job={job} />
								</div>
								<div className="mt-1 truncate font-mono text-[11px] text-slate-500">{runtimeSummary(job)}</div>
							</button>
						))}
					</div>
				</div>
			</aside>

			<main className="min-h-0 overflow-auto">
				<div className="max-w-5xl mx-auto p-5 space-y-5">
					<div className="flex items-start justify-between gap-3 flex-wrap">
						<div>
							<div className="text-xs uppercase tracking-[0.16em] text-[#11a4d4] font-bold">Continuous Pibo Sessions</div>
							<h1 className="text-2xl font-bold text-slate-100">{selectedJob ? selectedJob.name : "New Ralph job"}</h1>
							<p className="text-sm text-slate-400">Ralph starts fresh agent sessions with the same task until a stop condition is satisfied.</p>
						</div>
						<div className="flex items-center gap-2 flex-wrap">
							{selectedJob ? <button type="button" onClick={() => void action("start")} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-emerald-500/50 text-emerald-300 hover:border-emerald-400 disabled:opacity-50"><Play size={14} /> Start</button> : null}
							{selectedJob ? <button type="button" onClick={() => void action("stop")} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-amber-500/50 text-amber-300 hover:border-amber-400 disabled:opacity-50"><Square size={14} /> Stop</button> : null}
							{selectedJob ? <button type="button" onClick={() => void action("cancel")} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-orange-500/50 text-orange-300 hover:border-orange-400 disabled:opacity-50"><XCircle size={14} /> Cancel</button> : null}
							<button type="button" onClick={() => void save()} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4] disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>
							{selectedJob ? <button type="button" onClick={() => void remove()} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-red-500/40 text-red-300 hover:border-red-400 disabled:opacity-50"><Trash2 size={14} /> Delete</button> : null}
						</div>
					</div>

					{error ? <ErrorBox message={error} /> : null}

					<section className="grid grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-4 max-[980px]:grid-cols-1">
						<Panel title="Job">
							<Field label="Template"><select className={inputClass} value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)}><option value="">Blank job</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
							{selectedTemplateId ? <div className="rounded-sm border border-[#11a4d4]/30 bg-[#11a4d4]/10 px-3 py-2 text-xs text-slate-400">{templates.find((template) => template.id === selectedTemplateId)?.description}</div> : null}
							<Field label="Name"><input className={inputClass} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ralph PRD loop" /></Field>
							<Field label="Description"><input className={inputClass} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Optional" /></Field>
							<Field label="Agent"><select className={inputClass} value={draft.profile} onChange={(event) => setDraft({ ...draft, profile: event.target.value })}>{agentOptions.map((profile) => <option key={profile.name} value={profile.name}>{profile.label}</option>)}{draft.profile && !agentOptions.some((profile) => profile.name === draft.profile) ? <option value={draft.profile}>{draft.profile} (missing)</option> : null}</select></Field>
							<div className="space-y-2">
								<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Target</div>
								<div className="grid grid-cols-2 gap-2">
									<RadioCard name="ralph-target-kind" checked={draft.targetKind === "personal"} title="Shared Chat" description="Runs in the shared default chat" onChange={() => setDraft({ ...draft, targetKind: "personal" })} />
									<RadioCard name="ralph-target-kind" checked={draft.targetKind === "room"} title="Room" description="Uses a room workspace" onChange={() => setDraft({ ...draft, targetKind: "room" })} />
								</div>
							</div>
							{draft.targetKind === "room" ? <Field label="Room"><select className={inputClass} value={draft.roomId} onChange={(event) => setDraft({ ...draft, roomId: event.target.value })}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field> : null}
							<Field label="Max Iterations"><input className={inputClass} type="number" min="1" value={draft.maxIterations} onChange={(event) => setDraft({ ...draft, maxIterations: event.target.value })} placeholder="Unlimited" /></Field>
							<div className="rounded-sm border border-slate-800 bg-[#101d22] px-3 py-2 text-xs text-slate-500">Target: <span className="text-slate-300">{draft.targetKind === "room" ? selectedRoomName : "Shared Chat"}</span></div>
						</Panel>

						<Panel title="Runtime">
							<RuntimeOverridesEditor modelCatalog={bootstrap.modelCatalog} model={draft.modelOverride} thinking={draft.thinkingLevel} fastMode={draft.fastMode} disabled={saving} onModelChange={(modelOverride) => setDraft({ ...draft, modelOverride })} onThinkingChange={(thinkingLevel) => setDraft({ ...draft, thinkingLevel })} onFastModeChange={(fastMode) => setDraft({ ...draft, fastMode })} />
							<div className="rounded-sm border border-[#11a4d4]/30 bg-[#11a4d4]/10 px-3 py-2">
								<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Default stop marker</div>
								<div className="mt-1 font-mono text-xs text-slate-200">&lt;promise&gt;COMPLETE&lt;/promise&gt;</div>
								<div className="mt-1 text-xs text-slate-500">When a final answer contains this marker, Ralph stops after that run.</div>
							</div>
						</Panel>
					</section>

					<StopConditionsEditor conditions={conditions} value={draft.stopPolicyText} onChange={(stopPolicyText) => setDraft({ ...draft, stopPolicyText })} />

					<Panel title="Task / Prompt">
						<textarea className={`${inputClass} min-h-56 resize-y font-mono leading-relaxed`} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="What should Ralph do on each iteration?" />
					</Panel>

					<Panel title={selectedJob ? "Recent runs" : "Recent runs will appear after saving"}>
						{runs.length === 0 ? <div className="text-sm text-slate-500">No runs yet.</div> : (
							<div className="overflow-auto">
								<table className="w-full text-sm">
									<thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="text-left py-2">Status</th><th className="text-left py-2">Started</th><th className="text-left py-2">Session</th><th className="text-left py-2">Stop</th><th className="text-left py-2">Error</th></tr></thead>
									<tbody>{runs.map((run) => <tr key={run.id} className="border-t border-slate-800"><td className="py-2"><RunStatusBadge status={run.status} /></td><td className="py-2 text-slate-400">{shortDate(run.startedAt ?? run.createdAt)}</td><td className="py-2">{run.piboSessionId ? <a className="text-[#11a4d4] hover:underline" href={`/apps/chat/sessions/${encodeURIComponent(run.piboSessionId)}`}>{run.piboSessionId.slice(0, 10)}…</a> : <span className="text-slate-600">-</span>}</td><td className="py-2 text-slate-400">{selectedJob?.state.lastRunId === run.id && selectedJob.state.lastStopEvaluation ? selectedJob.state.lastStopEvaluation.finalAction : ""}</td><td className="py-2 text-red-300">{run.error ?? ""}</td></tr>)}</tbody>
								</table>
							</div>
						)}
					</Panel>
				</div>
			</main>
		</div>
	);
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
	return <section className="rounded-sm border border-slate-800 bg-[#152126] p-4 space-y-3"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h2>{children}</section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return <label className="block space-y-1"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>{children}</label>;
}

function RadioCard({ name, checked, title, description, onChange }: { name: string; checked: boolean; title: string; description: string; onChange: () => void }) {
	return (
		<label className="block cursor-pointer">
			<input type="radio" name={name} checked={checked} onChange={onChange} className={radioClass} />
			<span className="block rounded-sm border border-slate-700 bg-[#101d22] px-3 py-2 text-sm text-slate-300 peer-checked:border-[#11a4d4] peer-checked:bg-[#11a4d4]/10 peer-checked:text-slate-100 hover:border-slate-500">
				<span className="flex items-center gap-2 font-medium"><span className={`h-3 w-3 rounded-full border ${checked ? "border-[#11a4d4] bg-[#11a4d4]" : "border-slate-500"}`} />{title}</span>
				<span className="mt-0.5 block text-[11px] text-slate-500">{description}</span>
			</span>
		</label>
	);
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
	return <div className="rounded-sm border border-slate-800 bg-[#101d22] px-2 py-2"><div className="text-slate-100 font-semibold truncate">{value}</div><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div></div>;
}

function ErrorBox({ message }: { message: string }) {
	return <div className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 text-red-300" /> <span>{message}</span></div>;
}

function StopConditionsEditor({ conditions, value, onChange }: { conditions: PiboRalphStopConditionInfo[]; value: string; onChange: (value: string) => void }) {
	const sample = conditions[0] ? { mode: "any", conditions: [{ id: conditions[0].type.split(".").pop() ?? "condition", type: conditions[0].type, options: conditions[0].defaultOptions ?? {} }] } : { mode: "any", conditions: [] };
	return (
		<Panel title="Stop Conditions">
			<div className="text-xs text-slate-500">Optional JSON policy. Empty uses the default max-iterations and promise-complete behavior.</div>
			<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
				{conditions.map((condition) => (
					<div key={condition.type} className="rounded-sm border border-slate-800 bg-[#101d22] p-3 text-xs">
						<div className="font-medium text-slate-200">{condition.name}</div>
						<div className="mt-1 truncate font-mono text-[11px] text-[#11a4d4]">{condition.type}</div>
						<div className="mt-1 text-slate-600">{condition.phases.join(", ")}{condition.pluginName ? ` · ${condition.pluginName}` : ""}</div>
						{condition.description ? <div className="mt-2 text-slate-500">{condition.description}</div> : null}
					</div>
				))}
			</div>
			<textarea className={`${inputClass} min-h-32 resize-y font-mono leading-relaxed`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={JSON.stringify(sample, null, 2)} />
			<div className="text-xs text-slate-600">Registered conditions: {conditions.length || "none"}</div>
		</Panel>
	);
}

function RuntimeOverridesEditor({ modelCatalog, model, thinking, fastMode, disabled, onModelChange, onThinkingChange, onFastModeChange }: { modelCatalog?: ModelCatalog; model?: ModelProfile; thinking?: ThinkingLevel; fastMode?: boolean; disabled: boolean; onModelChange: (value: ModelProfile | undefined) => void; onThinkingChange: (value: ThinkingLevel | undefined) => void; onFastModeChange: (value: boolean | undefined) => void }) {
	return <div className="grid gap-3"><ModelOverrideSelector catalog={modelCatalog} value={model} disabled={disabled} onChange={onModelChange}/><ThinkingOverrideSelector value={thinking} disabled={disabled} onChange={onThinkingChange}/><FastModeOverrideSelector value={fastMode} disabled={disabled} onChange={onFastModeChange}/></div>;
}

function ModelOverrideSelector({ catalog, value, disabled, onChange }: { catalog?: ModelCatalog; value?: ModelProfile; disabled: boolean; onChange: (value: ModelProfile | undefined) => void }) {
	const [providerId, setProviderId] = useState(value?.provider ?? "");
	const [modelId, setModelId] = useState(value?.id ?? "");
	const providers = catalog?.providers ?? [];
	const selectedProvider = providers.find((provider) => provider.id === providerId);
	const selectedModel = selectedProvider?.models.find((item) => item.id === modelId);
	const hasStaleProvider = Boolean(providerId) && !selectedProvider;
	const hasStaleModel = Boolean(providerId && modelId && selectedProvider && !selectedModel);
	useEffect(() => { setProviderId(value?.provider ?? ""); setModelId(value?.id ?? ""); }, [value?.provider, value?.id]);
	return <div className="grid gap-2"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Model</span><button type="button" disabled={disabled || (!providerId && !modelId)} onClick={() => { setProviderId(""); setModelId(""); onChange(undefined); }} className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 disabled:opacity-50">Unset</button></div><div className="grid grid-cols-2 gap-2"><select value={providerId} disabled={disabled} onChange={(event) => { const next = event.target.value; setProviderId(next); setModelId(""); if (!next) onChange(undefined); }} className={inputClass}><option value="">Default</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}{hasStaleProvider ? <option value={providerId}>{providerId} (missing)</option> : null}</select><select value={modelId} disabled={disabled || !providerId} onChange={(event) => { const next = event.target.value; setModelId(next); if (providerId && next) onChange({ provider: providerId, id: next }); }} className={inputClass}><option value="">{providerId ? "Select model" : "Default"}</option>{selectedProvider?.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}{hasStaleModel ? <option value={modelId}>{modelId} (missing)</option> : null}</select></div>{providerId && selectedProvider ? <div className="text-xs text-slate-600">{selectedProvider.authConfigured ? "Provider auth configured." : "Provider auth missing."}</div> : null}</div>;
}

function ThinkingOverrideSelector({ value, disabled, onChange }: { value?: ThinkingLevel; disabled: boolean; onChange: (value: ThinkingLevel | undefined) => void }) {
	return <div className="grid gap-2"><div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Thinking</div><select value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value ? event.target.value as ThinkingLevel : undefined)} className={inputClass}><option value="">Default</option>{THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select><div className="text-xs text-slate-600">Per-run thinking level.</div></div>;
}

function FastModeOverrideSelector({ value, disabled, onChange }: { value?: boolean; disabled: boolean; onChange: (value: boolean | undefined) => void }) {
	const selectValue = value === undefined ? "" : value ? "fast" : "normal";
	return <div className="grid gap-2"><div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Fast Mode</div><select value={selectValue} disabled={disabled} onChange={(event) => { const next = event.target.value; onChange(next === "" ? undefined : next === "fast"); }} className={inputClass}><option value="">Default</option><option value="fast">Fast on</option><option value="normal">Fast off</option></select><div className="text-xs text-slate-600">Overrides default fast mode.</div></div>;
}

function JobStatusBadge({ job }: { job: PiboRalphJob }) {
	const running = Boolean(job.state.runningAt);
	const stopping = job.enabled && !running;
	const styles = running ? "border-[#11a4d4]/50 text-[#11a4d4]" : stopping ? "border-emerald-500/40 text-emerald-300" : "border-slate-600 text-slate-400";
	const label = running ? "active" : job.enabled ? "on" : "off";
	return <span className={`shrink-0 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] ${styles}`}>{running ? <Loader2 size={10} className="animate-spin" /> : null}{label}</span>;
}

function RunStatusBadge({ status }: { status: PiboRalphRun["status"] }) {
	const styles = status === "ok" ? "border-emerald-500/40 text-emerald-300" : status === "error" ? "border-red-500/40 text-red-300" : status === "running" ? "border-[#11a4d4]/50 text-[#11a4d4]" : status === "cancelled" ? "border-orange-500/50 text-orange-300" : "border-slate-600 text-slate-400";
	return <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] ${styles}`}>{status === "running" ? <Loader2 size={11} className="animate-spin" /> : null}{status}</span>;
}

function emptyDraft(defaultProfile: string, roomId?: string): Draft { return { name: "", description: "", profile: defaultProfile, prompt: "", maxIterations: "", stopPolicyText: "", targetKind: roomId ? "room" : "personal", roomId: roomId ?? "" }; }
function draftFromTemplate(template: PiboRalphJobTemplate, defaultProfile: string, roomId?: string): Draft { return { ...emptyDraft(defaultProfile, roomId), name: template.job.name, description: template.job.description ?? "", prompt: template.job.prompt, maxIterations: template.job.maxIterations ? String(template.job.maxIterations) : "", stopPolicyText: template.job.stopPolicy ? JSON.stringify(template.job.stopPolicy, null, 2) : "" }; }
function draftFromJob(job: PiboRalphJob, defaultProfile: string, roomId?: string): Draft { return { name: job.name, description: job.description ?? "", profile: job.profile || defaultProfile, prompt: job.prompt, maxIterations: job.maxIterations ? String(job.maxIterations) : "", targetKind: job.target.kind, roomId: job.target.kind === "room" ? job.target.roomId : roomId ?? "", modelOverride: job.modelOverride, thinkingLevel: job.thinkingLevel, fastMode: job.fastMode, stopPolicyText: job.stopPolicy ? JSON.stringify(job.stopPolicy, null, 2) : "" }; }
function inputFromDraft(draft: Draft): RalphJobInput { return { name: draft.name.trim() || undefined, description: draft.description.trim() || undefined, profile: draft.profile, prompt: draft.prompt, maxIterations: draft.maxIterations.trim() ? Number(draft.maxIterations) : null, stopPolicy: parseStopPolicyText(draft.stopPolicyText), modelOverride: draft.modelOverride ?? null, thinkingLevel: draft.thinkingLevel ?? null, fastMode: draft.fastMode ?? null, target: draft.targetKind === "room" ? { kind: "room", roomId: draft.roomId } : { kind: "personal", principalId: "" } }; }
function parseStopPolicyText(value: string): PiboRalphStopPolicy | null { const trimmed = value.trim(); if (!trimmed) return null; return JSON.parse(trimmed) as PiboRalphStopPolicy; }
function profileOptions(agents: AgentProfile[], customAgents: CustomAgent[]): AgentOption[] { const options = new Map<string, AgentOption>(); for (const agent of agents) options.set(agent.name, { name: agent.name, label: agent.name, description: agent.description }); for (const agent of customAgents) if (!agent.archivedAt) options.set(agent.profileName, { name: agent.profileName, label: agent.displayName === agent.profileName ? agent.profileName : `${agent.displayName} (${agent.profileName})`, description: agent.description }); return [...options.values()]; }
function runtimeSummary(job: PiboRalphJob): string { const parts = [job.modelOverride ? `${job.modelOverride.provider}/${job.modelOverride.id}` : undefined, job.thinkingLevel ? `thinking ${job.thinkingLevel}` : undefined, job.fastMode !== undefined ? job.fastMode ? "fast on" : "fast off" : undefined].filter(Boolean); return parts.length ? parts.join(" · ") : "default runtime"; }
function shortDate(value: string): string { return new Date(value).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
