import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeWebAnnotationAttachmentIds,
	prepareWebAnnotationMessageAttachments,
	renderAttachedWebAnnotations,
	serializeWebAnnotationAttachment,
} from "../dist/web-annotations/attachments.js";
import { WebAnnotationStore } from "../dist/web-annotations/store.js";

function annotation(overrides = {}) {
	return {
		id: "ann_1",
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

test("attached web annotation context highlights Pibo component and row metadata", () => {
	const sourceHints = [
		{ kind: "pibo-markdown", confidence: "high", id: "li", component: "MarkdownRenderer", raw: { tagName: "li" } },
		{ kind: "pibo-terminal-row", confidence: "high", id: "row_1", component: "TerminalRow", raw: { rowKind: "message.assistant", eventId: "evt_1", traceNodeId: "node_1" } },
		{ kind: "test-id", confidence: "high", id: "virtuoso-item-list" },
	];
	const block = renderAttachedWebAnnotations([annotation({ target: { ...annotation().target, sourceHints } })]);
	assert.match(block, /primaryTarget: MarkdownRenderer li/);
	assert.match(block, /piboContext: component=MarkdownRenderer/);
	assert.match(block, /rowKind=message\.assistant/);
	assert.match(block, /eventId=evt_1/);
	assert.match(block, /sourceHints: .*TerminalRow/);

	const summary = serializeWebAnnotationAttachment(annotation({ target: { ...annotation().target, sourceHints } }));
	assert.equal(summary.primaryTarget, "MarkdownRenderer li");
	assert.match(summary.piboContext, /rowKind=message\.assistant/);
	assert.ok(summary.sourceHints?.some((hint) => hint.includes("TerminalRow")));
});

test("web annotation composer attachments reject stale and terminal annotation ids", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		store.createAnnotation(annotation({ id: "ann_open" }));
		store.createAnnotation(annotation({ id: "ann_other_session", piboSessionId: "ps_b" }));
		store.createAnnotation(annotation({ id: "ann_resolved", status: "resolved" }));

		const prepared = prepareWebAnnotationMessageAttachments({
			store,
			piboSessionId: "ps_a",
			messageText: "Please fix this",
			attachmentIds: ["ann_open"],
		});
		assert.deepEqual(prepared.ids, ["ann_open"]);
		assert.equal(prepared.attachments[0].id, "ann_open");
		assert.match(prepared.messageText, /<attached-web-annotations>/);

		assert.throws(
			() => prepareWebAnnotationMessageAttachments({ store, piboSessionId: "ps_a", messageText: "x", attachmentIds: ["ann_missing"] }),
			/not available in this app/,
		);
		const crossSession = prepareWebAnnotationMessageAttachments({ store, piboSessionId: "ps_a", messageText: "x", attachmentIds: ["ann_other_session"] });
		assert.equal(crossSession.attachments[0].piboSessionId, "ps_b");
		assert.match(crossSession.modelContext, /sourceSession: ps_b/);
		assert.throws(
			() => prepareWebAnnotationMessageAttachments({ store, piboSessionId: "ps_a", messageText: "x", attachmentIds: ["ann_resolved"] }),
			/cannot be attached because it is resolved/,
		);
	} finally {
		store.close();
	}
});
