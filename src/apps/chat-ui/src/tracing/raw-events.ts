import type { PiboSessionTraceView } from "../types";

type RawEvent = PiboSessionTraceView["rawEvents"][number];
export type CompactRawEvent = RawEvent & { count: number };

export function compactRawEvents(events: RawEvent[]): CompactRawEvent[] {
	const compacted: CompactRawEvent[] = [];
	for (const event of events) {
		const previous = compacted[compacted.length - 1];
		if (previous && canMergeRawDelta(previous, event)) {
			previous.count += 1;
			previous.createdAt = event.createdAt;
			previous.payload = {
				...(isRecord(previous.payload) ? previous.payload : {}),
				text: `${textFromPayload(previous.payload)}${textFromPayload(event.payload)}`,
			};
			continue;
		}
		compacted.push({ ...event, count: 1 });
	}
	return compacted;
}

function canMergeRawDelta(left: RawEvent, right: RawEvent): boolean {
	if (left.type !== right.type) return false;
	if (
		left.type !== "assistant_delta" &&
		left.type !== "thinking_delta" &&
		left.type !== "TEXT_MESSAGE_CONTENT" &&
		left.type !== "REASONING_MESSAGE_CONTENT"
	) {
		return false;
	}
	const leftPayload = isRecord(left.payload) ? left.payload : {};
	const rightPayload = isRecord(right.payload) ? right.payload : {};
	return eventKeyFromPayload(leftPayload) === eventKeyFromPayload(rightPayload);
}

function textFromPayload(payload: unknown): string {
	if (!isRecord(payload)) return "";
	if (typeof payload.text === "string") return payload.text;
	return typeof payload.delta === "string" ? payload.delta : "";
}

function eventKeyFromPayload(payload: Record<string, unknown>): unknown {
	return payload.eventId ?? payload.messageId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
