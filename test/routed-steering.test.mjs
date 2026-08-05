import assert from "node:assert/strict";
import test from "node:test";
import { PiboSteeringUnavailableError } from "../dist/core/events.js";
import { RoutedSession } from "../dist/core/routed-session.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";

async function waitUntil(predicate, message) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.fail(message);
}

function createSteeringHarness() {
	let releasePrompt;
	let isStreaming = false;
	const events = [];
	const order = [];
	const session = {
		agent: { async continue() {} },
		model: undefined,
		settingsManager: {
			getCompactionSettings() { return { enabled: false }; },
			getRetrySettings() { return { enabled: true, maxRetries: 3, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 60_000 }; },
		},
		subscribe() { return () => {}; },
		async prompt(text) {
			order.push(`prompt:${text}`);
			isStreaming = true;
			await new Promise((resolve) => { releasePrompt = resolve; });
			isStreaming = false;
		},
		async steer(text) {
			assert.equal(isStreaming, true, "steering must target an active Pi run");
			order.push(`steer:${text}`);
		},
		async abort() {},
		get isStreaming() { return isStreaming; },
		supportsThinking() { return false; },
		getActiveToolNames() { return []; },
		getContextUsage() { return null; },
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getPiSessionId() { return "pi-steering-test"; },
			getSessionFile() { return undefined; },
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {},
	};
	const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
	const routed = new RoutedSession("route:steering", runtime, (event) => events.push(event), registry, false);
	return {
		routed,
		events,
		order,
		releasePrompt() { releasePrompt?.(); },
	};
}

test("routed sessions support steering and queued follow-up turns at the same time", async () => {
	const harness = createSteeringHarness();
	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:steering", id: "active", text: "active", source: "user" });
	await waitUntil(() => harness.routed.getStatus().streaming, "active message did not start");

	harness.routed.enqueueMessage({ type: "message", piboSessionId: "route:steering", id: "queued", text: "queued", source: "user" });
	const steered = await harness.routed.steerMessage({ type: "message", piboSessionId: "route:steering", id: "steered", text: "steered", source: "user", delivery: "steer" });

	assert.deepEqual(steered, {
		type: "message_steered",
		piboSessionId: "route:steering",
		eventId: "steered",
		activeEventId: "active",
		text: "steered",
		source: "user",
	});
	assert.equal(harness.routed.getStatus().queuedMessages, 1, "steering must not consume or duplicate the routed queue");
	assert.deepEqual(harness.order, ["prompt:active", "steer:steered"]);

	harness.releasePrompt();
	await waitUntil(() => harness.order.includes("prompt:queued"), "queued turn did not start after the active turn");
	harness.releasePrompt();
	await waitUntil(() => harness.events.some((event) => event.type === "message_finished" && event.eventId === "queued"), "queued turn did not finish");
	assert.deepEqual(harness.order, ["prompt:active", "steer:steered", "prompt:queued"]);
});

test("steering rejects idle sessions instead of silently queueing", async () => {
	const harness = createSteeringHarness();
	await assert.rejects(
		() => harness.routed.steerMessage({ type: "message", piboSessionId: "route:steering", id: "idle-steer", text: "too late", source: "user", delivery: "steer" }),
		(error) => error instanceof PiboSteeringUnavailableError,
	);
	assert.equal(harness.routed.getStatus().queuedMessages, 0);
	assert.deepEqual(harness.order, []);
});
