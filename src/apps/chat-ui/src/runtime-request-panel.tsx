import { useMemo, useState } from "react";
import { HelpCircle, ShieldAlert } from "lucide-react";
import { postAction } from "./api-chat-sessions";
import type {
	PiboRuntimeApprovalDecision,
	PiboRuntimeApprovalRequest,
	PiboRuntimeUserInputQuestion,
	PiboRuntimeUserInputRequest,
} from "./types";
import { errorMessage } from "./error-message";

const FALLBACK_APPROVAL_DECISIONS: readonly PiboRuntimeApprovalDecision[] = [
	{ id: "accept", label: "Approve once" },
	{ id: "acceptForSession", label: "Approve for session" },
	{ id: "decline", label: "Decline" },
	{ id: "cancel", label: "Cancel turn" },
];

type RuntimeRequestPanelProps = {
	piboSessionId: string;
	approvals: readonly PiboRuntimeApprovalRequest[];
	userInputs: readonly PiboRuntimeUserInputRequest[];
	onResolved: (requestId: string) => void;
	onError: (message: string | null) => void;
};

export function RuntimeRequestPanel({
	piboSessionId,
	approvals,
	userInputs,
	onResolved,
	onError,
}: RuntimeRequestPanelProps) {
	const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
	if (approvals.length === 0 && userInputs.length === 0) return null;

	const respondToApproval = async (requestId: string, decision: string) => {
		if (busyRequestId) return;
		setBusyRequestId(requestId);
		onError(null);
		try {
			await postAction(piboSessionId, "runtime.approval.respond", { requestId, decision });
			onResolved(requestId);
		} catch (caught) {
			onError(errorMessage(caught));
		} finally {
			setBusyRequestId(null);
		}
	};

	const respondToUserInput = async (requestId: string, answers: Record<string, string>) => {
		if (busyRequestId) return;
		setBusyRequestId(requestId);
		onError(null);
		try {
			await postAction(piboSessionId, "runtime.user_input.respond", { requestId, answers });
			onResolved(requestId);
		} catch (caught) {
			onError(errorMessage(caught));
		} finally {
			setBusyRequestId(null);
		}
	};

	return (
		<section
			className="border-t border-slate-800 bg-[#101d22] px-3 py-2 sm:px-4"
			data-pibo-debug="runtime-request-panel"
			aria-label="Runtime requests"
		>
			<div className="mx-auto grid w-full max-w-4xl gap-2">
				{approvals.map((request) => (
					<ApprovalRequestCard
						key={request.requestId}
						request={request}
						busy={busyRequestId === request.requestId}
						disabled={busyRequestId !== null}
						onDecision={(decision) => void respondToApproval(request.requestId, decision)}
					/>
				))}
				{userInputs.map((request) => (
					<UserInputRequestCard
						key={request.requestId}
						request={request}
						busy={busyRequestId === request.requestId}
						disabled={busyRequestId !== null}
						onSubmit={(answers) => void respondToUserInput(request.requestId, answers)}
					/>
				))}
			</div>
		</section>
	);
}

function ApprovalRequestCard({
	request,
	busy,
	disabled,
	onDecision,
}: {
	request: PiboRuntimeApprovalRequest;
	busy: boolean;
	disabled: boolean;
	onDecision: (decision: string) => void;
}) {
	const decisions = request.decisions?.length ? request.decisions : FALLBACK_APPROVAL_DECISIONS;
	return (
		<article className="rounded-sm border border-amber-500/40 bg-amber-500/5" data-pibo-debug="runtime-approval-request">
			<div className="flex items-start gap-3 border-b border-amber-500/20 px-3 py-2">
				<ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">{request.title || "Approval required"}</h3>
						<span className="rounded-sm border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-400">{request.requestType}</span>
					</div>
					{request.detail ? <p className="mt-1 text-xs leading-5 text-slate-300">{request.detail}</p> : null}
				</div>
			</div>
			{request.arguments !== undefined ? (
				<pre className="max-h-36 overflow-auto border-b border-slate-800 bg-[#0e1116] px-3 py-2 font-mono text-[11px] leading-5 text-slate-300">
					{formatRequestArguments(request.arguments)}
				</pre>
			) : null}
			<div className="flex flex-wrap gap-2 px-3 py-2">
				{decisions.map((decision) => (
					<button
						key={decision.id}
						type="button"
						onClick={() => onDecision(decision.id)}
						disabled={disabled}
						title={decision.description}
						className={approvalButtonClass(decision.id)}
						data-pibo-decision={decision.id}
					>
						{busy ? "Responding…" : decision.label}
					</button>
				))}
			</div>
		</article>
	);
}

function UserInputRequestCard({
	request,
	busy,
	disabled,
	onSubmit,
}: {
	request: PiboRuntimeUserInputRequest;
	busy: boolean;
	disabled: boolean;
	onSubmit: (answers: Record<string, string>) => void;
}) {
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const complete = useMemo(
		() => request.questions.every((question) => Boolean(answers[question.id]?.trim())),
		[answers, request.questions],
	);
	return (
		<article className="rounded-sm border border-cyan-500/40 bg-cyan-500/5" data-pibo-debug="runtime-user-input-request">
			<div className="flex items-start gap-3 border-b border-cyan-500/20 px-3 py-2">
				<HelpCircle size={16} className="mt-0.5 shrink-0 text-cyan-400" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">Input requested</h3>
						<span className="rounded-sm border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-400">
							{request.blocking === false ? "non-blocking" : "blocking"}
						</span>
					</div>
					<p className="mt-1 text-xs leading-5 text-slate-400">Codex is waiting for structured input before continuing this turn.</p>
				</div>
			</div>
			<div className="grid gap-3 px-3 py-3">
				{request.questions.map((question) => (
					<UserInputQuestionField
						key={question.id}
						question={question}
						groupName={`runtime-question-${request.requestId}-${question.id}`}
						value={answers[question.id] ?? ""}
						disabled={disabled}
						onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
					/>
				))}
			</div>
			<div className="flex justify-end border-t border-cyan-500/20 px-3 py-2">
				<button
					type="button"
					onClick={() => onSubmit(answers)}
					disabled={disabled || !complete}
					className="rounded-sm border border-[#11a4d4] bg-[#11a4d4] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0d8eb8] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{busy ? "Submitting…" : "Submit response"}
				</button>
			</div>
		</article>
	);
}

function UserInputQuestionField({
	question,
	groupName,
	value,
	disabled,
	onChange,
}: {
	question: PiboRuntimeUserInputQuestion;
	groupName: string;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const options = question.options ?? [];
	const listed = new Set(options.map((option) => option.label));
	const selectingOther = Boolean(value) && !listed.has(value);
	return (
		<fieldset className="grid gap-2" disabled={disabled}>
			<legend className="text-xs font-semibold text-slate-200">
				{question.header ? <span className="mr-2 font-mono uppercase text-cyan-400">{question.header}</span> : null}
				{question.question}
			</legend>
			{options.length ? (
				<div className="grid gap-1.5 sm:grid-cols-2">
					{options.map((option) => (
						<label key={option.label} className="flex cursor-pointer gap-2 rounded-sm border border-slate-700 bg-[#151f24] px-2.5 py-2 text-xs hover:border-cyan-500/60">
							<input
								type="radio"
								name={groupName}
								value={option.label}
								checked={value === option.label}
								onChange={() => onChange(option.label)}
								className="mt-0.5 accent-[#11a4d4]"
							/>
							<span><span className="block font-semibold text-slate-200">{option.label}</span>{option.description ? <span className="mt-0.5 block leading-4 text-slate-400">{option.description}</span> : null}</span>
						</label>
					))}
					{question.allowFreeform ? (
						<label className="flex cursor-pointer gap-2 rounded-sm border border-slate-700 bg-[#151f24] px-2.5 py-2 text-xs hover:border-cyan-500/60">
							<input
								type="radio"
								name={groupName}
								checked={selectingOther}
								onChange={() => onChange("Other")}
								className="mt-0.5 accent-[#11a4d4]"
							/>
							<span className="font-semibold text-slate-200">Other</span>
						</label>
					) : null}
				</div>
			) : null}
			{options.length === 0 || (question.allowFreeform && selectingOther) ? (
				<input
					type={question.secret ? "password" : "text"}
					value={selectingOther && value === "Other" ? "" : value}
					onChange={(event) => onChange(event.target.value)}
					autoComplete="off"
					placeholder={question.secret ? "Enter a private response" : "Enter a response"}
					className="w-full rounded-sm border border-slate-700 bg-[#0e1116] px-2.5 py-2 font-mono text-xs text-slate-200 outline-none focus:border-[#11a4d4] focus:ring-1 focus:ring-[#11a4d4]/40"
				/>
			) : null}
		</fieldset>
	);
}

function approvalButtonClass(decision: string): string {
	const base = "rounded-sm border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
	if (decision === "accept") return `${base} border-emerald-500/60 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`;
	if (decision === "acceptForSession") return `${base} border-cyan-500/60 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20`;
	if (decision === "cancel") return `${base} border-red-500/60 bg-red-500/10 text-red-300 hover:bg-red-500/20`;
	return `${base} border-slate-600 bg-slate-800/60 text-slate-300 hover:border-slate-500`;
}

function formatRequestArguments(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "[unavailable]";
	}
}
