import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStreamingSseHeaderRegressions } from "../dist/debug/web-streaming-benchmark-analysis.js";

const regression = "SSE X-Accel-Buffering header is not no";

function benchmark(headers) {
	return { sse: { requested: true, headers } };
}

test("hosted SSE permits nginx-hidden X-Accel-Buffering when transport gates pass separately", () => {
	assert.deepEqual(
		evaluateStreamingSseHeaderRegressions(benchmark({ server: "nginx/1.28.3" }), "https://pibo.example/apps/chat"),
		[],
	);
});

test("direct application SSE still requires a visible X-Accel-Buffering no header", () => {
	for (const url of [
		"http://127.0.0.1:4788/apps/chat",
		"http://localhost:4788/apps/chat",
		"http://[::1]:4788/apps/chat",
	]) {
		assert.deepEqual(evaluateStreamingSseHeaderRegressions(benchmark({}), url), [regression]);
	}
	assert.deepEqual(
		evaluateStreamingSseHeaderRegressions(benchmark({ "x-accel-buffering": "no" }), "http://127.0.0.1:4788/apps/chat"),
		[],
	);
});

test("an explicitly conflicting visible X-Accel-Buffering value always fails", () => {
	for (const url of ["https://pibo.example/apps/chat", "http://127.0.0.1:4788/apps/chat"]) {
		assert.deepEqual(
			evaluateStreamingSseHeaderRegressions(benchmark({ "x-accel-buffering": "yes" }), url),
			[regression],
		);
	}
});
