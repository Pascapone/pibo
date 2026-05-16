import type { CompactTerminalRowKind, CompactTerminalRowStatus, TerminalInlineToken } from "../../session-ui/index.js";

export type InkTerminalColor =
	| "blue"
	| "cyan"
	| "gray"
	| "green"
	| "magenta"
	| "red"
	| "white"
	| "yellow";

export function colorForTone(tone: TerminalInlineToken["tone"]): InkTerminalColor | undefined {
	switch (tone) {
		case "blue":
			return "blue";
		case "cyan":
			return "cyan";
		case "green":
			return "green";
		case "magenta":
			return "magenta";
		case "red":
			return "red";
		case "yellow":
		case "amber":
			return "yellow";
		case "dim":
			return "gray";
		case "default":
		default:
			return undefined;
	}
}

export function colorForStatus(status: CompactTerminalRowStatus): InkTerminalColor | undefined {
	switch (status) {
		case "done":
			return "green";
		case "running":
			return "yellow";
		case "error":
			return "red";
		case "neutral":
		default:
			return "gray";
	}
}

export function colorForRowKind(kind: CompactTerminalRowKind): InkTerminalColor | undefined {
	if (kind === "message.user") return "cyan";
	if (kind === "message.assistant") return undefined;
	if (kind === "error") return "red";
	if (kind === "yielded.run") return "magenta";
	if (kind.startsWith("tool.")) return "yellow";
	if (kind.startsWith("agent.")) return "magenta";
	if (kind.startsWith("execution.")) return "blue";
	if (kind === "reasoning") return "yellow";
	return "gray";
}

export function markerForStatus(status: CompactTerminalRowStatus): string {
	switch (status) {
		case "done":
			return "✓";
		case "running":
			return "…";
		case "error":
			return "✕";
		case "neutral":
		default:
			return "•";
	}
}
