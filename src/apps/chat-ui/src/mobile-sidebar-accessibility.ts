import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const MOBILE_SIDEBAR_MEDIA_QUERY = "(max-width: 980px)";

const MOBILE_SIDEBAR_SELECTOR = "[data-pibo-mobile-sidebar]";
const MOBILE_SIDEBAR_BACKDROP_ATTRIBUTE = "data-pibo-mobile-sidebar-backdrop";
const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[contenteditable="true"]',
	'[tabindex]:not([tabindex="-1"])',
].join(",");

type MobileSidebarA11yProps = {
	"aria-hidden"?: true;
	inert?: true;
	role?: "dialog";
	"aria-modal"?: true;
	"aria-label"?: string;
	tabIndex?: -1;
};

type FocusTarget = {
	focus(): void;
};

type BackgroundElementSnapshot = {
	element: HTMLElement;
	ariaHidden: string | null;
	inert: boolean;
};

export function mobileSidebarA11yProps(
	isMobileViewport: boolean,
	isOpen: boolean,
	label: string,
): MobileSidebarA11yProps {
	if (!isMobileViewport) return {};
	if (!isOpen) return { "aria-hidden": true, inert: true };
	return { role: "dialog", "aria-modal": true, "aria-label": label, tabIndex: -1 };
}

export function mobileSidebarInitialFocusTarget<T>(focusable: readonly T[], fallback: T): T {
	return focusable[0] ?? fallback;
}

export function mobileSidebarFocusTarget<T>(
	focusable: readonly T[],
	activeElement: T | null,
	shiftKey: boolean,
): T | null {
	if (focusable.length === 0) return null;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (!focusable.includes(activeElement as T)) return shiftKey ? last : first;
	if (shiftKey && activeElement === first) return last;
	if (!shiftKey && activeElement === last) return first;
	return null;
}

export function mobileSidebarShouldYieldKeyboardEvent(sidebar: HTMLElement, eventTarget: EventTarget | null): boolean {
	if (!eventTarget || typeof (eventTarget as Element).closest !== "function") return false;
	const owningModal = (eventTarget as Element).closest('[role="dialog"][aria-modal="true"]');
	return owningModal !== null && owningModal !== sidebar;
}

export function collectMobileSidebarBackgroundElements(sidebar: HTMLElement, root: HTMLElement): HTMLElement[] {
	const background: HTMLElement[] = [];
	let current: HTMLElement | null = sidebar;
	while (current && current !== root) {
		const parentElement: HTMLElement | null = current.parentElement;
		if (!parentElement) return [];
		for (const sibling of Array.from(parentElement.children) as HTMLElement[]) {
			if (sibling === current || sibling.hasAttribute(MOBILE_SIDEBAR_BACKDROP_ATTRIBUTE)) continue;
			background.push(sibling);
		}
		current = parentElement;
	}
	return current === root ? background : [];
}

export function applyMobileSidebarBackgroundIsolation(sidebar: HTMLElement, root: HTMLElement): () => void {
	const snapshots: BackgroundElementSnapshot[] = collectMobileSidebarBackgroundElements(sidebar, root).map((element) => ({
		element,
		ariaHidden: element.getAttribute("aria-hidden"),
		inert: element.inert,
	}));
	for (const { element } of snapshots) {
		element.inert = true;
		element.setAttribute("aria-hidden", "true");
	}
	return () => {
		for (const { element, ariaHidden, inert } of snapshots) {
			element.inert = inert;
			if (ariaHidden === null) element.removeAttribute("aria-hidden");
			else element.setAttribute("aria-hidden", ariaHidden);
		}
	};
}

function mobileSidebarFocusableElements(sidebar: HTMLElement): HTMLElement[] {
	return Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
		if (element.tabIndex < 0 || element.closest('[inert], [aria-hidden="true"]')) return false;
		const style = window.getComputedStyle(element);
		return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
	});
}

export function useMobileSidebarModal({
	isMobileViewport,
	isOpen,
	onClose,
	triggerRef,
}: {
	isMobileViewport: boolean;
	isOpen: boolean;
	onClose: () => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
}): () => void {
	const restoreTriggerFocusRef = useRef(false);
	const requestClose = useCallback(() => {
		if (isMobileViewport && isOpen) restoreTriggerFocusRef.current = true;
		onClose();
	}, [isMobileViewport, isOpen, onClose]);

	useEffect(() => {
		if (!isMobileViewport || !isOpen) {
			if (isOpen || !restoreTriggerFocusRef.current) return;
			restoreTriggerFocusRef.current = false;
			const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
			return () => window.cancelAnimationFrame(frame);
		}

		const sidebar = document.querySelector<HTMLElement>(MOBILE_SIDEBAR_SELECTOR);
		if (!sidebar) return;

		const restoreBackground = applyMobileSidebarBackgroundIsolation(sidebar, document.body);
		const focusFrame = window.requestAnimationFrame(() => {
			const focusable = mobileSidebarFocusableElements(sidebar);
			mobileSidebarInitialFocusTarget<FocusTarget>(focusable, sidebar).focus();
		});
		const handleKeyDown = (event: KeyboardEvent) => {
			if (mobileSidebarShouldYieldKeyboardEvent(sidebar, event.target)) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				requestClose();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = mobileSidebarFocusableElements(sidebar);
			if (focusable.length === 0) {
				event.preventDefault();
				sidebar.focus();
				return;
			}
			const target = mobileSidebarFocusTarget(
				focusable,
				document.activeElement instanceof HTMLElement ? document.activeElement : null,
				event.shiftKey,
			);
			if (!target) return;
			event.preventDefault();
			target.focus();
		};
		document.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.cancelAnimationFrame(focusFrame);
			document.removeEventListener("keydown", handleKeyDown, true);
			restoreBackground();
		};
	}, [isMobileViewport, isOpen, requestClose, triggerRef]);

	return requestClose;
}

export function useMobileSidebarViewport(): boolean {
	const [isMobileViewport, setIsMobileViewport] = useState(() =>
		typeof window !== "undefined" && window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY).matches,
	);

	useEffect(() => {
		const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_MEDIA_QUERY);
		const update = () => setIsMobileViewport(mediaQuery.matches);
		update();
		mediaQuery.addEventListener("change", update);
		return () => mediaQuery.removeEventListener("change", update);
	}, []);

	return isMobileViewport;
}
