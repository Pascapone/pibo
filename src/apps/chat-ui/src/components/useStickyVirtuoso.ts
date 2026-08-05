import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FollowOutputScalarType, ListItem, ListRange, VirtuosoHandle } from "react-virtuoso";
import {
	captureStickyVisibleAnchors,
	prependedItemCount,
	shouldReattachStickyAtBottom,
	stickyAnchorLocation,
	stickyScrollIntentDirection,
	type StickyAnchorLocation,
	type StickyScrollIntentDirection,
	type StickyVisibleAnchor,
} from "./stickyVirtuosoState";

const DEFAULT_BOTTOM_THRESHOLD = 24;
const USER_SCROLL_INTENT_MS = 700;
const USER_ANCHOR_SETTLE_MS = 120;

type StickyScrollBehavior = "auto" | "smooth" | "fast-smooth";
type NativeScrollBehavior = "auto" | "smooth";
type StickyScrollAlign = "start" | "center" | "end";

type StickyScrollToIndexOptions = {
	fromIndex?: number;
	stagingAlign?: StickyScrollAlign;
	stagingDistance?: number;
};

const DEFAULT_FAST_SMOOTH_STAGING_DISTANCE = 3;
const INITIAL_FIRST_ITEM_INDEX = 1_000_000;

type StickyVirtuosoOptions = {
	itemCount: number;
	itemKeys: readonly string[];
	/** True while an older-page prepend request is in flight. */
	isPrepending?: boolean;
	/** Resets stickiness when the backing conversation/trace changes. */
	resetKey?: unknown;
	/** Schedules a sticky scroll when rendered content changes without changing itemCount. */
	contentKey?: unknown;
	atBottomThreshold?: number;
	/** Calls back whenever the scroll container is exactly at the history edge. */
	onAtTop?: () => void;
	/** Calls back while the user is reading near the top of the scroll range. */
	onNearTop?: () => void;
	atTopThreshold?: number;
	nearTopThreshold?: number;
	onUserScrollIntent?: (event?: Event) => void;
	onVisibleAnchorChange?: (anchor: StickyVisibleAnchor | undefined) => void;
};

export function useStickyVirtuoso({
	itemCount,
	itemKeys,
	isPrepending = false,
	resetKey,
	contentKey,
	atBottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
	onAtTop,
	onNearTop,
	atTopThreshold = 0,
	nearTopThreshold = 0,
	onUserScrollIntent,
	onVisibleAnchorChange,
}: StickyVirtuosoOptions) {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const itemCountRef = useRef(itemCount);
	const isPrependingRef = useRef(isPrepending);
	isPrependingRef.current = isPrepending;
	const stickyRef = useRef(true);
	const scrollFrameRef = useRef<number | undefined>(undefined);
	const anchorFrameRef = useRef<number | undefined>(undefined);
	const atTopFrameRef = useRef<number | undefined>(undefined);
	const nearTopFrameRef = useRef<number | undefined>(undefined);
	const userScrollIntentRef = useRef(false);
	const userScrollDirectionRef = useRef<StickyScrollIntentDirection | undefined>(undefined);
	const userAnchorCaptureArmedRef = useRef(false);
	const bottomReattachArmedRef = useRef(false);
	const userScrollIntentTimerRef = useRef<number | undefined>(undefined);
	const userAnchorCaptureTimerRef = useRef<number | undefined>(undefined);
	const lastTouchYRef = useRef<number | undefined>(undefined);
	const lastScrollTopRef = useRef<number | undefined>(undefined);
	const renderedItemsRef = useRef<readonly ListItem<unknown>[]>([]);
	const visibleAnchorsRef = useRef<readonly StickyVisibleAnchor[]>([]);
	const pendingAnchorsRef = useRef<readonly StickyVisibleAnchor[] | undefined>(undefined);
	const committedItemKeysRef = useRef(itemKeys);
	const firstItemIndexRef = useRef(INITIAL_FIRST_ITEM_INDEX);
	const committedFirstItemIndexRef = useRef(INITIAL_FIRST_ITEM_INDEX);
	const previousItemsRef = useRef({ resetKey, itemKeys });
	const prependTransactionRef = useRef(false);
	const atTopRef = useRef(false);
	const [isSticky, setIsStickyState] = useState(true);
	const [isAtTop, setIsAtTopState] = useState(false);
	const [scroller, setScroller] = useState<HTMLElement | Window | null>(null);

	const previousItems = previousItemsRef.current;
	if (!Object.is(previousItems.resetKey, resetKey)) {
		firstItemIndexRef.current = INITIAL_FIRST_ITEM_INDEX;
		prependTransactionRef.current = false;
	} else {
		const prependedCount = prependedItemCount(previousItems.itemKeys, itemKeys);
		prependTransactionRef.current = prependedCount > 0;
		if (prependedCount > 0) firstItemIndexRef.current -= prependedCount;
	}
	previousItemsRef.current = { resetKey, itemKeys };
	const firstItemIndex = firstItemIndexRef.current;

	useLayoutEffect(() => {
		itemCountRef.current = itemCount;
	}, [itemCount]);

	const setSticky = useCallback((next: boolean, notifyAnchorChange = true) => {
		const wasSticky = stickyRef.current;
		stickyRef.current = next;
		if (next) {
			if (!wasSticky && notifyAnchorChange) onVisibleAnchorChange?.(undefined);
			bottomReattachArmedRef.current = false;
			if (anchorFrameRef.current !== undefined) cancelAnimationFrame(anchorFrameRef.current);
			anchorFrameRef.current = undefined;
		}
		setIsStickyState(next);
	}, [onVisibleAnchorChange]);

	const setAtTop = useCallback((next: boolean) => {
		if (atTopRef.current === next) return;
		atTopRef.current = next;
		setIsAtTopState(next);
	}, []);

	const updateAtTopFromScrollTop = useCallback((scrollTop: number) => {
		const next = scrollTop <= atTopThreshold;
		setAtTop(next);
		return next;
	}, [atTopThreshold, setAtTop]);

	const captureVisibleAnchors = useCallback(() => {
		if (!scroller || stickyRef.current) return undefined;
		const domAnchors = captureDomVisibleAnchors(scroller, committedItemKeysRef.current);
		visibleAnchorsRef.current = domAnchors.length ? domAnchors : captureStickyVisibleAnchors({
			items: renderedItemsRef.current,
			itemKeys: committedItemKeysRef.current,
			firstItemIndex: committedFirstItemIndexRef.current,
			scrollTop: getScrollTop(scroller),
			viewportHeight: getClientHeight(scroller),
		});
		const anchor = visibleAnchorsRef.current[0];
		onVisibleAnchorChange?.(anchor);
		return anchor;
	}, [onVisibleAnchorChange, scroller]);

	const itemsRendered = useCallback((items: ListItem<unknown>[]) => {
		renderedItemsRef.current = items;
	}, []);

	const restoreVisibleAnchor = useCallback(() => {
		if (stickyRef.current || userAnchorCaptureArmedRef.current) return;
		const anchors = pendingAnchorsRef.current ?? visibleAnchorsRef.current;
		const itemKeys = committedItemKeysRef.current;
		const location = stickyAnchorLocation({ anchors, nextKeys: itemKeys });
		if (!location) return;
		const restore = () => {
			if (stickyRef.current || userAnchorCaptureArmedRef.current) return;
			const restoredInDom = Boolean(scroller && restoreDomVisibleAnchor(scroller, location, anchors, itemKeys));
			if (!restoredInDom) virtuosoRef.current?.scrollToIndex(location);
		};
		restore();
		if (anchorFrameRef.current !== undefined) cancelAnimationFrame(anchorFrameRef.current);
		anchorFrameRef.current = requestAnimationFrame(() => {
			restore();
			anchorFrameRef.current = requestAnimationFrame(() => {
				anchorFrameRef.current = undefined;
				restore();
			});
		});
	}, [scroller]);

	const prepareForPrepend = useCallback(() => {
		if (stickyRef.current) return;
		captureVisibleAnchors();
		pendingAnchorsRef.current = visibleAnchorsRef.current;
		userAnchorCaptureArmedRef.current = false;
	}, [captureVisibleAnchors]);

	const normalizeRange = useCallback((range: ListRange): ListRange => ({
		startIndex: Math.max(0, range.startIndex - firstItemIndexRef.current),
		endIndex: Math.max(0, range.endIndex - firstItemIndexRef.current),
	}), []);

	const clearScheduledScroll = useCallback(() => {
		if (scrollFrameRef.current !== undefined) {
			cancelAnimationFrame(scrollFrameRef.current);
			scrollFrameRef.current = undefined;
		}
	}, []);

	const restoreAnchor = useCallback((anchor: StickyVisibleAnchor): boolean => {
		const itemKeys = committedItemKeysRef.current;
		const index = itemKeys.indexOf(anchor.key);
		if (index < 0) return false;
		setSticky(false);
		userAnchorCaptureArmedRef.current = false;
		visibleAnchorsRef.current = [{ ...anchor, dataIndex: index }];
		pendingAnchorsRef.current = visibleAnchorsRef.current;
		clearScheduledScroll();
		const location: StickyAnchorLocation = { index, align: "start", behavior: "auto", offset: -anchor.offset };
		const restore = () => {
			if (stickyRef.current) return;
			const restoredInDom = Boolean(scroller && restoreDomVisibleAnchor(scroller, location, visibleAnchorsRef.current, itemKeys));
			if (!restoredInDom) virtuosoRef.current?.scrollToIndex(location);
		};
		virtuosoRef.current?.scrollToIndex(location);
		if (anchorFrameRef.current !== undefined) cancelAnimationFrame(anchorFrameRef.current);
		anchorFrameRef.current = requestAnimationFrame(() => {
			restore();
			anchorFrameRef.current = requestAnimationFrame(() => {
				anchorFrameRef.current = undefined;
				restore();
			});
		});
		return true;
	}, [clearScheduledScroll, scroller, setSticky]);

	const requestNearTop = useCallback(() => {
		if (!onNearTop || !scroller) return;
		if (nearTopFrameRef.current !== undefined) return;
		nearTopFrameRef.current = requestAnimationFrame(() => {
			nearTopFrameRef.current = undefined;
			if (!onNearTop || !scroller) return;
			if (getScrollTop(scroller) <= nearTopThreshold) {
				captureVisibleAnchors();
				pendingAnchorsRef.current = visibleAnchorsRef.current;
				onNearTop();
			}
		});
	}, [captureVisibleAnchors, nearTopThreshold, onNearTop, scroller]);

	const scheduleScrollToBottom = useCallback((behavior: NativeScrollBehavior = "auto") => {
		clearScheduledScroll();
		scrollFrameRef.current = requestAnimationFrame(() => {
			scrollFrameRef.current = undefined;
			if (!stickyRef.current) return;
			const lastIndex = itemCountRef.current - 1;
			if (lastIndex < 0) return;

			// autoscrollToBottom catches measured height changes inside the last item;
			// scrollToIndex catches newly appended rows.
			if (scroller) scrollToBottom(scroller);
			virtuosoRef.current?.autoscrollToBottom();
			virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: "end", behavior });

			requestAnimationFrame(() => {
				if (!stickyRef.current) return;
				if (scroller) scrollToBottom(scroller);
				virtuosoRef.current?.autoscrollToBottom();
				requestAnimationFrame(() => {
					if (!stickyRef.current) return;
					if (scroller) scrollToBottom(scroller);
					virtuosoRef.current?.autoscrollToBottom();
				});
			});
		});
	}, [clearScheduledScroll, scroller]);

	const requestAtTop = useCallback(() => {
		if (!onAtTop || !scroller) return;
		if (atTopFrameRef.current !== undefined) return;
		atTopFrameRef.current = requestAnimationFrame(() => {
			atTopFrameRef.current = undefined;
			if (!onAtTop || !scroller) return;
			if (updateAtTopFromScrollTop(getScrollTop(scroller))) {
				captureVisibleAnchors();
				pendingAnchorsRef.current = visibleAnchorsRef.current;
				onAtTop();
			}
		});
	}, [captureVisibleAnchors, onAtTop, scroller, updateAtTopFromScrollTop]);

	const isScrolledToTop = useCallback(() => {
		if (!scroller) return false;
		return updateAtTopFromScrollTop(getScrollTop(scroller));
	}, [scroller, updateAtTopFromScrollTop]);

	const stickToBottom = useCallback((behavior: NativeScrollBehavior = "auto") => {
		setSticky(true);
		scheduleScrollToBottom(behavior);
	}, [scheduleScrollToBottom, setSticky]);

	const scrollToIndex = useCallback((index: number, align: StickyScrollAlign = "center", behavior: StickyScrollBehavior = "auto", options: StickyScrollToIndexOptions = {}) => {
		setSticky(false);
		userAnchorCaptureArmedRef.current = true;
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

	const markUserScrollIntent = useCallback((event?: Event, directionOverride?: StickyScrollIntentDirection) => {
		userScrollIntentRef.current = true;
		onUserScrollIntent?.(event);
		const direction = directionOverride ?? stickyScrollIntentDirection(scrollIntentInput(event));
		userScrollDirectionRef.current = direction;
		userAnchorCaptureArmedRef.current = true;
		if (direction === "away") {
			bottomReattachArmedRef.current = false;
			clearScheduledScroll();
			setSticky(false);
			captureVisibleAnchors();
		} else if (direction === "toward") {
			bottomReattachArmedRef.current = true;
			if (scroller && isAtBottom(scroller, 1)) setSticky(true);
		}
		if (direction !== "away" && scroller && !isAtBottom(scroller, atBottomThreshold)) {
			setSticky(false);
			captureVisibleAnchors();
		}
		const scrollTop = scroller ? getScrollTop(scroller) : undefined;
		if (scrollTop !== undefined && updateAtTopFromScrollTop(scrollTop)) requestAtTop();
		else if (isNearTopHistoryIntent(event) && scrollTop !== undefined && scrollTop <= nearTopThreshold) requestNearTop();
		if (userScrollIntentTimerRef.current !== undefined) window.clearTimeout(userScrollIntentTimerRef.current);
		userScrollIntentTimerRef.current = window.setTimeout(() => {
			userScrollIntentRef.current = false;
			userScrollDirectionRef.current = undefined;
			userScrollIntentTimerRef.current = undefined;
		}, USER_SCROLL_INTENT_MS);
	}, [atBottomThreshold, captureVisibleAnchors, clearScheduledScroll, nearTopThreshold, onUserScrollIntent, requestAtTop, requestNearTop, scroller, setSticky, updateAtTopFromScrollTop]);

	const updateFromScrollPosition = useCallback(() => {
		if (!scroller) return;
		const scrollTop = getScrollTop(scroller);
		const previousScrollTop = lastScrollTopRef.current;
		lastScrollTopRef.current = scrollTop;
		const scrollingAwayFromBottom = previousScrollTop !== undefined && scrollTop < previousScrollTop - 1;
		const scrollingTowardBottom = previousScrollTop !== undefined && scrollTop > previousScrollTop + 1;
		if (scrollingAwayFromBottom) bottomReattachArmedRef.current = false;
		else if (scrollingTowardBottom && userScrollDirectionRef.current === "toward") bottomReattachArmedRef.current = true;
		const readingAwayFromBottom = userScrollIntentRef.current || scrollingAwayFromBottom || !stickyRef.current;
		if (userAnchorCaptureArmedRef.current && isPrependingRef.current && pendingAnchorsRef.current !== undefined) {
			captureVisibleAnchors();
			pendingAnchorsRef.current = visibleAnchorsRef.current;
		}
		if (userAnchorCaptureArmedRef.current) {
			if (userAnchorCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorCaptureTimerRef.current);
			userAnchorCaptureTimerRef.current = window.setTimeout(() => {
				captureVisibleAnchors();
				if (isPrependingRef.current && pendingAnchorsRef.current !== undefined) pendingAnchorsRef.current = visibleAnchorsRef.current;
				userAnchorCaptureArmedRef.current = false;
				userAnchorCaptureTimerRef.current = undefined;
			}, USER_ANCHOR_SETTLE_MS);
		}
		if (updateAtTopFromScrollTop(scrollTop)) requestAtTop();
		else if (readingAwayFromBottom && scrollTop <= nearTopThreshold) requestNearTop();
		if (isAtBottom(scroller, atBottomThreshold)) {
			if (shouldReattachStickyAtBottom(bottomReattachArmedRef.current, scrollingAwayFromBottom)) setSticky(true);
			return;
		}
		if (userScrollIntentRef.current || scrollingAwayFromBottom) setSticky(false);
	}, [atBottomThreshold, captureVisibleAnchors, nearTopThreshold, requestAtTop, requestNearTop, scroller, setSticky, updateAtTopFromScrollTop]);

	useEffect(() => {
		if (!scroller) return undefined;
		const target: HTMLElement | Window = scroller;
		const markIntentFromKey = (event: Event) => {
			const key = event instanceof KeyboardEvent ? event.key : "";
			if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(key)) {
				markUserScrollIntent(event);
			}
		};
		const markIntentFromPointer = (event: Event) => {
			if (event.target === target) markUserScrollIntent();
		};
		const rememberTouch = (event: Event) => {
			lastTouchYRef.current = firstTouchClientY(event);
		};
		const markIntentFromTouch = (event: Event) => {
			const currentY = firstTouchClientY(event);
			const previousY = lastTouchYRef.current;
			lastTouchYRef.current = currentY;
			const direction = currentY === undefined || previousY === undefined || currentY === previousY
				? undefined
				: currentY > previousY ? "away" : "toward";
			markUserScrollIntent(event, direction);
		};
		target.addEventListener("wheel", markUserScrollIntent, { passive: true });
		target.addEventListener("touchstart", rememberTouch, { passive: true });
		target.addEventListener("touchmove", markIntentFromTouch, { passive: true });
		target.addEventListener("pointerdown", markIntentFromPointer, { passive: true });
		target.addEventListener("keydown", markIntentFromKey);
		target.addEventListener("scroll", updateFromScrollPosition, { passive: true });
		return () => {
			target.removeEventListener("wheel", markUserScrollIntent);
			target.removeEventListener("touchstart", rememberTouch);
			target.removeEventListener("touchmove", markIntentFromTouch);
			target.removeEventListener("pointerdown", markIntentFromPointer);
			target.removeEventListener("keydown", markIntentFromKey);
			target.removeEventListener("scroll", updateFromScrollPosition);
		};
	}, [markUserScrollIntent, scroller, updateFromScrollPosition]);

	useLayoutEffect(() => {
		lastScrollTopRef.current = undefined;
		if (userAnchorCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorCaptureTimerRef.current);
		userAnchorCaptureTimerRef.current = undefined;
		userAnchorCaptureArmedRef.current = false;
		visibleAnchorsRef.current = [];
		pendingAnchorsRef.current = undefined;
		setAtTop(false);
		setSticky(true, false);
		scheduleScrollToBottom("auto");
	}, [resetKey, scheduleScrollToBottom, setAtTop, setSticky]);

	useLayoutEffect(() => {
		prependTransactionRef.current = false;
		committedItemKeysRef.current = itemKeys;
		committedFirstItemIndexRef.current = firstItemIndexRef.current;
		if (!stickyRef.current && pendingAnchorsRef.current !== undefined) userAnchorCaptureArmedRef.current = false;
		if (stickyRef.current) {
			scheduleScrollToBottom("auto");
		} else {
			restoreVisibleAnchor();
		}
		pendingAnchorsRef.current = undefined;
		return () => {
			if (!stickyRef.current && pendingAnchorsRef.current === undefined) pendingAnchorsRef.current = visibleAnchorsRef.current;
		};
	}, [contentKey, itemCount, itemKeys, restoreVisibleAnchor, scheduleScrollToBottom]);

	useEffect(() => () => {
		clearScheduledScroll();
		if (anchorFrameRef.current !== undefined) cancelAnimationFrame(anchorFrameRef.current);
		if (atTopFrameRef.current !== undefined) cancelAnimationFrame(atTopFrameRef.current);
		if (nearTopFrameRef.current !== undefined) cancelAnimationFrame(nearTopFrameRef.current);
		if (userScrollIntentTimerRef.current !== undefined) window.clearTimeout(userScrollIntentTimerRef.current);
		if (userAnchorCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorCaptureTimerRef.current);
	}, [clearScheduledScroll]);

	const atBottomStateChange = useCallback((atBottom: boolean) => {
		if (atBottom) {
			if (shouldReattachStickyAtBottom(bottomReattachArmedRef.current, false)) setSticky(true);
			return;
		}
		if (userScrollIntentRef.current) setSticky(false);
	}, [setSticky]);

	const followOutput = useCallback((): FollowOutputScalarType => (stickyRef.current ? "auto" : false), []);

	const totalListHeightChanged = useCallback(() => {
		if (stickyRef.current) scheduleScrollToBottom("auto");
		else restoreVisibleAnchor();
	}, [restoreVisibleAnchor, scheduleScrollToBottom]);

	return {
		virtuosoRef,
		firstItemIndex,
		itemsRendered,
		normalizeRange,
		isSticky,
		isAtTop,
		isScrolledToTop,
		captureVisibleAnchor: captureVisibleAnchors,
		prepareForPrepend,
		restoreAnchor,
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

function getClientHeight(scroller: HTMLElement | Window) {
	const element = scroller instanceof Window ? document.scrollingElement : scroller;
	return element?.clientHeight ?? 0;
}

function captureDomVisibleAnchors(scroller: HTMLElement | Window, itemKeys: readonly string[]): StickyVisibleAnchor[] {
	const root = scroller instanceof Window ? document : scroller;
	const viewportTop = scroller instanceof Window ? 0 : scroller.getBoundingClientRect().top;
	const viewportBottom = viewportTop + getClientHeight(scroller);
	return [...root.querySelectorAll<HTMLElement>("[data-index][data-item-index]")]
		.flatMap((element) => {
			const dataIndex = Number(element.dataset.index);
			const key = Number.isInteger(dataIndex) ? itemKeys[dataIndex] : undefined;
			if (key === undefined) return [];
			const rect = element.getBoundingClientRect();
			if (rect.bottom <= viewportTop || rect.top >= viewportBottom) return [];
			return [{ key, dataIndex, offset: rect.top - viewportTop }];
		})
		.sort((left, right) => left.offset - right.offset);
}

function restoreDomVisibleAnchor(
	scroller: HTMLElement | Window,
	location: StickyAnchorLocation,
	anchors: readonly StickyVisibleAnchor[],
	itemKeys: readonly string[],
): boolean {
	const anchor = anchors.find((candidate) => itemKeys.indexOf(candidate.key) === location.index);
	if (!anchor) return false;
	const root = scroller instanceof Window ? document : scroller;
	const row = [...root.querySelectorAll<HTMLElement>("[data-row-id]")]
		.find((element) => element.dataset.rowId === anchor.key);
	const item = row?.closest<HTMLElement>("[data-index][data-item-index]")
		?? root.querySelector<HTMLElement>(`[data-index="${location.index}"][data-item-index]`);
	if (!item) return false;
	const viewportTop = scroller instanceof Window ? 0 : scroller.getBoundingClientRect().top;
	const currentOffset = item.getBoundingClientRect().top - viewportTop;
	const delta = currentOffset - anchor.offset;
	if (Math.abs(delta) > 0.5) setScrollTop(scroller, getScrollTop(scroller) + delta);
	return true;
}

function setScrollTop(scroller: HTMLElement | Window, scrollTop: number) {
	const element = scroller instanceof Window ? document.scrollingElement : scroller;
	if (element) element.scrollTop = scrollTop;
}

function scrollToBottom(scroller: HTMLElement | Window) {
	const element = scroller instanceof Window ? document.scrollingElement : scroller;
	if (element) element.scrollTop = element.scrollHeight;
}

function isNearTopHistoryIntent(event?: Event) {
	if (event instanceof WheelEvent) return event.deltaY < 0;
	if (event instanceof KeyboardEvent) return ["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey);
	return event?.type === "touchmove";
}

function scrollIntentInput(event?: Event) {
	if (event instanceof WheelEvent) return { type: "wheel", deltaY: event.deltaY };
	if (event instanceof KeyboardEvent) return { type: "keydown", key: event.key, shiftKey: event.shiftKey };
	return { type: event?.type };
}

function firstTouchClientY(event: Event): number | undefined {
	if (!(event instanceof TouchEvent)) return undefined;
	return event.touches[0]?.clientY;
}
