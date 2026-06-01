import assert from "node:assert/strict";
import test from "node:test";
import { PRE_CUTOVER_LEGACY_OWNER_SCOPE } from "../dist/owner-scope-compat.js";
import { renderAttachedWebAnnotations, WEB_ANNOTATION_LIMITS, WebAnnotationStore } from "../dist/web-annotations/index.js";

function createAnnotationInput(overrides = {}) {
	return {
		ownerScope: "user:a",
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
			boundingBox: { x: 10, y: 20, width: 100, height: 40 },
			sourceHints: [{ kind: "test-id", confidence: "high", id: "save" }],
		},
		...overrides,
	};
}

test("web annotation bindings persist by shared app and session without deleting annotations", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const binding = store.createBinding({
			id: "binding-a",
			ownerScope: "user:a",
			piboSessionId: "ps_a",
			piboRoomId: "room_a",
			url: "http://localhost:3000/settings",
			targetId: "target-a",
		}, new Date("2026-05-16T10:00:00.000Z"));
		assert.equal(binding.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
		assert.equal(binding.state, "active");

		const injected = store.patchBinding("user:a", "ps_a", binding.id, {
			state: "injected",
			lastInjectedAt: "2026-05-16T10:01:00.000Z",
		});
		assert.equal(injected?.state, "injected");
		assert.equal(injected?.lastInjectedAt, "2026-05-16T10:01:00.000Z");

		store.createAnnotation(createAnnotationInput(), new Date("2026-05-16T10:02:00.000Z"));
		assert.equal(store.removeBinding("user:a", "ps_a", binding.id), true);
		assert.equal(store.listBindings({ ownerScope: "user:a", piboSessionId: "ps_a" }).length, 0);
		assert.equal(store.listAnnotations({ ownerScope: "user:a", piboSessionId: "ps_a" }).length, 1);
	} finally {
		store.close();
	}
});

test("web annotations list newest first with status and bounded limits", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const older = store.createAnnotation(createAnnotationInput({ id: "ann-old", note: "older" }), new Date("2026-05-16T10:00:00.000Z"));
		const newer = store.createAnnotation(createAnnotationInput({ id: "ann-new", note: "newer", status: "acknowledged" }), new Date("2026-05-16T10:05:00.000Z"));
		assert.deepEqual(store.listAnnotations({ ownerScope: "user:a", piboSessionId: "ps_a" }).map((annotation) => annotation.id), [newer.id, older.id]);
		assert.deepEqual(store.listAnnotations({ ownerScope: "user:a", piboSessionId: "ps_a", status: "open" }).map((annotation) => annotation.id), [older.id]);
		assert.deepEqual(store.listAnnotations({ ownerScope: "user:a", piboSessionId: "ps_a", limit: 1 }).map((annotation) => annotation.id), [newer.id]);
	} finally {
		store.close();
	}
});

test("web annotation lifecycle and thread operations validate payloads", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		store.createAnnotation(createAnnotationInput({ id: "ann-life" }), new Date("2026-05-16T10:00:00.000Z"));
		const acknowledged = store.acknowledgeAnnotation("user:a", "ps_a", "ann-life", "starting", new Date("2026-05-16T10:01:00.000Z"));
		assert.equal(acknowledged?.status, "acknowledged");
		assert.equal(acknowledged?.summary, "starting");

		const threaded = store.addThreadMessage({ annotationId: "ann-life", ownerScope: "user:a", piboSessionId: "ps_a", role: "agent", content: "I found it." }, new Date("2026-05-16T10:02:00.000Z"));
		assert.equal(threaded?.thread?.length, 1);
		assert.equal(threaded?.thread?.[0].role, "agent");

		const resolved = store.resolveAnnotation("user:a", "ps_a", "ann-life", "fixed", "agent", new Date("2026-05-16T10:03:00.000Z"));
		assert.equal(resolved?.status, "resolved");
		assert.equal(resolved?.resolvedAt, "2026-05-16T10:03:00.000Z");
		assert.equal(resolved?.resolvedBy, "agent");

		assert.throws(() => store.patchAnnotation("user:a", "ps_a", "ann-life", { status: "not-a-status" }), /Invalid annotation status/);
		assert.throws(() => store.addThreadMessage({ annotationId: "ann-life", ownerScope: "user:a", piboSessionId: "ps_a", role: "agent", content: "" }), /content is required/);
	} finally {
		store.close();
	}
});

test("web annotations normalize oversized and secret-like payloads", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const rawSecret = "sk-abcdefghijklmnopqrstuvwxyz123456";
		const annotation = store.createAnnotation(createAnnotationInput({
			id: "ann-limits",
			note: `Please check token=${rawSecret}`,
			url: `http://localhost:3000/${"x".repeat(3_000)}`,
			target: {
				kind: "element",
				label: "Save button",
				selector: `[data-secret="${rawSecret}"]`,
				text: `visible ${rawSecret} ${"t".repeat(2_000)}`,
				htmlHint: `<button data-token="${rawSecret}">${"H".repeat(3_000)}</button>`,
				classSummary: "c".repeat(2_000),
				sourceHints: Array.from({ length: 20 }, (_, index) => ({
					kind: "test-id",
					confidence: "high",
					id: `hint-${index}`,
					raw: { token: rawSecret, long: "r".repeat(2_000), nested: { value: rawSecret } },
				})),
			},
			screenshotRef: { path: `/tmp/${"screen".repeat(200)}.png`, artifactId: "artifact-1", mimeType: "image/png", width: 100, height: 100 },
		}), new Date("2026-05-16T10:00:00.000Z"));

		assert.equal(annotation.url.length, WEB_ANNOTATION_LIMITS.url);
		assert.equal(annotation.target.text.length, WEB_ANNOTATION_LIMITS.text);
		assert.equal(annotation.target.htmlHint.length, WEB_ANNOTATION_LIMITS.htmlHint);
		assert.equal(annotation.target.classSummary.length, WEB_ANNOTATION_LIMITS.classSummary);
		assert.equal(annotation.target.sourceHints.length, WEB_ANNOTATION_LIMITS.sourceHints);
		assert.equal(annotation.screenshotRef.path.length, WEB_ANNOTATION_LIMITS.screenshotRefText);
		assert.doesNotMatch(annotation.note, /sk-abcdefghijklmnopqrstuvwxyz/);
		assert.match(annotation.note, /\[REDACTED_SECRET\]/);
		assert.doesNotMatch(annotation.target.text, /sk-abcdefghijklmnopqrstuvwxyz/);
		assert.match(annotation.target.sourceHints[0].raw.token, /\[REDACTED_SECRET\]/);

		const threaded = store.addThreadMessage({ annotationId: "ann-limits", ownerScope: "user:a", piboSessionId: "ps_a", role: "human", content: `${rawSecret} ${"m".repeat(3_000)}` });
		assert.equal(threaded.thread[0].content.length, WEB_ANNOTATION_LIMITS.threadMessage);
		assert.doesNotMatch(threaded.thread[0].content, /sk-abcdefghijklmnopqrstuvwxyz/);

		const promptBlock = renderAttachedWebAnnotations([annotation]);
		assert.doesNotMatch(promptBlock, /sk-abcdefghijklmnopqrstuvwxyz/);
		assert.doesNotMatch(promptBlock, /screen/);
	} finally {
		store.close();
	}
});

test("web annotations are app-global across historical owner scopes while staying session-scoped", () => {
	const store = new WebAnnotationStore({ path: ":memory:" });
	try {
		const ownerA = store.createAnnotation(createAnnotationInput({ id: "ann-owner-a" }));
		store.db.exec("ALTER TABLE web_annotations ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'shared:app'");
		const historicalUser = store.createAnnotation(createAnnotationInput({ id: "ann-owner-b", ownerScope: "user:b" }));
		store.db.prepare("UPDATE web_annotations SET owner_scope = ? WHERE id = ?").run("user:historical", historicalUser.id);
		store.createAnnotation(createAnnotationInput({ id: "ann-session-b", piboSessionId: "ps_b" }));

		assert.equal(ownerA.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
		assert.deepEqual(store.listAnnotations({ ownerScope: "user:a", piboSessionId: "ps_a" }).map((annotation) => annotation.id), [historicalUser.id, ownerA.id]);
		assert.equal(store.getAnnotation("user:b", "ps_a", ownerA.id)?.id, ownerA.id);
		assert.equal(store.getAnnotation("user:a", "ps_b", ownerA.id), undefined);
		assert.equal(store.patchAnnotation("user:b", "ps_a", ownerA.id, { status: "resolved" })?.status, "resolved");
		assert.equal(store.patchAnnotation("user:a", "ps_b", ownerA.id, { status: "acknowledged" }), undefined);
		assert.equal(store.getAnnotation("user:a", "ps_a", ownerA.id)?.status, "resolved");
	} finally {
		store.close();
	}
});
