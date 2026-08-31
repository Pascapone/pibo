export type StickyScrollIntentDirection = "away" | "toward";

export type StickyScrollIntentInput = {
	type?: string;
	key?: string;
	deltaY?: number;
	deltaMode?: number;
	shiftKey?: boolean;
};

export type StickyScrollPositionInput = {
	hasUserScrollIntent: boolean;
	previousScrollTop?: number;
	scrollTop: number;
};

export type StickyPointerScrollMode = "scrollbar" | "middle";

export type StickyPointerScrollInput = {
	button?: number;
	targetIsScroller: boolean;
	clientX?: number;
	scrollerRight?: number;
	verticalScrollbarWidth?: number;
};

export type StickyRenderedItem = {
	index: number;
	offset: number;
	size: number;
};

export type StickyVisibleAnchor = {
	key: string;
	dataIndex: number;
	offset: number;
};

export type StickyAnchorLocation = {
	index: number;
	align: "start";
	behavior: "auto";
	offset: number;
};

export function stickyWheelOwnsViewport(input: StickyScrollIntentInput): boolean {
	if (input.type !== "wheel" || (input.deltaY ?? 0) === 0) return false;
	return (input.deltaMode ?? 0) !== 0 || Math.abs(input.deltaY ?? 0) >= 80;
}

export function stickyWheelPixelDelta(input: StickyScrollIntentInput, viewportHeight: number): number {
	if (input.type !== "wheel" || (input.deltaY ?? 0) === 0) return 0;
	if (input.deltaMode === 1) return (input.deltaY ?? 0) * 16;
	if (input.deltaMode === 2) return (input.deltaY ?? 0) * viewportHeight;
	return input.deltaY ?? 0;
}

export function stickyScrollIntentDirection(input: StickyScrollIntentInput): StickyScrollIntentDirection | undefined {
	if (input.type === "wheel") {
		if ((input.deltaY ?? 0) < 0) return "away";
		if ((input.deltaY ?? 0) > 0) return "toward";
		return undefined;
	}
	if (input.type === "keydown") {
		if (["ArrowUp", "PageUp", "Home"].includes(input.key ?? "")) return "away";
		if (input.key === " " && input.shiftKey) return "away";
		if (["ArrowDown", "PageDown", "End", " "].includes(input.key ?? "")) return "toward";
	}
	return undefined;
}

export function stickyScrollPositionDirection(input: StickyScrollPositionInput): StickyScrollIntentDirection | undefined {
	if (!input.hasUserScrollIntent || input.previousScrollTop === undefined) return undefined;
	if (input.scrollTop < input.previousScrollTop - 1) return "away";
	if (input.scrollTop > input.previousScrollTop + 1) return "toward";
	return undefined;
}

export function resolveScrollbarDragMovement({
	direction,
	oppositeCount,
	previousScrollTop,
	scrollTop,
}: {
	direction?: StickyScrollIntentDirection;
	oppositeCount: number;
	previousScrollTop?: number;
	scrollTop: number;
}): { direction?: StickyScrollIntentDirection; oppositeCount: number; clamp: boolean } {
	const movement = stickyScrollPositionDirection({
		hasUserScrollIntent: true,
		previousScrollTop,
		scrollTop,
	});
	if (!movement) return { direction, oppositeCount, clamp: false };
	if (!direction || movement === direction) return { direction: movement, oppositeCount: 0, clamp: false };
	const nextOppositeCount = oppositeCount + 1;
	if (nextOppositeCount < 2) return { direction, oppositeCount: nextOppositeCount, clamp: true };
	return { direction: movement, oppositeCount: 0, clamp: false };
}

export function stickyTouchScrollIntentDirection(previousY: number | undefined, currentY: number | undefined): StickyScrollIntentDirection | undefined {
	if (currentY === undefined || previousY === undefined || currentY === previousY) return undefined;
	return currentY > previousY ? "away" : "toward";
}

export function stickyPointerScrollMode(input: StickyPointerScrollInput): StickyPointerScrollMode | undefined {
	if (input.button === 1) return "middle";
	if (input.button !== 0 || !input.targetIsScroller) return undefined;
	if (input.clientX === undefined || input.scrollerRight === undefined) return undefined;
	const scrollbarWidth = Math.max(12, input.verticalScrollbarWidth ?? 0);
	return input.clientX >= input.scrollerRight - scrollbarWidth ? "scrollbar" : undefined;
}

export function shouldReattachStickyAtBottom(armed: boolean, scrollingAwayFromBottom: boolean): boolean {
	return armed && !scrollingAwayFromBottom;
}

export function prependedItemCount(previousKeys: readonly string[], nextKeys: readonly string[]): number {
	const addedCount = nextKeys.length - previousKeys.length;
	if (addedCount <= 0) return 0;
	for (let index = 0; index < previousKeys.length; index += 1) {
		if (previousKeys[index] !== nextKeys[index + addedCount]) return 0;
	}
	return addedCount;
}

export function captureStickyVisibleAnchors({
	items,
	itemKeys,
	firstItemIndex,
	scrollTop,
	viewportHeight,
}: {
	items: readonly StickyRenderedItem[];
	itemKeys: readonly string[];
	firstItemIndex: number;
	scrollTop: number;
	viewportHeight: number;
}): StickyVisibleAnchor[] {
	const viewportBottom = scrollTop + viewportHeight;
	return items
		.filter((item) => item.offset + item.size > scrollTop && item.offset < viewportBottom)
		.sort((left, right) => left.offset - right.offset)
		.flatMap((item) => {
			const dataIndex = item.index - firstItemIndex;
			const key = itemKeys[dataIndex];
			return key === undefined ? [] : [{ key, dataIndex, offset: item.offset - scrollTop }];
		});
}

export function preferredStickyVisibleAnchor(anchors: readonly StickyVisibleAnchor[]): StickyVisibleAnchor | undefined {
	return [...anchors].sort((left, right) => Math.abs(left.offset) - Math.abs(right.offset))[0];
}

export function stickyAnchorLocation({
	anchors,
	previousKeys,
	nextKeys,
}: {
	anchors: readonly StickyVisibleAnchor[];
	previousKeys?: readonly string[];
	nextKeys: readonly string[];
}): StickyAnchorLocation | undefined {
	if (!anchors.length || !nextKeys.length) return undefined;
	const orderedAnchors = [...anchors].sort((left, right) => Math.abs(left.offset) - Math.abs(right.offset));
	for (const anchor of orderedAnchors) {
		const dataIndex = nextKeys.indexOf(anchor.key);
		if (dataIndex >= 0) return anchorLocation(dataIndex, anchor.offset);
	}
	const fallback = orderedAnchors[0];
	if (previousKeys?.length) {
		for (let index = fallback.dataIndex; index < previousKeys.length; index += 1) {
			const nextIndex = nextKeys.indexOf(previousKeys[index]);
			if (nextIndex >= 0) return anchorLocation(nextIndex, fallback.offset);
		}
		for (let index = fallback.dataIndex - 1; index >= 0; index -= 1) {
			const nextIndex = nextKeys.indexOf(previousKeys[index]);
			if (nextIndex >= 0) return anchorLocation(nextIndex, fallback.offset);
		}
	}
	const fallbackIndex = Math.min(Math.max(fallback.dataIndex, 0), nextKeys.length - 1);
	return anchorLocation(fallbackIndex, fallback.offset);
}

function anchorLocation(index: number, visibleOffset: number): StickyAnchorLocation {
	return {
		index,
		align: "start",
		behavior: "auto",
		offset: -visibleOffset,
	};
}
