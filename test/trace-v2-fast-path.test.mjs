import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { buildTraceViewFromEvents } from "./helpers/pi-history.mjs";
import {
	TRACE_V2_INLINE_TRANSCRIPT_PAYLOAD_MAX_BYTES,
	TRACE_V2_PAYLOAD_DEFAULT_LIMIT_BYTES,
	TRACE_V2_TIMELINE_HARD_BYTES,
	TRACE_IMAGE_MAX_COUNT,
	TRACE_IMAGE_MAX_DECODED_BYTES,
	TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES,
	parseTracePayloadRef,
	readTraceImagePayload,
	readTracePayloadChunk,
	tracePayloadRefForStoredPayload,
	traceRawEventsPageFromEvents,
	traceTimelinePageFromView,
} from "../dist/apps/chat/trace-v2.js";

function tempStore() {
	const dir = mkdtempSync(join(tmpdir(), "pibo-trace-v2-"));
	return new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });
}

function tempStoreWithPaths() {
	const dir = mkdtempSync(join(tmpdir(), "pibo-trace-v2-image-"));
	const payloadRoot = join(dir, "payloads");
	return {
		dir,
		payloadRoot,
		databasePath: join(dir, "pibo.sqlite"),
		store: new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: payloadRoot }),
	};
}

function pngBytes(size = 32, fill = 7) {
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(Math.max(0, size - 8), fill),
	]);
}

function writeStoredImageRef(store, value, nodeId = "tool:call-image", piboSessionId = "ps_image") {
	const payload = store.payloads.writePayload({ value, contentType: "application/json", retentionClass: "trace_event" });
	const ref = tracePayloadRefForStoredPayload({
		payloadStore: store.payloads,
		piboSessionId,
		payloadId: payload.id,
		nodeId,
		payloadKind: "output",
	});
	assert.ok(ref);
	return { payload, ref };
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

test("trace image payloads bind exact bytes to one session, node, and output ref", () => {
	const store = tempStore();
	try {
		const bytes = pngBytes(9 * 1024);
		const { ref } = writeStoredImageRef(store, {
			content: [{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" }],
		});
		const parsed = parseTracePayloadRef(ref.ref);
		assert.deepEqual(parsed, {
			piboSessionId: "ps_image",
			payloadId: parsed.payloadId,
			nodeId: "tool:call-image",
			payloadKind: "output",
		});
		const result = readTraceImagePayload({ payloadStore: store.payloads, ref: ref.ref, nodeId: "tool:call-image", index: 0 });
		assert.equal(result.ok, true);
		assert.equal(result.image.mimeType, "image/png");
		assert.deepEqual(Buffer.from(result.image.bytes), bytes);
		assert.deepEqual(
			readTraceImagePayload({ payloadStore: store.payloads, ref: ref.ref, nodeId: "tool:another-call", index: 0 }),
			{ ok: false, reason: "invalid-ref" },
		);
	} finally {
		store.close();
	}
});

test("trace image decoding rejects malformed base64, MIME mismatches, SVG, and HTML", () => {
	const store = tempStore();
	try {
		const cases = [
			{
				name: "malformed base64",
				value: { type: "image", data: "%%%not-base64%%%", mimeType: "image/png" },
				reason: "malformed-base64",
			},
			{
				name: "declared MIME mismatch",
				value: { type: "image", data: pngBytes().toString("base64"), mimeType: "image/jpeg" },
				reason: "mime-mismatch",
			},
			{
				name: "SVG",
				value: { type: "image", data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>").toString("base64"), mimeType: "image/svg+xml" },
				reason: "unsupported-image",
			},
			{
				name: "HTML",
				value: { type: "image", data: `data:text/html;base64,${Buffer.from("<html><script/></html>").toString("base64")}` },
				reason: "unsupported-image",
			},
		];
		for (const [index, candidate] of cases.entries()) {
			const nodeId = `tool:invalid-${index}`;
			const { ref } = writeStoredImageRef(store, candidate.value, nodeId);
			assert.deepEqual(
				readTraceImagePayload({ payloadStore: store.payloads, ref: ref.ref, nodeId, index: 0 }),
				{ ok: false, reason: candidate.reason },
				candidate.name,
			);
		}
	} finally {
		store.close();
	}
});

test("trace image reads enforce decoded, stored-payload, and multi-image bounds", () => {
	const store = tempStore();
	try {
		const oversizedImage = Buffer.concat([
			pngBytes(8),
			Buffer.alloc(TRACE_IMAGE_MAX_DECODED_BYTES - 7),
		]);
		const oversized = writeStoredImageRef(store, { type: "image", data: oversizedImage.toString("base64"), mimeType: "image/png" }, "tool:oversized");
		assert.deepEqual(
			readTraceImagePayload({ payloadStore: store.payloads, ref: oversized.ref.ref, nodeId: "tool:oversized", index: 0 }),
			{ ok: false, reason: "image-too-large" },
		);

		const overBudgetPayload = writeStoredImageRef(store, {
			padding: "x".repeat(TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES),
			content: [{ type: "image", data: pngBytes().toString("base64"), mimeType: "image/png" }],
		}, "tool:payload-oversized");
		assert.deepEqual(
			readTraceImagePayload({ payloadStore: store.payloads, ref: overBudgetPayload.ref.ref, nodeId: "tool:payload-oversized", index: 0 }),
			{ ok: false, reason: "payload-too-large" },
		);

		const images = Array.from({ length: TRACE_IMAGE_MAX_COUNT + 4 }, (_, index) => ({
			type: "image",
			data: pngBytes(32, index).toString("base64"),
			mimeType: "image/png",
		}));
		const bounded = writeStoredImageRef(store, { content: images }, "tool:many-images");
		const last = readTraceImagePayload({ payloadStore: store.payloads, ref: bounded.ref.ref, nodeId: "tool:many-images", index: TRACE_IMAGE_MAX_COUNT - 1 });
		assert.equal(last.ok, true);
		assert.equal(last.imageCount, TRACE_IMAGE_MAX_COUNT);
		assert.deepEqual(
			readTraceImagePayload({ payloadStore: store.payloads, ref: bounded.ref.ref, nodeId: "tool:many-images", index: TRACE_IMAGE_MAX_COUNT }),
			{ ok: false, reason: "index-out-of-range" },
		);
	} finally {
		store.close();
	}
});

test("trace image exact refs fail closed for missing and corrupt payloads", () => {
	const fixture = tempStoreWithPaths();
	try {
		const missing = writeStoredImageRef(fixture.store, { type: "image", data: pngBytes().toString("base64"), mimeType: "image/png" }, "tool:missing");
		fixture.store.db.prepare("DELETE FROM payloads WHERE id = ?").run(missing.payload.id);
		assert.deepEqual(
			readTraceImagePayload({ payloadStore: fixture.store.payloads, ref: missing.ref.ref, nodeId: "tool:missing", index: 0 }),
			{ ok: false, reason: "missing-payload" },
		);

		const corrupt = writeStoredImageRef(fixture.store, { type: "image", data: pngBytes().toString("base64"), mimeType: "image/png" }, "tool:corrupt");
		writeFileSync(join(fixture.payloadRoot, corrupt.payload.storagePath), Buffer.from("corrupt"));
		assert.deepEqual(
			readTraceImagePayload({ payloadStore: fixture.store.payloads, ref: corrupt.ref.ref, nodeId: "tool:corrupt", index: 0 }),
			{ ok: false, reason: "corrupt-payload" },
		);
	} finally {
		fixture.store.close();
		rmSync(fixture.dir, { recursive: true, force: true });
	}
});

test("trace image refs survive compaction events and store restart readback", () => {
	const fixture = tempStoreWithPaths();
	const bytes = pngBytes(20 * 1024, 5);
	let ref;
	try {
		const stored = writeStoredImageRef(fixture.store, { content: [{ type: "image", data: bytes.toString("base64"), mimeType: "image/png" }] });
		ref = stored.ref;
		const trace = buildTraceViewFromEvents({
			session: { id: "ps_image", piSessionId: "pi_image", title: "Image restart" },
			events: [
				storedEvent(1, { type: "tool_call", piboSessionId: "ps_image", eventId: "turn-image", toolCallId: "call-image", toolName: "read", args: { path: "/tmp/exact.png" }, argsComplete: true }),
				{ ...storedEvent(2, { type: "tool_execution_finished", piboSessionId: "ps_image", eventId: "turn-image", toolCallId: "call-image", toolName: "read", result: null, isError: false }), storedPayloadRef: ref },
				storedEvent(3, { type: "compaction_start", piboSessionId: "ps_image", eventId: "turn-image", reason: "context" }),
				storedEvent(4, { type: "compaction_end", piboSessionId: "ps_image", eventId: "turn-image", reason: "context", aborted: false }),
			],
		});
		const page = traceTimelinePageFromView({ trace, payloadStore: fixture.store.payloads, limit: 20 });
		const tool = page.nodes.find((node) => node.toolCallId === "call-image");
		assert.deepEqual(tool.payloadRefs.output, ref);
	} finally {
		fixture.store.close();
	}

	const reopened = new PiboDataStore(fixture.databasePath, { payloadRootDir: fixture.payloadRoot });
	try {
		const result = readTraceImagePayload({ payloadStore: reopened.payloads, ref: ref.ref, nodeId: "tool:call-image", index: 0 });
		assert.equal(result.ok, true);
		assert.deepEqual(Buffer.from(result.image.bytes), bytes);
	} finally {
		reopened.close();
		rmSync(fixture.dir, { recursive: true, force: true });
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
