import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

const ACTION_MENU_WIDTH = 192;
const ACTION_MENU_GAP = 4;
const ACTION_MENU_VIEWPORT_MARGIN = 8;
const PAGE_TAB_STOP_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]:not([tabindex='-1'])",
].join(",");

type InitialMenuFocus = "first" | "last";

type ActionMenuProps = {
	label: string;
	children: ReactNode;
	estimatedHeight?: number;
	disabled?: boolean;
};

type ActionMenuItemProps = {
	children: ReactNode;
	onSelect: () => void;
	className?: string;
	disabled?: boolean;
};

const ActionMenuCloseContext = createContext<(() => void) | null>(null);

export function nextActionMenuItemIndex(key: string, currentIndex: number, itemCount: number): number | null {
	if (itemCount <= 0) return null;
	switch (key) {
		case "ArrowDown":
			return (currentIndex + 1 + itemCount) % itemCount;
		case "ArrowUp":
			return (currentIndex - 1 + itemCount) % itemCount;
		case "Home":
			return 0;
		case "End":
			return itemCount - 1;
		default:
			return null;
	}
}

type ActionMenuEscapeEvent = {
	key: string;
	preventDefault(): void;
	stopPropagation(): void;
	stopImmediatePropagation(): void;
};

export function consumeActionMenuEscape(event: ActionMenuEscapeEvent, closeMenu: () => void, restoreFocus: () => void): boolean {
	if (event.key !== "Escape") return false;
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	closeMenu();
	restoreFocus();
	return true;
}

export function ActionMenu({ label, children, estimatedHeight = ACTION_MENU_WIDTH, disabled = false }: ActionMenuProps) {
	const reactId = useId();
	const triggerId = `${reactId}-trigger`;
	const menuId = `${reactId}-menu`;
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	const initialFocusRef = useRef<InitialMenuFocus>("first");
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const updatePosition = useCallback(() => {
		const trigger = triggerRef.current;
		if (!trigger) return;
		const triggerRect = trigger.getBoundingClientRect();
		const menuWidth = menuRef.current?.offsetWidth ?? ACTION_MENU_WIDTH;
		const menuHeight = menuRef.current?.offsetHeight ?? estimatedHeight;
		const maxLeft = Math.max(ACTION_MENU_VIEWPORT_MARGIN, window.innerWidth - menuWidth - ACTION_MENU_VIEWPORT_MARGIN);
		const left = Math.min(Math.max(ACTION_MENU_VIEWPORT_MARGIN, triggerRect.right - menuWidth), maxLeft);
		const belowTop = triggerRect.bottom + ACTION_MENU_GAP;
		const top = belowTop + menuHeight <= window.innerHeight - ACTION_MENU_VIEWPORT_MARGIN
			? belowTop
			: Math.max(ACTION_MENU_VIEWPORT_MARGIN, triggerRect.top - ACTION_MENU_GAP - menuHeight);
		setPosition((current) => current?.top === top && current.left === left ? current : { top, left });
	}, [estimatedHeight]);

	const closeMenu = useCallback(() => {
		setOpen(false);
	}, []);

	const openMenu = (initialFocus: InitialMenuFocus) => {
		if (disabled) return;
		initialFocusRef.current = initialFocus;
		updatePosition();
		setOpen(true);
	};

	const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") ?? []);

	const focusRelativeToTrigger = (backwards: boolean) => {
		const trigger = triggerRef.current;
		if (!trigger) return;
		const tabStops = Array.from(document.querySelectorAll<HTMLElement>(PAGE_TAB_STOP_SELECTOR)).filter((element) => {
			if (menuRef.current?.contains(element)) return false;
			if (element.closest("[inert], [aria-hidden='true']")) return false;
			return element.getClientRects().length > 0;
		});
		const triggerIndex = tabStops.indexOf(trigger);
		if (triggerIndex < 0) return;
		const target = backwards
			? tabStops[triggerIndex - 1] ?? tabStops.at(-1)
			: tabStops[triggerIndex + 1] ?? tabStops[0];
		target?.focus();
	};

	useLayoutEffect(() => {
		if (!open) return;
		updatePosition();
		const items = menuItems();
		const target = initialFocusRef.current === "last" ? items.at(-1) : items[0];
		target?.focus();
	}, [open, updatePosition]);

	useEffect(() => {
		if (disabled && open) {
			closeMenu();
			return;
		}
		if (!open) {
			setPosition(null);
			return;
		}
		const handleViewportChange = () => updatePosition();
		window.addEventListener("resize", handleViewportChange);
		window.addEventListener("scroll", handleViewportChange, true);
		return () => {
			window.removeEventListener("resize", handleViewportChange);
			window.removeEventListener("scroll", handleViewportChange, true);
		};
	}, [closeMenu, disabled, open, updatePosition]);

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
			closeMenu();
		};
		const handleEscape = (event: globalThis.KeyboardEvent) => {
			consumeActionMenuEscape(event, closeMenu, () => triggerRef.current?.focus());
		};
		document.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleEscape, true);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleEscape, true);
		};
	}, [closeMenu, open]);

	const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			openMenu(event.key === "ArrowUp" ? "last" : "first");
		} else if (event.key === "Escape" && open) {
			event.preventDefault();
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation();
			closeMenu();
			triggerRef.current?.focus();
		}
	};

	const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation();
			closeMenu();
			triggerRef.current?.focus();
			return;
		}
		if (event.key === "Tab") {
			event.preventDefault();
			closeMenu();
			focusRelativeToTrigger(event.shiftKey);
			return;
		}
		const items = menuItems();
		const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
		const nextIndex = nextActionMenuItemIndex(event.key, currentIndex, items.length);
		if (nextIndex === null) return;
		event.preventDefault();
		items[nextIndex]?.focus();
	};

	return (
		<div className="relative">
			<button
				ref={triggerRef}
				id={triggerId}
				type="button"
				disabled={disabled}
				onClick={() => open ? closeMenu() : openMenu("first")}
				onKeyDown={handleTriggerKeyDown}
				title={label}
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={menuId}
				className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center rounded-sm text-slate-400 hover:text-[#11a4d4] disabled:cursor-not-allowed disabled:opacity-50"
			>
				<MoreVertical size={12} className="max-[980px]:h-4 max-[980px]:w-4" />
			</button>
			{!disabled && open && position && typeof document !== "undefined" ? createPortal(
				<ActionMenuCloseContext.Provider value={closeMenu}>
					<div
						ref={menuRef}
						id={menuId}
						role="menu"
						aria-labelledby={triggerId}
						onKeyDown={handleMenuKeyDown}
						className="fixed z-[1000] max-h-[calc(100vh-1rem)] w-48 overflow-y-auto bg-[#1a262b] border border-slate-700 rounded-sm shadow-lg py-1"
						style={position}
					>
						{children}
					</div>
				</ActionMenuCloseContext.Provider>,
				document.body,
			) : null}
		</div>
	);
}

export function ActionMenuItem({ children, onSelect, className = "text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4]", disabled = false }: ActionMenuItemProps) {
	const closeMenu = useContext(ActionMenuCloseContext);
	if (!closeMenu) throw new Error("ActionMenuItem must be rendered inside ActionMenu");
	return (
		<button
			type="button"
			role="menuitem"
			tabIndex={-1}
			disabled={disabled}
			onClick={() => {
				closeMenu();
				onSelect();
			}}
			className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 ${className}`}
		>
			{children}
		</button>
	);
}
