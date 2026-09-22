import type { PiboAgentObserveResult } from "./types.js";

/** Shared model-facing format; callers retain their own cursor/session policy. */
export function formatAgentObservationsForModel(result: PiboAgentObserveResult): string {
	const includeTools = result.filters.includeTools === true;
	const toolDetail = result.filters.toolDetail ?? "summary";
	const cursorMode = result.filters.cursorMode ?? "auto";
	const lines = [
		`Agent observations (${result.observations.length}; cursor=${cursorMode}; tools=${includeTools ? toolDetail : "hidden"}; order=${result.filters.order ?? "desc"}; limit=${result.filters.limit ?? 20})`,
		`afterSequence=${result.filters.afterSequence ?? "initial"}; nextAfterSequence=${result.nextAfterSequence}${result.autoCursorSequence === undefined ? "" : `; autoCursorSequence=${result.autoCursorSequence}`}; truncated=${result.truncated}`,
	];
	if (result.observations.length === 0) {
		lines.push("", cursorMode === "auto"
			? "No new delegated-agent messages matched since the automatic cursor. Use cursorMode=\"history\" only when you need to reread earlier observations."
			: "No historical delegated-agent observations matched the filters.");
		return lines.join("\n");
	}
	for (const observation of result.observations) {
		const scope = [
			observation.name,
			observation.threadKey ? `thread=${observation.threadKey}` : undefined,
			observation.requestId ? `request=${observation.requestId}` : undefined,
		].filter(Boolean).join("; ");
		const event = observation.kind === "tool"
			? `${observation.eventType}${observation.toolName ? ` ${observation.toolName}` : ""}`
			: observation.eventType;
		const toolCall = observation.kind === "tool" && observation.toolCallId
			? `; toolCallId=${observation.toolCallId}`
			: "";
		lines.push("", `#${observation.sequence} ${scope} — ${event}${toolCall}${observation.isError ? " [error]" : ""}`);
		if (observation.text) lines.push(observation.text);
	}
	return lines.join("\n");
}
