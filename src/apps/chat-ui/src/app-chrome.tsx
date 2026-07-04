import type { RefObject } from "react";
import { AlertTriangle, LogOut, List, Menu, UserRound } from "lucide-react";
import { signInWithGoogle, signOut } from "./api-auth";
import type { BootstrapData } from "./types";

export type AppArea = "sessions" | "projects" | "workflows" | "cron" | "ralph" | "agents" | "context" | "settings";

const MAIN_NAV_AREAS: readonly AppArea[] = ["sessions", "projects", "workflows", "cron", "ralph", "agents", "context", "settings"];

type AppHeaderProps = {
	area: AppArea;
	identity: BootstrapData["identity"];
	mobileAreaMenuOpen: boolean;
	mobileAreaMenuRef: RefObject<HTMLDivElement | null>;
	totalRoomUnreadCount: number;
	onOpenMobileSidebar: () => void;
	onSelectMainNavArea: (area: AppArea) => void;
	onToggleMobileAreaMenu: () => void;
};

export function FallbackGatewayBanner() {
	return (
		<div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center text-sm font-bold py-1.5 px-4 flex items-center justify-center gap-2 shadow-lg">
			<AlertTriangle size={16} />
			Recovery Mode: Main gateway is down. You are connected to a fallback instance.
		</div>
	);
}

export function AppHeader({
	area,
	identity,
	mobileAreaMenuOpen,
	mobileAreaMenuRef,
	totalRoomUnreadCount,
	onOpenMobileSidebar,
	onSelectMainNavArea,
	onToggleMobileAreaMenu,
}: AppHeaderProps) {
	const identityLabel = identity.email || identity.name || identity.userId;
	return (
		<header className="relative flex items-center gap-3 px-4 bg-[#1a262b] border-b border-slate-800 min-h-14 max-[980px]:px-3">
			<div className="flex min-w-0 items-center gap-2">
				<button
					type="button"
					onClick={onOpenMobileSidebar}
					className="min-[981px]:hidden shrink-0 p-1.5 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
					title="Open sidebar"
					aria-label="Open sidebar"
				>
					<Menu size={16} />
				</button>
				<img src="/apps/chat/assets/pwa-images/android/launchericon-512x512.png" alt="Logo" className="h-5 w-auto shrink-0" />
				<div className="truncate font-extrabold tracking-[0.08em] uppercase text-lg max-[420px]:text-base">Pibo Chat</div>
			</div>
			<nav className="flex gap-1 max-[1200px]:hidden min-[1201px]:absolute min-[1201px]:left-1/2 min-[1201px]:-translate-x-1/2">
				{MAIN_NAV_AREAS.map((item) => (
					<button
						key={item}
						type="button"
						onClick={() => onSelectMainNavArea(item)}
						className={`h-8 px-3 border rounded-sm text-xs uppercase tracking-wider ${
							area === item ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-700 text-slate-400"
						}`}
					>
						<span className="inline-flex items-center gap-1.5">
							<span>{item}</span>
							{item === "sessions" ? <MobileUnreadBadge count={totalRoomUnreadCount} /> : null}
						</span>
					</button>
				))}
			</nav>
			<div className="ml-auto flex shrink-0 items-center justify-end gap-2 text-xs text-slate-400 min-[1201px]:ml-0">
				<UserRound size={14} />
				<span className="truncate max-[600px]:hidden">{identityLabel}</span>
				<button type="button" onClick={() => void signOut().then(() => location.reload())} className="p-1 border border-slate-700 rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4]" title="Sign out" aria-label="Sign out">
					<LogOut size={14} />
				</button>
				<div className="relative min-[1201px]:hidden" ref={mobileAreaMenuRef}>
					<button
						type="button"
						onClick={onToggleMobileAreaMenu}
						className={`p-1 border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${mobileAreaMenuOpen ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-700 text-slate-400"}`}
						title="Open navigation menu"
						aria-label="Open navigation menu"
						aria-expanded={mobileAreaMenuOpen}
					>
						<List size={14} />
					</button>
					{mobileAreaMenuOpen ? (
						<div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-sm border border-slate-700 bg-[#1a262b] p-1 shadow-xl" role="menu" aria-label="Main navigation">
							{MAIN_NAV_AREAS.map((item) => (
								<button
									key={item}
									type="button"
									onClick={() => onSelectMainNavArea(item)}
									className={`flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-xs uppercase tracking-wider ${
										area === item ? "bg-[#11a4d4]/10 text-[#11a4d4]" : "text-slate-300 hover:bg-slate-800/80 hover:text-[#11a4d4]"
									}`}
									role="menuitem"
								>
									<span>{item}</span>
									{item === "sessions" ? <MobileUnreadBadge count={totalRoomUnreadCount} /> : null}
								</button>
							))}
						</div>
					) : null}
				</div>
			</div>
		</header>
	);
}

export function AppErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
	return (
		<div className="border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-100 flex items-start justify-between gap-3">
			<div className="min-w-0 flex items-start gap-2">
				<AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-300" />
				<div className="min-w-0">
					<div className="text-[11px] font-bold uppercase tracking-wider text-red-300">Session Error</div>
					<div className="break-words">{message}</div>
				</div>
			</div>
			<button
				type="button"
				onClick={onDismiss}
				className="shrink-0 rounded-sm border border-red-500/40 px-2 py-1 text-[11px] uppercase tracking-wider text-red-200 hover:border-red-300 hover:text-red-100"
			>
				Dismiss
			</button>
		</div>
	);
}

export function SignedOut({ message }: { message: string }) {
	return (
		<div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">
			<div className="border border-slate-700 bg-[#1a262b] p-5 rounded-sm">
				<div className="mb-4 text-sm text-slate-400">{message}</div>
				<button type="button" onClick={() => void signInWithGoogle()} className="px-3 py-2 bg-[#11a4d4] rounded-sm">
					Sign in with Google
				</button>
			</div>
		</div>
	);
}

function unreadBadgeLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
}

function MobileUnreadBadge({ count }: { count?: number }) {
	if (!count || count <= 0) return null;
	return (
		<span
			className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#38bdf8] text-[#0e1116] text-[10px] font-bold tabular-nums leading-none"
			aria-label={`${count} unread messages across all rooms`}
			title={`${count} unread messages across all rooms`}
		>
			{unreadBadgeLabel(count)}
		</span>
	);
}
