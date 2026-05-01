import { compareTraceOrder } from "../../../../shared/trace-order.js";
import type { Span } from "../types";

const shouldDisplaySpan = (span: Span): boolean => {
	if (span.spanType === "model.request") return false;
	if (span.spanType === "model.response") return true;
	return true;
};

export function processSpanTree(spans: Span[]): Span[] {
	const processed: Span[] = [];

	for (const span of sortByStartTime(spans)) {
		processed.push(...displaySpansFor(span));
	}

	return processed;
}

function displaySpansFor(span: Span): Span[] {
	const children = span.children ? processSpanTree(span.children) : undefined;
	if (span.spanType === "agent.run") return children ?? [];
	if (span.spanType === "model.response") {
		const response = span.children ? { ...span, children: undefined } : span;
		return sortByStartTime([...(children ?? []), response]);
	}

	if (!shouldDisplaySpan(span)) return children ?? [];
	return children === span.children ? [span] : [{ ...span, children }];
}

function sortByStartTime(spans: Span[]): Span[] {
	return [...spans].sort(compareSpans);
}

function compareSpans(left: Span, right: Span): number {
	const byTraceOrder = compareTraceOrder(left.pibo?.traceOrder, right.pibo?.traceOrder);
	if (byTraceOrder !== 0) return byTraceOrder;
	return left.startTime - right.startTime || left.id.localeCompare(right.id);
}
