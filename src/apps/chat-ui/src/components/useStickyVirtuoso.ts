import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FollowOutputScalarType, VirtuosoHandle } from "react-virtuoso";

const DEFAULT_BOTTOM_THRESHOLD = 24;
const USER_SCROLL_INTENT_MS = 700;

type StickyScrollBehavior = "auto" | "smooth" | "fast-smooth";
type NativeScrollBehavior = "auto" | "smooth";
type StickyScrollAlign = "start" | "center" | "end";

type StickyScrollToIndexOptions = {
	fromIndex?: number;
	stagingAlign?: StickyScrollAlign;
	stagingDistance?: number;
};

const DEFAULT_FAST_SMOOTH_STAGING_DISTANCE = 3;

type StickyVirtuosoOptions = {
	itemCount: number;
	/** Resets stickiness when the backing conversation/trace changes. */
	resetKey?: unknown;
	/** Schedules a sticky scroll when rendered content changes without changing itemCount. */
	contentKey?: unknown;
	atBottomThreshold?: number;
	/** Calls back while the user is reading near the top of the scroll range. */
	onNearTop?: () => void;
	nearTopThreshold?: number;
};

export function useStickyVirtuoso({
	itemCount,
	resetKey,
	contentKey,
	atBottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
	onNearTop,
	nearTopThreshold = 0,
}: StickyVirtuosoOptions) {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const itemCountRef = useRef(itemCount);
	const stickyRef = useRef(true);
	const scrollFrameRef = useRef<number | undefined>(undefined);
	const userScrollIntentRef = useRef(false);
	const userScrollIntentTimerRef = useRef<number | undefined>(undefined);
	const lastScrollTopRef = useRef<number | undefined>(undefined);
	const [isSticky, setIsStickyState] = useState(true);
	const [scroller, setScroller] = useState<HTMLElement | Window | null>(null);

	useLayoutEffect(() => {
		itemCountRef.current = itemCount;
	}, [itemCount]);

	const setSticky = useCallback((next: boolean) => {
		stickyRef.current = next;
		setIsStickyState(next);
	}, []);

	const clearScheduledScroll = useCallback(() => {
		if (scrollFrameRef.current !== undefined) {
			cancelAnimationFrame(scrollFrameRef.current);
			scrollFrameRef.current = undefined;
		}
	}, []);

	const scheduleScrollToBottom = useCallback((behavior: NativeScrollBehavior = "auto") => {
		clearScheduledScroll();
		scrollFrameRef.current = requestAnimationFrame(() => {
			scrollFrameRef.current = undefined;
			if (!stickyRef.current) return;
			const lastIndex = itemCountRef.current - 1;
			if (lastIndex < 0) return;

			// autoscrollToBottom catches measured height changes inside the last item;
			// scrollToIndex catches newly appended rows.
			virtuosoRef.current?.autoscrollToBottom();
			virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: "end", behavior });

			requestAnimationFrame(() => {
				if (stickyRef.current) virtuosoRef.current?.autoscrollToBottom();
			});
		});
	}, [clearScheduledScroll]);

	const stickToBottom = useCallback((behavior: NativeScrollBehavior = "auto") => {
		setSticky(true);
		scheduleScrollToBottom(behavior);
	}, [scheduleScrollToBottom, setSticky]);

	const scrollToIndex = useCallback((index: number, align: StickyScrollAlign = "center", behavior: StickyScrollBehavior = "auto", options: StickyScrollToIndexOptions = {}) => {
		setSticky(false);
		clearScheduledScroll();
		requestAnimationFrame(() => {
			if (behavior !== "fast-smooth") {
				virtuosoRef.current?.scrollToIndex({ index, align, behavior });
				return;
			}
			if (options.stagingAlign) {
				virtuosoRef.current?.scrollToIndex({ index, align: options.stagingAlign, behavior: "auto" });
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						virtuosoRef.current?.scrollToIndex({ index, align, behavior: "smooth" });
					});
				});
				return;
			}
			const fromIndex = options.fromIndex;
			const distance = Math.abs(typeof fromIndex === "number" ? fromIndex - index : 0);
			const stagingDistance = options.stagingDistance ?? DEFAULT_FAST_SMOOTH_STAGING_DISTANCE;
			if (typeof fromIndex !== "number" || distance <= stagingDistance) {
				virtuosoRef.current?.scrollToIndex({ index, align, behavior: "smooth" });
				return;
			}
			const lastIndex = itemCountRef.current - 1;
			const stagedIndex = index < fromIndex
				? Math.min(lastIndex, index + stagingDistance)
				: Math.max(0, index - stagingDistance);
			virtuosoRef.current?.scrollToIndex({ index: stagedIndex, align, behavior: "auto" });
			requestAnimationFrame(() => {
				virtuosoRef.current?.scrollToIndex({ index, align, behavior: "smooth" });
			});
		});
	}, [clearScheduledScroll, setSticky]);

	const markUserScrollIntent = useCallback((event?: Event) => {
		userScrollIntentRef.current = true;
		const scrollingAwayFromBottom = event instanceof WheelEvent && event.deltaY < 0;
		if (scrollingAwayFromBottom) clearScheduledScroll();
		if (scrollingAwayFromBottom || (scroller && !isAtBottom(scroller, atBottomThreshold))) setSticky(false);
		if (userScrollIntentTimerRef.current !== undefined) window.clearTimeout(userScrollIntentTimerRef.current);
		userScrollIntentTimerRef.current = window.setTimeout(() => {
			userScrollIntentRef.current = false;
			userScrollIntentTimerRef.current = undefined;
		}, USER_SCROLL_INTENT_MS);
	}, [atBottomThreshold, clearScheduledScroll, scroller, setSticky]);

	const updateFromScrollPosition = useCallback(() => {
		if (!scroller) return;
		const scrollTop = getScrollTop(scroller);
		const previousScrollTop = lastScrollTopRef.current;
		lastScrollTopRef.current = scrollTop;
		const scrollingAwayFromBottom = previousScrollTop !== undefined && scrollTop < previousScrollTop - 1;
		const readingAwayFromBottom = userScrollIntentRef.current || scrollingAwayFromBottom || !stickyRef.current;
		if (onNearTop && readingAwayFromBottom && scrollTop <= nearTopThreshold) onNearTop();
		if (isAtBottom(scroller, atBottomThreshold)) {
			if (!userScrollIntentRef.current) setSticky(true);
			return;
		}
		if (userScrollIntentRef.current || scrollingAwayFromBottom) setSticky(false);
	}, [atBottomThreshold, nearTopThreshold, onNearTop, scroller, setSticky]);

	useEffect(() => {
		if (!scroller) return undefined;
		const target: HTMLElement | Window = scroller;
		const markIntentFromKey = (event: Event) => {
			const key = event instanceof KeyboardEvent ? event.key : "";
			if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(key)) {
				markUserScrollIntent();
			}
		};
		const markIntentFromPointer = (event: Event) => {
			if (event.target === target) markUserScrollIntent();
		};
		target.addEventListener("wheel", markUserScrollIntent, { passive: true });
		target.addEventListener("touchmove", markUserScrollIntent, { passive: true });
		target.addEventListener("pointerdown", markIntentFromPointer, { passive: true });
		target.addEventListener("keydown", markIntentFromKey);
		target.addEventListener("scroll", updateFromScrollPosition, { passive: true });
		return () => {
			target.removeEventListener("wheel", markUserScrollIntent);
			target.removeEventListener("touchmove", markUserScrollIntent);
			target.removeEventListener("pointerdown", markIntentFromPointer);
			target.removeEventListener("keydown", markIntentFromKey);
			target.removeEventListener("scroll", updateFromScrollPosition);
		};
	}, [markUserScrollIntent, scroller, updateFromScrollPosition]);

	useLayoutEffect(() => {
		lastScrollTopRef.current = undefined;
		setSticky(true);
		scheduleScrollToBottom("auto");
	}, [resetKey, scheduleScrollToBottom, setSticky]);

	useLayoutEffect(() => {
		if (stickyRef.current) scheduleScrollToBottom("auto");
	}, [contentKey, itemCount, scheduleScrollToBottom]);

	useEffect(() => () => {
		clearScheduledScroll();
		if (userScrollIntentTimerRef.current !== undefined) window.clearTimeout(userScrollIntentTimerRef.current);
	}, [clearScheduledScroll]);

	const atBottomStateChange = useCallback((atBottom: boolean) => {
		if (atBottom) {
			if (!userScrollIntentRef.current) setSticky(true);
			return;
		}
		if (userScrollIntentRef.current) setSticky(false);
	}, [setSticky]);

	const followOutput = useCallback((): FollowOutputScalarType => (stickyRef.current ? "auto" : false), []);

	const totalListHeightChanged = useCallback(() => {
		if (stickyRef.current) scheduleScrollToBottom("auto");
	}, [scheduleScrollToBottom]);

	return {
		virtuosoRef,
		isSticky,
		stickToBottom,
		scrollToIndex,
		scrollerRef: setScroller,
		atBottomStateChange,
		atBottomThreshold,
		followOutput,
		totalListHeightChanged,
	};
}

function isAtBottom(scroller: HTMLElement | Window, threshold: number) {
	const element = scroller instanceof Window ? document.scrollingElement : scroller;
	if (!element) return true;
	return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function getScrollTop(scroller: HTMLElement | Window) {
	const element = scroller instanceof Window ? document.scrollingElement : scroller;
	return element?.scrollTop ?? 0;
}
