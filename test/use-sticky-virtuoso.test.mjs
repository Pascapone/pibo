import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const sourcePath = path.resolve("src/apps/chat-ui/src/components/useStickyVirtuoso.ts");
const source = fs.readFileSync(sourcePath, "utf8");

test("useStickyVirtuoso cancels pending bottom scroll on upward wheel intent", () => {
	assert.match(
		source,
		/const scrollingAwayFromBottom = event instanceof WheelEvent && event\.deltaY < 0;\n\t\tif \(scrollingAwayFromBottom\) clearScheduledScroll\(\);\n\t\tif \(scrollingAwayFromBottom \|\|/,
		"upward wheel input should synchronously cancel scheduled sticky scroll work before detaching",
	);
});

test("useStickyVirtuoso ignores stale scheduled scrolls after sticky mode is cleared", () => {
	assert.match(
		source,
		/requestAnimationFrame\(\(\) => \{\n\t\t\tscrollFrameRef\.current = undefined;\n\t\t\tif \(!stickyRef\.current\) return;\n\t\t\tconst lastIndex/,
		"scheduled bottom-scroll frame should re-check sticky state before scrolling",
	);
});

test("useStickyVirtuoso does not re-enable stickiness during user scroll intent", () => {
	const guardedBottomSetStickyCount = (source.match(/if \(!userScrollIntentRef\.current\) setSticky\(true\);/g) ?? []).length;
	assert.equal(
		guardedBottomSetStickyCount,
		2,
		"scroll-position and at-bottom callbacks should not restore sticky mode during explicit user scroll intent",
	);
});
