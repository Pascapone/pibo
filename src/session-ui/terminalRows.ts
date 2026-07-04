import { compareTraceNodes } from "../shared/trace-engine.js";
import type { PiboSessionTraceView, PiboTraceNode, TracePayloadRef } from "../shared/trace-types.js";
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
	| "tool.image"
	| "tool.group.exploring"
	| "tool.group.images"
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

export type CompactTerminalPreviewOmission = {
	source: "input" | "output" | "error" | "details";
	visibleLineCount: number;
	omittedLineCount: number;
	totalLineCount: number;
	maxVisibleLineCount: number;
};

export type CompactTerminalDetailItem = {
	id: string;
	label: string;
	status: CompactTerminalRowStatus;
	input?: unknown;
	output?: unknown;
	error?: string;
	linkedPiboSessionId?: string;
	payloadRefs?: Partial<Record<"input" | "output" | "reasoning" | "error" | "raw", TracePayloadRef>>;
	previewOmission?: CompactTerminalPreviewOmission;
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
	payloadRefs?: Partial<Record<"input" | "output" | "reasoning" | "error" | "raw", TracePayloadRef>>;
	expandable?: boolean;
	previewOmission?: CompactTerminalPreviewOmission;
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
	image?: CompactTerminalDetailItem;
};

export const COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES = 5;
export const COMPACT_TERMINAL_EXPLORING_PREVIEW_LINES = 6;

export function buildCompactTerminalRows(
	traceView: PiboSessionTraceView | null,
	options: BuildTerminalRowsOptions,
): CompactTerminalRow[] {
	if (!traceView) return [];
	const flatNodes = flattenTraceNodes(traceView.nodes)
		.sort((left, right) => compareTraceNodes(left.node, right.node))
		.filter((item) => item.node.type !== "agent.turn" && (options.showThinking || item.node.type !== "model.reasoning"));
	const candidates = syncThinkingToolRows(flatNodes.map((item) => createRowCandidate(item.node, item.turnId)));
	return groupRelatedToolCandidates(candidates).map((candidate) => candidate.row);
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
			candidate = createToolResultRowCandidate(node, turnId);
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
	"eventId" | "runId" | "orderSource" | "orderStreamId" | "orderStreamFrameIndex" | "payloadRefs"
> {
	return {
		eventId: node.eventId,
		runId: node.runId,
		orderSource: node.source,
		orderStreamId: node.orderKey?.streamId,
		orderStreamFrameIndex: node.orderKey?.streamFrameIndex,
		payloadRefs: node.payloadRefs,
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
		payloadRefs: node.payloadRefs,
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
		payloadRefs: node.payloadRefs,
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
		payloadRefs: node.payloadRefs,
	};
}

function createToolRowCandidate(node: PiboTraceNode, turnId?: string): RowCandidate {
	const command = shellCommandValue(node.input);
	if (command && isShellToolName(node.title)) {
		const row = createCommandToolRow(node, command);
		return { row, turnId, exploring: undefined };
	}
	const image = classifyImageTool(node);
	if (image) {
		const row = createImageToolRow(node, image);
		return { row, turnId, image: image.groupable ? image.detail : undefined };
	}
	const preview = previewLines(node.error ?? node.output, COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim");
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
		previewOmission: previewOmission(preview, node.error ? "error" : "output"),
	};
	const exploring = classifyExploringTool(node);
	return { row, turnId, exploring };
}

function createImageToolRow(node: PiboTraceNode, image: ImageToolClassification): CompactTerminalRow {
	const status = mapStatus(node.status);
	const detailLabel = image.path ? `Path: ${image.path}` : image.artifactId ? `Artifact: ${image.artifactId}` : image.query ? `Query: ${image.query}` : image.mimeType ? `Type: ${image.mimeType}` : "Image content returned";
	return {
		id: node.id,
		kind: "tool.image",
		status,
		errorKind: node.status === "error" ? "tool" : undefined,
		lines: [
			{
				prefix: "bullet",
				tokens: [token(image.verb, toneForStatus(node.status), "semibold")],
			},
			{
				prefix: "detail",
				tokens: [token(detailLabel, node.status === "error" ? "red" : "cyan")],
			},
		],
		sourceNodeIds: [node.id],
		input: sanitizeImagePayload(node.input),
		output: image.summary,
		error: node.error,
		expandable: node.input !== undefined || image.summary !== undefined || Boolean(node.error),
	};
}

function createToolResultRowCandidate(node: PiboTraceNode, turnId?: string): RowCandidate {
	const image = classifyImageTool(node);
	if (image) {
		const row = createImageToolRow(node, image);
		return { row, turnId, image: image.groupable ? image.detail : undefined };
	}
	return { row: createToolResultRow(node), turnId };
}

function createToolResultRow(node: PiboTraceNode): CompactTerminalRow {
	const preview = previewLines(node.error ?? node.output, COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim");
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
		previewOmission: previewOmission(preview, node.error ? "error" : "output"),
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
	const preview = previewLines(node.error ?? node.output, COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim");
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
		previewOmission: previewOmission(preview, node.error ? "error" : "output"),
	};
}

function createYieldedRunRow(node: PiboTraceNode): CompactTerminalRow {
	const preview = previewLines(node.output, COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES);
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
		previewOmission: previewOmission(preview, "output"),
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
		return isThinkingLevelSetOutput(node.output) ? createThinkingLevelSetRow(node) : createThinkingToolRow(node);
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
	const preview = previewLines(node.error ?? node.output, COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim", 180);
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
		previewOmission: previewOmission(preview, node.error ? "error" : "output"),
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

function createThinkingLevelSetRow(node: PiboTraceNode): CompactTerminalRow {
	const result = isRecord(node.output) ? node.output : undefined;
	const level = stringValue(result?.level);
	const changed = result?.changed !== false;
	const supported = result?.supported !== false;
	const label = !supported
		? "Thinking level is not supported by this model."
		: level
			? changed ? `Thinking level set to ${level}.` : `Thinking level is already ${level}.`
			: "Thinking level updated.";

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
	const preview = previewLines(node.error ?? node.output, COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES, node.error ? "red" : "dim", 180);
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
		previewOmission: previewOmission(preview, node.error ? "error" : "output"),
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
				tokens: [token(node.title || "Error", "red", "bold"), token(node.error ? ` ${node.error}` : "", "red")],
			},
			...sessionErrorDetailLines(node.input),
		],
		sourceNodeIds: [node.id],
		input: node.input,
		error: node.error,
		output: node.output,
		expandable: node.input !== undefined || node.output !== undefined || Boolean(node.error),
	};
}

function sessionErrorDetailLines(details: unknown): CompactTerminalLine[] {
	if (!isRecord(details)) return [];
	const fields = [
		["Class", stringValue(details.errorClass) ?? stringValue(details.category)],
		["Code", stringValue(details.code) ?? stringValue(details.providerCode)],
		["Origin", stringValue(details.origin)],
		["Provider", [stringValue(details.api), stringValue(details.provider), stringValue(details.model)].filter(Boolean).join(" / ") || undefined],
		["Retryable", typeof details.retryable === "boolean" ? (details.retryable ? "yes" : "no") : undefined],
	];
	return fields
		.filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
		.map(([label, value], index) => ({
			prefix: index === 0 ? "detail" : "continuation",
			tokens: [token(`${label}: `, "dim"), token(value, "red")],
		}));
}

function syncThinkingToolRows(candidates: readonly RowCandidate[]): RowCandidate[] {
	const latest = candidates.map((candidate) => candidate.row.output).filter(isThinkingOutput).at(-1);
	if (!latest) return [...candidates];
	return candidates.map((candidate) => {
		if (candidate.row.kind !== "tool.thinking" || !isRecord(candidate.row.output)) return candidate;
		return {
			...candidate,
			row: {
				...candidate.row,
				output: {
					...candidate.row.output,
					level: latest.level,
					availableLevels: latest.availableLevels,
					supported: latest.supported,
				},
			},
		};
	});
}

function isThinkingOutput(value: unknown): value is { level: string; availableLevels: unknown; supported: unknown } {
	return isRecord(value) && typeof value.level === "string" && Array.isArray(value.availableLevels);
}

function isThinkingLevelSetOutput(value: unknown): boolean {
	return isRecord(value) && value.action === "set_thinking_level";
}

function groupRelatedToolCandidates(candidates: readonly RowCandidate[]): RowCandidate[] {
	const grouped: RowCandidate[] = [];
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		const groupKind = candidateGroupKind(candidate);
		if (!groupKind) {
			grouped.push(candidate);
			continue;
		}
		const run: RowCandidate[] = [candidate];
		let cursor = index + 1;
		while (cursor < candidates.length && candidateGroupKind(candidates[cursor]) === groupKind && candidates[cursor].turnId === candidate.turnId) {
			run.push(candidates[cursor]);
			cursor += 1;
		}
		if (run.length === 1) {
			grouped.push(candidate);
			continue;
		}
		grouped.push({ row: groupKind === "images" ? createImageGroup(run) : createExploringGroup(run), turnId: candidate.turnId });
		index = cursor - 1;
	}
	return grouped;
}

function candidateGroupKind(candidate: RowCandidate): "exploring" | "images" | undefined {
	if (candidate.image) return "images";
	if (candidate.exploring) return "exploring";
	return undefined;
}

function createExploringGroup(candidates: readonly RowCandidate[]): CompactTerminalRow {
	const detailItems = detailItemsForGroup(candidates, "exploring");
	const visibleDetailItems = detailItems.slice(0, COMPACT_TERMINAL_EXPLORING_PREVIEW_LINES);
	const omittedDetailCount = Math.max(0, detailItems.length - visibleDetailItems.length);
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
			...visibleDetailItems.map((item, index): CompactTerminalLine => ({
				prefix: index === 0 ? "detail" : "continuation",
				tokens: [token(item.label, item.status === "error" ? "red" : "dim")],
			})),
			...(omittedDetailCount > 0 ? [{
				prefix: "continuation" as const,
				tokens: [token(`+${omittedDetailCount} more explorations`, "dim", "normal", true)],
			}] : []),
		],
		sourceNodeIds: candidates.flatMap((candidate) => candidate.row.sourceNodeIds),
		eventId: firstRow?.eventId,
		runId: firstRow?.runId,
		orderSource: firstRow?.orderSource,
		orderStreamId: firstRow?.orderStreamId,
		orderStreamFrameIndex: firstRow?.orderStreamFrameIndex,
		detailItems,
		expandable: detailItems.some((item) => item.input !== undefined || item.output !== undefined || Boolean(item.error)),
		previewOmission: omittedDetailCount > 0 ? {
			source: "details",
			visibleLineCount: visibleDetailItems.length,
			omittedLineCount: omittedDetailCount,
			totalLineCount: detailItems.length,
			maxVisibleLineCount: COMPACT_TERMINAL_EXPLORING_PREVIEW_LINES,
		} : undefined,
	};
}

function createImageGroup(candidates: readonly RowCandidate[]): CompactTerminalRow {
	const detailItems = detailItemsForGroup(candidates, "images");
	const visibleDetailItems = detailItems.slice(0, COMPACT_TERMINAL_EXPLORING_PREVIEW_LINES);
	const omittedDetailCount = Math.max(0, detailItems.length - visibleDetailItems.length);
	const firstRow = candidates[0]?.row;
	const firstId = firstRow?.id ?? "images";
	const lastId = candidates[candidates.length - 1]?.row.id ?? firstId;
	const status = candidates.some((candidate) => candidate.row.status === "running")
		? "running"
		: candidates.some((candidate) => candidate.row.status === "error")
			? "error"
			: "done";

	return {
		id: `group:images:${firstId}:${lastId}`,
		kind: "tool.group.images",
		status,
		errorKind: status === "error" ? "tool" : undefined,
		lines: [
			{
				prefix: "bullet",
				tokens: [token(status === "running" ? "Viewing images" : status === "error" ? "Image reads failed" : "Viewed images", toneForStatus(status), "semibold")],
			},
			...visibleDetailItems.map((item, index): CompactTerminalLine => ({
				prefix: index === 0 ? "detail" : "continuation",
				tokens: [token(item.label, item.status === "error" ? "red" : "cyan")],
			})),
			...(omittedDetailCount > 0 ? [{
				prefix: "continuation" as const,
				tokens: [token(`+${omittedDetailCount} more image reads`, "dim", "normal", true)],
			}] : []),
		],
		sourceNodeIds: candidates.flatMap((candidate) => candidate.row.sourceNodeIds),
		eventId: firstRow?.eventId,
		runId: firstRow?.runId,
		orderSource: firstRow?.orderSource,
		orderStreamId: firstRow?.orderStreamId,
		orderStreamFrameIndex: firstRow?.orderStreamFrameIndex,
		detailItems,
		expandable: detailItems.some((item) => item.input !== undefined || item.output !== undefined || Boolean(item.error)),
		previewOmission: omittedDetailCount > 0 ? {
			source: "details",
			visibleLineCount: visibleDetailItems.length,
			omittedLineCount: omittedDetailCount,
			totalLineCount: detailItems.length,
			maxVisibleLineCount: COMPACT_TERMINAL_EXPLORING_PREVIEW_LINES,
		} : undefined,
	};
}

function detailItemsForGroup(candidates: readonly RowCandidate[], kind: "exploring" | "images"): CompactTerminalDetailItem[] {
	return candidates.map((candidate) => {
		const detail = kind === "images" ? candidate.image : candidate.exploring;
		return {
			id: candidate.row.id,
			label: detail?.label ?? candidate.row.lines[0]?.tokens.map((entry) => entry.text).join("") ?? candidate.row.id,
			status: candidate.row.status,
			input: candidate.row.input,
			output: candidate.row.output,
			error: candidate.row.error,
			payloadRefs: candidate.row.payloadRefs,
			linkedPiboSessionId: candidate.row.linkedPiboSessionId,
			previewOmission: candidate.row.previewOmission,
		};
	});
}

type ImageToolClassification = {
	count: number;
	path?: string;
	artifactId?: string;
	query?: string;
	mimeType?: string;
	verb: string;
	groupable: boolean;
	summary: unknown;
	detail: CompactTerminalDetailItem;
};

type ImagePayloadSummary = {
	type: "image" | "images" | "image_reference";
	toolName?: string;
	operation?: "generate" | "edit";
	path?: string;
	savedPath?: string;
	artifactId?: string;
	model?: string;
	referencedImageCount?: number;
	query?: string;
	mimeType?: string;
	count?: number;
	detail?: string;
};

function classifyImageTool(node: PiboTraceNode): ImageToolClassification | undefined {
	const normalized = (node.title ?? "").trim().toLowerCase();
	const args = isRecord(node.input) ? node.input : undefined;
	const output = isRecord(node.output) ? node.output : undefined;
	const details = recordField(output, "details");
	const codexOperation = normalized === "codex_image_generation" ? codexImageOperation(details) ?? codexImageOperationFromInput(args) : undefined;
	const path = codexOperation
		? stringValue(details?.savedPath) ?? previewPath(details)
		: previewPath(args) ?? previewPath(details) ?? previewPath(output);
	const artifactId = codexOperation ? stringValue(details?.artifactId) : undefined;
	const query = previewQuery(args);
	const images = collectImagePayloads(node.output);
	const isImageTool = matchesTool(normalized, ["view_image", "image", "screenshot"]);
	if (!images.length && !isImageTool && !codexOperation) return undefined;

	const mimeType = images.map((image) => image.mimeType).find((value): value is string => Boolean(value));
	const count = Math.max(1, images.length);
	const summary: ImagePayloadSummary = {
		type: images.length > 1 ? "images" : images.length === 1 ? "image" : "image_reference",
		toolName: codexOperation ? node.title : undefined,
		operation: codexOperation,
		path,
		savedPath: codexOperation ? path : undefined,
		artifactId,
		model: codexOperation ? stringValue(details?.model) : undefined,
		referencedImageCount: codexOperation ? numberValue(details?.referencedImageCount) : undefined,
		query,
		mimeType,
		count: count > 1 ? count : undefined,
		detail: images.length ? "Image data hidden in terminal view." : "Image path only; binary data is hidden in terminal view.",
	};
	const labelTarget = path ?? artifactId ?? query ?? mimeType ?? "image";
	const verb = codexOperation ? codexImageVerb(node.status, codexOperation) : imageToolVerb(node.status, count);
	return {
		count,
		path,
		artifactId,
		query,
		mimeType,
		verb,
		groupable: !codexOperation,
		summary,
		detail: {
			id: node.id,
			label: `${verb} ${labelTarget}`,
			status: mapStatus(node.status),
			input: sanitizeImagePayload(node.input),
			output: summary,
			error: node.error,
		},
	};
}

function collectImagePayloads(value: unknown, depth = 0, seen = new Set<unknown>()): Array<{ mimeType?: string }> {
	if (depth > 5 || value === undefined || value === null) return [];
	if (typeof value !== "object") return [];
	if (seen.has(value)) return [];
	seen.add(value);
	if (Array.isArray(value)) return value.flatMap((item) => collectImagePayloads(item, depth + 1, seen));
	const record = value as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type.toLowerCase() : undefined;
	const mimeType = typeof record.mimeType === "string" ? record.mimeType : typeof record.mime_type === "string" ? record.mime_type : undefined;
	const hasImageData = typeof record.data === "string" || typeof record.image_url === "string" || isRecord(record.image_url);
	if ((type === "image" || type === "input_image" || type === "output_image" || type === "image_url") && (hasImageData || mimeType?.startsWith("image/"))) {
		return [{ mimeType }];
	}
	if (mimeType?.startsWith("image/") && hasImageData) return [{ mimeType }];

	const nested: unknown[] = [];
	if ("content" in record) nested.push(record.content);
	if ("message" in record) nested.push(record.message);
	if ("result" in record) nested.push(record.result);
	if ("output" in record) nested.push(record.output);
	return nested.flatMap((item) => collectImagePayloads(item, depth + 1, seen));
}

function sanitizeImagePayload(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sanitizeImagePayload);
	if (!isRecord(value)) return value;
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if ((key === "data" || key === "image_url") && typeof item === "string" && item.length > 120) {
			result[key] = `[hidden ${key}]`;
			continue;
		}
		result[key] = sanitizeImagePayload(item);
	}
	return result;
}

function imageToolVerb(status: PiboTraceNode["status"], count: number): string {
	if (status === "running") return count > 1 ? "Viewing images" : "Viewing image";
	if (status === "error") return count > 1 ? "Image reads failed" : "Image read failed";
	return count > 1 ? "Viewed images" : "Viewed image";
}

function codexImageOperation(details: Record<string, unknown> | undefined): "generate" | "edit" | undefined {
	const operation = stringValue(details?.operation);
	return operation === "generate" || operation === "edit" ? operation : undefined;
}

function codexImageOperationFromInput(args: Record<string, unknown> | undefined): "generate" | "edit" | undefined {
	if (!args) return undefined;
	const referencedPaths = args.referenced_image_paths;
	if (Array.isArray(referencedPaths) && referencedPaths.length > 0) return "edit";
	if (numberValue(args.num_last_images_to_include) !== undefined) return "edit";
	return "generate";
}

function codexImageVerb(status: PiboTraceNode["status"], operation: "generate" | "edit"): string {
	if (operation === "edit") {
		if (status === "running") return "Editing image";
		if (status === "error") return "Image edit failed";
		return "Edited image";
	}
	if (status === "running") return "Generating image";
	if (status === "error") return "Image generation failed";
	return "Generated image";
}

function recordField(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
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

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type PreviewLinesResult = {
	lines: CompactTerminalLine[];
	visibleLineCount: number;
	omittedLineCount: number;
	totalLineCount: number;
	maxVisibleLineCount: number;
};

function previewLines(
	value: unknown,
	maxVisibleLines: number,
	tone: TerminalInlineToken["tone"] = "dim",
	_maxLineLength = 160,
): PreviewLinesResult {
	const empty = { lines: [], visibleLineCount: 0, omittedLineCount: 0, totalLineCount: 0, maxVisibleLineCount: maxVisibleLines };
	const text = previewText(value);
	if (!text) return empty;
	const allLines = text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line, index, lines) => line.length > 0 || lines.length === 1);
	if (!allLines.length) return empty;
	const visible = allLines.slice(0, maxVisibleLines);
	const omittedLineCount = Math.max(0, allLines.length - visible.length);
	const lines: CompactTerminalLine[] = visible.map((line, index) => ({
		prefix: index === 0 ? "detail" : "continuation",
		tokens: [token(line, tone)],
	}));
	if (omittedLineCount > 0) {
		lines.push({
			prefix: "continuation",
			tokens: [token(`+${omittedLineCount} more lines`, "dim", "normal", true)],
		});
	}
	return {
		lines,
		visibleLineCount: visible.length,
		omittedLineCount,
		totalLineCount: allLines.length,
		maxVisibleLineCount: maxVisibleLines,
	};
}

function previewOmission(result: PreviewLinesResult, source: CompactTerminalPreviewOmission["source"]): CompactTerminalPreviewOmission | undefined {
	if (result.omittedLineCount <= 0) return undefined;
	return {
		source,
		visibleLineCount: result.visibleLineCount,
		omittedLineCount: result.omittedLineCount,
		totalLineCount: result.totalLineCount,
		maxVisibleLineCount: result.maxVisibleLineCount,
	};
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
