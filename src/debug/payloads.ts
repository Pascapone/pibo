export type DebugEventRow = {
	stream_id: number;
	session_id?: string | null;
	session_sequence?: number | null;
	event_id: string | null;
	type: string;
	created_at: string;
	preview_text: string | null;
	attributes_json: string | null;
};

export type DebugPayloadRef = {
	store: "chat" | "sessions" | "pibo-data" | "reliability";
	table: string;
	rowSelector: Record<string, string | number>;
	path?: string;
	kind: "message" | "event" | "toolArgs" | "toolOutput" | "telemetry" | "raw";
	byteLength?: number;
};

export type DebugResolvedMessageContent = {
	content: string;
	source: DebugPayloadRef;
	previewOnly: boolean;
};

export function parseObject(value: string | null | undefined): Record<string, unknown> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function eventAttributes(row: DebugEventRow): Record<string, unknown> {
	return parseObject(row.attributes_json);
}

export function eventPayload(row: DebugEventRow): Record<string, unknown> {
	const attributes = eventAttributes(row);
	const inlinePayload = attributes.inlinePayload;
	if (inlinePayload && typeof inlinePayload === "object" && !Array.isArray(inlinePayload)) return inlinePayload as Record<string, unknown>;
	return { ...attributes, previewText: row.preview_text };
}

export function getPath(value: unknown, path: string): unknown {
	let current = value;
	for (const part of path.split(".").filter(Boolean)) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

export function resolveEventField(row: DebugEventRow, path: string): { value: unknown; source: "raw" | "payload" } {
	const raw = rawEventObject(row);
	if (path.startsWith("attributes_json.")) return { value: getPath(raw, path), source: "raw" };
	if (path in raw) return { value: getPath(raw, path), source: "raw" };
	const attributes = eventAttributes(row);
	if (path in attributes) return { value: getPath(attributes, path), source: "raw" };
	const payload = eventPayload(row);
	return { value: getPath(payload, path), source: "payload" };
}

export function rawEventObject(row: DebugEventRow): Record<string, unknown> {
	return {
		...row,
		attributes_json: eventAttributes(row),
	};
}

export function messageRole(row: DebugEventRow): string | undefined {
	if (row.type === "assistant_message" || row.type === "assistant_delta") return "assistant";
	if (row.type === "user_message") return "user";
	const payload = eventPayload(row);
	const source = payload.source;
	if (typeof source === "string" && ["user", "assistant", "system"].includes(source)) return source;
	const role = payload.role;
	if (typeof role === "string") return role;
	if (row.type === "message_started" && typeof source === "string") return source;
	return undefined;
}

export function resolveMessageContent(row: DebugEventRow): DebugResolvedMessageContent | undefined {
	const attributes = eventAttributes(row);
	const inlinePayload = attributes.inlinePayload;
	if (typeof inlinePayload === "string") {
		return {
			content: inlinePayload,
			previewOnly: false,
			source: sourceRef(row, "attributes_json.inlinePayload", "message"),
		};
	}
	if (inlinePayload && typeof inlinePayload === "object" && !Array.isArray(inlinePayload)) {
		const object = inlinePayload as Record<string, unknown>;
		if (typeof object.content === "string") return { content: object.content, previewOnly: false, source: sourceRef(row, "attributes_json.inlinePayload.content", "message") };
		if (typeof object.text === "string") return { content: object.text, previewOnly: false, source: sourceRef(row, "attributes_json.inlinePayload.text", "message") };
		if (typeof object.message === "string") return { content: object.message, previewOnly: false, source: sourceRef(row, "attributes_json.inlinePayload.message", "message") };
	}
	if (typeof attributes.inlineText === "string") {
		return {
			content: attributes.inlineText,
			previewOnly: false,
			source: sourceRef(row, "attributes_json.inlineText", "message"),
		};
	}
	if (row.preview_text) {
		return {
			content: row.preview_text,
			previewOnly: true,
			source: sourceRef(row, "preview_text", "message"),
		};
	}
	return undefined;
}

export function sourceRef(row: DebugEventRow, path: string | undefined, kind: DebugPayloadRef["kind"]): DebugPayloadRef {
	return {
		store: "chat",
		table: "event_log",
		rowSelector: { stream_id: row.stream_id },
		path,
		kind,
	};
}

export function stringifyPayloadValue(value: unknown): string {
	if (value === undefined) return "";
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

export function compactOneLine(value: unknown): string {
	if (value === null || value === undefined) return "";
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.replaceAll("\n", "\\n");
}
