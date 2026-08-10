import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const sourcePath = path.resolve("src/apps/chat-ui/src/components/useStickyVirtuoso.ts");
const source = fs.readFileSync(sourcePath, "utf8");

test("useStickyVirtuoso detaches synchronously for upward intent and permits explicit bottom reattachment", () => {
	assert.match(source, /if \(direction === "away"\) \{\n\t\t\tbottomReattachArmedRef\.current = false;\n\t\t\tclearScheduledScroll\(\);\n\t\t\tsetSticky\(false\);/);
	assert.match(source, /bottomReattachArmedRef\.current = direction === "toward"|bottomReattachArmedRef\.current = true/);
	assert.match(source, /shouldReattachStickyAtBottom\(bottomReattachArmedRef\.current, scrollingAwayFromBottom\)/);
	assert.match(source, /if \(scroller && isAtBottom\(scroller, 1\)\) setSticky\(true\);/);
	assert.match(source, /shouldReattachStickyAtBottom\(bottomReattachArmedRef\.current, false\)/);
});

test("useStickyVirtuoso treats scroll position changes as directional only during user intent", () => {
	assert.match(source, /const hasUserScrollIntent = userScrollIntentRef\.current \|\| pointerScrollMode !== undefined/);
	assert.match(source, /stickyScrollPositionDirection\(\{\n\t\t\thasUserScrollIntent,/);
	assert.doesNotMatch(source, /previousScrollTop !== undefined && scrollTop < previousScrollTop - 1/);
	assert.match(source, /if \(userScrollIntentRef\.current\) setSticky\(false\);/);
	assert.doesNotMatch(source, /if \(userScrollIntentRef\.current \|\| scrollingAwayFromBottom\) setSticky\(false\);/);
	assert.match(source, /stickyTouchScrollIntentDirection\(previousY, currentY\)/);
});

test("useStickyVirtuoso uses explicit anchor and Virtuoso prepend contracts", () => {
	assert.match(source, /firstItemIndexRef\.current -= prependedCount/);
	assert.match(source, /captureDomVisibleAnchors\(scroller, committedItemKeysRef\.current\)/);
	assert.match(source, /stickyAnchorLocation\(\{/);
	assert.match(source, /virtuosoRef\.current\?\.scrollToIndex\(location\)/);
	assert.match(source, /else restoreVisibleAnchor\(\);/);
	assert.match(source, /anchorFrameRef\.current = requestAnimationFrame/);
	assert.doesNotMatch(source, /firstItemIndexRef\.current \+ index/);
	assert.match(source, /firstItemIndex,/);
	assert.match(source, /itemsRendered,/);
	assert.match(source, /normalizeRange,/);
});

test("useStickyVirtuoso tracks descendant middle autoscroll and deferrable scrollbar drags", () => {
	assert.match(source, /if \(input\.button === 1\) return "middle"|stickyPointerScrollMode/);
	assert.match(source, /targetIsScroller: event\.target === target/);
	assert.match(source, /window\.addEventListener\("pointerup", finishScrollbarDrag/);
	assert.match(source, /onScrollbarDragChange\?\.\(true\)/);
	assert.match(source, /onScrollbarDragChange\?\.\(false\)/);
	assert.match(source, /onUserScrollIntent\?\.\(undefined, scrollPositionDirection\)/);
	assert.match(source, /MIDDLE_AUTOSCROLL_INACTIVITY_MS/);
});

test("useStickyVirtuoso no longer applies blind scrollHeight growth compensation", () => {
	assert.doesNotMatch(source, /lastScrollHeightRef/);
	assert.doesNotMatch(source, /addedHeight/);
	assert.doesNotMatch(source, /scrollTop \+ addedHeight/);
});
