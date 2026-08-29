const QUALIFIED_TOOL_PREFIX = "tool-invocation:";
const LEGACY_QUALIFIED_TOOL_PREFIX = "history-tool:";
const TOOL_PREFIX = "tool:";
const TOOL_INVOCATION_TAG = "event-tool";

export type TraceToolNodeIdentity = {
	toolCallId: string;
	qualifier?: {
		eventId: string;
		invocationOrdinal: number;
	};
};

export function qualifiedToolNodeId(
	toolCallId: string,
	eventId: string,
	invocationOrdinal: number,
): string {
	const projectionIdentity = JSON.stringify([TOOL_INVOCATION_TAG, eventId, invocationOrdinal]);
	return `${QUALIFIED_TOOL_PREFIX}${encodeURIComponent(JSON.stringify([toolCallId, projectionIdentity]))}`;
}

/** @deprecated Use qualifiedToolNodeId for every projection source. */
export const qualifiedHistoryToolNodeId = qualifiedToolNodeId;

export function parseTraceToolNodeIdentity(nodeId: string): TraceToolNodeIdentity | undefined {
	if (nodeId.startsWith(TOOL_PREFIX)) {
		const toolCallId = nodeId.slice(TOOL_PREFIX.length);
		return toolCallId ? { toolCallId } : undefined;
	}
	const qualifiedPrefix = nodeId.startsWith(QUALIFIED_TOOL_PREFIX)
		? QUALIFIED_TOOL_PREFIX
		: nodeId.startsWith(LEGACY_QUALIFIED_TOOL_PREFIX) ? LEGACY_QUALIFIED_TOOL_PREFIX : undefined;
	if (!qualifiedPrefix) return undefined;
	try {
		const decoded = JSON.parse(decodeURIComponent(nodeId.slice(qualifiedPrefix.length))) as unknown;
		if (
			!Array.isArray(decoded)
			|| decoded.length !== 2
			|| typeof decoded[0] !== "string"
			|| decoded[0].length === 0
			|| typeof decoded[1] !== "string"
		) return undefined;
		const qualifier = JSON.parse(decoded[1]) as unknown;
		if (
			!Array.isArray(qualifier)
			|| qualifier.length !== 3
			|| qualifier[0] !== TOOL_INVOCATION_TAG
			|| typeof qualifier[1] !== "string"
			|| qualifier[1].length === 0
			|| !Number.isSafeInteger(qualifier[2])
			|| Number(qualifier[2]) < 0
		) return undefined;
		const identity = {
			toolCallId: decoded[0],
			qualifier: { eventId: qualifier[1], invocationOrdinal: Number(qualifier[2]) },
		};
		const canonicalId = qualifiedToolNodeId(
			identity.toolCallId,
			identity.qualifier.eventId,
			identity.qualifier.invocationOrdinal,
		);
		return canonicalId === nodeId || canonicalId.replace(QUALIFIED_TOOL_PREFIX, LEGACY_QUALIFIED_TOOL_PREFIX) === nodeId
			? identity
			: undefined;
	} catch {
		return undefined;
	}
}
