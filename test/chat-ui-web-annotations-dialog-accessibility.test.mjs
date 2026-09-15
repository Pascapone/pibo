import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const annotationsSource = readFileSync("src/apps/chat-ui/src/web-annotations.tsx", "utf8");
const headerSource = readFileSync("src/apps/chat-ui/src/session-trace-header.tsx", "utf8");
const pluginSource = readFileSync("src/apps/chat-ui/src/plugins/web-annotations-view.tsx", "utf8");
const responsiveSource = readFileSync("src/apps/chat-ui/src/responsive-pane-sidebar.tsx", "utf8");

test("Web Annotation controls and saved annotations use explicit tab subviews", () => {
	assert.match(annotationsSource, /data-pibo-debug="web-annotations-entry"/);
	assert.match(annotationsSource, /data-pibo-debug="web-annotations-current-page"/);
	assert.match(annotationsSource, /htmlFor="web-annotation-url"/);
	assert.match(annotationsSource, /htmlFor="web-annotation-cdp-url"/);
	assert.match(annotationsSource, />Existing targets</);
	assert.doesNotMatch(annotationsSource, /role="dialog"|ariaHaspopup|WEB_ANNOTATIONS_DIALOG_ID|fixed inset-x-2/);
	assert.match(pluginSource, /WEB_ANNOTATION_SUBVIEWS[\s\S]*id: "annotations"[\s\S]*id: "settings"[\s\S]*id: "context"/);
	assert.match(pluginSource, /subview === "settings"[\s\S]*<WebAnnotationsControls/);
	assert.match(pluginSource, /<WebAnnotationsSessionPanel/);
});

test("Session top bar no longer exposes Web Annotation controls", () => {
	assert.doesNotMatch(headerSource, /WebAnnotationsEntryPoints|webAnnotationsDisabled|onShowWebAnnotationsPanel|onHideWebAnnotationsPanel/);
});

test("Annotations tab delegates full-height scrolling to the shared responsive panel", () => {
	assert.match(pluginSource, /return <ResponsiveTabSidebarPanel/);
	assert.match(responsiveSource, /contentOverflow = "auto"/);
	assert.match(responsiveSource, /contentOverflow === "auto" \? "overflow-auto" : "overflow-hidden"/);
	assert.doesNotMatch(annotationsSource, /max-h-\[min\(40svh,18rem\)\]|sm:max-h-56|data-pibo-debug="web-annotations-list"[^>]*overflow-y-auto/);
});
