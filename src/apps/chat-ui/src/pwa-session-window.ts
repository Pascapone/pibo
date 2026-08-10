type PwaNavigator = Pick<Navigator, "maxTouchPoints" | "userAgent"> & {
	userAgentData?: { mobile?: boolean };
};

type MatchMedia = (query: string) => Pick<MediaQueryList, "matches">;

const PWA_DISPLAY_MODE_QUERIES = [
	"(display-mode: standalone)",
	"(display-mode: window-controls-overlay)",
] as const;

export function isDesktopPwaWindow(matchMedia: MatchMedia, navigatorLike: PwaNavigator): boolean {
	if (!PWA_DISPLAY_MODE_QUERIES.some((query) => matchMedia(query).matches)) return false;
	if (typeof navigatorLike.userAgentData?.mobile === "boolean") return !navigatorLike.userAgentData.mobile;
	if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigatorLike.userAgent)) return false;
	if (/Macintosh/i.test(navigatorLike.userAgent) && navigatorLike.maxTouchPoints > 1) return false;
	return true;
}

export function canOpenDesktopPwaSessionWindow(): boolean {
	return typeof window !== "undefined"
		&& typeof navigator !== "undefined"
		&& isDesktopPwaWindow(window.matchMedia.bind(window), navigator as PwaNavigator);
}

export function createPwaSessionWindowTarget(href: string, windowId: string): {
	url: string;
	name: string;
	features: string;
} {
	return {
		url: href,
		name: `pibo-session-${windowId}`,
		features: "width=1280,height=900",
	};
}

export function openCurrentPwaSessionWindow(): Window | null {
	const target = createPwaSessionWindowTarget(window.location.href, crypto.randomUUID());
	return window.open(target.url, target.name, target.features);
}
