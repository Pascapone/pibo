export type InkJsonOptions = {
	maxChars?: number;
	maxDepth?: number;
	maxArrayItems?: number;
	maxObjectKeys?: number;
};

const DEFAULT_MAX_CHARS = 1600;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ARRAY_ITEMS = 20;
const DEFAULT_MAX_OBJECT_KEYS = 40;

export function formatInkJson(value: unknown, options: InkJsonOptions = {}): string {
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const prepared = prepareJsonValue(value, {
		maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
		maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
		maxObjectKeys: options.maxObjectKeys ?? DEFAULT_MAX_OBJECT_KEYS,
		seen: new WeakSet<object>(),
		depth: 0,
	});
	const text = JSON.stringify(prepared, null, 2) ?? String(prepared);
	return truncateTerminalText(text, maxChars);
}

export function formatInlineJson(value: unknown, maxChars = 180): string {
	const text = JSON.stringify(prepareJsonValue(value, {
		maxDepth: 2,
		maxArrayItems: 8,
		maxObjectKeys: 12,
		seen: new WeakSet<object>(),
		depth: 0,
	})) ?? String(value);
	return truncateTerminalText(text, maxChars).replace(/\s+/g, " ");
}

export function truncateTerminalText(text: string, maxChars: number): string {
	const safeText = sanitizeTerminalText(text);
	if (safeText.length <= maxChars) return safeText;
	return `${safeText.slice(0, Math.max(0, maxChars - 12)).trimEnd()}\n… truncated`;
}

export function sanitizeTerminalText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

type PrepareOptions = Required<Omit<InkJsonOptions, "maxChars">> & {
	seen: WeakSet<object>;
	depth: number;
};

function prepareJsonValue(value: unknown, options: PrepareOptions): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return truncateTerminalText(value, 600);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "bigint") return `${value.toString()}n`;
	if (typeof value === "symbol") return value.description ? `Symbol(${value.description})` : "Symbol";
	if (typeof value === "function") return "[Function]";
	if (options.depth >= options.maxDepth) return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
	if (typeof value !== "object") return String(value);
	if (options.seen.has(value)) return "[Circular]";
	options.seen.add(value);
	try {
		if (Array.isArray(value)) {
			const items = value.slice(0, options.maxArrayItems).map((item) => prepareJsonValue(item, { ...options, depth: options.depth + 1 }));
			if (value.length > options.maxArrayItems) items.push(`… ${value.length - options.maxArrayItems} more items`);
			return items;
		}
		const entries = Object.entries(value as Record<string, unknown>);
		const result: Record<string, unknown> = {};
		for (const [key, item] of entries.slice(0, options.maxObjectKeys)) {
			result[key] = prepareJsonValue(item, { ...options, depth: options.depth + 1 });
		}
		if (entries.length > options.maxObjectKeys) result["…"] = `${entries.length - options.maxObjectKeys} more keys`;
		return result;
	} finally {
		options.seen.delete(value);
	}
}
