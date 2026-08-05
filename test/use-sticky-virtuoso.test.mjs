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

test("useStickyVirtuoso no longer applies blind scrollHeight growth compensation", () => {
	assert.doesNotMatch(source, /lastScrollHeightRef/);
	assert.doesNotMatch(source, /addedHeight/);
	assert.doesNotMatch(source, /scrollTop \+ addedHeight/);
});
