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
	const children = span.children ? processSpanTree(span.children) : [];
	if (span.spanType === "agent.run") return children;
	if (span.spanType === "model.response") {
		return sortByStartTime([...children, { ...span, children: undefined }]);
	}

	if (!shouldDisplaySpan(span)) return children;
	return [{ ...span, children }];
}

function sortByStartTime(spans: Span[]): Span[] {
	return [...spans].sort((left, right) => left.startTime - right.startTime);
}
