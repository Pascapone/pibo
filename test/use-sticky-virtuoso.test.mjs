import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const sourcePath = path.resolve("src/apps/chat-ui/src/components/useStickyVirtuoso.ts");
const source = fs.readFileSync(sourcePath, "utf8").replaceAll("\r\n", "\n");

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
	assert.match(source, /if \(hasUserScrollIntent && userScrollDirectionRef\.current === "away"\) requestAtTop\(\);/);
});

test("useStickyVirtuoso uses explicit anchor and Virtuoso prepend contracts", () => {
	assert.match(source, /firstItemIndexRef\.current -= prependedCount/);
	assert.match(source, /captureDomVisibleAnchors\(scroller, itemKeys\)/);
	assert.match(source, /stickyAnchorLocation\(\{/);
	assert.match(source, /virtuosoRef\.current\?\.scrollToIndex\(location\)/);
	assert.match(source, /else restoreVisibleAnchor\(\);/);
	assert.match(source, /const wasPrependTransaction = prependTransactionRef\.current/);
	assert.match(source, /else if \(wasPrependTransaction\) \{\n\t\t\tschedulePrependSettle\(\);/);
	assert.match(source, /else if \(virtuosoPrependPendingRef\.current\) schedulePrependSettle\(\);/);
	assert.match(source, /virtuosoPrependPendingRef\.current = false;\n\t\t\t\trestoreVisibleAnchor\(\);/);
	assert.match(source, /anchorFrameRef\.current = requestAnimationFrame/);
	assert.match(source, /const mutationObserver = new MutationObserver/);
	assert.match(source, /new ResizeObserver\(preserveReadingTarget\)/);
	assert.match(source, /\[data-testid="virtuoso-item-list"\]/);
	assert.match(source, /if \(stickyRef\.current\) \{\s*scrollToBottom\(scroller\)/);
	assert.match(source, /characterData: true/);
	assert.match(source, /virtuosoPrependPendingRef\.current && !allowDuringPrepend/);
	assert.match(source, /restoreVisibleAnchor\(true\)/);
	assert.match(source, /!restoredInDom && !virtuosoPrependPendingRef\.current/);
	assert.match(source, /pointerScrollModeRef\.current !== undefined/);
	assert.match(source, /USER_ANCHOR_FINAL_CAPTURE_MS/);
	assert.match(source, /userAnchorFinalCaptureTimerRef\.current = window\.setTimeout/);
	assert.match(source, /restoredAnchorLockRef\.current = \{ \.\.\.anchor, dataIndex: index \}/, "reload restoration keeps the explicit conceptual row through late layout measurement");
	assert.match(source, /const anchors = restoredAnchorIndex >= 0/, "late mutations continue restoring the explicit reload anchor");
	assert.doesNotMatch(source, /restoredAnchorIndex < 0\) restoredAnchorLockRef\.current = undefined/, "transient replay gaps must not discard the explicit reload anchor");
	assert.match(source, /markUserScrollIntent = useCallback[\s\S]*clearAnchorLocks\(\)/, "the first new user input releases restored and content anchor locks");
	assert.match(source, /touchScrollIntentRef\.current = event\?\.type === "touchmove";/, "touch gesture ownership is tracked separately from wheel and keyboard intent");
	assert.match(source, /wheelScrollIntentRef\.current = event\?\.type === "wheel";/, "wheel gestures retain synchronous layout stabilization");
	assert.match(source, /offset: anchor\.offset - event\.deltaY/, "wheel anchors project the requested visual movement before dynamic rows resize");
	assert.match(source, /userAnchorCaptureArmedRef\.current && !wheelScrollIntentRef\.current/, "projected wheel anchors may correct layout in the same frame");
	assert.match(source, /if \(userScrollIntentRef\.current && touchScrollIntentRef\.current\) \{\n\t\t\tuserAnchorRestoreDeferredRef\.current = true;\n\t\t\treturn;/, "active touch gestures own the viewport without suppressing wheel anchor stabilization");
	assert.match(source, /if \(userScrollIntentRef\.current\) scheduleUserScrollIntentRelease\(\);/, "scroll events keep gesture ownership armed through touch momentum and wheel settling");
	assert.match(source, /if \(!userAnchorRestoreDeferredRef\.current\) return;[\s\S]*captureVisibleAnchors\(\);/, "settled gestures adopt their final conceptual row instead of replaying a stale anchor");
	assert.match(source, /if \(anchorFrameRef\.current !== undefined\) cancelAnimationFrame\(anchorFrameRef\.current\);\n\t\tanchorFrameRef\.current = undefined;/, "new input cancels already scheduled anchor corrections");
	assert.match(source, /contentAnchorLockRef\.current = \{[\s\S]*anchors: visibleAnchorsRef\.current/, "the first frame in a content burst retains every visible fallback anchor");
	assert.match(source, /contentAnchorLock\?\.anchors \?\? pendingAnchors/, "replay reconciliation restores against the pre-burst anchor set");
	assert.match(source, /scheduleContentAnchorSettle\(\)/, "the pre-burst anchor set is released only after content and layout settle");
	assert.doesNotMatch(source, /firstItemIndexRef\.current \+ index/);
	assert.match(source, /firstItemIndex,/);
	assert.match(source, /itemsRendered,/);
	assert.match(source, /normalizeRange,/);
});

test("useStickyVirtuoso uses one bottom target without a competing last-index scroll", () => {
	assert.match(source, /virtuosoRef\.current\?\.autoscrollToBottom\(\);/);
	assert.match(source, /if \(scroller\) scrollToBottom\(scroller\);/);
	assert.doesNotMatch(source, /scrollToIndex\(\{ index: lastIndex, align: "end"/);
});

test("useStickyVirtuoso tracks descendant middle autoscroll and deferrable scrollbar drags", () => {
	assert.match(source, /if \(input\.button === 1\) return "middle"|stickyPointerScrollMode/);
	assert.match(source, /targetIsScroller: event\.target === target/);
	assert.match(source, /pointerScrollModeRef\.current = mode;\n\t\t\tbottomReattachArmedRef\.current = false;\n\t\t\tclearScheduledScroll\(\);\n\t\t\tsetSticky\(false\);\n\t\t\tcaptureVisibleAnchors\(\);/, "pointer scrolling detaches before the native thumb or autoscroll can move");
	assert.match(source, /window\.addEventListener\("pointerup", finishScrollbarDrag/);
	assert.match(source, /onScrollbarDragChange\?\.\(true\)/);
	assert.match(source, /onScrollbarDragChange\?\.\(false\)/);
	assert.match(source, /isAtBottom\(scroller, 1\) && userScrollDirectionRef\.current !== "away"\) setSticky\(true\)/, "a no-op scrollbar click at the bottom reattaches on release");
	assert.match(source, /const edge = event\.type === "pointerup" \? scrollbarReleaseEdge\(event, target\) : undefined/, "pointer cancellation releases the drag without forcing a viewport edge");
	assert.match(source, /if \(edge === "top"\) setScrollTop\(target, 0\)/, "releasing a virtualized thumb at the top clamps to the requested edge");
	assert.match(source, /pointerReleaseFrameRef\.current = requestAnimationFrame/, "the edge clamp settles before deferred history loading resumes");
	assert.match(source, /window\.addEventListener\("pointermove", trackScrollbarPointer/, "thumb direction is observed independently from virtualized scroll corrections");
	assert.match(source, /resolveScrollbarDragMovement\(\{[\s\S]*scrollbarOppositeScrollCountRef\.current/, "one-off virtualizer measurement corrections cannot reverse content against the held thumb");
	assert.match(source, /onUserScrollIntent\?\.\(undefined, scrollPositionDirection\)/);
	assert.match(source, /MIDDLE_AUTOSCROLL_INACTIVITY_MS/);
});

test("useStickyVirtuoso no longer applies blind scrollHeight growth compensation", () => {
	assert.doesNotMatch(source, /lastScrollHeightRef/);
	assert.doesNotMatch(source, /addedHeight/);
	assert.doesNotMatch(source, /scrollTop \+ addedHeight/);
});
