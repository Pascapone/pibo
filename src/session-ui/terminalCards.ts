import type { CompactTerminalRow, CompactTerminalRowKind, CompactTerminalRowStatus } from "./terminalRows.js";
import { buildTerminalStatusViewModel, redactTerminalSecret, type BuildTerminalStatusInput, type TerminalStatusViewModel } from "./statusViewModel.js";

export type TerminalCardKind =
	| "status"
	| "thinking"
	| "model"
	| "login"
	| "tool"
	| "yielded-run"
	| "compaction"
	| "error"
	| "command";

export type TerminalCardTone = "neutral" | "cyan" | "green" | "yellow" | "red" | "magenta" | "blue";

export type TerminalCardAction = {
	id: string;
	label: string;
	action?: string;
	value?: string;
	disabled?: boolean;
	description?: string;
};

export type TerminalCardDescriptor = {
	id: string;
	kind: TerminalCardKind;
	title: string;
	status: CompactTerminalRowStatus;
	tone: TerminalCardTone;
	rows: readonly { label?: string; value: string; tone?: TerminalCardTone }[];
	actions?: readonly TerminalCardAction[];
	statusView?: TerminalStatusViewModel;
	sourceRowKind?: CompactTerminalRowKind;
};

export function buildTerminalCardDescriptor(row: CompactTerminalRow): TerminalCardDescriptor | undefined {
	switch (row.kind) {
		case "tool.status":
			return buildStatusCard(row);
		case "tool.thinking":
			return buildThinkingCard(row);
		case "tool.model":
			return buildModelCard(row);
		case "tool.login":
			return buildLoginCard(row);
		case "tool.call":
		case "tool.image":
		case "tool.group.exploring":
		case "tool.group.images":
			return buildToolCard(row);
		case "yielded.run":
			return baseCard(row, "yielded-run", "Yielded run", row.status === "error" ? "red" : row.status === "running" ? "cyan" : "green");
		case "execution.compaction":
			return baseCard(row, "compaction", row.status === "error" ? "Compaction failed" : row.status === "running" ? "Compacting" : "Compaction", row.status === "error" ? "red" : "magenta");
		case "execution.command":
			return baseCard(row, "command", "Command", row.status === "error" ? "red" : "yellow");
		case "error":
			return baseCard(row, "error", "Error", "red");
		default:
			return undefined;
	}
}

export function buildTerminalCardDescriptors(rows: readonly CompactTerminalRow[]): TerminalCardDescriptor[] {
	return rows.map(buildTerminalCardDescriptor).filter((descriptor): descriptor is TerminalCardDescriptor => Boolean(descriptor));
}

function buildStatusCard(row: CompactTerminalRow): TerminalCardDescriptor {
	const data = parseRecord(row.output);
	const model = recordField(data, "activeModel") ?? recordField(data, "model");
	const statusView = buildTerminalStatusViewModel({
		owner: { label: stringField(data, "activeOwnerLabel") ?? stringField(data, "ownerLabel"), scope: stringField(data, "activeOwnerScope") ?? stringField(data, "ownerScope") },
		session: {
			id: stringField(data, "piboSessionId") ?? stringField(data, "sessionId"),
			title: stringField(data, "sessionTitle") ?? stringField(data, "title"),
			profile: stringField(data, "profile") ?? stringField(data, "activeAgentId") ?? stringField(data, "agentId"),
			status: boolField(data, "disposed") ? "disposed" : stringField(data, "sessionStatus"),
		},
		model: model ? { provider: stringField(model, "provider"), id: stringField(model, "id"), label: stringField(model, "label") } : undefined,
		runtime: {
			state: boolField(data, "disposed") ? "disposed" : boolField(data, "processing") ? "processing" : boolField(data, "streaming") ? "streaming" : stringField(data, "mode") ?? "idle",
			connected: boolField(data, "connected"),
			queuedMessages: numberField(data, "queuedMessages"),
			processing: boolField(data, "processing"),
			streaming: boolField(data, "streaming"),
			disposed: boolField(data, "disposed"),
		},
		cwd: stringField(data, "cwd"),
		contextUsage: recordField(data, "contextUsage") as { tokens?: number; contextWindow?: number; percent?: number } | undefined,
		providerUsage: recordField(data, "providerUsage") as BuildTerminalStatusInput["providerUsage"],
		tools: { enabled: arrayStringField(data, "enabledTools"), active: arrayStringField(data, "activeTools") },
		thinking: stringField(data, "thinkingLevel") ? { level: stringField(data, "thinkingLevel") } : undefined,
		fastMode: boolField(data, "fastMode"),
		warnings: arrayStringField(data, "warnings"),
		errors: arrayStringField(data, "errors"),
		message: stringField(data, "message"),
	});
	return {
		id: row.id,
		kind: "status",
		title: "Status",
		status: row.status,
		tone: row.status === "error" ? "red" : "green",
		rows: statusView.fields.map((field) => ({ label: field.label, value: field.value, tone: field.tone })),
		statusView,
		sourceRowKind: row.kind,
	};
}

function buildThinkingCard(row: CompactTerminalRow): TerminalCardDescriptor {
	const data = parseRecord(row.output);
	const level = stringField(data, "level") ?? "unknown";
	const supported = data?.supported === false ? false : true;
	const levels = arrayStringField(data, "availableLevels");
	return {
		id: row.id,
		kind: "thinking",
		title: "Thinking",
		status: row.status,
		tone: supported ? "yellow" : "red",
		rows: [{ label: "Current", value: redactTerminalSecret(level) }, { label: "Supported", value: supported ? "yes" : "no", tone: supported ? "green" : "red" }],
		actions: levels.map((availableLevel) => ({ id: `thinking:${availableLevel}`, label: availableLevel, action: "thinking.set", value: availableLevel, disabled: !supported })),
		sourceRowKind: row.kind,
	};
}

function buildModelCard(row: CompactTerminalRow): TerminalCardDescriptor {
	const data = parseRecord(row.output);
	const providers = arrayRecordField(data, "providers");
	const actions = providers.flatMap((provider) => {
		const providerId = stringField(provider, "id") ?? stringField(provider, "provider") ?? "provider";
		const providerLabel = stringField(provider, "label") ?? stringField(provider, "name") ?? providerId;
		return arrayRecordField(provider, "models").map((model) => {
			const modelId = stringField(model, "id") ?? "model";
			const label = stringField(model, "label") ?? modelId;
			return { id: `model:${providerId}:${modelId}`, label: `${providerLabel} / ${label}`, action: "model.select", value: `${providerId}/${modelId}` };
		});
	});
	return {
		id: row.id,
		kind: "model",
		title: "Model",
		status: row.status,
		tone: actions.length ? "cyan" : "neutral",
		rows: [{ label: "Providers", value: String(providers.length) }, { label: "Models", value: String(actions.length) }],
		actions,
		sourceRowKind: row.kind,
	};
}

function buildLoginCard(row: CompactTerminalRow): TerminalCardDescriptor {
	const data = parseRecord(row.output);
	const providers = arrayRecordField(data, "providers");
	const actions = providers.map((provider) => {
		const providerId = stringField(provider, "id") ?? "provider";
		return {
			id: `login:${providerId}`,
			label: stringField(provider, "name") ?? stringField(provider, "label") ?? providerId,
			action: "login.selectProvider",
			value: providerId,
			description: arrayStringField(provider, "authMethods").join(", "),
		};
	});
	return {
		id: row.id,
		kind: "login",
		title: "Login",
		status: row.status,
		tone: actions.length ? "cyan" : "neutral",
		rows: [{ label: "Providers", value: String(providers.length) }],
		actions,
		sourceRowKind: row.kind,
	};
}

function buildToolCard(row: CompactTerminalRow): TerminalCardDescriptor {
	const title = row.kind === "tool.group.exploring"
		? "Exploring"
		: row.kind === "tool.image" || row.kind === "tool.group.images"
			? "Image"
			: "Tool";
	return baseCard(row, "tool", title, row.status === "error" ? "red" : row.status === "running" ? "cyan" : "green");
}

function baseCard(row: CompactTerminalRow, kind: TerminalCardKind, title: string, tone: TerminalCardTone): TerminalCardDescriptor {
	const rows = row.lines.flatMap((line) => {
		const tokenText = line.tokens.map((token) => token.text).join("");
		const functionText = line.functionCall ? `${line.functionCall.name}${line.functionCall.input !== undefined ? ` ${safeInlineJson(line.functionCall.input)}` : ""}` : "";
		const text = `${tokenText}${functionText}`.trim();
		return text ? [{ value: redactTerminalSecret(text) }] : [];
	});
	const output = row.lines.length === 0 && typeof row.output === "string" && row.output.trim()
		? [{ value: redactTerminalSecret(row.output.trim()) }]
		: [];
	const extraRows = [row.error ? { label: "Error", value: redactTerminalSecret(row.error), tone: "red" as const } : undefined]
		.filter((item): item is { label: string; value: string; tone: "red" } => Boolean(item));
	return {
		id: row.id,
		kind,
		title,
		status: row.status,
		tone,
		rows: [...rows, ...output, ...extraRows],
		sourceRowKind: row.kind,
	};
}

function safeInlineJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value) return undefined;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
		} catch {
			return undefined;
		}
	}
	return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function recordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
	const value = record?.[key];
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayRecordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown>[] {
	const value = record?.[key];
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function arrayStringField(record: Record<string, unknown> | undefined, key: string): string[] {
	const value = record?.[key];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boolField(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
	const value = record?.[key];
	return typeof value === "boolean" ? value : undefined;
}
