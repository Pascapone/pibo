import { createHash } from "node:crypto";
import type {
	PiboAgentObservation,
	PiboAgentObserveInput,
	PiboAgentObserveResult,
} from "./tool.js";
import {
	PIBO_AGENT_OBSERVATION_DEFAULT_EVENT_TYPES,
	PIBO_AGENT_OBSERVATION_DEFAULT_TOOL_EVENT_TYPES,
	normalizePiboAgentObservationCursor,
	normalizePiboAgentObservationCursorMode,
	normalizePiboAgentObservationLimit,
	normalizePiboAgentObservationOrder,
	normalizePiboAgentObservationToolDetail,
	parsePiboAgentObservationTimestamp,
	piboAgentObservationKind,
	piboAgentObservationToolSummary,
	type PiboAgentObservationCursorMode,
	type PiboAgentObservationOrder,
	type PiboAgentObservationToolDetail,
} from "./observations.js";
import {
	PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS,
	PIBO_AGENT_TEXT_REGEX_BATCH_TARGET_BYTES,
	matchPiboAgentObservationTextRegex,
	preparePiboAgentObservationTextRegex,
	type PreparedPiboAgentObservationTextRegex,
} from "./observation-text-regex.js";

export type PreparedPiboAgentObservationQuery = {
	filters: PiboAgentObserveInput;
	afterSequence?: number;
	cursorMode: PiboAgentObservationCursorMode;
	order: PiboAgentObservationOrder;
	scanOrder: PiboAgentObservationOrder;
	limit: number;
	includeTools: boolean;
	toolDetail: PiboAgentObservationToolDetail;
	scanEventTypes?: string[];
	textRegex?: PreparedPiboAgentObservationTextRegex;
	matches(observation: PiboAgentObservation): boolean;
};

export type PiboAgentObservationPageOptions = {
	evictedThrough?: number;
};

function sortedUnique(values: string[] | undefined): string[] | undefined {
	return values ? [...new Set(values)].sort() : undefined;
}

export function piboAgentObservationCursorScopeKey(input: PiboAgentObserveInput): string {
	const scope = {
		requestIds: sortedUnique(input.requestIds),
		toolCallIds: sortedUnique(input.toolCallIds),
		agentIds: sortedUnique(input.agentIds),
		names: sortedUnique(input.names),
		threadKeys: sortedUnique(input.threadKeys),
		eventTypes: sortedUnique(input.eventTypes),
		kinds: input.kinds ? [...new Set(input.kinds)].sort() : undefined,
		roles: sortedUnique(input.roles),
		since: input.since,
		until: input.until,
		textContains: input.textContains?.toLowerCase(),
		textRegex: input.textRegex,
		includeTools: input.includeTools === true,
		toolDetail: input.toolDetail ?? "summary",
		includeDetails: input.includeDetails === true,
	};
	return `v1:${createHash("sha256").update(JSON.stringify(scope)).digest("hex")}`;
}

export function preparePiboAgentObservationQuery(
	input: PiboAgentObserveInput = {},
): PreparedPiboAgentObservationQuery {
	const cursorMode = normalizePiboAgentObservationCursorMode(input.cursorMode);
	const order = normalizePiboAgentObservationOrder(input.order);
	const limit = normalizePiboAgentObservationLimit(input.limit);
	const toolDetail = normalizePiboAgentObservationToolDetail(input.toolDetail);
	const afterSequence = normalizePiboAgentObservationCursor(input.afterSequence);
	const since = parsePiboAgentObservationTimestamp(input.since, "since");
	const until = parsePiboAgentObservationTimestamp(input.until, "until");
	if (since !== undefined && until !== undefined && since > until) {
		throw new Error("Agent observation since must not be after until.");
	}
	if (input.toolCallIds && input.toolCallIds.length > 50) {
		throw new Error("Agent observation toolCallIds must contain at most 50 entries.");
	}

	const requestIds = input.requestIds ? new Set(input.requestIds) : undefined;
	const toolCallIds = input.toolCallIds ? new Set(input.toolCallIds) : undefined;
	const agentIds = input.agentIds ? new Set(input.agentIds) : undefined;
	const names = input.names ? new Set(input.names) : undefined;
	const threadKeys = input.threadKeys ? new Set(input.threadKeys) : undefined;
	const eventTypes = input.eventTypes ? new Set(input.eventTypes) : undefined;
	const kinds = input.kinds ? new Set(input.kinds) : undefined;
	const roles = input.roles ? new Set(input.roles) : undefined;
	const textContains = input.textContains?.toLowerCase();
	const textRegex = preparePiboAgentObservationTextRegex(input.textRegex);
	const defaultMessageView = eventTypes === undefined && kinds === undefined;
	const explicitlySelectsTools = input.eventTypes?.some((eventType) => piboAgentObservationKind(eventType) === "tool") === true
		|| input.kinds?.includes("tool") === true
		|| toolCallIds !== undefined;
	const includeTools = input.includeTools === true || (input.includeTools === undefined && explicitlySelectsTools);
	const defaultEventTypes = includeTools
		? [...PIBO_AGENT_OBSERVATION_DEFAULT_EVENT_TYPES, ...PIBO_AGENT_OBSERVATION_DEFAULT_TOOL_EVENT_TYPES]
		: [...PIBO_AGENT_OBSERVATION_DEFAULT_EVENT_TYPES];
	const defaultEventTypeSet = new Set<string>(defaultEventTypes);
	const scanEventTypes = defaultMessageView
		? defaultEventTypes
		: input.eventTypes && input.eventTypes.length > 0
			? [...input.eventTypes]
			: undefined;

	return {
		filters: {
			...input,
			cursorMode,
			...(defaultMessageView ? { eventTypes: defaultEventTypes } : {}),
			...(afterSequence !== undefined ? { afterSequence } : {}),
			order,
			limit,
			includeTools,
			toolDetail,
			includeDetails: input.includeDetails === true,
		},
		...(afterSequence !== undefined ? { afterSequence } : {}),
		cursorMode,
		order,
		scanOrder: afterSequence !== undefined ? "asc" : order,
		limit,
		includeTools,
		toolDetail,
		...(scanEventTypes ? { scanEventTypes } : {}),
		...(textRegex ? { textRegex } : {}),
		matches(observation) {
			if (requestIds && (!observation.requestId || !requestIds.has(observation.requestId))) return false;
			if (toolCallIds && (!observation.toolCallId || !toolCallIds.has(observation.toolCallId))) return false;
			if (agentIds && !agentIds.has(observation.agentId)) return false;
			if (names && !names.has(observation.name)) return false;
			if (threadKeys && (!observation.threadKey || !threadKeys.has(observation.threadKey))) return false;
			if (observation.kind === "tool" && !includeTools) return false;
			if (defaultMessageView && !defaultEventTypeSet.has(observation.eventType)) return false;
			if (eventTypes && !eventTypes.has(observation.eventType)) return false;
			if (kinds && !kinds.has(observation.kind)) return false;
			if (roles && (!observation.role || !roles.has(observation.role))) return false;
			if (afterSequence !== undefined && observation.sequence <= afterSequence) return false;
			const createdAt = Date.parse(observation.createdAt);
			if (since !== undefined && createdAt < since) return false;
			if (until !== undefined && createdAt > until) return false;
			if (textContains && !(observation.text ?? "").toLowerCase().includes(textContains)) return false;
			return true;
		},
	};
}

export function selectPiboAgentObservationPage(
	observations: Iterable<PiboAgentObservation>,
	query: PreparedPiboAgentObservationQuery,
	options: PiboAgentObservationPageOptions = {},
): PiboAgentObserveResult {
	const matches: PiboAgentObservation[] = [];
	if (query.textRegex) {
		let candidates: PiboAgentObservation[] = [];
		let candidateBytes = 0;
		const matchCandidates = (): boolean => {
			const regexMatches = matchPiboAgentObservationTextRegex(
				query.textRegex!,
				candidates.map((observation) => observation.text ?? ""),
			);
			for (let index = 0; index < candidates.length; index += 1) {
				if (!regexMatches[index]) continue;
				matches.push(candidates[index]!);
				if (matches.length > query.limit) {
					candidates = [];
					candidateBytes = 0;
					return true;
				}
			}
			candidates = [];
			candidateBytes = 0;
			return false;
		};

		for (const observation of observations) {
			if (!query.matches(observation)) continue;
			const textBytes = Buffer.byteLength(observation.text ?? "", "utf8");
			if (
				candidates.length > 0
				&& candidateBytes + textBytes > PIBO_AGENT_TEXT_REGEX_BATCH_TARGET_BYTES
				&& matchCandidates()
			) break;
			candidates.push(observation);
			candidateBytes += textBytes;
			if (
				candidates.length >= PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS
				|| candidateBytes >= PIBO_AGENT_TEXT_REGEX_BATCH_TARGET_BYTES
			) {
				if (matchCandidates()) break;
			}
		}
		if (matches.length <= query.limit && candidates.length > 0) matchCandidates();
	} else {
		for (const observation of observations) {
			if (!query.matches(observation)) continue;
			matches.push(observation);
			if (matches.length > query.limit) break;
		}
	}
	const pageLimited = matches.length > query.limit;
	const selected = matches.slice(0, query.limit);
	if (query.afterSequence !== undefined && query.order === "desc") selected.reverse();
	const projected = selected.map((observation) => {
		const { details, ...visible } = observation;
		const compact = visible.kind === "tool" && query.toolDetail === "summary"
			? { ...visible, text: piboAgentObservationToolSummary(visible.text, visible.isError, details) }
			: visible;
		return query.filters.includeDetails === true && details !== undefined ? { ...compact, details } : compact;
	});
	const evictedThrough = options.evictedThrough ?? 0;
	const retentionTruncated = query.afterSequence === undefined
		? evictedThrough > 0
		: query.afterSequence < evictedThrough;
	const nextAfterSequence = projected.reduce(
		(maximum, observation) => Math.max(maximum, observation.sequence),
		query.afterSequence === undefined ? 0 : Math.max(query.afterSequence, evictedThrough),
	);
	return {
		filters: query.filters,
		observations: projected,
		nextAfterSequence,
		truncated: retentionTruncated || pageLimited,
	};
}
