import type { Span } from "../types";
import type { ToolDisplayMode } from "../session-views/types";

export function isToolDisplaySpan(span: Span): boolean {
	const traceNodeType = span.pibo?.traceNodeType;
	if (traceNodeType) {
		return traceNodeType === "tool.call" || traceNodeType === "tool.result" || traceNodeType === "agent.delegation";
	}
	return span.spanType === "tool.call" || span.spanType === "tool.result" || span.spanType === "agent.delegation";
}

export function filterToolDisplaySpans(spans: Span[], mode: ToolDisplayMode): Span[] {
	if (mode !== "hide" && mode !== "intent") return spans;
	return spans.flatMap((span) => {
		if (isToolDisplaySpan(span) && (mode === "hide" || typeof span.attributes.intent !== "string" || !span.attributes.intent.trim())) return [];
		return [{ ...span, children: span.children ? filterToolDisplaySpans(span.children, mode) : undefined }];
	});
}
