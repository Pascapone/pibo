import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("sticky Virtuoso state handles intent, prepend, and anchor transactions", async () => {
	const script = `
		import assert from "node:assert/strict";
		import {
			captureStickyVisibleAnchors,
			prependedItemCount,
			shouldReattachStickyAtBottom,
			stickyAnchorLocation,
			stickyPointerScrollMode,
			stickyScrollIntentDirection,
			stickyScrollPositionDirection,
			stickyTouchScrollIntentDirection,
		} from "./src/apps/chat-ui/src/components/stickyVirtuosoState.ts";

		assert.equal(stickyScrollIntentDirection({ type: "wheel", deltaY: -1 }), "away");
		assert.equal(stickyScrollIntentDirection({ type: "keydown", key: "ArrowUp" }), "away");
		assert.equal(stickyScrollIntentDirection({ type: "keydown", key: " ", shiftKey: true }), "away");
		assert.equal(stickyScrollIntentDirection({ type: "wheel", deltaY: 1 }), "toward");
		assert.equal(stickyScrollIntentDirection({ type: "keydown", key: "End" }), "toward");
		assert.equal(stickyTouchScrollIntentDirection(100, 120), "away");
		assert.equal(stickyTouchScrollIntentDirection(120, 100), "toward");
		assert.equal(stickyTouchScrollIntentDirection(undefined, 100), undefined);
		assert.equal(stickyPointerScrollMode({ button: 1, targetIsScroller: false }), "middle");
		assert.equal(stickyPointerScrollMode({ button: 0, targetIsScroller: true, clientX: 995, scrollerRight: 1_000, verticalScrollbarWidth: 15 }), "scrollbar");
		assert.equal(stickyPointerScrollMode({ button: 0, targetIsScroller: true, clientX: 950, scrollerRight: 1_000, verticalScrollbarWidth: 15 }), undefined);
		assert.equal(stickyPointerScrollMode({ button: 0, targetIsScroller: false, clientX: 995, scrollerRight: 1_000, verticalScrollbarWidth: 15 }), undefined);

		assert.equal(stickyScrollPositionDirection({
			hasUserScrollIntent: false,
			previousScrollTop: 29_690,
			scrollTop: 749,
		}), undefined, "a large programmatic negative jump must remain non-user movement");
		assert.equal(stickyScrollPositionDirection({
			hasUserScrollIntent: true,
			previousScrollTop: 29_690,
			scrollTop: 749,
		}), "away", "an armed user intent must classify the same negative movement as away");
		assert.equal(stickyScrollPositionDirection({
			hasUserScrollIntent: false,
			previousScrollTop: 29_777,
			scrollTop: 29_690,
		}), undefined, "a no-input near-bottom layout correction must remain non-user movement");
		assert.equal(stickyScrollPositionDirection({
			hasUserScrollIntent: true,
			previousScrollTop: 749,
			scrollTop: 29_690,
		}), "toward");
		assert.equal(stickyScrollPositionDirection({
			hasUserScrollIntent: true,
			previousScrollTop: 100,
			scrollTop: 99,
		}), undefined, "one-pixel measurement jitter must remain ignored");

		assert.equal(shouldReattachStickyAtBottom(true, false), true);
		assert.equal(shouldReattachStickyAtBottom(true, true), false);
		assert.equal(shouldReattachStickyAtBottom(false, false), false);

		assert.equal(prependedItemCount(["c", "d"], ["a", "b", "c", "d"]), 2);
		assert.equal(prependedItemCount(["b", "c"], ["a", "b", "x", "c"]), 0);
		assert.equal(prependedItemCount(["a", "b"], ["a", "b", "c"]), 0);

		const anchors = captureStickyVisibleAnchors({
			items: [
				{ index: 999_999, offset: 80, size: 40 },
				{ index: 1_000_000, offset: 120, size: 60 },
				{ index: 1_000_001, offset: 180, size: 70 },
			],
			itemKeys: ["row-a", "row-b", "row-c"],
			firstItemIndex: 999_999,
			scrollTop: 150,
			viewportHeight: 90,
		});
		assert.deepEqual(anchors, [
			{ key: "row-b", dataIndex: 1, offset: -30 },
			{ key: "row-c", dataIndex: 2, offset: 30 },
		]);

		assert.deepEqual(stickyAnchorLocation({
			anchors,
			nextKeys: ["older", "row-a", "row-b", "row-c"],
		}), { index: 2, align: "start", behavior: "auto", offset: 30 });

		assert.deepEqual(stickyAnchorLocation({
			anchors,
			nextKeys: ["replacement-a", "replacement-b"],
		}), { index: 1, align: "start", behavior: "auto", offset: 30 });
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
