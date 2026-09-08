import type { CompactTerminalRow, CompactTerminalToolCallReference } from "../../../session-ui/terminalRows.js";

export const TOOL_CALL_REFERENCE_QUERY_PARAM = "toolCall";

export function buildToolCallReferenceUrl(
	currentHref: string,
	piboSessionId: string,
	reference: CompactTerminalToolCallReference,
): string {
	const url = new URL(currentHref);
	url.pathname = `/apps/chat/sessions/${encodeURIComponent(piboSessionId)}`;
	url.search = "";
	url.searchParams.set("view", "terminal");
	url.searchParams.set(TOOL_CALL_REFERENCE_QUERY_PARAM, reference.traceNodeId);
	url.hash = "";
	return url.toString();
}

export function formatToolCallReference(
	piboSessionId: string,
	reference: CompactTerminalToolCallReference,
	url: string,
): string {
	return [
		"Pibo Tool Call Reference",
		`Session ID: ${piboSessionId}`,
		`Tool Call ID: ${reference.toolCallId}`,
		`Trace Node ID: ${reference.traceNodeId}`,
		...(reference.eventId ? [`Event ID: ${reference.eventId}`] : []),
		...(reference.invocationOrdinal === undefined ? [] : [`Invocation: ${reference.invocationOrdinal}`]),
		`Link: ${url}`,
		`Agent command: pibo debug trace ${piboSessionId} show '${reference.traceNodeId}'`,
	].join("\n");
}

export function findToolCallReferenceRowIndex(
	rows: readonly CompactTerminalRow[],
	traceNodeId: string,
): number {
	return rows.findIndex((row) =>
		row.toolCallReference?.traceNodeId === traceNodeId
		|| row.detailItems?.some((item) => item.toolCallReference?.traceNodeId === traceNodeId),
	);
}
