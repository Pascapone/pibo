import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import {
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

test("trace v2 timeline gives truncated small tool previews payload refs", () => {
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
		assert.ok(page.nodes[0].payloadRefs.output);
		assert.equal(page.nodes[0].payloadRefs.output.byteLength, Buffer.byteLength(output, "utf8"));

		const chunk = readTracePayloadChunk({
			payloadStore: store.payloads,
			ref: page.nodes[0].payloadRefs.output.ref,
			offset: 0,
			limit: 4096,
		});
		assert.ok(chunk);
		assert.equal(chunk.data, output);
		assert.equal(chunk.hasMore, false);
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
