import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeWebAnnotationAttachmentIds,
	renderAttachedWebAnnotations,
	serializeWebAnnotationAttachment,
} from "../dist/web-annotations/attachments.js";

function annotation(overrides = {}) {
	return {
		id: "ann_1",
		ownerScope: "user:a",
		piboSessionId: "ps_a",
		status: "open",
		note: "Make <this> wider and align it with the footer",
		url: "http://localhost:3000/settings",
		targetKind: "element",
		viewport: { width: 1280, height: 720 },
		target: {
			kind: "element",
			label: "button Save changes",
			selector: "[data-testid=save]",
			text: "Save changes",
			htmlHint: "<button data-secret=\"abc\" class=\"primary\">Save changes</button>",
			boundingBox: { x: 10, y: 20, width: 140, height: 32 },
			sourceHints: [{ kind: "test-id", confidence: "high", id: "save" }],
		},
		createdAt: "2026-05-17T00:00:00.000Z",
		...overrides,
	};
}

test("web annotation attachment ids are bounded and unique", () => {
	assert.deepEqual(normalizeWebAnnotationAttachmentIds([" ann_1 ", "ann_1", "ann_2"]), ["ann_1", "ann_2"]);
	assert.throws(() => normalizeWebAnnotationAttachmentIds(["a", "b", "c", "d", "e", "f"]), /At most 5/);
	assert.throws(() => normalizeWebAnnotationAttachmentIds(["ann", 1]), /entries must be strings/);
});

test("web annotation message attachments are compact bounded summaries", () => {
	const summary = serializeWebAnnotationAttachment(annotation({ note: "x".repeat(500) }));
	assert.equal(summary.id, "ann_1");
	assert.equal(summary.targetKind, "element");
	assert.equal(summary.label, "button Save changes");
	assert.match(summary.sourceHint, /save/);
	assert.match(summary.position, /x10 y20 140x32/);
	assert.equal(summary.note.length, 400);
});

test("attached web annotation context escapes html and omits screenshots", () => {
	const block = renderAttachedWebAnnotations([annotation({ screenshotRef: { path: "/tmp/screen.png" } })]);
	assert.match(block, /^<attached-web-annotations>/);
	assert.match(block, /ann_1/);
	assert.match(block, /selector: \[data-testid=save\]/);
	assert.match(block, /htmlHint: &lt;button/);
	assert.match(block, /comment: Make &lt;this&gt; wider/);
	assert.doesNotMatch(block, /screen\.png/);
});
