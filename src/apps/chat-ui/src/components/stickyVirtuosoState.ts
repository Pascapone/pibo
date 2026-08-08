export type StickyScrollIntentDirection = "away" | "toward";

export type StickyScrollIntentInput = {
	type?: string;
	key?: string;
	deltaY?: number;
	shiftKey?: boolean;
};

export type StickyScrollPositionInput = {
	hasUserScrollIntent: boolean;
	previousScrollTop?: number;
	scrollTop: number;
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

export function stickyTouchScrollIntentDirection(previousY: number | undefined, currentY: number | undefined): StickyScrollIntentDirection | undefined {
	if (currentY === undefined || previousY === undefined || currentY === previousY) return undefined;
	return currentY > previousY ? "away" : "toward";
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

export function stickyAnchorLocation({
	anchors,
	nextKeys,
}: {
	anchors: readonly StickyVisibleAnchor[];
	nextKeys: readonly string[];
}): StickyAnchorLocation | undefined {
	if (!anchors.length || !nextKeys.length) return undefined;
	for (const anchor of anchors) {
		const dataIndex = nextKeys.indexOf(anchor.key);
		if (dataIndex >= 0) return anchorLocation(dataIndex, anchor.offset);
	}
	const fallback = anchors[0];
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
