import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const annotationsSource = readFileSync("src/apps/chat-ui/src/web-annotations.tsx", "utf8");
const headerSource = readFileSync("src/apps/chat-ui/src/session-trace-header.tsx", "utf8");
const paneSource = readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");

test("Web Annotation controls live directly in the Annotations tab", () => {
	assert.match(annotationsSource, /data-pibo-debug="web-annotations-entry"/);
	assert.match(annotationsSource, /data-pibo-debug="web-annotations-current-page"/);
	assert.match(annotationsSource, /htmlFor="web-annotation-url"/);
	assert.match(annotationsSource, /htmlFor="web-annotation-cdp-url"/);
	assert.match(annotationsSource, />Existing targets</);
	assert.doesNotMatch(annotationsSource, /role="dialog"|ariaHaspopup|WEB_ANNOTATIONS_DIALOG_ID|fixed inset-x-2/);
	assert.match(paneSource, /data-pibo-debug="web-annotations-tab-panel"[\s\S]*<WebAnnotationsControls[\s\S]*<WebAnnotationsSessionPanel/);
});

test("Session top bar no longer exposes Web Annotation controls", () => {
	assert.doesNotMatch(headerSource, /WebAnnotationsEntryPoints|webAnnotationsDisabled|onShowWebAnnotationsPanel|onHideWebAnnotationsPanel/);
});

test("Annotations tab owns the full-height scrollbar instead of a short nested list", () => {
	assert.match(paneSource, /data-pibo-debug="web-annotations-tab-panel"/);
	assert.match(paneSource, /h-full min-h-0 overflow-y-auto/);
	assert.doesNotMatch(annotationsSource, /max-h-\[min\(40svh,18rem\)\]|sm:max-h-56|data-pibo-debug="web-annotations-list"[^>]*overflow-y-auto/);
});
