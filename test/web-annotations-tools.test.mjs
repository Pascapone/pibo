import assert from "node:assert/strict";
import test from "node:test";
import { WebAnnotationStore } from "../dist/web-annotations/store.js";
import { createWebAnnotationToolProfiles } from "../dist/web-annotations/tools.js";

function createAnnotationInput(overrides = {}) {
	return {
		piboSessionId: "ps_a",
		piboRoomId: "room_a",
		bindingId: "binding-a",
		note: "Make this wider",
		url: "http://localhost:3000/settings",
		title: "Settings",
		targetId: "target-a",
		targetKind: "element",
		viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
		target: {
			kind: "element",
			label: "button Save",
			selector: "[data-testid=\"save\"]",
			domPath: "body > button",
			fullDomPath: "html > body > main > button:nth-of-type(1)",
			text: "Save changes",
			htmlHint: "<button data-testid=\"save\" class=\"primary\">",
			boundingBox: { x: 10, y: 20, width: 100, height: 40 },
			sourceHints: [{ kind: "test-id", confidence: "high", id: "save" }],
		},
		...overrides,
	};
}

function createToolMap(store, context = { piboSessionId: "ps_a", piboRoomId: "room_a" }) {
	return new Map(createWebAnnotationToolProfiles({ store }).map((profile) => [profile.name, profile.createDefinition(context)]));
}

async function execute(tool, params = {}) {
	const result = await tool.execute("tool-call-1", params);
	return result;
}

test("annotation list and get tools derive app context/session from runtime context and bound output", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		store.createAnnotation(createAnnotationInput({ id: "ann_visible", note: "v".repeat(400) }), new Date("2026-05-16T10:00:00.000Z"));
		store.createAnnotation(createAnnotationInput({ id: "ann_second_visible" }), new Date("2026-05-16T10:01:00.000Z"));
		store.createAnnotation(createAnnotationInput({ id: "ann_other_session", piboSessionId: "ps_b" }), new Date("2026-05-16T10:02:00.000Z"));
		const tools = createToolMap(store);

		const list = await execute(tools.get("web_annotations_list"), { limit: 10 });
		assert.equal(list.details.ok, true);
		assert.deepEqual(list.details.annotations.map((annotation) => annotation.id), ["ann_second_visible", "ann_visible"]);
		assert.ok(list.details.annotations.find((annotation) => annotation.id === "ann_visible").note.endsWith("…"));

		const detail = await execute(tools.get("web_annotations_get"), { annotationId: "ann_visible" });
		assert.equal(detail.details.ok, true);
		assert.equal(detail.details.annotation.target.sourceHints[0].kind, "test-id");
		assert.equal(detail.details.annotation.target.htmlHint.includes("<button"), true);

		const sameApp = await execute(createToolMap(store, { piboSessionId: "ps_a" }).get("web_annotations_get"), { annotationId: "ann_visible" });
		assert.equal(sameApp.details.ok, true);
		assert.equal(sameApp.details.annotation.id, "ann_visible");
	} finally {
		store.close();
	}
});

test("annotation lifecycle tools enforce valid terminal transitions with app context access", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		store.createAnnotation(createAnnotationInput({ id: "ann_lifecycle" }), new Date("2026-05-16T10:00:00.000Z"));
		store.createAnnotation(createAnnotationInput({ id: "ann_applying", status: "applying" }), new Date("2026-05-16T10:00:01.000Z"));
		const tools = createToolMap(store);

		const acknowledged = await execute(tools.get("web_annotations_acknowledge"), { annotationId: "ann_lifecycle", summary: "starting" });
		assert.equal(acknowledged.details.annotation.status, "acknowledged");
		assert.equal(store.getAnnotation("ps_a", "ann_lifecycle").summary, "starting");

		const resolved = await execute(tools.get("web_annotations_resolve"), { annotationId: "ann_lifecycle", summary: "fixed" });
		assert.equal(resolved.details.annotation.status, "resolved");
		assert.equal(store.getAnnotation("ps_a", "ann_lifecycle").resolvedBy, "agent");

		const repeat = await execute(tools.get("web_annotations_acknowledge"), { annotationId: "ann_lifecycle" });
		assert.equal(repeat.isError, true);
		assert.match(repeat.content[0].text, /already resolved/);

		const terminalDismiss = await execute(createToolMap(store, { piboSessionId: "ps_a" }).get("web_annotations_dismiss"), { annotationId: "ann_lifecycle", reason: "already done" });
		assert.equal(terminalDismiss.isError, true);
		assert.equal(store.getAnnotation("ps_a", "ann_lifecycle").status, "resolved");

		const applyingDismiss = await execute(tools.get("web_annotations_dismiss"), { annotationId: "ann_applying", reason: "not actionable" });
		assert.equal(applyingDismiss.isError, true);
		assert.match(applyingDismiss.content[0].text, /applying annotations cannot be dismissed/);
		assert.equal(store.getAnnotation("ps_a", "ann_applying").status, "applying");
	} finally {
		store.close();
	}
});

test("annotation tools keep explicit session access session-scoped and app-global", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		store.createAnnotation(createAnnotationInput({ id: "ann_session_a" }), new Date("2026-05-16T10:00:00.000Z"));
		store.createAnnotation(createAnnotationInput({ id: "ann_session_b", piboSessionId: "ps_b" }), new Date("2026-05-16T10:01:00.000Z"));
		store.createAnnotation(createAnnotationInput({ id: "ann_second_session_b", piboSessionId: "ps_b" }), new Date("2026-05-16T10:02:00.000Z"));
		const tools = createToolMap(store, { piboSessionId: "ps_a" });

		const defaultList = await execute(tools.get("web_annotations_list"), { limit: 10 });
		assert.deepEqual(defaultList.details.annotations.map((annotation) => annotation.id), ["ann_session_a"]);

		const explicitList = await execute(tools.get("web_annotations_list"), { piboSessionId: "ps_b", limit: 10 });
		assert.deepEqual(explicitList.details.annotations.map((annotation) => annotation.id), ["ann_second_session_b", "ann_session_b"]);

		const explicitSessionGet = await execute(tools.get("web_annotations_get"), { piboSessionId: "ps_b", annotationId: "ann_second_session_b" });
		assert.equal(explicitSessionGet.details.ok, true);
		assert.equal(explicitSessionGet.details.annotation.id, "ann_second_session_b");
	} finally {
		store.close();
	}
});

test("annotation watch returns new annotations or timeout without error", async () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const tools = createToolMap(store);
		const timedOut = await execute(tools.get("web_annotations_watch"), { timeoutMs: 1 });
		assert.equal(timedOut.details.ok, true);
		assert.equal(timedOut.details.timedOut, true);
		assert.deepEqual(timedOut.details.annotations, []);

		setTimeout(() => {
			store.createAnnotation(createAnnotationInput({ id: "ann_watch" }), new Date("2026-05-16T10:00:00.000Z"));
		}, 10);
		const watched = await execute(tools.get("web_annotations_watch"), { timeoutMs: 1000, afterCreatedAt: "2026-05-16T09:59:00.000Z" });
		assert.equal(watched.details.ok, true);
		assert.equal(watched.details.timedOut, false);
		assert.deepEqual(watched.details.annotations.map((annotation) => annotation.id), ["ann_watch"]);
	} finally {
		store.close();
	}
});
