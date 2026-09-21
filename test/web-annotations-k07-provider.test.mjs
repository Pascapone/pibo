import assert from "node:assert/strict";
import test from "node:test";
import {
	WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT,
	normalizeWebAnnotationAttachmentIds,
	prepareWebAnnotationMessageAttachments,
	serializeWebAnnotationAttachment,
} from "../dist/web-annotations/attachments.js";
import { WebAnnotationStore } from "../dist/web-annotations/store.js";
import { webAnnotationsPackageManifest } from "../dist/plugins/default-packages.js";

// C1 provider-side snapshot preparation for K07. Provider scope only: the
// existing annotation record, its JSON snapshot and the attach-time rules.
// No composer, draft store or send-path involvement here; the end-to-end
// provider wiring waits for the integrated D commit (D1 -> I -> C1).

function openStore() {
	return new WebAnnotationStore({ path: ":memory:" });
}

function createSample(store, overrides = {}) {
	return store.createAnnotation({
		id: "wa_snapshot_1",
		piboSessionId: "ps_provider",
		note: "Header overlaps the toolbar",
		url: "https://app.example/board",
		title: "Board",
		targetKind: "text",
		viewport: { width: 1280, height: 800 },
		target: {
			kind: "text",
			label: "Toolbar header",
			selector: "main h1",
			selectedText: "Selected toolbar text",
			boundingBox: { x: 8, y: 8, width: 320, height: 40 },
			sourceHints: [{ kind: "jsx-source", confidence: "high", file: "App.tsx", line: 120 }],
		},
		...overrides,
	});
}

test("provider attachment ids are deduplicated, trimmed and bounded", () => {
	// Current provider limit, pinned as regression. Future limit decisions are D-owned.
	assert.equal(WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT, 5);
	assert.deepEqual(normalizeWebAnnotationAttachmentIds(undefined), []);
	assert.deepEqual(normalizeWebAnnotationAttachmentIds([" wa_1 ", "wa_1", "wa_2"]), ["wa_1", "wa_2"]);
	assert.throws(() => normalizeWebAnnotationAttachmentIds("wa_1"), /must be an array/);
	assert.throws(() => normalizeWebAnnotationAttachmentIds(["wa_1", 7]), /must be strings/);
	assert.throws(() => normalizeWebAnnotationAttachmentIds(["  "]), /non-empty/);
	assert.throws(() => normalizeWebAnnotationAttachmentIds([`wa_${"x".repeat(160)}`]), /too long/);
	assert.throws(
		() => normalizeWebAnnotationAttachmentIds(["a", "b", "c", "d", "e", "f"]),
		/At most 5 web annotations can be attached/,
	);
});

test("serialized attachment is a JSON-clean fixed capture of the record", () => {
	const store = openStore();
	try {
		const annotation = createSample(store);
		const attachment = serializeWebAnnotationAttachment(annotation);

		assert.equal(attachment.id, "wa_snapshot_1");
		assert.equal(attachment.status, "open");
		assert.equal(attachment.targetKind, "text");
		assert.equal(attachment.piboSessionId, "ps_provider");
		assert.equal(attachment.note, "Header overlaps the toolbar");
		assert.equal(attachment.text, "Selected toolbar text");
		assert.equal(attachment.selector, "main h1");
		assert.equal(attachment.label, "Toolbar header");
		assert.equal(attachment.position, "x8 y8 320x40");
		assert.deepEqual(attachment.sourceHints, ["App.tsx:120 · high · jsx-source"]);

		assert.deepEqual(JSON.parse(JSON.stringify(attachment)), {
			id: "wa_snapshot_1",
			status: "open",
			targetKind: "text",
			piboSessionId: "ps_provider",
			url: "https://app.example/board",
			note: "Header overlaps the toolbar",
			createdAt: annotation.createdAt,
			label: "Toolbar header",
			selector: "main h1",
			sourceHint: "App.tsx:120 · high · jsx-source",
			sourceHints: ["App.tsx:120 · high · jsx-source"],
			position: "x8 y8 320x40",
			text: "Selected toolbar text",
		});

		annotation.note = "mutated after capture";
		annotation.target.selectedText = "mutated text";
		assert.equal(attachment.note, "Header overlaps the toolbar");
		assert.equal(attachment.text, "Selected toolbar text");
	} finally {
		store.close();
	}
});

test("serialized attachment truncates long provider fields to fixed bounds", () => {
	const store = openStore();
	try {
		const annotation = createSample(store, {
			url: `https://app.example/${"p".repeat(400)}`,
			note: "n".repeat(500),
			target: { kind: "text", selector: "s".repeat(400), selectedText: "t".repeat(400) },
		});
		const attachment = serializeWebAnnotationAttachment(annotation);
		assert.ok(attachment.url.length <= 240);
		assert.ok(attachment.url.endsWith("…"));
		assert.ok(attachment.note.length <= 400);
		assert.ok(attachment.note.endsWith("…"));
		assert.ok(attachment.selector.length <= 220);
		assert.ok(attachment.text.length <= 220);
	} finally {
		store.close();
	}
});

test("provider view and terminal-card registrations pin renderer and fallback metadata", () => {
	const manifest = webAnnotationsPackageManifest();
	const view = manifest.contributions.find((entry) => entry.id === "annotations");
	assert.equal(view.kind, "view");
	assert.equal(view.view.exportName, "WebAnnotationsView");
	assert.equal(view.view.presentation, "workspace");
	assert.equal(view.view.mount, "keep-alive");
	assert.deepEqual(view.view.subviews.map((entry) => entry.id), ["annotations", "settings", "context"]);
	const terminal = manifest.contributions.find((entry) => entry.kind === "terminal-card");
	assert.equal(terminal.title, "Web Annotation");
	assert.deepEqual(terminal.metadata, { renderer: "web-annotation", fallback: "Web annotation unavailable" });
});

// Tile sizes and grid placement have no provider-side code today: the K07 grid,
// clamping and overlay rules are owned by the D core draft (D1 -> I -> C1).
// Acceptance for that path is the same-commit Core+provider end-to-end test
// (AT-03/AT-04 rendering incl. overflow pages), not an invented local grid API.

test("prepare resolves real store records and rejects resolved or missing ones", () => {
	const store = openStore();
	try {
		createSample(store);
		const prepared = prepareWebAnnotationMessageAttachments({
			store,
			piboSessionId: "ps_provider",
			messageText: "Please check this.",
			attachmentIds: ["wa_snapshot_1"],
		});
		assert.deepEqual(prepared.ids, ["wa_snapshot_1"]);
		assert.equal(prepared.attachments.length, 1);
		assert.equal(prepared.attachments[0].id, "wa_snapshot_1");
		assert.ok(prepared.modelContext.includes("wa_snapshot_1"));
		assert.ok(prepared.messageText.startsWith("Please check this.\n\n<attached-web-annotations>"));

		const empty = prepareWebAnnotationMessageAttachments({
			store,
			piboSessionId: "ps_provider",
			messageText: "Nothing attached.",
			attachmentIds: [],
		});
		assert.deepEqual(empty.attachments, []);
		assert.equal(empty.modelContext, "");
		assert.equal(empty.messageText, "Nothing attached.");

		assert.throws(
			() => prepareWebAnnotationMessageAttachments({ store, piboSessionId: "ps_provider", messageText: "x", attachmentIds: ["wa_missing"] }),
			/is not available in this app/,
		);
		store.createAnnotation({
			id: "wa_resolved_1",
			piboSessionId: "ps_provider",
			status: "resolved",
			note: "done",
			url: "https://app.example/board",
			targetKind: "text",
			viewport: { width: 1280, height: 800 },
		});
		assert.throws(
			() => prepareWebAnnotationMessageAttachments({ store, piboSessionId: "ps_provider", messageText: "x", attachmentIds: ["wa_resolved_1"] }),
			/because it is resolved/,
		);
	} finally {
		store.close();
	}
});
