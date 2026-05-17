import { compareTraceNodes } from "../shared/trace-engine.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../shared/trace-types.js";
import { terminalTextValue } from "./terminalValue.js";

export type CompactTerminalRowStatus = "running" | "done" | "error" | "neutral";

export type CompactTerminalRowKind =
	| "message.user"
	| "message.assistant"
	| "reasoning"
	| "tool.call"
	| "tool.status"
	| "tool.thinking"
	| "tool.login"
	| "tool.model"
	| "tool.group.exploring"
	| "agent.delegation"
	| "agent.async"
	| "yielded.run"
	| "execution.command"
	| "execution.compaction"
	| "error";

export type TerminalInlineToken = {
	text: string;
	tone?: "default" | "dim" | "cyan" | "green" | "red" | "magenta" | "yellow" | "blue" | "amber";
	weight?: "normal" | "semibold" | "bold";
	italic?: boolean;
};

export type CompactTerminalLine = {
	prefix?: "bullet" | "detail" | "continuation" | "prompt" | "none";
	tokens: TerminalInlineToken[];
	functionCall?: {
		name: string;
		input?: unknown;
	};
};

export type CompactTerminalDetailItem = {
	id: string;
	label: string;
	status: CompactTerminalRowStatus;
	input?: unknown;
	output?: unknown;
	error?: string;
	linkedPiboSessionId?: string;
};

export type CompactTerminalRow = {
	id: string;
	kind: CompactTerminalRowKind;
	status: CompactTerminalRowStatus;
	errorKind?: "tool" | "system";
	lines: CompactTerminalLine[];
	sourceNodeIds: string[];
	eventId?: string;
	runId?: string;
	orderSource?: string;
	orderStreamId?: number;
	orderStreamFrameIndex?: number;
	linkedPiboSessionId?: string;
	forkEntryId?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	markdown?: string;
	expandable?: boolean;
	detailItems?: readonly CompactTerminalDetailItem[];
};

export type BuildTerminalRowsOptions = {
	showThinking: boolean;
};

type FlatTraceNode = {
	node: PiboTraceNode;
	turnId?: string;
};

type RowCandidate = {
	row: CompactTerminalRow;
	turnId?: string;
	exploring?: CompactTerminalDetailItem;
};

const TOOL_OUTPUT_PREVIEW_LINES = 5;

export function buildCompactTerminalRows(
	traceView: PiboSessionTraceView | null,
	options: BuildTerminalRowsOptions,
): CompactTerminalRow[] {
	if (!traceView) return [];
	const flatNodes = flattenTraceNodes(traceView.nodes)
		.sort((left, right) => compareTraceNodes(left.node, right.node))
		.filter((item) => item.node.type !== "agent.turn" && (options.showThinking || item.node.type !== "model.reasoning"));
	const candidates = flatNodes.map((item) => createRowCandidate(item.node, item.turnId));
	return groupExploringCandidates(candidates).map((candidate) => candidate.row);
}

function flattenTraceNodes(nodes: readonly PiboTraceNode[], turnId?: string): FlatTraceNode[] {
	const result: FlatTraceNode[] = [];
	for (const node of nodes) {
		if (node.type !== "agent.turn") result.push({ node, turnId });
		result.push(...flattenTraceNodes(node.children, node.type === "agent.turn" ? node.id : turnId));
	}
	return result;
}

function createRowCandidate(node: PiboTraceNode, turnId?: string): RowCandidate {
	let candidate: RowCandidate;
	switch (node.type) {
		case "user.message":
			candidate = { row: createUserMessageRow(node), turnId };
			break;
		case "assistant.message":
			candidate = { row: createAssistantMessageRow(node), turnId };
			break;
		case "model.reasoning":
			candidate = { row: createReasoningRow(node), turnId };
			break;
		case "tool.call":
			candidate = createToolRowCandidate(node, turnId);
			break;
		case "tool.result":
			candidate = { row: createToolResultRow(node), turnId };
			break;
		case "agent.delegation":
			candidate = { row: createDelegationRow(node), turnId };
			break;
		case "agent.async":
			candidate = { row: createAsyncAgentRow(node), turnId };
			break;
		case "yielded.run":
			candidate = { row: createYieldedRunRow(node), turnId };
			break;
		case "execution.command":
			candidate = { row: createExecutionCommandRow(node), turnId };
			break;
		case "execution.compaction":
			candidate = { row: createCompactionRow(node), turnId };
			break;
		case "error":
			candidate = { row: createErrorRow(node), turnId };
			break;
		case "agent.turn":
			candidate = {
				row: {
					id: node.id,
					kind: "error",
					status: "neutral",
					lines: [],
					sourceNodeIds: [node.id],
				},
				turnId,
			};
			break;
	}
	return { ...candidate, row: { ...candidate.row, ...debugFields(node) } };
}

function debugFields(node: PiboTraceNode): Pick<
	CompactTerminalRow,
	"eventId" | "runId" | "orderSource" | "orderStreamId" | "orderStreamFrameIndex"
> {
	return {
		eventId: node.eventId,
		runId: node.runId,
		orderSource: node.source,
		orderStreamId: node.orderKey?.streamId,
		orderStreamFrameIndex: node.orderKey?.streamFrameIndex,
	};
}

function createUserMessageRow(node: PiboTraceNode): CompactTerminalRow {
	const text = stringValue(node.output) || stringValue(node.summary) || node.title;
	return {
		id: node.id,
		kind: "message.user",
		status: mapStatus(node.status),
		lines: [{ prefix: "prompt", tokens: [token(text)] }],
		sourceNodeIds: [node.id],
		forkEntryId: node.entryId,
		output: text,
	};
}

function createAssistantMessageRow(node: PiboTraceNode): CompactTerminalRow {
	return {
		id: node.id,
		kind: "message.assistant",
		status: mapStatus(node.status),
		lines: [],
		sourceNodeIds: [node.id],
		output: stringValue(node.output) || stringValue(node.summary) || "",
		error: node.error,
	};
}

function createReasoningRow(node: PiboTraceNode): CompactTerminalRow {
	const text = previewText(node.output ?? node.summary);
	return {
		id: node.id,
		kind: "reasoning",
		status: mapStatus(node.status),
		lines: [
			{
				prefix: "bullet",
				tokens: [token(node.status === "running" ? "Thinking" : "Thought", "amber", "semibold")],
			},
		],
		sourceNodeIds: [node.id],
		markdown: text,
	};
}

function createToolRowCandidate(node: PiboTraceNode, turnId?: string): RowCandidate {
	const command = shellCommandValue(node.input);
	if (command && isShellToolName(node.title)) {
		const row = createCommandToolRow(node, command);
		return { row, turnId, exploring: undefined };
	}
	const preview = previewLines(node.error ?? node.output, TOOL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim");
	const row: CompactTerminalRow = {
		id: node.id,
		kind: "tool.call",
		status: mapStatus(node.status),
		errorKind: node.status === "error" ? "tool" : undefined,
		lines: [
			{
				prefix: "bullet",
				tokens: [
					token(toolVerb(node.status), toneForStatus(node.status), "semibold"),
					token(" "),
				],
				functionCall: { name: node.title, input: node.input },
			},
			...preview.lines,
		],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: node.input !== undefined || node.output !== undefined || Boolean(node.error),
	};
	const exploring = classifyExploringTool(node);
	return { row, turnId, exploring };
}

function createToolResultRow(node: PiboTraceNode): CompactTerminalRow {
	const preview = previewLines(node.error ?? node.output, TOOL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim");
	return {
		id: node.id,
		kind: "tool.call",
		status: mapStatus(node.status),
		errorKind: node.status === "error" ? "tool" : undefined,
		lines: [
			{
				prefix: "bullet",
				tokens: [token(node.status === "error" ? "Tool failed" : "Returned", toneForStatus(node.status), "semibold"), token(` ${node.title}`)],
			},
			...preview.lines,
		],
		sourceNodeIds: [node.id],
		output: node.output,
		error: node.error,
		expandable: node.output !== undefined || Boolean(node.error),
	};
}

function createDelegationRow(node: PiboTraceNode): CompactTerminalRow {
	const subagentName = stringValue(isRecord(node.input) ? node.input.subagentName : undefined) || node.summary || node.title;
	const delegatedArguments = isRecord(node.input) ? node.input.arguments : undefined;
	const previewText = compactInlinePreview(delegatedArguments ?? node.input);
	const detailLines = previewText
		? [{ prefix: "detail" as const, tokens: [token(previewText, "dim")] }]
		: [];
	return {
		id: node.id,
		kind: "agent.delegation",
		status: mapStatus(node.status),
		lines: [
			{
				prefix: "bullet",
				tokens: [token(delegationVerb(node.status), toneForStatus(node.status), "semibold"), token(` ${subagentName}`, "cyan")],
			},
			...detailLines,
		],
		sourceNodeIds: [node.id],
		linkedPiboSessionId: node.linkedPiboSessionId,
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: node.input !== undefined || node.output !== undefined || Boolean(node.error),
	};
}

function createAsyncAgentRow(node: PiboTraceNode): CompactTerminalRow {
	const preview = previewLines(node.error ?? node.output, TOOL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim");
	return {
		id: node.id,
		kind: "agent.async",
		status: mapStatus(node.status),
		lines: [
			{
				prefix: "bullet",
				tokens: [token(asyncVerb(node.status), toneForStatus(node.status), "semibold"), token(` ${node.title}`, "cyan")],
			},
			...preview.lines,
		],
		sourceNodeIds: [node.id],
		linkedPiboSessionId: node.linkedPiboSessionId,
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: node.input !== undefined || node.output !== undefined || Boolean(node.error),
	};
}

function createYieldedRunRow(node: PiboTraceNode): CompactTerminalRow {
	const preview = previewLines(node.output, TOOL_OUTPUT_PREVIEW_LINES);
	return {
		id: node.id,
		kind: "yielded.run",
		status: mapStatus(node.status),
		errorKind: node.status === "error" ? "tool" : undefined,
		lines: [
			{
				prefix: "bullet",
				tokens: [
					token(node.status === "running" ? "Waiting on runs" : "Run update", toneForStatus(node.status), "semibold"),
					token(node.summary ? ` ${node.summary}` : ""),
				],
			},
			...preview.lines,
		],
		sourceNodeIds: [node.id],
		output: node.output,
		error: node.error,
		expandable: node.output !== undefined || Boolean(node.error),
	};
}

function createCompactionRow(node: PiboTraceNode): CompactTerminalRow {
	const label = node.status === "running"
		? "Compacting"
		: node.status === "error"
			? "Compaction failed"
			: stringValue(node.summary) || "Compacted";
	return {
		id: node.id,
		kind: "execution.compaction",
		status: mapStatus(node.status),
		lines: [
			{
				prefix: "bullet",
				tokens: [token(label, toneForStatus(node.status), node.status === "error" ? "bold" : "semibold")],
			},
		],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: node.input !== undefined || node.output !== undefined || Boolean(node.error),
	};
}

function createExecutionCommandRow(node: PiboTraceNode): CompactTerminalRow {
	if (node.title === "status") {
		return createStatusToolRow(node);
	}
	if (node.title === "thinking") {
		return createThinkingToolRow(node);
	}
	if (node.title === "fast_mode") {
		return createFastModeToolRow(node);
	}
	if (node.title === "login" && isLoginMenuOutput(node.output)) {
		return createLoginToolRow(node);
	}
	if (node.title === "model" && isModelMenuOutput(node.output)) {
		return createModelToolRow(node);
	}
	const command = shellCommandValue(node.output) ?? shellCommandValue(node.input) ?? node.title;
	const preview = previewLines(node.error ?? node.output, TOOL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim", 180);
	return {
		id: node.id,
		kind: "execution.command",
		status: mapStatus(node.status),
		lines: [
			{
				prefix: "bullet",
				tokens: [token("Command", "yellow", "semibold"), token(` /${node.title}`, "yellow")],
			},
			...preview.lines,
		],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: node.input !== undefined || node.output !== undefined || Boolean(node.error),
	};
}

function createStatusToolRow(node: PiboTraceNode): CompactTerminalRow {
	return {
		id: node.id,
		kind: "tool.status",
		status: mapStatus(node.status),
		lines: [],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: false,
	};
}

function createThinkingToolRow(node: PiboTraceNode): CompactTerminalRow {
	return {
		id: node.id,
		kind: "tool.thinking",
		status: mapStatus(node.status),
		lines: [],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: false,
	};
}

function createFastModeToolRow(node: PiboTraceNode): CompactTerminalRow {
	const result = isRecord(node.output) ? node.output : undefined;
	const mode = result?.mode === "fast" ? "fast" : result?.mode === "normal" ? "normal" : undefined;
	const changed = result?.changed !== false;
	const supported = result?.supported !== false;
	const label = !supported
		? "Fast mode is not supported by this model."
		: mode === "fast"
			? changed ? "Switched to Fast mode." : "Fast mode is already on."
			: mode === "normal"
				? changed ? "Switched to Normal mode." : "Normal mode is already on."
				: "Fast mode updated.";

	return {
		id: node.id,
		kind: "execution.command",
		status: mapStatus(node.status),
		lines: [
			{
				prefix: "bullet",
				tokens: [token(label, supported ? "green" : "dim", "semibold")],
			},
		],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: false,
	};
}

function createLoginToolRow(node: PiboTraceNode): CompactTerminalRow {
	return {
		id: node.id,
		kind: "tool.login",
		status: mapStatus(node.status),
		lines: [],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: false,
	};
}

function createModelToolRow(node: PiboTraceNode): CompactTerminalRow {
	return {
		id: node.id,
		kind: "tool.model",
		status: mapStatus(node.status),
		lines: [],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: false,
	};
}

function isLoginMenuOutput(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.action === "show_login_menu" && Array.isArray(record.providers);
}

function isModelMenuOutput(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.action === "show_model_menu" && Array.isArray(record.providers);
}

function createCommandToolRow(node: PiboTraceNode, command: string): CompactTerminalRow {
	const preview = previewLines(node.error ?? node.output, TOOL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim", 180);
	return {
		id: node.id,
		kind: "execution.command",
		status: mapStatus(node.status),
		errorKind: node.status === "error" ? "tool" : undefined,
		lines: [
			{
				prefix: "bullet",
				tokens: [token(node.status === "running" ? "Running" : "Ran", toneForStatus(node.status), "semibold"), token(" "), ...bashTokens(command)],
			},
			...preview.lines,
		],
		sourceNodeIds: [node.id],
		input: node.input,
		output: node.output,
		error: node.error,
		expandable: node.input !== undefined || node.output !== undefined || Boolean(node.error),
	};
}

function createErrorRow(node: PiboTraceNode): CompactTerminalRow {
	return {
		id: node.id,
		kind: "error",
		status: "error",
		errorKind: "system",
		lines: [
			{
				prefix: "bullet",
				tokens: [token("Error", "red", "bold"), token(node.error ? ` ${node.error}` : "", "red")],
			},
		],
		sourceNodeIds: [node.id],
		error: node.error,
		output: node.output,
		expandable: node.output !== undefined || Boolean(node.error),
	};
}

function groupExploringCandidates(candidates: readonly RowCandidate[]): RowCandidate[] {
	const grouped: RowCandidate[] = [];
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		if (!candidate.exploring) {
			grouped.push(candidate);
			continue;
		}
		const run: RowCandidate[] = [candidate];
		let cursor = index + 1;
		while (cursor < candidates.length && candidates[cursor].exploring && candidates[cursor].turnId === candidate.turnId) {
			run.push(candidates[cursor]);
			cursor += 1;
		}
		if (run.length === 1) {
			grouped.push(candidate);
			continue;
		}
		grouped.push({ row: createExploringGroup(run), turnId: candidate.turnId });
		index = cursor - 1;
	}
	return grouped;
}

function createExploringGroup(candidates: readonly RowCandidate[]): CompactTerminalRow {
	const detailItems = candidates.map((candidate) => ({
		id: candidate.row.id,
		label: candidate.exploring?.label ?? candidate.row.lines[0]?.tokens.map((entry) => entry.text).join("") ?? candidate.row.id,
		status: candidate.row.status,
		input: candidate.row.input,
		output: candidate.row.output,
		error: candidate.row.error,
		linkedPiboSessionId: candidate.row.linkedPiboSessionId,
	}));
	const firstRow = candidates[0]?.row;
	const firstId = firstRow?.id ?? "exploring";
	const lastId = candidates[candidates.length - 1]?.row.id ?? firstId;
	const status = candidates.some((candidate) => candidate.row.status === "running")
		? "running"
		: candidates.some((candidate) => candidate.row.status === "error")
			? "error"
			: "done";

	return {
		id: `group:exploring:${firstId}:${lastId}`,
		kind: "tool.group.exploring",
		status,
		errorKind: status === "error" ? "tool" : undefined,
		lines: [
			{
				prefix: "bullet",
				tokens: [token(status === "running" ? "Exploring" : status === "error" ? "Exploring failed" : "Explored", toneForStatus(status), "semibold")],
			},
			...detailItems.map((item, index): CompactTerminalLine => ({
				prefix: index === 0 ? "detail" : "continuation",
				tokens: [token(item.label, item.status === "error" ? "red" : "dim")],
			})),
		],
		sourceNodeIds: candidates.flatMap((candidate) => candidate.row.sourceNodeIds),
		eventId: firstRow?.eventId,
		runId: firstRow?.runId,
		orderSource: firstRow?.orderSource,
		orderStreamId: firstRow?.orderStreamId,
		orderStreamFrameIndex: firstRow?.orderStreamFrameIndex,
		detailItems,
		expandable: detailItems.some((item) => item.input !== undefined || item.output !== undefined || Boolean(item.error)),
	};
}

function classifyExploringTool(node: PiboTraceNode): CompactTerminalDetailItem | undefined {
	const normalized = (node.title ?? "").trim().toLowerCase();
	const args = isRecord(node.input) ? node.input : undefined;
	if (matchesTool(normalized, ["read", "open"])) {
		return {
			id: node.id,
			label: `Read ${previewPath(args) ?? compactInlinePreview(node.input)}`,
			status: mapStatus(node.status),
			input: node.input,
			output: node.output,
			error: node.error,
		};
	}
	if (matchesTool(normalized, ["list", "ls", "glob"])) {
		return {
			id: node.id,
			label: `List ${previewPath(args) ?? compactInlinePreview(node.input)}`,
			status: mapStatus(node.status),
			input: node.input,
			output: node.output,
			error: node.error,
		};
	}
	if (matchesTool(normalized, ["search", "find", "grep", "rg"])) {
		const query = previewQuery(args);
		const path = previewPath(args);
		return {
			id: node.id,
			label: `Search ${query ?? compactInlinePreview(node.input)}${path ? ` in ${path}` : ""}`,
			status: mapStatus(node.status),
			input: node.input,
			output: node.output,
			error: node.error,
		};
	}
	return undefined;
}

function matchesTool(name: string, terms: readonly string[]): boolean {
	return terms.some((term) => name === term || name.startsWith(`${term}_`) || name.endsWith(`_${term}`) || name.includes(term));
}

function previewPath(value?: Record<string, unknown>): string | undefined {
	if (!value) return undefined;
	for (const key of ["path", "file", "filePath", "filepath", "url", "uri", "cwd", "pattern", "glob"]) {
		const candidate = stringValue(value[key]);
		if (candidate) return candidate;
	}
	return undefined;
}

function previewQuery(value?: Record<string, unknown>): string | undefined {
	if (!value) return undefined;
	for (const key of ["query", "pattern", "text", "name", "q", "regex"]) {
		const candidate = stringValue(value[key]);
		if (candidate) return candidate;
	}
	return undefined;
}

function previewLines(
	value: unknown,
	maxVisibleLines: number,
	tone: TerminalInlineToken["tone"] = "dim",
	_maxLineLength = 160,
): { lines: CompactTerminalLine[]; truncated: boolean } {
	const text = previewText(value);
	if (!text) return { lines: [], truncated: false };
	const allLines = text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line, index, lines) => line.length > 0 || lines.length === 1);
	if (!allLines.length) return { lines: [], truncated: false };
	const visible = allLines.slice(0, maxVisibleLines);
	const lines: CompactTerminalLine[] = visible.map((line, index) => ({
		prefix: index === 0 ? "detail" : "continuation",
		tokens: [token(line, tone)],
	}));
	if (allLines.length > maxVisibleLines) {
		lines.push({
			prefix: "continuation",
			tokens: [token(`+${allLines.length - maxVisibleLines} more lines`, "dim", "normal", true)],
		});
	}
	return { lines, truncated: allLines.length > maxVisibleLines };
}

function previewText(value: unknown): string {
	const text = terminalTextValue(value);
	if (text !== undefined) return text.trim();
	if (typeof value === "string") return value.trim();
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function compactInlinePreview(value: unknown): string {
	const text = typeof value === "string" ? value : previewText(value);
	return text.replace(/\s+/g, " ").trim();
}

function isShellToolName(name: string | undefined): boolean {
	const normalized = (name ?? "").trim().toLowerCase();
	return (
		normalized === "shell" ||
		normalized === "bash" ||
		normalized === "terminal"
	);
}

function shellCommandValue(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of ["cmd", "command", "script"]) {
		const candidate = stringValue(value[key]);
		if (candidate) return candidate;
	}
	return undefined;
}

function bashTokens(command: string): TerminalInlineToken[] {
	const chunks = command.match(/\s+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g) ?? [command];
	let seenCommand = false;
	return chunks.map((chunk) => {
		if (/^\s+$/.test(chunk)) return token(chunk);
		if (/^(?:&&|\|\||[|;<>]|2>&1)$/.test(chunk)) return token(chunk, "red", "semibold");
		if (chunk.startsWith("-")) return token(chunk, "magenta");
		if (chunk.startsWith("$") || chunk.includes("=")) return token(chunk, "yellow");
		if (/^['"]/.test(chunk)) return token(chunk, "green");
		if (!seenCommand) {
			seenCommand = true;
			return token(chunk, "green", "semibold");
		}
		if (chunk.includes("/") || chunk.startsWith(".")) return token(chunk, "cyan");
		return token(chunk, "default");
	});
}


function toolVerb(status: PiboTraceNode["status"]): string {
	if (status === "running") return "Calling";
	if (status === "error") return "Call failed";
	return "Called";
}

function delegationVerb(status: PiboTraceNode["status"]): string {
	if (status === "running") return "Spawning";
	if (status === "error") return "Spawn failed";
	return "Spawned";
}

function asyncVerb(status: PiboTraceNode["status"]): string {
	if (status === "running") return "Waiting for";
	if (status === "error") return "Finished waiting for";
	return "Finished waiting for";
}

function mapStatus(status: PiboTraceNode["status"]): CompactTerminalRowStatus {
	if (status === "running") return "running";
	if (status === "error") return "error";
	return "done";
}

function toneForStatus(status: PiboTraceNode["status"] | CompactTerminalRowStatus): TerminalInlineToken["tone"] {
	if (status === "running") return "cyan";
	if (status === "error") return "red";
	if (status === "done") return "green";
	return "default";
}

function token(
	text: string,
	tone: TerminalInlineToken["tone"] = "default",
	weight: TerminalInlineToken["weight"] = "normal",
	italic = false,
): TerminalInlineToken {
	return { text, tone, weight, italic };
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
