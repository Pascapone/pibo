import { redactTerminalSecret } from "./statusViewModel.js";

export type CommandResultDescriptor =
	| { kind: "text"; title?: string; text: string; tone?: "neutral" | "green" | "yellow" | "red" | "cyan" }
	| { kind: "json"; title?: string; value: unknown }
	| { kind: "menu"; title: string; items: readonly CommandResultMenuItem[] }
	| { kind: "status"; title: string; status: unknown }
	| { kind: "session-link"; title: string; sessionId: string; roomId?: string; label?: string }
	| { kind: "unsupported"; command: string; reason: string }
	| { kind: "error"; title?: string; message: string };

export type CommandResultMenuItem = {
	id: string;
	label: string;
	description?: string;
	action?: string;
	value?: unknown;
	disabled?: boolean;
};

export function normalizeCommandResultDescriptor(command: string, value: unknown): CommandResultDescriptor {
	const unwrapped = unwrapActionPayload(value);
	if (unwrapped instanceof Error) return { kind: "error", title: command, message: redactTerminalSecret(unwrapped.message) };
	if (typeof unwrapped === "string") return { kind: "text", title: command, text: redactTerminalSecret(unwrapped) };
	if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) return { kind: "json", title: command, value: unwrapped };
	const record = unwrapped as Record<string, unknown>;
	if (typeof record.error === "string") return { kind: "error", title: command, message: redactTerminalSecret(record.error) };
	if (record.supported === false || typeof record.unsupportedReason === "string") {
		return { kind: "unsupported", command, reason: redactTerminalSecret(typeof record.unsupportedReason === "string" ? record.unsupportedReason : "This command is not supported in the terminal.") };
	}
	if (command === "status" || record.contextUsage || record.providerUsage || record.queuedMessages !== undefined) {
		return { kind: "status", title: "Status", status: record };
	}
	if (typeof record.piboSessionId === "string" || typeof record.sessionId === "string") {
		return {
			kind: "session-link",
			title: command,
			sessionId: String(record.piboSessionId ?? record.sessionId),
			roomId: typeof record.roomId === "string" ? record.roomId : undefined,
			label: typeof record.title === "string" ? redactTerminalSecret(record.title) : undefined,
		};
	}
	if (record.action === "show_login_menu" || record.action === "show_model_menu" || record.action === "show_fork_candidates" || Array.isArray(record.items) || Array.isArray(record.providers) || Array.isArray(record.messages)) {
		return { kind: "menu", title: menuTitle(command, record), items: menuItems(record) };
	}
	if (typeof record.message === "string") return { kind: "text", title: command, text: redactTerminalSecret(record.message), tone: record.ok === false ? "red" : "green" };
	return { kind: "json", title: command, value: record };
}

export function normalizeCommandErrorDescriptor(command: string, error: unknown): CommandResultDescriptor {
	const message = error instanceof Error ? error.message : String(error);
	return { kind: "error", title: command, message: redactTerminalSecret(message) };
}

function unwrapActionPayload(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const record = value as Record<string, unknown>;
	if (record.ok === true && "result" in record) return record.result;
	if (record.success === true && "data" in record) return record.data;
	return value;
}

function menuTitle(command: string, record: Record<string, unknown>): string {
	if (record.action === "show_login_menu") return "Login";
	if (record.action === "show_model_menu") return "Model";
	if (record.action === "show_fork_candidates") return "Fork candidates";
	return command;
}

function menuItems(record: Record<string, unknown>): CommandResultMenuItem[] {
	const explicitItems = arrayRecordField(record, "items");
	if (explicitItems.length) return explicitItems.map((item, index) => itemFromRecord(item, index));
	const providers = arrayRecordField(record, "providers");
	if (providers.length) return providers.map((provider, index) => itemFromRecord(provider, index));
	const messages = arrayRecordField(record, "messages");
	return messages.map((message, index) => itemFromRecord(message, index));
}

function itemFromRecord(record: Record<string, unknown>, index: number): CommandResultMenuItem {
	const id = stringField(record, "id") ?? stringField(record, "entryId") ?? stringField(record, "provider") ?? `item-${index}`;
	const text = stringField(record, "text");
	return {
		id,
		label: redactTerminalSecret(stringField(record, "label") ?? stringField(record, "name") ?? trimLabel(text) ?? id),
		description: redactTerminalSecret(stringField(record, "description") ?? (text && text.length > 80 ? text : undefined) ?? stringField(record, "reason") ?? arrayStringField(record, "authMethods").join(", ")) || undefined,
		action: stringField(record, "action"),
		value: record.value ?? record,
		disabled: record.disabled === true,
	};
}

function arrayRecordField(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = record[key];
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function arrayStringField(record: Record<string, unknown>, key: string): string[] {
	const value = record[key];
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function trimLabel(value: string | undefined): string | undefined {
	return value;
}
