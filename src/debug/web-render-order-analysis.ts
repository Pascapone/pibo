import type {
	StreamingRenderOrderAnalysis,
	StreamingRenderOrderCapture,
	StreamingRenderOrderDomState,
	StreamingRenderOrderFinding,
	StreamingRenderOrderTraceLayer,
	StreamingRenderOrderTraceSnapshot,
} from "./web-streaming-types.js";

type OrderedState = {
	source: StreamingRenderOrderFinding["source"];
	timestamp: number;
	ids: string[];
	meta: Array<Record<string, unknown>>;
};

const MAX_FINDINGS = 200;

export function analyzeStreamingRenderOrderCapture(capture: StreamingRenderOrderCapture | undefined): StreamingRenderOrderCapture | undefined {
	if (!capture) return undefined;
	const findings: StreamingRenderOrderFinding[] = [];
	const pushFinding = (finding: StreamingRenderOrderFinding) => {
		if (findings.length < MAX_FINDINGS) findings.push(finding);
	};

	const internalStates = orderedInternalStates(capture.traceSnapshots);
	for (const source of ["baseNodes", "currentNodes", "terminalRows", "visibleRows"] as const) {
		analyzeStateSequence(internalStates.filter((state) => state.source === source), pushFinding);
	}

	const stableDomStates = capture.domStates.filter((state) => state.atBottom !== false);
	analyzeStateSequence(stableDomStates.map(domState), pushFinding);
	analyzeVisualOrder(stableDomStates, pushFinding);
	analyzeStateDomAgreement(stableDomStates, internalStates, pushFinding);

	const analysis: StreamingRenderOrderAnalysis = {
		domStateCount: capture.domStates.length,
		traceSnapshotCount: capture.traceSnapshots.length,
		reorderCount: findings.filter((finding) => finding.kind === "reorder").length,
		disappearReappearCount: findings.filter((finding) => finding.kind === "disappear-reappear").length,
		identityReplacementCount: findings.filter((finding) => finding.kind === "identity-replacement").length,
		stateDomMismatchCount: findings.filter((finding) => finding.kind === "state-dom-mismatch").length,
		findings,
		regressions: renderOrderRegressions(findings),
	};
	return { ...capture, analysis };
}

function orderedInternalStates(snapshots: readonly StreamingRenderOrderTraceSnapshot[]): OrderedState[] {
	const states: OrderedState[] = [];
	for (const snapshot of snapshots) {
		for (const layer of snapshot.layers ?? []) {
			if (!isOrderedLayer(layer)) continue;
			states.push({
				source: layer.kind,
				timestamp: snapshot.timestamp,
				ids: uniqueStrings(layer.ids),
				meta: Array.isArray(layer.meta) ? layer.meta : [],
			});
		}
	}
	return states.sort((left, right) => left.timestamp - right.timestamp);
}

function isOrderedLayer(layer: StreamingRenderOrderTraceLayer): layer is StreamingRenderOrderTraceLayer & { kind: "baseNodes" | "currentNodes" | "terminalRows" | "visibleRows" } {
	return layer.kind === "baseNodes" || layer.kind === "currentNodes" || layer.kind === "terminalRows" || layer.kind === "visibleRows";
}

function domState(state: StreamingRenderOrderDomState): OrderedState {
	return {
		source: "dom",
		timestamp: state.timestamp,
		ids: uniqueStrings(state.rowIds),
		meta: state.rows as unknown as Array<Record<string, unknown>>,
	};
}

function analyzeStateSequence(states: readonly OrderedState[], pushFinding: (finding: StreamingRenderOrderFinding) => void): void {
	if (states.length < 2) return;
	for (let index = 1; index < states.length; index++) {
		const before = states[index - 1];
		const after = states[index];
		const reordered = reorderedCommonIds(before.ids, after.ids);
		if (reordered.length > 0) {
			pushFinding({
				source: after.source,
				kind: "reorder",
				timestamp: after.timestamp,
				ids: reordered,
				detail: `${after.source} changed relative order: ${compactOrder(before.ids)} -> ${compactOrder(after.ids)}`,
			});
		}
		for (const replacement of identityReplacements(before, after)) {
			pushFinding({
				source: after.source,
				kind: "identity-replacement",
				timestamp: after.timestamp,
				ids: [replacement.beforeId, replacement.afterId],
				detail: `${after.source} changed id for ${replacement.logicalKey}: ${replacement.beforeId} -> ${replacement.afterId}`,
			});
		}
	}
	for (const reappearance of disappearReappearances(states)) {
		pushFinding({
			source: reappearance.source,
			kind: "disappear-reappear",
			timestamp: reappearance.timestamp,
			ids: [reappearance.id],
			detail: `${reappearance.source} removed ${reappearance.id} and later rendered it again`,
		});
	}
}

function analyzeVisualOrder(states: readonly StreamingRenderOrderDomState[], pushFinding: (finding: StreamingRenderOrderFinding) => void): void {
	for (const state of states) {
		const reordered = reorderedCommonIds(state.rowIds, state.visualRowIds);
		if (reordered.length === 0) continue;
		pushFinding({
			source: "visual",
			kind: "reorder",
			timestamp: state.timestamp,
			ids: reordered,
			detail: `visual order differs from DOM order: ${compactOrder(state.rowIds)} -> ${compactOrder(state.visualRowIds)}`,
		});
	}
}

function analyzeStateDomAgreement(domStates: readonly StreamingRenderOrderDomState[], internalStates: readonly OrderedState[], pushFinding: (finding: StreamingRenderOrderFinding) => void): void {
	const terminalStates = internalStates.filter((state) => state.source === "terminalRows");
	const visibleStates = internalStates.filter((state) => state.source === "visibleRows");
	for (const dom of domStates) {
		const candidates = dom.view === "compact-terminal" ? terminalStates : dom.view === "trace-timeline" ? visibleStates : [];
		const internal = nearestState(candidates, dom.timestamp, 500);
		if (!internal || dom.rowIds.length === 0) continue;
		if (isSubsequence(dom.rowIds, internal.ids)) continue;
		pushFinding({
			source: "state-dom",
			kind: "state-dom-mismatch",
			timestamp: dom.timestamp,
			ids: dom.rowIds.filter((id) => !internal.ids.includes(id)),
			detail: `${dom.view} DOM is not an ordered subset of ${internal.source}: DOM ${compactOrder(dom.rowIds)}, state ${compactOrder(internal.ids)}`,
		});
	}
}

function reorderedCommonIds(before: readonly string[], after: readonly string[]): string[] {
	const beforeSet = new Set(before);
	const afterSet = new Set(after);
	const beforeCommon = before.filter((id) => afterSet.has(id));
	const afterCommon = after.filter((id) => beforeSet.has(id));
	if (beforeCommon.length < 2 || arraysEqual(beforeCommon, afterCommon)) return [];
	const beforeIndex = new Map(beforeCommon.map((id, index) => [id, index]));
	return afterCommon.filter((id, index) => beforeIndex.get(id) !== index);
}

function identityReplacements(before: OrderedState, after: OrderedState): Array<{ logicalKey: string; beforeId: string; afterId: string }> {
	const beforeByLogicalKey = logicalIdentityMap(before);
	const afterByLogicalKey = logicalIdentityMap(after);
	const replacements: Array<{ logicalKey: string; beforeId: string; afterId: string }> = [];
	for (const [logicalKey, beforeId] of beforeByLogicalKey) {
		const afterId = afterByLogicalKey.get(logicalKey);
		if (afterId && afterId !== beforeId) replacements.push({ logicalKey, beforeId, afterId });
	}
	return replacements;
}

function logicalIdentityMap(state: OrderedState): Map<string, string> {
	const result = new Map<string, string>();
	for (const raw of state.meta) {
		const id = stringField(raw, "id");
		if (!id) continue;
		const kind = stringField(raw, "kind") ?? stringField(raw, "type") ?? "node";
		const direct = stringField(raw, "eventId")
			?? stringField(raw, "runId")
			?? stringField(raw, "toolCallId")
			?? stringField(raw, "entryId")
			?? stringField(raw, "stableKey");
		const sourceNodeIds = stringArrayField(raw, "sourceNodeIds");
		const logicalKey = direct ? `${kind}:${direct}` : sourceNodeIds.length ? `${kind}:${sourceNodeIds.join("|")}` : undefined;
		if (logicalKey && !result.has(logicalKey)) result.set(logicalKey, id);
	}
	return result;
}

function disappearReappearances(states: readonly OrderedState[]): Array<{ source: OrderedState["source"]; id: string; timestamp: number }> {
	const seen = new Set<string>();
	const absentAfterSeen = new Set<string>();
	const reported = new Set<string>();
	const results: Array<{ source: OrderedState["source"]; id: string; timestamp: number }> = [];
	let previous = new Set<string>();
	for (const state of states) {
		const current = new Set(state.ids);
		for (const id of previous) {
			if (!current.has(id) && seen.has(id)) absentAfterSeen.add(id);
		}
		for (const id of current) {
			if (absentAfterSeen.has(id) && !reported.has(id)) {
				results.push({ source: state.source, id, timestamp: state.timestamp });
				reported.add(id);
			}
			seen.add(id);
		}
		previous = current;
	}
	return results;
}

function nearestState(states: readonly OrderedState[], timestamp: number, maxDistanceMs: number): OrderedState | undefined {
	let best: OrderedState | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const state of states) {
		const distance = Math.abs(state.timestamp - timestamp);
		if (distance < bestDistance) {
			best = state;
			bestDistance = distance;
		}
	}
	return bestDistance <= maxDistanceMs ? best : undefined;
}

function renderOrderRegressions(findings: readonly StreamingRenderOrderFinding[]): string[] {
	const regressions: string[] = [];
	const count = (kind: StreamingRenderOrderFinding["kind"], sources?: readonly StreamingRenderOrderFinding["source"][]) => findings.filter((finding) => finding.kind === kind && (!sources || sources.includes(finding.source))).length;
	const internalReorders = count("reorder", ["baseNodes", "currentNodes", "terminalRows", "visibleRows"]);
	const renderedReorders = count("reorder", ["dom", "visual"]);
	const reappearances = count("disappear-reappear");
	const replacements = count("identity-replacement");
	const mismatches = count("state-dom-mismatch");
	if (internalReorders > 0) regressions.push(`render order internal state reordered ${internalReorders} time${internalReorders === 1 ? "" : "s"}`);
	if (renderedReorders > 0) regressions.push(`render order DOM/visual rows reordered ${renderedReorders} time${renderedReorders === 1 ? "" : "s"}`);
	if (reappearances > 0) regressions.push(`render order rows disappeared and reappeared ${reappearances} time${reappearances === 1 ? "" : "s"}`);
	if (replacements > 0) regressions.push(`render order logical identities changed ids ${replacements} time${replacements === 1 ? "" : "s"}`);
	if (mismatches > 0) regressions.push(`render order DOM diverged from client state ${mismatches} time${mismatches === 1 ? "" : "s"}`);
	return regressions;
}

function isSubsequence(candidate: readonly string[], full: readonly string[]): boolean {
	let index = 0;
	for (const id of full) {
		if (id === candidate[index]) index += 1;
		if (index === candidate.length) return true;
	}
	return candidate.length === 0;
}

function uniqueStrings(values: readonly unknown[]): string[] {
	return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
	const field = value[key];
	return typeof field === "string" && field.length > 0 ? field : undefined;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
	const field = value[key];
	return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compactOrder(ids: readonly string[]): string {
	const shown = ids.slice(0, 8);
	return `[${shown.join(", ")}${ids.length > shown.length ? `, … +${ids.length - shown.length}` : ""}]`;
}
