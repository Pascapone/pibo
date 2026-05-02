export type TerminalRenderableValue =
	| { kind: "empty" }
	| { kind: "text"; text: string }
	| { kind: "json"; value: unknown };

export function renderableTerminalValue(value: unknown): TerminalRenderableValue {
	if (value === undefined || value === null) return { kind: "empty" };
	const text = terminalTextValue(value);
	if (text !== undefined) return { kind: "text", text };
	return { kind: "json", value };
}

export function terminalTextValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const parts = value.map(terminalTextValue).filter((part): part is string => part !== undefined);
		return parts.length === value.length && parts.length > 0 ? parts.join("") : undefined;
	}
	if (!isRecord(value)) return undefined;

	const type = typeof value.type === "string" ? value.type : undefined;
	if (type === "text" && typeof value.text === "string") return value.text;
	if (type === "text" && typeof value.content === "string") return value.content;
	if (type === "output_text" && typeof value.text === "string") return value.text;

	const content = terminalTextValue(value.content);
	if (content !== undefined && isTextContentWrapper(value)) return content;

	const messageContent = isRecord(value.message) ? terminalTextValue(value.message.content) : undefined;
	if (messageContent !== undefined) return messageContent;

	return undefined;
}

function isTextContentWrapper(value: Record<string, unknown>): boolean {
	const keys = Object.keys(value).filter((key) => value[key] !== undefined);
	if (keys.length === 1 && keys[0] === "content") return true;
	if (keys.every((key) => key === "content" || key === "type")) return true;
	if (keys.every((key) => key === "content" || key === "details" || key === "type")) return true;
	return typeof value.type === "string" && value.type.includes("text");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
