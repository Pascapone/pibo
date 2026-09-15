import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	PI_HISTORY_PAGE_MAX_BYTES,
	PI_HISTORY_SCAN_MAX_BYTES,
	PI_HISTORY_TAIL_MAX_BYTES,
	listPiHistorySessions,
	loadPiHistoryFastMetadata,
	loadPiHistoryMetadata,
	piSessionEntriesToAgentRuntimeHistoryEntries,
	readPiTranscriptHistoryPage,
	readPiTranscriptTailEntries,
	type PiHistoryMetadata,
} from "../../agent-runtimes/pi/history.js";
import type { PiboSession } from "../../sessions/store.js";
import { traceNodesFromHistoryEntries } from "../../shared/trace-engine.js";
import type { TraceMessageTurnTiming } from "../../shared/trace-event-projection.js";
import type { PiboTraceNode } from "../../shared/trace-types.js";

export const TRACE_TRANSCRIPT_TAIL_MAX_BYTES = PI_HISTORY_TAIL_MAX_BYTES;
export const TRACE_TRANSCRIPT_HISTORY_PAGE_MAX_BYTES = PI_HISTORY_PAGE_MAX_BYTES;
export const TRACE_TRANSCRIPT_HISTORY_SCAN_MAX_BYTES = PI_HISTORY_SCAN_MAX_BYTES;

export async function loadPiSessionMetadata(session: PiboSession, cwd = process.cwd()): Promise<PiHistoryMetadata> {
	return await loadPiHistoryMetadata(session.runtimeBinding?.nativeSessionId ?? session.piSessionId, cwd);
}

export async function loadPiSessionFastMetadata(session: PiboSession, cwd = process.cwd()): Promise<PiHistoryMetadata> {
	return loadPiHistoryFastMetadata(session.runtimeBinding?.nativeSessionId ?? session.piSessionId, cwd);
}

export async function loadPiSessionTailEntries(
	session: PiboSession,
	cwd = process.cwd(),
	maxBytes = TRACE_TRANSCRIPT_TAIL_MAX_BYTES,
): Promise<{ metadata: PiHistoryMetadata; entries: SessionEntry[] }> {
	const metadata = await loadPiSessionMetadata(session, cwd);
	if (!metadata.sessionPath) return { metadata, entries: [] };
	return { metadata, entries: readPiTranscriptTailEntries(metadata.sessionPath, maxBytes) };
}

export const listPiSessions = listPiHistorySessions;
export const readTailEntries = readPiTranscriptTailEntries;
export const readTranscriptHistoryPage = readPiTranscriptHistoryPage;

export function piSessionEntriesToHistoryEntries(entries: readonly SessionEntry[]) {
	return piSessionEntriesToAgentRuntimeHistoryEntries(entries);
}

/** @deprecated Pi compatibility helper. Use traceNodesFromHistoryEntries. */
export function traceNodesFromEntries(
	piboSessionId: string,
	entries: readonly SessionEntry[],
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): PiboTraceNode[] {
	return traceNodesFromHistoryEntries(piboSessionId, piSessionEntriesToAgentRuntimeHistoryEntries(entries), turnTimings);
}
