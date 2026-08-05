export type TerminalReadingPosition = {
	rowId: string;
	offsetPx: number;
};

const STORAGE_PREFIX = "pibo.chat.terminalReadingPosition.";

export function readTerminalReadingPosition(piboSessionId: string): TerminalReadingPosition | undefined {
	if (!piboSessionId) return undefined;
	try {
		return parseTerminalReadingPosition(sessionStorage.getItem(STORAGE_PREFIX + piboSessionId));
	} catch {
		return undefined;
	}
}

export function writeTerminalReadingPosition(piboSessionId: string, position: TerminalReadingPosition | undefined): void {
	if (!piboSessionId) return;
	try {
		const key = STORAGE_PREFIX + piboSessionId;
		if (!position) sessionStorage.removeItem(key);
		else sessionStorage.setItem(key, JSON.stringify(position));
	} catch {
		// Reading-position persistence is best effort and must not break the Terminal.
	}
}

export function parseTerminalReadingPosition(raw: string | null): TerminalReadingPosition | undefined {
	if (!raw) return undefined;
	try {
		const value = JSON.parse(raw) as { rowId?: unknown; offsetPx?: unknown };
		if (typeof value.rowId !== "string" || !value.rowId) return undefined;
		if (typeof value.offsetPx !== "number" || !Number.isFinite(value.offsetPx)) return undefined;
		return { rowId: value.rowId, offsetPx: value.offsetPx };
	} catch {
		return undefined;
	}
}
