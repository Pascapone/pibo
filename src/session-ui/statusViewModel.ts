export type TerminalProgressTone = "green" | "yellow" | "red" | "cyan" | "neutral";

export type TerminalProgressDescriptor = {
	id: string;
	label: string;
	state: "available" | "unavailable";
	value?: number;
	max?: number;
	percent?: number;
	text: string;
	tone: TerminalProgressTone;
};

export type TerminalStatusField = {
	id: string;
	label: string;
	value: string;
	tone?: TerminalProgressTone;
};

export type TerminalStatusViewModel = {
	kind: "status";
	title: string;
	fields: TerminalStatusField[];
	progress: TerminalProgressDescriptor[];
	warnings: string[];
	errors: string[];
};

export type BuildTerminalStatusInput = {
	owner?: { label?: string; scope?: string };
	session?: { id?: string; title?: string; profile?: string; status?: string };
	model?: { provider?: string; id?: string; label?: string };
	runtime?: { state?: string; connected?: boolean; queuedMessages?: number; processing?: boolean; streaming?: boolean; disposed?: boolean };
	cwd?: string;
	contextUsage?: { tokens?: number; contextWindow?: number; percent?: number } | null;
	providerUsage?: {
		provider?: string;
		planType?: string;
		limits?: readonly { label?: string; usedPercent?: number; remainingPercent?: number; resetsAt?: string }[];
		credits?: { unlimited?: boolean; balance?: string };
	} | null;
	tools?: { enabled?: readonly string[]; active?: readonly string[] };
	thinking?: { level?: string; supported?: boolean } | string;
	fastMode?: boolean | string;
	warnings?: readonly string[];
	errors?: readonly string[];
	message?: string;
};

export function buildTerminalStatusViewModel(input: BuildTerminalStatusInput = {}): TerminalStatusViewModel {
	const fields: TerminalStatusField[] = [];
	const progress: TerminalProgressDescriptor[] = [];
	const warnings = sanitizeTextList(input.warnings);
	const errors = sanitizeTextList(input.errors);

	const ownerLabel = input.owner?.label ?? input.owner?.scope;
	if (ownerLabel || input.owner?.scope) {
		fields.push({ id: "owner", label: "Owner", value: redactTerminalSecret([ownerLabel, input.owner?.scope ? `(${input.owner.scope})` : undefined].filter(Boolean).join(" ")) });
	}
	if (input.session?.id || input.session?.title) {
		fields.push({ id: "session", label: "Session", value: redactTerminalSecret([input.session?.title, input.session?.id].filter(Boolean).join(" | ")) });
	}
	if (input.session?.profile) fields.push({ id: "profile", label: "Profile", value: redactTerminalSecret(input.session.profile) });
	if (input.session?.status) fields.push({ id: "session-status", label: "Session status", value: redactTerminalSecret(input.session.status), tone: input.session.status === "error" || input.session.status === "disposed" ? "red" : "neutral" });
	if (input.model?.provider || input.model?.id || input.model?.label) {
		fields.push({ id: "model", label: "Model", value: redactTerminalSecret(input.model.label ?? [input.model.provider, input.model.id].filter(Boolean).join("/")) });
	}
	if (input.runtime?.state) fields.push({ id: "runtime", label: "Runtime", value: redactTerminalSecret(input.runtime.state), tone: input.runtime.connected === false || input.runtime.disposed ? "red" : "green" });
	if (input.runtime?.disposed !== undefined) fields.push({ id: "disposed", label: "Disposed", value: input.runtime.disposed ? "yes" : "no", tone: input.runtime.disposed ? "red" : "neutral" });
	if (typeof input.runtime?.queuedMessages === "number") fields.push({ id: "queue", label: "Queue", value: String(input.runtime.queuedMessages) });
	if (input.runtime?.processing !== undefined) fields.push({ id: "processing", label: "Processing", value: input.runtime.processing ? "yes" : "no", tone: input.runtime.processing ? "cyan" : "neutral" });
	if (input.runtime?.streaming !== undefined) fields.push({ id: "streaming", label: "Streaming", value: input.runtime.streaming ? "yes" : "no", tone: input.runtime.streaming ? "cyan" : "neutral" });
	if (input.cwd) fields.push({ id: "cwd", label: "CWD", value: redactTerminalSecret(input.cwd) });
	const thinking = typeof input.thinking === "string" ? { level: input.thinking } : input.thinking;
	if (thinking?.level || thinking?.supported !== undefined) {
		fields.push({ id: "thinking", label: "Thinking", value: redactTerminalSecret(thinking.level ?? (thinking.supported === false ? "unsupported" : "available")), tone: thinking.supported === false ? "red" : "yellow" });
	}
	if (input.fastMode !== undefined) fields.push({ id: "fast-mode", label: "Fast mode", value: typeof input.fastMode === "string" ? redactTerminalSecret(input.fastMode) : input.fastMode ? "on" : "off", tone: input.fastMode ? "green" : "neutral" });
	const enabledTools = sanitizeTextList(input.tools?.enabled);
	const activeTools = sanitizeTextList(input.tools?.active);
	if (enabledTools.length) fields.push({ id: "enabled-tools", label: "Enabled tools", value: `${enabledTools.length}${enabledTools.length <= 4 ? ` (${enabledTools.join(", ")})` : ""}` });
	if (activeTools.length) fields.push({ id: "active-tools", label: "Active tools", value: `${activeTools.length}${activeTools.length <= 4 ? ` (${activeTools.join(", ")})` : ""}`, tone: "cyan" });
	if (input.providerUsage?.planType) fields.push({ id: "provider-plan", label: "Provider plan", value: redactTerminalSecret(input.providerUsage.planType) });
	if (input.providerUsage?.credits) fields.push({ id: "provider-credits", label: "Credits", value: input.providerUsage.credits.unlimited ? "unlimited" : redactTerminalSecret(input.providerUsage.credits.balance ?? "available") });
	if (input.message) fields.push({ id: "message", label: "Message", value: redactTerminalSecret(input.message) });

	progress.push(contextProgress(input.contextUsage));
	for (const descriptor of providerProgress(input.providerUsage)) progress.push(descriptor);

	return { kind: "status", title: "Status", fields, progress, warnings, errors };
}

export function progressBarText(descriptor: TerminalProgressDescriptor, width = 20): string {
	if (descriptor.state === "unavailable" || descriptor.percent === undefined) return "unavailable";
	const boundedWidth = Math.max(4, Math.min(80, Math.floor(width)));
	const filled = Math.round((Math.max(0, Math.min(100, descriptor.percent)) / 100) * boundedWidth);
	return `${"█".repeat(filled)}${"░".repeat(boundedWidth - filled)} ${descriptor.percent.toFixed(1)}%`;
}

export function redactTerminalSecret(text: string): string {
	return text
		.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(?:sk|pk|pibo|ghp|github_pat)_[A-Za-z0-9_\-]{8,}\b/g, "[redacted]");
}

function contextProgress(usage: BuildTerminalStatusInput["contextUsage"]): TerminalProgressDescriptor {
	if (!usage || (usage.tokens === undefined && usage.contextWindow === undefined && usage.percent === undefined)) {
		return { id: "context", label: "Context", state: "unavailable", text: "Context usage unavailable", tone: "neutral" };
	}
	const percent = normalizePercent(usage.percent ?? (usage.tokens !== undefined && usage.contextWindow ? (usage.tokens / usage.contextWindow) * 100 : undefined));
	return {
		id: "context",
		label: "Context",
		state: percent === undefined ? "unavailable" : "available",
		value: usage.tokens,
		max: usage.contextWindow,
		percent,
		text: percent === undefined ? "Context usage unavailable" : `${usage.tokens ?? "?"}/${usage.contextWindow ?? "?"} tokens (${percent.toFixed(1)}%)`,
		tone: toneForPercent(percent),
	};
}

function providerProgress(usage: BuildTerminalStatusInput["providerUsage"]): TerminalProgressDescriptor[] {
	if (!usage?.limits?.length) {
		return [{ id: "provider", label: "Provider quota", state: "unavailable", text: "Provider usage unavailable", tone: "neutral" }];
	}
	return usage.limits.map((limit, index) => {
		const usedPercent = normalizePercent(limit.usedPercent);
		const remainingPercent = normalizePercent(limit.remainingPercent ?? (usedPercent === undefined ? undefined : 100 - usedPercent));
		const provider = usage.provider ? `${usage.provider} ` : "";
		const details = [
			remainingPercent === undefined ? undefined : `${remainingPercent.toFixed(1)}% remaining`,
			limit.resetsAt ? `resets ${redactTerminalSecret(limit.resetsAt)}` : undefined,
		].filter(Boolean).join(", ");
		return {
			id: `provider-${index}`,
			label: `${provider}${limit.label ?? "quota"}`.trim(),
			state: remainingPercent === undefined ? "unavailable" : "available",
			percent: remainingPercent,
			text: remainingPercent === undefined ? "Provider usage unavailable" : details,
			tone: toneForRemainingPercent(remainingPercent),
		};
	});
}

function normalizePercent(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.max(0, Math.min(100, value));
}

function toneForPercent(percent: number | undefined): TerminalProgressTone {
	if (percent === undefined) return "neutral";
	if (percent >= 80) return "red";
	if (percent >= 50) return "yellow";
	return "green";
}

function toneForRemainingPercent(percent: number | undefined): TerminalProgressTone {
	if (percent === undefined) return "neutral";
	if (percent <= 20) return "red";
	if (percent <= 50) return "yellow";
	return "green";
}

function sanitizeTextList(values: readonly string[] | undefined): string[] {
	return (values ?? []).map((value) => redactTerminalSecret(value)).filter((value) => value.length > 0);
}
