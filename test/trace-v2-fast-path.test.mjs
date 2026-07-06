import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";
import {
	TRACE_V2_INLINE_TRANSCRIPT_PAYLOAD_MAX_BYTES,
	TRACE_V2_PAYLOAD_DEFAULT_LIMIT_BYTES,
	TRACE_V2_TIMELINE_HARD_BYTES,
	readTracePayloadChunk,
	traceRawEventsPageFromEvents,
	traceTimelinePageFromView,
} from "../dist/apps/chat/trace-v2.js";

function tempStore() {
	const dir = mkdtempSync(join(tmpdir(), "pibo-trace-v2-"));
	return new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });
}

function largeTrace(output) {
	return {
		piboSessionId: "ps_large",
		piSessionId: "pi_large",
		title: "Large",
		version: "v1",
		eventCount: 1,
		pageSize: 1,
		firstEventSequence: 1,
		lastEventSequence: 1,
		nextBeforeSequence: 1,
		hasOlderEvents: false,
		rawEvents: [],
		nodes: [
			{
				id: "tool_1",
				piboSessionId: "ps_large",
				type: "tool.call",
				title: "bash",
				status: "done",
				input: { command: "generate-large-output" },
				output,
				children: [],
			},
		],
	};
}

function traceWithNode(node) {
	return {
		piboSessionId: "ps_transcript",
		piSessionId: "pi_transcript",
		title: "Transcript",
		version: "v1",
		eventCount: 1,
		pageSize: 1,
		firstEventSequence: 1,
		lastEventSequence: 1,
		nextBeforeSequence: 1,
		hasOlderEvents: false,
		rawEvents: [],
		nodes: [
			{
				id: "node_1",
				piboSessionId: "ps_transcript",
				status: "done",
				children: [],
				...node,
			},
		],
	};
}

function storedEvent(sequence, payload) {
	return {
		id: `event-${sequence}`,
		piboSessionId: payload.piboSessionId ?? "ps_transcript",
		eventSequence: sequence,
		streamId: 100 + sequence,
		streamFrameIndex: 0,
		type: payload.type,
		createdAt: new Date(Date.UTC(2026, 6, 5, 12, 0, sequence)).toISOString(),
		payload: {
			piboSessionId: "ps_transcript",
			...payload,
		},
	};
}

test("trace v2 timeline keeps large tool output behind payload refs", () => {
	const store = tempStore();
	try {
		const output = "x".repeat(10 * 1024 * 1024);
		const page = traceTimelinePageFromView({
			trace: largeTrace(output),
			payloadStore: store.payloads,
			limit: 120,
		});
		const bytes = Buffer.byteLength(JSON.stringify(page), "utf8");
		assert.ok(bytes < TRACE_V2_TIMELINE_HARD_BYTES, `timeline bytes ${bytes}`);
		assert.equal(page.nodes.length, 1);
		assert.equal("input" in page.nodes[0], false);
		assert.equal("output" in page.nodes[0], false);
		assert.deepEqual(page.nodes[0].inlinePayloads.input, { command: "generate-large-output" });
		assert.equal(page.nodes[0].inlinePayloads.output, undefined);
		assert.ok(page.nodes[0].payloadRefs.output);
		assert.equal(page.nodes[0].payloadRefs.output.byteLength, output.length);

		const chunk = readTracePayloadChunk({
			payloadStore: store.payloads,
			ref: page.nodes[0].payloadRefs.output.ref,
			offset: 0,
			limit: TRACE_V2_PAYLOAD_DEFAULT_LIMIT_BYTES,
		});
		assert.ok(chunk);
		assert.equal(chunk.data.length, TRACE_V2_PAYLOAD_DEFAULT_LIMIT_BYTES);
		assert.equal(chunk.hasMore, true);
	} finally {
		store.close();
	}
});

test("trace v2 timeline omits older-page cursors when history is exhausted", () => {
	const store = tempStore();
	try {
		const page = traceTimelinePageFromView({
			trace: largeTrace("done"),
			payloadStore: store.payloads,
			limit: 120,
		});

		assert.equal(page.cursor.hasOlder, false);
		assert.equal(page.cursor.before, undefined);
		assert.equal(page.nextBeforeSequence, undefined);
		assert.equal(page.nextBeforeCursor, undefined);
		assert.equal(page.hasOlderEvents, false);
	} finally {
		store.close();
	}
});

test("trace v2 timeline keeps bounded transcript text renderable inline", () => {
	const store = tempStore();
	try {
		const output = [
			"Hier ist eine kopierbare Agent-Instruktion:",
			"## Nicht tun",
			"- Keine unbounded JSON-Objekte in Gateway, Browser Parse, React Query oder UI-State.",
			"## Acceptance",
			"- Vor PR: relevante Tests + Browser/CDP-Validierung mit großer Session ausführen.",
			"x".repeat(16 * 1024),
		].join("\n");
		assert.ok(Buffer.byteLength(output, "utf8") < TRACE_V2_INLINE_TRANSCRIPT_PAYLOAD_MAX_BYTES);
		const page = traceTimelinePageFromView({
			trace: traceWithNode({
				type: "assistant.message",
				title: "Agent Message",
				output,
			}),
			payloadStore: store.payloads,
			limit: 120,
		});
		const bytes = Buffer.byteLength(JSON.stringify(page), "utf8");
		assert.ok(bytes < TRACE_V2_TIMELINE_HARD_BYTES, `timeline bytes ${bytes}`);
		assert.equal(page.nodes.length, 1);
		assert.equal(page.nodes[0].inlinePayloads.output, output);
		assert.equal(page.nodes[0].payloadRefs, undefined);
	} finally {
		store.close();
	}
});

test("trace v2 tail pages keep the newest compacted nodes", () => {
	const store = tempStore();
	try {
		const nodes = Array.from({ length: 140 }, (_, index) => ({
			id: `assistant_${index}`,
			piboSessionId: "ps_transcript",
			type: "assistant.message",
			title: "Agent Message",
			status: "done",
			output: index === 139 ? "final guide ## Acceptance" : `older ${index}`,
			children: [],
			orderKey: { sourceRank: 0, turnSeq: index, phaseRank: 8 },
		}));
		const page = traceTimelinePageFromView({
			trace: {
				piboSessionId: "ps_transcript",
				piSessionId: "pi_transcript",
				title: "Transcript",
				version: "v1",
				eventCount: 140,
				pageSize: 100,
				firstEventSequence: 41,
				lastEventSequence: 140,
				nextBeforeSequence: 41,
				hasOlderEvents: true,
				rawEvents: [],
				nodes,
			},
			payloadStore: store.payloads,
			limit: 100,
			fromTail: true,
		});
		assert.equal(page.nodes.length, 100);
		assert.equal(page.nodes[0].nodeId, "assistant_40");
		assert.equal(page.nodes.at(-1).nodeId, "assistant_139");
		assert.equal(page.nodes.at(-1).inlinePayloads.output, "final guide ## Acceptance");
	} finally {
		store.close();
	}
});

test("trace v2 origin tail pages can continue through transcript history", () => {
	const store = tempStore();
	try {
		const nodes = Array.from({ length: 6 }, (_, index) => ({
			id: `transcript_${index}`,
			piboSessionId: "ps_transcript",
			type: index === 0 ? "user.message" : "assistant.message",
			title: index === 0 ? "User Message" : "Agent Message",
			status: "done",
			output: `message ${index}`,
			source: "transcript",
			startedAt: `2026-06-22T15:4${index}:00.000Z`,
			children: [],
			orderKey: { sourceRank: 0, turnSeq: index, phaseRank: index === 0 ? 0 : 8 },
		}));
		const page = traceTimelinePageFromView({
			trace: {
				piboSessionId: "ps_transcript",
				piSessionId: "pi_transcript",
				title: "Transcript",
				version: "v1",
				eventCount: 8,
				pageSize: 4,
				firstEventSequence: 8,
				lastEventSequence: 57,
				nextBeforeSequence: 8,
				hasOlderEvents: true,
				rawEvents: [],
				nodes,
			},
			payloadStore: store.payloads,
			limit: 4,
			fromTail: true,
			transcriptTailCursor: "transcript:12345:MjAyNi0wNi0yMlQxNTo0MjowMC4wMDBa",
		});

		assert.equal(page.nodes.length, 4);
		assert.equal(page.nodes[0].nodeId, "transcript_2");
		assert.equal(page.cursor.hasOlder, true);
		assert.equal(page.cursor.before, "transcript:12345:MjAyNi0wNi0yMlQxNTo0MjowMC4wMDBa");
		assert.equal(page.nextBeforeCursor, "transcript:12345:MjAyNi0wNi0yMlQxNTo0MjowMC4wMDBa");
		assert.equal(page.nextBeforeSequence, undefined);
	} finally {
		store.close();
	}
});

test("trace v2 tail pages keep transcript nodes when event-log nodes exist", () => {
	const store = tempStore();
	try {
		const trace = buildTraceViewFromEvents({
			session: { id: "ps_transcript", piSessionId: "pi_transcript", title: "Transcript" },
			status: "idle",
			transcriptEntries: [
				{
					id: "entry-user-1",
					type: "message",
					timestamp: "2026-07-05T12:00:00.000Z",
					message: { role: "user", content: [{ type: "text", text: "original user request" }] },
				},
				{
					id: "entry-assistant-1",
					type: "message",
					timestamp: "2026-07-05T12:00:01.000Z",
					message: { role: "assistant", content: [{ type: "text", text: "persisted transcript answer" }] },
				},
			],
			events: [
				storedEvent(42, {
					type: "execution_result",
					eventId: "cmd-status",
					action: "status",
					result: { ok: true },
				}),
			],
		});
		const page = traceTimelinePageFromView({
			trace: {
				...trace,
				eventCount: 42,
				pageSize: 50,
				lastEventSequence: 42,
				nextBeforeSequence: 40,
				hasOlderEvents: true,
			},
			payloadStore: store.payloads,
			limit: 50,
			fromTail: true,
			transcriptTailCursor: "transcript:12345:MjAyNi0wNy0wNVQxMjowMDowMC4wMDBa",
		});

		assert.ok(page.nodes.some((node) => node.source === "transcript" && node.inlinePayloads?.output === "persisted transcript answer"));
		assert.ok(page.nodes.some((node) => node.source === "event-log" && node.title === "status"));
		assert.equal(page.nextBeforeCursor, "transcript:12345:MjAyNi0wNy0wNVQxMjowMDowMC4wMDBa");
		assert.equal(page.nextBeforeSequence, undefined);
	} finally {
		store.close();
	}
});

test("trace v2 timeline does not duplicate fully inlined small tool payloads", () => {
	const store = tempStore();
	try {
		const output = "first line\n" + "small-output ".repeat(20);
		assert.ok(Buffer.byteLength(output, "utf8") < 4096);
		const page = traceTimelinePageFromView({
			trace: largeTrace(output),
			payloadStore: store.payloads,
			limit: 120,
		});
		assert.equal(page.nodes.length, 1);
		assert.ok(page.nodes[0].preview.truncated);
		assert.deepEqual(page.nodes[0].inlinePayloads.input, { command: "generate-large-output" });
		assert.equal(page.nodes[0].inlinePayloads.output, output);
		assert.equal(page.nodes[0].payloadRefs, undefined);
	} finally {
		store.close();
	}
});

test("trace v2 raw events are separate and bounded", () => {
	const store = tempStore();
	try {
		const event = {
			id: "raw_1",
			piboSessionId: "ps_large",
			eventSequence: 1,
			type: "tool_execution_finished",
			createdAt: "2026-07-04T00:00:00.000Z",
			payload: { type: "tool_execution_finished", result: "y".repeat(10 * 1024 * 1024) },
		};
		const page = traceRawEventsPageFromEvents({
			piboSessionId: "ps_large",
			events: [event],
			payloadStore: store.payloads,
			limit: 80,
		});
		const bytes = Buffer.byteLength(JSON.stringify(page), "utf8");
		assert.ok(bytes < TRACE_V2_TIMELINE_HARD_BYTES, `raw event page bytes ${bytes}`);
		assert.equal(page.events.length, 1);
		assert.equal(page.events[0].payload.truncated, true);
		assert.ok(page.events[0].payload.payloadRef.ref);
	} finally {
		store.close();
	}
});

test("large trace payloads are stored without synchronous gzip compression", () => {
	const store = tempStore();
	try {
		const payload = store.payloads.writePayload({
			value: "z".repeat(2 * 1024 * 1024),
			contentType: "text/plain; charset=utf-8",
			retentionClass: "trace_event",
		});
		assert.equal(payload.encoding, "identity");
		assert.equal(payload.compressedByteSize, undefined);
		assert.equal(Buffer.from(store.payloads.readPayloadBytes(payload.id)).byteLength, payload.byteSize);
	} finally {
		store.close();
	}
});
