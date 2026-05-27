export type ForkActionResponse = {
	result: {
		piboSessionId?: string;
		cancelled?: boolean;
		selectedText?: string;
	};
};

export function normalizeDownloadCommandPath(value: string): string {
	const path = value.trim();
	if (path.length >= 2) {
		const first = path[0];
		const last = path[path.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return path.slice(1, -1).trim();
		}
	}
	return path;
}

export function commandActionParams(action: string, commandArgs: string): unknown | undefined {
	if (action === "thinking" && commandArgs) {
		return { level: commandArgs.split(/\s+/, 1)[0] };
	}
	if (action === "compact" && commandArgs) {
		return { customInstructions: commandArgs };
	}
	return undefined;
}

export function parseForkActionResponse(value: unknown): ForkActionResponse | null {
	if (!isRecord(value) || !isRecord(value.result)) return null;
	return value as ForkActionResponse;
}

export function getResultPiboSessionId(value: unknown): string | undefined {
	if (!isRecord(value) || !isRecord(value.result)) return undefined;
	return typeof value.result.piboSessionId === "string" ? value.result.piboSessionId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
