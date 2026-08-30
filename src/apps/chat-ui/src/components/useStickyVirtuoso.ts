import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FollowOutputScalarType, ListItem, ListRange, VirtuosoHandle } from "react-virtuoso";
import {
	captureStickyVisibleAnchors,
	preferredStickyVisibleAnchor,
	prependedItemCount,
	resolveScrollbarDragMovement,
	shouldReattachStickyAtBottom,
	stickyAnchorLocation,
	stickyPointerScrollMode,
	stickyScrollIntentDirection,
	stickyScrollPositionDirection,
	stickyTouchScrollIntentDirection,
	type StickyAnchorLocation,
	type StickyPointerScrollMode,
	type StickyScrollIntentDirection,
	type StickyVisibleAnchor,
} from "./stickyVirtuosoState";

const DEFAULT_BOTTOM_THRESHOLD = 24;
const USER_SCROLL_INTENT_MS = 700;
const USER_ANCHOR_SETTLE_MS = 120;
const USER_ANCHOR_FINAL_CAPTURE_MS = 500;
const CONTENT_ANCHOR_SETTLE_MS = 250;
const CONTENT_ANCHOR_RELEASE_MS = 100;
const MIDDLE_AUTOSCROLL_INACTIVITY_MS = 1_500;

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
	onUserScrollIntent?: (event?: Event, direction?: StickyScrollIntentDirection) => void;
	onScrollbarDragChange?: (active: boolean) => void;
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
	onScrollbarDragChange,
	onVisibleAnchorChange,
}: StickyVirtuosoOptions) {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const itemCountRef = useRef(itemCount);
	const isPrependingRef = useRef(isPrepending);
	isPrependingRef.current = isPrepending;
	const stickyRef = useRef(true);
	const scrollFrameRef = useRef<number | undefined>(undefined);
	const anchorFrameRef = useRef<number | undefined>(undefined);
	const prependSettleFrameRef = useRef<number | undefined>(undefined);
	const atTopFrameRef = useRef<number | undefined>(undefined);
	const nearTopFrameRef = useRef<number | undefined>(undefined);
	const userScrollIntentRef = useRef(false);
	const userScrollDirectionRef = useRef<StickyScrollIntentDirection | undefined>(undefined);
	const userAnchorCaptureArmedRef = useRef(false);
	const bottomReattachArmedRef = useRef(false);
	const userScrollIntentTimerRef = useRef<number | undefined>(undefined);
	const userAnchorCaptureTimerRef = useRef<number | undefined>(undefined);
	const userAnchorFinalCaptureTimerRef = useRef<number | undefined>(undefined);
	const pointerScrollModeRef = useRef<StickyPointerScrollMode | undefined>(undefined);
	const pointerReleaseFrameRef = useRef<number | undefined>(undefined);
	const lastScrollbarPointerYRef = useRef<number | undefined>(undefined);
	const scrollbarPointerDirectionRef = useRef<StickyScrollIntentDirection | undefined>(undefined);
	const scrollbarOppositeScrollCountRef = useRef(0);
	const scrollbarMonotonicScrollTopRef = useRef<number | undefined>(undefined);
	const middleAutoscrollTimerRef = useRef<number | undefined>(undefined);
	const lastTouchYRef = useRef<number | undefined>(undefined);
	const lastScrollTopRef = useRef<number | undefined>(undefined);
	const renderedItemsRef = useRef<readonly ListItem<unknown>[]>([]);
	const visibleAnchorsRef = useRef<readonly StickyVisibleAnchor[]>([]);
	const visibleAnchorItemKeysRef = useRef<readonly string[]>(itemKeys);
	const restoredAnchorLockRef = useRef<StickyVisibleAnchor | undefined>(undefined);
	const contentAnchorLockRef = useRef<{ anchors: readonly StickyVisibleAnchor[]; itemKeys: readonly string[] } | undefined>(undefined);
	const contentAnchorSettleTimerRef = useRef<number | undefined>(undefined);
	const contentAnchorReleaseTimerRef = useRef<number | undefined>(undefined);
	const pendingAnchorsRef = useRef<readonly StickyVisibleAnchor[] | undefined>(undefined);
	const pendingAnchorItemKeysRef = useRef<readonly string[] | undefined>(undefined);
	const committedItemKeysRef = useRef(itemKeys);
	const firstItemIndexRef = useRef(INITIAL_FIRST_ITEM_INDEX);
	const committedFirstItemIndexRef = useRef(INITIAL_FIRST_ITEM_INDEX);
	const previousItemsRef = useRef({ resetKey, itemKeys });
	const prependTransactionRef = useRef(false);
	const virtuosoPrependPendingRef = useRef(false);
	const atTopRef = useRef(false);
	const [isSticky, setIsStickyState] = useState(true);
	const [isAtTop, setIsAtTopState] = useState(false);
	const [scroller, setScroller] = useState<HTMLElement | Window | null>(null);

	const previousItems = previousItemsRef.current;
	if (!Object.is(previousItems.resetKey, resetKey)) {
		firstItemIndexRef.current = INITIAL_FIRST_ITEM_INDEX;
		prependTransactionRef.current = false;
		virtuosoPrependPendingRef.current = false;
	} else {
		const prependedCount = prependedItemCount(previousItems.itemKeys, itemKeys);
		prependTransactionRef.current = prependedCount > 0;
		if (prependedCount > 0) {
			firstItemIndexRef.current -= prependedCount;
			virtuosoPrependPendingRef.current = true;
		}
	}
	previousItemsRef.current = { resetKey, itemKeys };
	const firstItemIndex = firstItemIndexRef.current;

	useLayoutEffect(() => {
		itemCountRef.current = itemCount;
	}, [itemCount]);

	const clearAnchorLocks = useCallback(() => {
		restoredAnchorLockRef.current = undefined;
		contentAnchorLockRef.current = undefined;
		if (contentAnchorSettleTimerRef.current !== undefined) window.clearTimeout(contentAnchorSettleTimerRef.current);
		if (contentAnchorReleaseTimerRef.current !== undefined) window.clearTimeout(contentAnchorReleaseTimerRef.current);
		contentAnchorSettleTimerRef.current = undefined;
		contentAnchorReleaseTimerRef.current = undefined;
	}, []);

	const stageContentAnchorLock = useCallback(() => {
		if (stickyRef.current || contentAnchorLockRef.current || !visibleAnchorsRef.current.length) return;
		contentAnchorLockRef.current = {
			anchors: visibleAnchorsRef.current,
			itemKeys: visibleAnchorItemKeysRef.current,
		};
	}, []);

	const setSticky = useCallback((next: boolean, notifyAnchorChange = true) => {
		const wasSticky = stickyRef.current;
		stickyRef.current = next;
		if (next) {
			clearAnchorLocks();
			if (!wasSticky && notifyAnchorChange) onVisibleAnchorChange?.(undefined);
			bottomReattachArmedRef.current = false;
			if (anchorFrameRef.current !== undefined) cancelAnimationFrame(anchorFrameRef.current);
			anchorFrameRef.current = undefined;
		}
		setIsStickyState(next);
	}, [clearAnchorLocks, onVisibleAnchorChange]);

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
		const itemKeys = committedItemKeysRef.current;
		const restoredAnchor = restoredAnchorLockRef.current;
		if (restoredAnchor) {
			const dataIndex = itemKeys.indexOf(restoredAnchor.key);
			if (dataIndex >= 0) {
				const lockedAnchor = { ...restoredAnchor, dataIndex };
				visibleAnchorsRef.current = [lockedAnchor];
				visibleAnchorItemKeysRef.current = itemKeys;
				onVisibleAnchorChange?.(lockedAnchor);
				return lockedAnchor;
			}
		}
		const domAnchors = captureDomVisibleAnchors(scroller, itemKeys);
		visibleAnchorsRef.current = domAnchors.length ? domAnchors : captureStickyVisibleAnchors({
			items: renderedItemsRef.current,
			itemKeys: committedItemKeysRef.current,
			firstItemIndex: committedFirstItemIndexRef.current,
			scrollTop: getScrollTop(scroller),
			viewportHeight: getClientHeight(scroller),
		});
		visibleAnchorItemKeysRef.current = committedItemKeysRef.current;
		const anchor = preferredStickyVisibleAnchor(visibleAnchorsRef.current);
		onVisibleAnchorChange?.(anchor);
		return anchor;
	}, [onVisibleAnchorChange, scroller]);

	const stageVisibleAnchors = useCallback(() => {
		pendingAnchorsRef.current = visibleAnchorsRef.current;
		pendingAnchorItemKeysRef.current = visibleAnchorItemKeysRef.current;
	}, []);

	const itemsRendered = useCallback((items: ListItem<unknown>[]) => {
		renderedItemsRef.current = items;
	}, []);

	const restoreVisibleAnchor = useCallback((allowDuringPrepend = false) => {
		if (stickyRef.current || userAnchorCaptureArmedRef.current || pointerScrollModeRef.current !== undefined || (virtuosoPrependPendingRef.current && !allowDuringPrepend)) return;
		const itemKeys = committedItemKeysRef.current;
		const restoredAnchor = restoredAnchorLockRef.current;
		const restoredAnchorIndex = restoredAnchor ? itemKeys.indexOf(restoredAnchor.key) : -1;
		const contentAnchorLock = contentAnchorLockRef.current;
		const pendingAnchors = pendingAnchorsRef.current;
		const anchors = restoredAnchorIndex >= 0
			? [{ ...restoredAnchor!, dataIndex: restoredAnchorIndex }]
			: contentAnchorLock?.anchors ?? pendingAnchors ?? visibleAnchorsRef.current;
		const previousKeys = restoredAnchorIndex >= 0
			? itemKeys
			: contentAnchorLock?.itemKeys ?? (pendingAnchors ? pendingAnchorItemKeysRef.current : visibleAnchorItemKeysRef.current) ?? [];
		const location = stickyAnchorLocation({ anchors, previousKeys, nextKeys: itemKeys });
		if (!location) return;
		const restore = () => {
			if (stickyRef.current || userAnchorCaptureArmedRef.current || pointerScrollModeRef.current !== undefined) return false;
			const restoredInDom = Boolean(scroller && restoreDomVisibleAnchor(scroller, location, anchors, itemKeys));
			if (!restoredInDom && !virtuosoPrependPendingRef.current) virtuosoRef.current?.scrollToIndex(location);
			return restoredInDom;
		};
		const restoredImmediately = restore();
		if (virtuosoPrependPendingRef.current && !restoredImmediately) return;
		if (anchorFrameRef.current !== undefined) cancelAnimationFrame(anchorFrameRef.current);
		anchorFrameRef.current = requestAnimationFrame(() => {
			restore();
			anchorFrameRef.current = requestAnimationFrame(() => {
				anchorFrameRef.current = undefined;
				restore();
				captureVisibleAnchors();
			});
		});
	}, [captureVisibleAnchors, scroller]);

	const scheduleContentAnchorSettle = useCallback(() => {
		if (!contentAnchorLockRef.current) return;
		if (contentAnchorSettleTimerRef.current !== undefined) window.clearTimeout(contentAnchorSettleTimerRef.current);
		if (contentAnchorReleaseTimerRef.current !== undefined) window.clearTimeout(contentAnchorReleaseTimerRef.current);
		contentAnchorSettleTimerRef.current = window.setTimeout(() => {
			contentAnchorSettleTimerRef.current = undefined;
			restoreVisibleAnchor(true);
			contentAnchorReleaseTimerRef.current = window.setTimeout(() => {
				contentAnchorReleaseTimerRef.current = undefined;
				contentAnchorLockRef.current = undefined;
				captureVisibleAnchors();
			}, CONTENT_ANCHOR_RELEASE_MS);
		}, CONTENT_ANCHOR_SETTLE_MS);
	}, [captureVisibleAnchors, restoreVisibleAnchor]);

	const prepareForPrepend = useCallback(() => {
		if (stickyRef.current) return;
		captureVisibleAnchors();
		stageVisibleAnchors();
		userAnchorCaptureArmedRef.current = false;
	}, [captureVisibleAnchors, stageVisibleAnchors]);

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
		clearAnchorLocks();
		setSticky(false);
		userAnchorCaptureArmedRef.current = false;
		restoredAnchorLockRef.current = { ...anchor, dataIndex: index };
		visibleAnchorsRef.current = [{ ...anchor, dataIndex: index }];
		visibleAnchorItemKeysRef.current = itemKeys;
		stageVisibleAnchors();
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
				captureVisibleAnchors();
			});
		});
		return true;
	}, [captureVisibleAnchors, clearAnchorLocks, clearScheduledScroll, scroller, setSticky, stageVisibleAnchors]);

	const requestNearTop = useCallback(() => {
		if (!onNearTop || !scroller) return;
		if (nearTopFrameRef.current !== undefined) return;
		nearTopFrameRef.current = requestAnimationFrame(() => {
			nearTopFrameRef.current = undefined;
			if (!onNearTop || !scroller) return;
			if (getScrollTop(scroller) <= nearTopThreshold) {
				captureVisibleAnchors();
				stageVisibleAnchors();
				onNearTop();
			}
		});
	}, [captureVisibleAnchors, nearTopThreshold, onNearTop, scroller, stageVisibleAnchors]);

	const scheduleScrollToBottom = useCallback((_behavior: NativeScrollBehavior = "auto") => {
		clearScheduledScroll();
		scrollFrameRef.current = requestAnimationFrame(() => {
			scrollFrameRef.current = undefined;
			if (!stickyRef.current || itemCountRef.current < 1) return;

			// Keep one bottom target. Virtuoso follows appended rows, while the native
			// maximum catches measured growth inside the last rendered item.
			virtuosoRef.current?.autoscrollToBottom();
			if (scroller) scrollToBottom(scroller);
			requestAnimationFrame(() => {
				if (!stickyRef.current) return;
				if (scroller) scrollToBottom(scroller);
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
				stageVisibleAnchors();
				onAtTop();
			}
		});
	}, [captureVisibleAnchors, onAtTop, scroller, stageVisibleAnchors, updateAtTopFromScrollTop]);

	const isScrolledToTop = useCallback(() => {
		if (!scroller) return false;
		return updateAtTopFromScrollTop(getScrollTop(scroller));
	}, [scroller, updateAtTopFromScrollTop]);

	const stickToBottom = useCallback((behavior: NativeScrollBehavior = "auto") => {
		setSticky(true);
		scheduleScrollToBottom(behavior);
	}, [scheduleScrollToBottom, setSticky]);

	const scrollToIndex = useCallback((index: number, align: StickyScrollAlign = "center", behavior: StickyScrollBehavior = "auto", options: StickyScrollToIndexOptions = {}) => {
		clearAnchorLocks();
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
	}, [clearAnchorLocks, clearScheduledScroll, setSticky]);

	const markUserScrollIntent = useCallback((event?: Event, directionOverride?: StickyScrollIntentDirection) => {
		clearAnchorLocks();
		userScrollIntentRef.current = true;
		const direction = directionOverride ?? stickyScrollIntentDirection(scrollIntentInput(event));
		onUserScrollIntent?.(event, direction);
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
	}, [atBottomThreshold, captureVisibleAnchors, clearAnchorLocks, clearScheduledScroll, nearTopThreshold, onUserScrollIntent, requestAtTop, requestNearTop, scroller, setSticky, updateAtTopFromScrollTop]);

	const clearPointerScrollMode = useCallback((expectedMode?: StickyPointerScrollMode) => {
		const currentMode = pointerScrollModeRef.current;
		if (!currentMode || (expectedMode && currentMode !== expectedMode)) return;
		pointerScrollModeRef.current = undefined;
		if (middleAutoscrollTimerRef.current !== undefined) window.clearTimeout(middleAutoscrollTimerRef.current);
		middleAutoscrollTimerRef.current = undefined;
		if (currentMode === "scrollbar") {
			lastScrollbarPointerYRef.current = undefined;
			scrollbarPointerDirectionRef.current = undefined;
			scrollbarOppositeScrollCountRef.current = 0;
			scrollbarMonotonicScrollTopRef.current = undefined;
			captureVisibleAnchors();
			stageVisibleAnchors();
			onScrollbarDragChange?.(false);
		}
		if (scroller && isAtBottom(scroller, 1) && userScrollDirectionRef.current !== "away") setSticky(true);
	}, [captureVisibleAnchors, onScrollbarDragChange, scroller, setSticky, stageVisibleAnchors]);

	const updateFromScrollPosition = useCallback(() => {
		if (!scroller) return;
		const scrollTop = getScrollTop(scroller);
		const previousScrollTop = lastScrollTopRef.current;
		const pointerScrollMode = pointerScrollModeRef.current;
		const scrollbarMonotonicScrollTop = scrollbarMonotonicScrollTopRef.current;
		if (pointerScrollMode === "scrollbar") {
			const movement = resolveScrollbarDragMovement({
				direction: scrollbarPointerDirectionRef.current,
				oppositeCount: scrollbarOppositeScrollCountRef.current,
				previousScrollTop: scrollbarMonotonicScrollTop,
				scrollTop,
			});
			scrollbarPointerDirectionRef.current = movement.direction;
			scrollbarOppositeScrollCountRef.current = movement.oppositeCount;
			if (movement.clamp && scrollbarMonotonicScrollTop !== undefined) {
				setScrollTop(scroller, scrollbarMonotonicScrollTop);
				return;
			}
			scrollbarMonotonicScrollTopRef.current = scrollTop;
		}
		lastScrollTopRef.current = scrollTop;
		const hasUserScrollIntent = userScrollIntentRef.current || pointerScrollMode !== undefined;
		const scrollPositionDirection = stickyScrollPositionDirection({
			hasUserScrollIntent,
			previousScrollTop,
			scrollTop,
		});
		if (scrollPositionDirection && pointerScrollMode) {
			userScrollDirectionRef.current = scrollPositionDirection;
			onUserScrollIntent?.(undefined, scrollPositionDirection);
		}
		if (pointerScrollMode === "middle") {
			if (middleAutoscrollTimerRef.current !== undefined) window.clearTimeout(middleAutoscrollTimerRef.current);
			middleAutoscrollTimerRef.current = window.setTimeout(() => clearPointerScrollMode("middle"), MIDDLE_AUTOSCROLL_INACTIVITY_MS);
		}
		const scrollingAwayFromBottom = scrollPositionDirection === "away";
		const scrollingTowardBottom = scrollPositionDirection === "toward";
		if (scrollingAwayFromBottom) bottomReattachArmedRef.current = false;
		else if (scrollingTowardBottom && userScrollDirectionRef.current === "toward") bottomReattachArmedRef.current = true;
		const readingAwayFromBottom = hasUserScrollIntent || scrollingAwayFromBottom || !stickyRef.current;
		if (userAnchorCaptureArmedRef.current && isPrependingRef.current && pendingAnchorsRef.current !== undefined) {
			captureVisibleAnchors();
			stageVisibleAnchors();
		}
		if (userAnchorCaptureArmedRef.current) {
			if (userAnchorCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorCaptureTimerRef.current);
			if (userAnchorFinalCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorFinalCaptureTimerRef.current);
			userAnchorCaptureTimerRef.current = window.setTimeout(() => {
				captureVisibleAnchors();
				if (isPrependingRef.current && pendingAnchorsRef.current !== undefined) stageVisibleAnchors();
				userAnchorCaptureArmedRef.current = false;
				userAnchorCaptureTimerRef.current = undefined;
			}, USER_ANCHOR_SETTLE_MS);
			userAnchorFinalCaptureTimerRef.current = window.setTimeout(() => {
				userAnchorFinalCaptureTimerRef.current = undefined;
				if (stickyRef.current || pointerScrollModeRef.current !== undefined) return;
				captureVisibleAnchors();
				if (isPrependingRef.current && pendingAnchorsRef.current !== undefined) stageVisibleAnchors();
			}, USER_ANCHOR_FINAL_CAPTURE_MS);
		}
		if (updateAtTopFromScrollTop(scrollTop)) {
			if (hasUserScrollIntent && userScrollDirectionRef.current === "away") requestAtTop();
		} else if (readingAwayFromBottom && scrollTop <= nearTopThreshold) requestNearTop();
		if (isAtBottom(scroller, atBottomThreshold)) {
			if (shouldReattachStickyAtBottom(bottomReattachArmedRef.current, scrollingAwayFromBottom)) setSticky(true);
			return;
		}
		if (hasUserScrollIntent) setSticky(false);
	}, [atBottomThreshold, captureVisibleAnchors, clearPointerScrollMode, nearTopThreshold, onUserScrollIntent, requestAtTop, requestNearTop, scroller, setSticky, stageVisibleAnchors, updateAtTopFromScrollTop]);

	useLayoutEffect(() => {
		if (!scroller || typeof MutationObserver === "undefined") return undefined;
		const target = scroller instanceof Window ? document.scrollingElement : scroller;
		if (!target) return undefined;
		const preserveReadingTarget = () => {
			if (stickyRef.current) {
				scrollToBottom(scroller);
				return;
			}
			if (contentAnchorLockRef.current) scheduleContentAnchorSettle();
			restoreVisibleAnchor(true);
		};
		const resizeObserver = typeof ResizeObserver === "undefined"
			? undefined
			: new ResizeObserver(preserveReadingTarget);
		const observeItemList = () => {
			const itemList = target.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]');
			if (itemList) resizeObserver?.observe(itemList);
		};
		const mutationObserver = new MutationObserver(() => {
			observeItemList();
			preserveReadingTarget();
		});
		observeItemList();
		mutationObserver.observe(target, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["style", "data-index", "data-item-index"],
		});
		return () => {
			mutationObserver.disconnect();
			resizeObserver?.disconnect();
		};
	}, [restoreVisibleAnchor, scheduleContentAnchorSettle, scroller]);

	useEffect(() => {
		if (!scroller) return undefined;
		const target: HTMLElement | Window = scroller;
		const markIntentFromKey = (event: Event) => {
			const key = event instanceof KeyboardEvent ? event.key : "";
			if (key === "Escape") clearPointerScrollMode("middle");
			if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(key)) {
				clearPointerScrollMode("middle");
				markUserScrollIntent(event);
			}
		};
		const markIntentFromPointer = (event: Event) => {
			if (!(event instanceof PointerEvent)) return;
			const mode = pointerScrollMode(event, target);
			if (!mode) {
				if (event.button === 0) clearPointerScrollMode("middle");
				return;
			}
			if (mode === "middle" && pointerScrollModeRef.current === "middle") {
				clearPointerScrollMode("middle");
				return;
			}
			clearAnchorLocks();
			pointerScrollModeRef.current = mode;
			bottomReattachArmedRef.current = false;
			clearScheduledScroll();
			setSticky(false);
			captureVisibleAnchors();
			if (mode === "scrollbar") {
				lastScrollbarPointerYRef.current = event.clientY;
				scrollbarPointerDirectionRef.current = undefined;
				scrollbarOppositeScrollCountRef.current = 0;
				const scrollTop = getScrollTop(target);
				scrollbarMonotonicScrollTopRef.current = scrollTop;
				lastScrollTopRef.current = scrollTop;
				onScrollbarDragChange?.(true);
			}
			markUserScrollIntent(event);
		};
		const trackScrollbarPointer = (event: Event) => {
			if (pointerScrollModeRef.current !== "scrollbar" || !(event instanceof PointerEvent)) return;
			const previousY = lastScrollbarPointerYRef.current;
			lastScrollbarPointerYRef.current = event.clientY;
			if (previousY === undefined) return;
			const nextDirection = event.clientY < previousY - 0.5
				? "away"
				: event.clientY > previousY + 0.5
					? "toward"
					: undefined;
			if (!nextDirection || nextDirection === scrollbarPointerDirectionRef.current) return;
			scrollbarPointerDirectionRef.current = nextDirection;
			scrollbarOppositeScrollCountRef.current = 0;
			scrollbarMonotonicScrollTopRef.current = getScrollTop(target);
		};
		const finishScrollbarDrag = (event: Event) => {
			if (pointerScrollModeRef.current !== "scrollbar") return;
			const edge = event.type === "pointerup" ? scrollbarReleaseEdge(event, target) : undefined;
			if (!edge) {
				clearPointerScrollMode("scrollbar");
				return;
			}
			scrollbarPointerDirectionRef.current = edge === "top" ? "away" : "toward";
			scrollbarOppositeScrollCountRef.current = 0;
			scrollbarMonotonicScrollTopRef.current = getScrollTop(target);
			if (edge === "top") setScrollTop(target, 0);
			else scrollToBottom(target);
			if (pointerReleaseFrameRef.current !== undefined) cancelAnimationFrame(pointerReleaseFrameRef.current);
			pointerReleaseFrameRef.current = requestAnimationFrame(() => {
				pointerReleaseFrameRef.current = undefined;
				clearPointerScrollMode("scrollbar");
			});
		};
		const rememberTouch = (event: Event) => {
			lastTouchYRef.current = firstTouchClientY(event);
		};
		const markIntentFromTouch = (event: Event) => {
			clearPointerScrollMode("middle");
			const currentY = firstTouchClientY(event);
			const previousY = lastTouchYRef.current;
			lastTouchYRef.current = currentY;
			markUserScrollIntent(event, stickyTouchScrollIntentDirection(previousY, currentY));
		};
		const markIntentFromWheel = (event: Event) => {
			clearPointerScrollMode("middle");
			markUserScrollIntent(event);
		};
		target.addEventListener("wheel", markIntentFromWheel, { passive: true });
		target.addEventListener("touchstart", rememberTouch, { passive: true });
		target.addEventListener("touchmove", markIntentFromTouch, { passive: true });
		target.addEventListener("pointerdown", markIntentFromPointer, { passive: true });
		target.addEventListener("keydown", markIntentFromKey);
		target.addEventListener("scroll", updateFromScrollPosition, { passive: true });
		window.addEventListener("pointermove", trackScrollbarPointer, { passive: true });
		window.addEventListener("pointerup", finishScrollbarDrag, { passive: true });
		window.addEventListener("pointercancel", finishScrollbarDrag, { passive: true });
		return () => {
			target.removeEventListener("wheel", markIntentFromWheel);
			target.removeEventListener("touchstart", rememberTouch);
			target.removeEventListener("touchmove", markIntentFromTouch);
			target.removeEventListener("pointerdown", markIntentFromPointer);
			target.removeEventListener("keydown", markIntentFromKey);
			target.removeEventListener("scroll", updateFromScrollPosition);
			window.removeEventListener("pointermove", trackScrollbarPointer);
			window.removeEventListener("pointerup", finishScrollbarDrag);
			window.removeEventListener("pointercancel", finishScrollbarDrag);
		};
	}, [captureVisibleAnchors, clearAnchorLocks, clearPointerScrollMode, clearScheduledScroll, markUserScrollIntent, onScrollbarDragChange, scroller, setSticky, updateFromScrollPosition]);

	useLayoutEffect(() => {
		clearAnchorLocks();
		lastScrollTopRef.current = undefined;
		if (userAnchorCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorCaptureTimerRef.current);
		if (userAnchorFinalCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorFinalCaptureTimerRef.current);
		userAnchorCaptureTimerRef.current = undefined;
		userAnchorFinalCaptureTimerRef.current = undefined;
		userAnchorCaptureArmedRef.current = false;
		visibleAnchorsRef.current = [];
		visibleAnchorItemKeysRef.current = [];
		pendingAnchorsRef.current = undefined;
		pendingAnchorItemKeysRef.current = undefined;
		setAtTop(false);
		setSticky(true, false);
		scheduleScrollToBottom("auto");
	}, [clearAnchorLocks, resetKey, scheduleScrollToBottom, setAtTop, setSticky]);

	const schedulePrependSettle = useCallback(() => {
		if (prependSettleFrameRef.current !== undefined) cancelAnimationFrame(prependSettleFrameRef.current);
		prependSettleFrameRef.current = requestAnimationFrame(() => {
			prependSettleFrameRef.current = requestAnimationFrame(() => {
				prependSettleFrameRef.current = undefined;
				virtuosoPrependPendingRef.current = false;
				restoreVisibleAnchor();
			});
		});
	}, [restoreVisibleAnchor]);

	useLayoutEffect(() => {
		const wasPrependTransaction = prependTransactionRef.current;
		prependTransactionRef.current = false;
		committedItemKeysRef.current = itemKeys;
		committedFirstItemIndexRef.current = firstItemIndexRef.current;
		if (!stickyRef.current && pendingAnchorsRef.current !== undefined) userAnchorCaptureArmedRef.current = false;
		if (stickyRef.current) {
			scheduleScrollToBottom("auto");
		} else if (wasPrependTransaction) {
			schedulePrependSettle();
		} else {
			restoreVisibleAnchor();
		}
		if (!stickyRef.current && contentAnchorLockRef.current) scheduleContentAnchorSettle();
		pendingAnchorsRef.current = undefined;
		pendingAnchorItemKeysRef.current = undefined;
		return () => {
			if (!stickyRef.current) stageContentAnchorLock();
			if (!stickyRef.current && pendingAnchorsRef.current === undefined) stageVisibleAnchors();
		};
	}, [contentKey, itemCount, itemKeys, restoreVisibleAnchor, scheduleContentAnchorSettle, schedulePrependSettle, scheduleScrollToBottom, stageContentAnchorLock, stageVisibleAnchors]);

	useEffect(() => () => {
		clearAnchorLocks();
		clearScheduledScroll();
		if (anchorFrameRef.current !== undefined) cancelAnimationFrame(anchorFrameRef.current);
		if (prependSettleFrameRef.current !== undefined) cancelAnimationFrame(prependSettleFrameRef.current);
		if (atTopFrameRef.current !== undefined) cancelAnimationFrame(atTopFrameRef.current);
		if (nearTopFrameRef.current !== undefined) cancelAnimationFrame(nearTopFrameRef.current);
		if (userScrollIntentTimerRef.current !== undefined) window.clearTimeout(userScrollIntentTimerRef.current);
		if (userAnchorCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorCaptureTimerRef.current);
		if (userAnchorFinalCaptureTimerRef.current !== undefined) window.clearTimeout(userAnchorFinalCaptureTimerRef.current);
		if (pointerReleaseFrameRef.current !== undefined) cancelAnimationFrame(pointerReleaseFrameRef.current);
		if (middleAutoscrollTimerRef.current !== undefined) window.clearTimeout(middleAutoscrollTimerRef.current);
	}, [clearAnchorLocks, clearScheduledScroll]);

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
		else if (virtuosoPrependPendingRef.current) schedulePrependSettle();
		else restoreVisibleAnchor();
	}, [restoreVisibleAnchor, schedulePrependSettle, scheduleScrollToBottom]);

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

function pointerScrollMode(event: PointerEvent, target: HTMLElement | Window): StickyPointerScrollMode | undefined {
	const element = (target instanceof Window ? document.scrollingElement : target) as HTMLElement | null;
	const rect = element?.getBoundingClientRect();
	return stickyPointerScrollMode({
		button: event.button,
		targetIsScroller: event.target === target,
		clientX: event.clientX,
		scrollerRight: rect?.right,
		verticalScrollbarWidth: element ? element.offsetWidth - element.clientWidth : undefined,
	});
}

function scrollbarReleaseEdge(event: Event, target: HTMLElement | Window): "top" | "bottom" | undefined {
	if (!(event instanceof PointerEvent)) return undefined;
	const element = (target instanceof Window ? document.scrollingElement : target) as HTMLElement | null;
	const rect = element?.getBoundingClientRect();
	if (!element || !rect) return undefined;
	const edgeSize = Math.max(12, element.offsetWidth - element.clientWidth) * 2;
	if (event.clientY <= rect.top + edgeSize) return "top";
	if (event.clientY >= rect.bottom - edgeSize) return "bottom";
	return undefined;
}

function firstTouchClientY(event: Event): number | undefined {
	if (!(event instanceof TouchEvent)) return undefined;
	return event.touches[0]?.clientY;
}
