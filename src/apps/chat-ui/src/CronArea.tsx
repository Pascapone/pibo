import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, Loader2, Pause, Play, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import {
	deleteCronJob,
	getCronJobs,
	getCronRuns,
	getCronStatus,
	patchCronJob,
	postCronJob,
	runCronJobNow,
	type CronJobInput,
	type CronScheduleInput,
} from "./api";
import type { AgentProfile, BootstrapData, CustomAgent, PiboCronJob, PiboCronRun, PiboCronStatus, PiboRoom } from "./types";

type ScheduleKind = "in" | "at" | "every" | "daily" | "weekly" | "monthly" | "cron";
type TargetKind = "personal" | "room";
type DurationUnit = "minutes" | "hours" | "days";

type CronDraft = {
	name: string;
	description: string;
	enabled: boolean;
	targetKind: TargetKind;
	roomId: string;
	profile: string;
	prompt: string;
	scheduleKind: ScheduleKind;
	inAmount: string;
	inUnit: DurationUnit;
	atDate: string;
	atTime: string;
	everyAmount: string;
	everyUnit: DurationUnit;
	dailyTime: string;
	weeklyDays: number[];
	monthlyDay: string;
	time: string;
	cronExpr: string;
	tz: string;
	deleteAfterRun: boolean;
};

type RoomOption = { id: string; label: string; archived: boolean };
type AgentOption = { name: string; description?: string };

type SchedulePreset = {
	kind: ScheduleKind;
	title: string;
	description: string;
};

const schedulePresets: SchedulePreset[] = [
	{ kind: "in", title: "Einmal später", description: "z.B. in 20 Minuten" },
	{ kind: "at", title: "Einmal am Datum", description: "Datepicker + Uhrzeit" },
	{ kind: "daily", title: "Täglich", description: "Cron aus Uhrzeit" },
	{ kind: "weekly", title: "Wöchentlich", description: "Wochentage wählen" },
	{ kind: "monthly", title: "Monatlich", description: "Tag im Monat" },
	{ kind: "every", title: "Intervall", description: "*/n Cron-Rhythmus" },
	{ kind: "cron", title: "Cron direkt", description: "5 Felder manuell" },
];

const weekdayOptions = [
	{ value: 1, short: "Mo", label: "Montag" },
	{ value: 2, short: "Di", label: "Dienstag" },
	{ value: 3, short: "Mi", label: "Mittwoch" },
	{ value: 4, short: "Do", label: "Donnerstag" },
	{ value: 5, short: "Fr", label: "Freitag" },
	{ value: 6, short: "Sa", label: "Samstag" },
	{ value: 0, short: "So", label: "Sonntag" },
];

export function CronArea({ bootstrap, mobileSidebarOpen = false, onCloseMobileSidebar }: { bootstrap: BootstrapData; mobileSidebarOpen?: boolean; onCloseMobileSidebar?: () => void }) {
	const rooms = useMemo(() => flattenRooms(bootstrap.rooms), [bootstrap.rooms]);
	const agentOptions = useMemo(() => profileOptions(bootstrap.agents, bootstrap.customAgents), [bootstrap.agents, bootstrap.customAgents]);
	const defaultProfile = agentOptions[0]?.name ?? "codex-compat-openai-web";
	const [jobs, setJobs] = useState<PiboCronJob[]>([]);
	const [runs, setRuns] = useState<PiboCronRun[]>([]);
	const [status, setStatus] = useState<PiboCronStatus | null>(null);
	const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
	const [draft, setDraft] = useState(() => createEmptyDraft(defaultProfile, rooms));
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
	const visibleRuns = selectedJobId ? runs.filter((run) => run.jobId === selectedJobId) : runs;
	const schedulePreview = useMemo(() => previewSchedule(draft), [draft]);
	const selectedJobIsRecurring = selectedJob ? isRecurringCronJob(selectedJob) : false;

	const load = async (jobId = selectedJobId) => {
		setLoading(true);
		try {
			const [statusResponse, jobsResponse, runsResponse] = await Promise.all([
				getCronStatus(),
				getCronJobs(true),
				getCronRuns(jobId ?? undefined, 100),
			]);
			setStatus(statusResponse.status);
			setJobs(jobsResponse.jobs);
			setRuns(runsResponse.runs);
			setError(null);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const startNewJob = () => {
		setSelectedJobId(null);
		setDraft(createEmptyDraft(defaultProfile, rooms));
	};

	const selectJob = async (job: PiboCronJob) => {
		setSelectedJobId(job.id);
		setDraft(draftFromJob(job, defaultProfile, rooms));
		onCloseMobileSidebar?.();
		try {
			const response = await getCronRuns(job.id, 100);
			setRuns(response.runs);
		} catch (caught) {
			setError(errorMessage(caught));
		}
	};

	const saveJob = async () => {
		setSaving(true);
		try {
			const input = inputFromDraft(draft);
			const response = selectedJob ? await patchCronJob(selectedJob.id, input) : await postCronJob(input);
			setSelectedJobId(response.job.id);
			setDraft(draftFromJob(response.job, defaultProfile, rooms));
			await load(response.job.id);
			setError(null);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setSaving(false);
		}
	};

	const removeJob = async () => {
		if (!selectedJob || !window.confirm(`Delete cron job "${selectedJob.name}"?`)) return;
		setSaving(true);
		try {
			await deleteCronJob(selectedJob.id);
			startNewJob();
			await load(null);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setSaving(false);
		}
	};

	const runNow = async () => {
		if (!selectedJob) return;
		setSaving(true);
		try {
			await runCronJobNow(selectedJob.id);
			await load(selectedJob.id);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setSaving(false);
		}
	};

	const toggleSelectedJobEnabled = async () => {
		if (!selectedJob || !selectedJobIsRecurring) return;
		setSaving(true);
		try {
			const response = await patchCronJob(selectedJob.id, { enabled: !selectedJob.enabled });
			setDraft(draftFromJob(response.job, defaultProfile, rooms));
			await load(response.job.id);
			setError(null);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setSaving(false);
		}
	};

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
					<span className="inline-flex items-center gap-2"><CalendarClock size={14} /> Cron Jobs</span>
					<div className="flex items-center gap-1">
						<button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><RefreshCw size={13} /></button>
						<button type="button" onClick={startNewJob} title="New Cron Job" aria-label="New Cron Job" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><Plus size={13} /></button>
						<button type="button" onClick={onCloseMobileSidebar} title="Close sidebar" aria-label="Close sidebar" className="min-[981px]:hidden p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><X size={13} /></button>
					</div>
				</div>
				<div className="p-3 space-y-3">
					<div className="grid grid-cols-3 gap-2 text-center text-[11px]">
						<Stat label="Jobs" value={status?.jobs ?? jobs.length} />
						<Stat label="Running" value={status?.running ?? 0} />
						<Stat label="Next" value={status?.nextRunAt ? shortDate(status.nextRunAt) : "-"} />
					</div>
					{loading && jobs.length === 0 ? <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading cron jobs…</div> : null}
					{jobs.length === 0 && !loading ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No cron jobs yet.</div> : null}
					<div className="space-y-2">
						{jobs.map((job) => (
							<button key={job.id} type="button" onClick={() => void selectJob(job)} className={`w-full text-left rounded-sm border px-3 py-2 ${selectedJobId === job.id ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 hover:border-slate-700 hover:bg-slate-900/40"}`}>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<div className="truncate text-sm font-medium text-slate-100">{job.name}</div>
										<div className="truncate text-[11px] text-slate-500">{formatSchedule(job)}</div>
									</div>
									<span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm border ${job.enabled ? "border-emerald-500/40 text-emerald-300" : "border-slate-600 text-slate-500"}`}>{job.enabled ? "on" : "off"}</span>
								</div>
								<div className="mt-1 text-[11px] text-slate-500">Next: {job.state.nextRunAt ? shortDate(job.state.nextRunAt) : "-"}</div>
							</button>
						))}
					</div>
				</div>
			</aside>
			<main className="min-h-0 overflow-auto">
				<div className="max-w-5xl mx-auto p-5 space-y-5">
					<div className="flex items-start justify-between gap-3 flex-wrap">
						<div>
							<div className="text-xs uppercase tracking-[0.16em] text-[#11a4d4] font-bold">Scheduled Pibo Sessions</div>
							<h1 className="text-2xl font-bold text-slate-100">{selectedJob ? selectedJob.name : "New cron job"}</h1>
							<p className="text-sm text-slate-400">Each run creates a visible Pibo Session in the selected Personal Chat or Room.</p>
						</div>
						<div className="flex items-center gap-2">
							{selectedJobIsRecurring ? <button type="button" onClick={() => void toggleSelectedJobEnabled()} disabled={saving} className={`h-9 px-3 inline-flex items-center gap-2 rounded-sm border disabled:opacity-50 ${selectedJob?.enabled ? "border-amber-500/50 text-amber-300 hover:border-amber-400" : "border-emerald-500/50 text-emerald-300 hover:border-emerald-400"}`}>{selectedJob?.enabled ? <Pause size={14} /> : <Play size={14} />} {selectedJob?.enabled ? "Stop" : "Resume"}</button> : null}
							{selectedJob ? <button type="button" onClick={() => void runNow()} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"><Play size={14} /> Run now</button> : null}
							<button type="button" onClick={() => void saveJob()} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4] disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save</button>
							{selectedJob ? <button type="button" onClick={() => void removeJob()} disabled={saving} className="h-9 px-3 inline-flex items-center gap-2 rounded-sm border border-red-500/40 text-red-300 hover:border-red-400 disabled:opacity-50"><Trash2 size={14} /> Delete</button> : null}
						</div>
					</div>

					{error ? <ErrorBox message={error} /> : null}

					<section className="grid grid-cols-2 gap-4 max-[980px]:grid-cols-1">
						<Panel title="Job">
							<Field label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} placeholder="Daily standup summary" /></Field>
							<Field label="Description"><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClass} placeholder="Optional" /></Field>
							<Field label="Agent"><select value={draft.profile} onChange={(event) => setDraft({ ...draft, profile: event.target.value })} className={inputClass}>{agentOptions.map((agent) => <option key={agent.name} value={agent.name}>{agent.name}</option>)}</select></Field>
							<div className="space-y-2">
								<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Target</div>
								<div className="grid grid-cols-2 gap-2">
									<RadioCard name="target-kind" checked={draft.targetKind === "personal"} title="Personal Chat" description="Runs in your personal chat" onChange={() => setDraft({ ...draft, targetKind: "personal" })} />
									<RadioCard name="target-kind" checked={draft.targetKind === "room"} title="Room" description="Uses the room workspace" onChange={() => setDraft({ ...draft, targetKind: "room" })} />
								</div>
							</div>
							{draft.targetKind === "room" ? <Field label="Room"><select value={draft.roomId} onChange={(event) => setDraft({ ...draft, roomId: event.target.value })} className={inputClass}>{rooms.map((room) => <option key={room.id} value={room.id} disabled={room.archived}>{room.label}{room.archived ? " (archived)" : ""}</option>)}</select></Field> : null}
							<div className="grid grid-cols-2 gap-2 pt-1">
								<Toggle checked={draft.enabled} label="Enabled" onChange={(checked) => setDraft({ ...draft, enabled: checked })} />
								<Toggle checked={draft.deleteAfterRun} label="Delete one-shot after success" onChange={(checked) => setDraft({ ...draft, deleteAfterRun: checked })} />
							</div>
						</Panel>

						<Panel title="Schedule Builder">
							<div className="grid grid-cols-2 gap-2 max-[720px]:grid-cols-1">
								{schedulePresets.map((preset) => (
									<RadioCard key={preset.kind} name="schedule-kind" checked={draft.scheduleKind === preset.kind} title={preset.title} description={preset.description} onChange={() => setDraft({ ...draft, scheduleKind: preset.kind })} />
								))}
							</div>

							<div className="rounded-sm border border-slate-800 bg-[#101d22] p-3 space-y-3">
								{draft.scheduleKind === "in" ? <DurationPicker label="Run after" amount={draft.inAmount} unit={draft.inUnit} onAmount={(inAmount) => setDraft({ ...draft, inAmount })} onUnit={(inUnit) => setDraft({ ...draft, inUnit })} /> : null}

								{draft.scheduleKind === "at" ? (
									<div className="grid grid-cols-2 gap-3">
										<Field label="Date"><input type="date" value={draft.atDate} onChange={(event) => setDraft({ ...draft, atDate: event.target.value })} className={inputClass} /></Field>
										<Field label="Time"><input type="time" value={draft.atTime} onChange={(event) => setDraft({ ...draft, atTime: event.target.value })} className={inputClass} /></Field>
									</div>
								) : null}

								{draft.scheduleKind === "every" ? <DurationPicker label="Every" amount={draft.everyAmount} unit={draft.everyUnit} onAmount={(everyAmount) => setDraft({ ...draft, everyAmount })} onUnit={(everyUnit) => setDraft({ ...draft, everyUnit })} /> : null}

								{draft.scheduleKind === "daily" ? <Field label="Time"><input type="time" value={draft.dailyTime} onChange={(event) => setDraft({ ...draft, dailyTime: event.target.value })} className={inputClass} /></Field> : null}

								{draft.scheduleKind === "weekly" ? (
									<div className="space-y-3">
										<div>
											<div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Weekdays</div>
											<div className="grid grid-cols-7 gap-1 max-[720px]:grid-cols-4">
												{weekdayOptions.map((day) => <CheckboxChip key={day.value} checked={draft.weeklyDays.includes(day.value)} label={day.short} title={day.label} onChange={(checked) => setDraft({ ...draft, weeklyDays: toggleDay(draft.weeklyDays, day.value, checked) })} />)}
											</div>
										</div>
										<Field label="Time"><input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} className={inputClass} /></Field>
									</div>
								) : null}

								{draft.scheduleKind === "monthly" ? (
									<div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-[720px]:grid-cols-1">
										<Field label="Day"><select value={draft.monthlyDay} onChange={(event) => setDraft({ ...draft, monthlyDay: event.target.value })} className={inputClass}>{Array.from({ length: 31 }, (_, index) => String(index + 1)).map((day) => <option key={day} value={day}>{day}</option>)}</select></Field>
										<Field label="Time"><input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} className={inputClass} /></Field>
									</div>
								) : null}

								{draft.scheduleKind === "cron" ? <Field label="5-field cron expression"><input value={draft.cronExpr} onChange={(event) => setDraft({ ...draft, cronExpr: event.target.value })} className={`${inputClass} font-mono`} placeholder="0 8 * * 1-5" /></Field> : null}

								<Field label="Timezone"><input value={draft.tz} onChange={(event) => setDraft({ ...draft, tz: event.target.value })} className={inputClass} placeholder="optional, e.g. Europe/Berlin" /></Field>
							</div>

							<div className={`rounded-sm border px-3 py-2 ${schedulePreview.kind === "error" ? "border-red-500/40 bg-red-500/10" : "border-[#11a4d4]/30 bg-[#11a4d4]/10"}`}>
								<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Generated schedule</div>
								<div className="mt-1 font-mono text-sm text-slate-100">{schedulePreview.value}</div>
								<div className="mt-1 text-xs text-slate-500">{schedulePreview.description}</div>
							</div>
							<div className="text-xs text-slate-500">Agents use the CLI for the same result, e.g. <code className="text-slate-300">pibo cron add --cron "{schedulePreview.kind === "cron" ? schedulePreview.value : "0 8 * * *"}" --prompt "..." --personal</code>.</div>
						</Panel>
					</section>

					<Panel title="Prompt / Task">
						<textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} className={`${inputClass} min-h-40 resize-y leading-relaxed`} placeholder="What should the agent do on each run?" />
					</Panel>

					<Panel title={selectedJob ? "Recent runs" : "Recent runs will appear after saving"}>
						{visibleRuns.length === 0 ? <div className="text-sm text-slate-500">No runs yet.</div> : (
							<div className="overflow-auto">
								<table className="w-full text-sm">
									<thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="text-left py-2">Status</th><th className="text-left py-2">Started</th><th className="text-left py-2">Session</th><th className="text-left py-2">Error</th></tr></thead>
									<tbody>{visibleRuns.map((run) => <tr key={run.id} className="border-t border-slate-800"><td className="py-2"><StatusBadge status={run.status} /></td><td className="py-2 text-slate-400">{shortDate(run.startedAt ?? run.createdAt)}</td><td className="py-2">{run.piboSessionId ? <a className="text-[#11a4d4] hover:underline" href={`/apps/chat/sessions/${encodeURIComponent(run.piboSessionId)}`}>{run.piboSessionId.slice(0, 10)}…</a> : <span className="text-slate-600">-</span>}</td><td className="py-2 text-red-300">{run.error ?? ""}</td></tr>)}</tbody>
								</table>
							</div>
						)}
					</Panel>
				</div>
			</main>
		</div>
	);
}

const inputClass = "w-full rounded-sm border border-slate-700 bg-[#101d22] px-3 py-2 text-sm text-slate-200 outline-none focus:border-[#11a4d4] disabled:opacity-50";
const radioClass = "sr-only peer";

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

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
	return (
		<label className="flex items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22] px-3 py-2 text-sm text-slate-300">
			<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#11a4d4]" />
			<span>{label}</span>
		</label>
	);
}

function DurationPicker({ label, amount, unit, onAmount, onUnit }: { label: string; amount: string; unit: DurationUnit; onAmount: (value: string) => void; onUnit: (value: DurationUnit) => void }) {
	return (
		<div className="space-y-2">
			<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
			<div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 max-[720px]:grid-cols-1">
				<input type="number" min="1" step="1" value={amount} onChange={(event) => onAmount(event.target.value)} className={inputClass} />
				<div className="grid grid-cols-3 gap-2">
					<RadioPill name={`${label}-unit`} checked={unit === "minutes"} label="Minutes" onChange={() => onUnit("minutes")} />
					<RadioPill name={`${label}-unit`} checked={unit === "hours"} label="Hours" onChange={() => onUnit("hours")} />
					<RadioPill name={`${label}-unit`} checked={unit === "days"} label="Days" onChange={() => onUnit("days")} />
				</div>
			</div>
		</div>
	);
}

function RadioPill({ name, checked, label, onChange }: { name: string; checked: boolean; label: string; onChange: () => void }) {
	return (
		<label className="cursor-pointer">
			<input type="radio" name={name} checked={checked} onChange={onChange} className={radioClass} />
			<span className="block rounded-sm border border-slate-700 bg-[#101d22] px-2 py-2 text-center text-xs text-slate-400 peer-checked:border-[#11a4d4] peer-checked:text-[#11a4d4] hover:border-slate-500">{label}</span>
		</label>
	);
}

function CheckboxChip({ checked, label, title, onChange }: { checked: boolean; label: string; title: string; onChange: (checked: boolean) => void }) {
	return (
		<label title={title} className="cursor-pointer">
			<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only peer" />
			<span className="block rounded-sm border border-slate-700 bg-[#101d22] px-2 py-2 text-center text-xs font-semibold text-slate-400 peer-checked:border-[#11a4d4] peer-checked:bg-[#11a4d4]/10 peer-checked:text-[#11a4d4] hover:border-slate-500">{label}</span>
		</label>
	);
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
	return <div className="rounded-sm border border-slate-800 bg-[#101d22] px-2 py-2"><div className="text-slate-100 font-semibold truncate">{value}</div><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div></div>;
}

function ErrorBox({ message }: { message: string }) {
	return <div className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 text-red-300" /> <span>{message}</span></div>;
}

function StatusBadge({ status }: { status: PiboCronRun["status"] }) {
	const styles = status === "ok" ? "border-emerald-500/40 text-emerald-300" : status === "error" ? "border-red-500/40 text-red-300" : status === "running" ? "border-[#11a4d4]/50 text-[#11a4d4]" : "border-slate-600 text-slate-400";
	return <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] ${styles}`}>{status === "running" ? <Loader2 size={11} className="animate-spin" /> : null}{status}</span>;
}

function createEmptyDraft(defaultProfile: string, rooms: RoomOption[]): CronDraft {
	const future = new Date(Date.now() + 60 * 60_000);
	return {
		name: "",
		description: "",
		enabled: true,
		targetKind: "personal",
		roomId: rooms.find((room) => !room.archived)?.id ?? "",
		profile: defaultProfile,
		prompt: "",
		scheduleKind: "daily",
		inAmount: "20",
		inUnit: "minutes",
		atDate: localDateValue(future),
		atTime: localTimeValue(future),
		everyAmount: "1",
		everyUnit: "hours",
		dailyTime: "08:00",
		weeklyDays: [1, 3, 5],
		monthlyDay: "1",
		time: "08:00",
		cronExpr: "0 8 * * *",
		tz: "",
		deleteAfterRun: false,
	};
}

function draftFromJob(job: PiboCronJob, defaultProfile: string, rooms: RoomOption[]): CronDraft {
	const draft = createEmptyDraft(defaultProfile, rooms);
	draft.name = job.name;
	draft.description = job.description ?? "";
	draft.enabled = job.enabled;
	draft.targetKind = job.target.kind;
	draft.roomId = job.target.kind === "room" ? job.target.roomId : draft.roomId;
	draft.profile = job.profile;
	draft.prompt = job.prompt;
	draft.deleteAfterRun = Boolean(job.deleteAfterRun);
	if (job.scheduleUi) applyScheduleUi(draft, job.scheduleUi);
	else if (job.schedule.kind === "cron") {
		applyCronToDraft(draft, job.schedule.expr);
		draft.tz = job.schedule.tz ?? "";
	} else if (job.schedule.kind === "every") {
		draft.scheduleKind = "every";
		const duration = durationParts(job.schedule.everyMs);
		draft.everyAmount = String(duration.amount);
		draft.everyUnit = duration.unit;
	} else {
		draft.scheduleKind = "at";
		const date = new Date(job.schedule.at);
		draft.atDate = localDateValue(date);
		draft.atTime = localTimeValue(date);
	}
	return draft;
}

function applyScheduleUi(draft: CronDraft, scheduleUi: NonNullable<PiboCronJob["scheduleUi"]>): void {
	draft.tz = "tz" in scheduleUi ? scheduleUi.tz ?? "" : "";
	switch (scheduleUi.preset) {
		case "in": draft.scheduleKind = "in"; draft.inAmount = String(scheduleUi.amount); draft.inUnit = scheduleUi.unit; break;
		case "at": {
			const [date, time = "08:00"] = scheduleUi.localDateTime.split("T");
			draft.scheduleKind = "at";
			draft.atDate = date || draft.atDate;
			draft.atTime = time.slice(0, 5);
			break;
		}
		case "every": draft.scheduleKind = "every"; draft.everyAmount = String(scheduleUi.amount); draft.everyUnit = scheduleUi.unit; break;
		case "daily": draft.scheduleKind = "daily"; draft.dailyTime = scheduleUi.time; break;
		case "weekly": draft.scheduleKind = "weekly"; draft.weeklyDays = scheduleUi.weekdays; draft.time = scheduleUi.time; break;
		case "monthly": draft.scheduleKind = "monthly"; draft.monthlyDay = String(scheduleUi.dayOfMonth); draft.time = scheduleUi.time; break;
		case "advanced": applyCronToDraft(draft, scheduleUi.expr); break;
	}
}

function inputFromDraft(draft: CronDraft): CronJobInput {
	const target = draft.targetKind === "room" ? { kind: "room" as const, roomId: draft.roomId } : { kind: "personal" as const, principalId: "" };
	return {
		name: draft.name.trim() || undefined,
		description: draft.description.trim() || undefined,
		enabled: draft.enabled,
		target,
		profile: draft.profile,
		prompt: draft.prompt,
		schedule: scheduleFromDraft(draft),
		deleteAfterRun: draft.deleteAfterRun,
	};
}

function scheduleFromDraft(draft: CronDraft): CronScheduleInput {
	const tz = draft.tz.trim() || undefined;
	switch (draft.scheduleKind) {
		case "in": return { kind: "in", value: durationValue(draft.inAmount, draft.inUnit) };
		case "at": return { kind: "at", value: `${draft.atDate}T${draft.atTime}`, tz };
		case "every": return { kind: "cron", expr: cronExpressionFromDraft(draft), tz };
		case "daily": return { kind: "daily", time: draft.dailyTime, tz };
		case "weekly": return { kind: "weekly", weekdays: draft.weeklyDays.join(","), time: draft.time, tz };
		case "monthly": return { kind: "monthly", dayOfMonth: Number(draft.monthlyDay), time: draft.time, tz };
		case "cron": return { kind: "cron", expr: draft.cronExpr.trim(), tz };
	}
}

function previewSchedule(draft: CronDraft): { kind: "cron" | "one-shot" | "error"; value: string; description: string } {
	try {
		if (draft.scheduleKind === "in") return { kind: "one-shot", value: durationValue(draft.inAmount, draft.inUnit), description: "One-shot schedule; the backend stores an absolute run time, not a recurring cron expression." };
		if (draft.scheduleKind === "at") return { kind: "one-shot", value: `${draft.atDate}T${draft.atTime}`, description: "One-shot schedule selected with native date and time pickers." };
		return { kind: "cron", value: cronExpressionFromDraft(draft), description: "This is the cron expression generated from the controls above." };
	} catch (error) {
		return { kind: "error", value: "Invalid schedule", description: errorMessage(error) };
	}
}

function cronExpressionFromDraft(draft: CronDraft): string {
	if (draft.scheduleKind === "cron") return draft.cronExpr.trim();
	if (draft.scheduleKind === "daily") {
		const { hour, minute } = timeParts(draft.dailyTime);
		return `${minute} ${hour} * * *`;
	}
	if (draft.scheduleKind === "weekly") {
		const { hour, minute } = timeParts(draft.time);
		if (draft.weeklyDays.length === 0) throw new Error("Select at least one weekday");
		return `${minute} ${hour} * * ${draft.weeklyDays.join(",")}`;
	}
	if (draft.scheduleKind === "monthly") {
		const { hour, minute } = timeParts(draft.time);
		const day = Number(draft.monthlyDay);
		if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Monthly day must be between 1 and 31");
		return `${minute} ${hour} ${day} * *`;
	}
	if (draft.scheduleKind === "every") {
		const amount = positiveInteger(draft.everyAmount);
		if (draft.everyUnit === "minutes") {
			if (amount > 59) throw new Error("Minute intervals must be between 1 and 59 for cron");
			return amount === 1 ? "* * * * *" : `*/${amount} * * * *`;
		}
		if (draft.everyUnit === "hours") {
			if (amount > 23) throw new Error("Hour intervals must be between 1 and 23 for cron");
			return amount === 1 ? "0 * * * *" : `0 */${amount} * * *`;
		}
		if (amount > 31) throw new Error("Day intervals must be between 1 and 31 for cron");
		return amount === 1 ? "0 8 * * *" : `0 8 */${amount} * *`;
	}
	throw new Error("This schedule type is not recurring");
}

function applyCronToDraft(draft: CronDraft, expr: string): void {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) {
		draft.scheduleKind = "cron";
		draft.cronExpr = expr;
		return;
	}
	const [minute, hour, day, month, weekday] = fields;
	if (minute === "*" && hour === "*" && day === "*" && month === "*" && weekday === "*") {
		draft.scheduleKind = "every";
		draft.everyAmount = "1";
		draft.everyUnit = "minutes";
		return;
	}
	const everyMinute = minute.match(/^\*\/(\d+)$/);
	if (everyMinute && hour === "*" && day === "*" && month === "*" && weekday === "*") {
		draft.scheduleKind = "every";
		draft.everyAmount = everyMinute[1];
		draft.everyUnit = "minutes";
		return;
	}
	if (minute === "0" && hour === "*" && day === "*" && month === "*" && weekday === "*") {
		draft.scheduleKind = "every";
		draft.everyAmount = "1";
		draft.everyUnit = "hours";
		return;
	}
	const everyHour = hour.match(/^\*\/(\d+)$/);
	if (minute === "0" && everyHour && day === "*" && month === "*" && weekday === "*") {
		draft.scheduleKind = "every";
		draft.everyAmount = everyHour[1];
		draft.everyUnit = "hours";
		return;
	}
	if (isSimpleNumber(minute, 0, 59) && isSimpleNumber(hour, 0, 23) && month === "*") {
		const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
		if (day === "*" && weekday === "*") {
			draft.scheduleKind = "daily";
			draft.dailyTime = time;
			return;
		}
		if (day === "*" && weekday !== "*") {
			draft.scheduleKind = "weekly";
			draft.weeklyDays = weekday.split(",").map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
			draft.time = time;
			return;
		}
		if (weekday === "*" && isSimpleNumber(day, 1, 31)) {
			draft.scheduleKind = "monthly";
			draft.monthlyDay = day;
			draft.time = time;
			return;
		}
	}
	draft.scheduleKind = "cron";
	draft.cronExpr = expr;
}

function flattenRooms(rooms: PiboRoom[]): RoomOption[] {
	const output: RoomOption[] = [];
	const visit = (room: PiboRoom, prefix = "") => {
		const label = prefix ? `${prefix} / ${room.name}` : room.name;
		output.push({ id: room.id, label, archived: typeof room.metadata.chatRoomArchivedAt === "string" });
		for (const child of room.children ?? []) visit(child, label);
	};
	for (const room of rooms) visit(room);
	return output;
}

function profileOptions(agents: AgentProfile[], customAgents: CustomAgent[]): AgentOption[] {
	const options = new Map<string, AgentOption>();
	for (const agent of agents) options.set(agent.name, { name: agent.name, description: agent.description });
	for (const agent of customAgents) if (!agent.archivedAt) options.set(agent.profileName, { name: agent.profileName, description: agent.description });
	return [...options.values()];
}

function isRecurringCronJob(job: PiboCronJob): boolean {
	if (job.schedule.kind === "every" || job.schedule.kind === "cron") return true;
	return job.scheduleUi?.preset === "every" || job.scheduleUi?.preset === "daily" || job.scheduleUi?.preset === "weekly" || job.scheduleUi?.preset === "monthly" || job.scheduleUi?.preset === "advanced";
}

function formatSchedule(job: PiboCronJob): string {
	const ui = job.scheduleUi;
	if (ui) {
		switch (ui.preset) {
			case "in": return `in ${ui.amount} ${ui.unit}`;
			case "at": return `at ${ui.localDateTime}`;
			case "every": return `every ${ui.amount} ${ui.unit}`;
			case "daily": return `daily at ${ui.time}`;
			case "weekly": return `weekly ${ui.weekdays.join(",")} at ${ui.time}`;
			case "monthly": return `monthly day ${ui.dayOfMonth} at ${ui.time}`;
			case "advanced": return `cron ${ui.expr}`;
		}
	}
	if (job.schedule.kind === "at") return `at ${job.schedule.at}`;
	if (job.schedule.kind === "every") return `every ${formatDuration(job.schedule.everyMs)}`;
	return `cron ${job.schedule.expr}`;
}

function toggleDay(days: number[], day: number, checked: boolean): number[] {
	const next = checked ? [...days, day] : days.filter((value) => value !== day);
	return [...new Set(next)].sort((a, b) => a - b);
}

function durationValue(amount: string, unit: DurationUnit): string {
	return `${positiveInteger(amount)}${unitSuffix(unit)}`;
}

function positiveInteger(value: string): number {
	const numeric = Number(value);
	if (!Number.isInteger(numeric) || numeric < 1) throw new Error("Amount must be a positive integer");
	return numeric;
}

function timeParts(value: string): { hour: string; minute: string } {
	const match = value.match(/^(\d{2}):(\d{2})$/);
	if (!match) throw new Error("Time must use HH:MM");
	return { hour: String(Number(match[1])), minute: String(Number(match[2])) };
}

function isSimpleNumber(value: string, min: number, max: number): boolean {
	const numeric = Number(value);
	return Number.isInteger(numeric) && numeric >= min && numeric <= max;
}

function shortDate(value: string): string {
	return new Date(value).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function localDateValue(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(ms: number): string {
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (ms % day === 0) return `${ms / day}d`;
	if (ms % hour === 0) return `${ms / hour}h`;
	return `${Math.round(ms / minute)}m`;
}

function durationParts(ms: number): { amount: number; unit: DurationUnit } {
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (ms % day === 0) return { amount: ms / day, unit: "days" };
	if (ms % hour === 0) return { amount: ms / hour, unit: "hours" };
	return { amount: Math.round(ms / minute), unit: "minutes" };
}

function unitSuffix(unit: DurationUnit): string {
	return unit === "minutes" ? "m" : unit === "hours" ? "h" : "d";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
