import type { PiboTraceNode, Span, SpanStatus, SpanType, Trace } from "../types";

const spanCache = new WeakMap<PiboTraceNode, Span>();

export function adaptTrace(piboSessionId: string, title: string, nodes: PiboTraceNode[]): Trace {
	const spans = nodes.map((node) => adaptNode(node));
	const all = flattenSpans(spans);
	const startTime = all.length ? Math.min(...all.map((span) => span.startTime)) : Date.now() * 1000;
	const endTimes = all.flatMap((span) => (span.endTime ? [span.endTime] : []));
	const endTime = endTimes.length ? Math.max(...endTimes) : undefined;
	const hasRunning = all.some((span) => span.status === "UNSET");
	const hasError = all.some((span) => span.status === "ERROR");

	return {
		id: piboSessionId,
		name: title,
		status: hasError ? "ERROR" : hasRunning ? "UNSET" : "OK",
		spans,
		startedAt: new Date(startTime / 1000),
		completedAt: endTime ? new Date(endTime / 1000) : undefined,
		totalDurationMs: endTime ? (endTime - startTime) / 1000 : 0,
	};
}

function adaptNode(node: PiboTraceNode): Span {
	const cached = spanCache.get(node);
	if (cached) return cached;

	const startTime = toMicros(node.startedAt) ?? Date.now() * 1000;
	const endTime = toMicros(node.completedAt);
	const status = adaptStatus(node.status);
	const spanType = adaptSpanType(node.type);

	const span: Span = {
		id: node.id,
		parentId: node.parentId,
		name: spanName(node),
		spanType,
		startTime,
		endTime,
		durationUs: node.durationMs === undefined ? undefined : node.durationMs * 1000,
		attributes: spanAttributes(node),
		status,
		statusMessage: node.error,
		events: node.error
			? [{ name: "exception", timestamp: endTime ?? startTime, attributes: { message: node.error } }]
			: [],
		children: node.children?.map(adaptNode),
		pibo: {
			entryId: node.entryId,
			linkedPiboSessionId: node.linkedPiboSessionId,
			traceNodeType: node.type,
			traceOrder: node.orderKey,
			stableKey: node.stableKey,
			source: node.source,
		},
	};
	spanCache.set(node, span);
	return span;
}

function adaptSpanType(type: PiboTraceNode["type"]): SpanType {
	switch (type) {
		case "user.message":
			return "user.prompt";
		case "assistant.message":
			return "model.response";
		case "model.reasoning":
			return "model.reasoning";
		case "tool.call":
			return "tool.call";
		case "tool.result":
			return "tool.result";
		case "agent.delegation":
			return "agent.delegation";
		case "agent.async":
			return "agent.async";
		case "execution.command":
			return "tool.result";
		case "yielded.run":
			return "yielded.run";
		case "agent.turn":
			return "agent.run";
		case "error":
			return "tool.result";
	}
}

function spanName(node: PiboTraceNode): string {
	if (node.type === "assistant.message") return "assistant_message";
	if (node.type === "user.message") return "user_prompt";
	if (node.type === "model.reasoning") return "model_reasoning";
	return node.title || node.type;
}

function spanAttributes(node: PiboTraceNode): Record<string, unknown> {
	const attributes: Record<string, unknown> = {};
	if (node.summary) attributes.content = node.summary;
	if (node.input !== undefined) {
		attributes.input = node.input;
		attributes.args = node.input;
		attributes.arguments = node.input;
	}
	if (node.output !== undefined) {
		attributes.output = node.output;
		attributes.result = node.output;
	}
	if (node.error) attributes.error = node.error;
	if (node.toolCallId) attributes.tool_call_id = node.toolCallId;
	if (node.runId) attributes.run_id = node.runId;
	if (node.type === "tool.call" || node.type === "agent.delegation") {
		attributes.tool_name = node.title;
	}
	if (node.type === "assistant.message") {
		attributes.content = node.output ?? node.summary ?? "";
	}
	if (node.type === "user.message") {
		attributes.content = node.output ?? node.summary ?? "";
	}
	if (node.type === "model.reasoning") {
		attributes.reasoning = node.output ?? node.summary ?? "";
	}
	if (node.type === "agent.delegation") {
		attributes["delegation.target_agent"] = node.title.replace(/^pibo_subagent_/, "");
		attributes["delegation.query"] = node.summary ?? node.input;
		attributes["result.status"] = node.status === "done" ? "completed" : node.status;
		attributes.linked_pibo_session_id = node.linkedPiboSessionId;
	}
	if (node.type === "agent.async") {
		attributes["async_agent.target_agent"] = node.title;
		attributes["async_agent.started_by"] = isRecord(node.input) ? node.input.startedBy : "pibo_run_start";
		attributes["async_agent.query"] = isRecord(node.input) ? node.input.arguments : node.input;
		attributes["result.status"] = node.status === "done" ? "started" : node.status;
		attributes.linked_pibo_session_id = node.linkedPiboSessionId;
	}
	if (node.type === "yielded.run") {
		attributes["run.notification"] = true;
		attributes["run.status"] = node.status;
	}
	return attributes;
}

function adaptStatus(status: PiboTraceNode["status"]): SpanStatus {
	if (status === "running") return "UNSET";
	if (status === "error") return "ERROR";
	return "OK";
}

function toMicros(value?: string): number | undefined {
	if (!value) return undefined;
	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp * 1000 : undefined;
}

function flattenSpans(spans: Span[]): Span[] {
	return spans.flatMap((span) => [span, ...(span.children ? flattenSpans(span.children) : [])]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
