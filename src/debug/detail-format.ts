export type DebugTextSlice = {
	text: string;
	totalBytes: number;
	from: number;
	bytesShown: number;
	truncatedBefore: boolean;
	truncatedAfter: boolean;
};

export type DebugDetailOptions = {
	maxBytes?: string | number;
	from?: string | number;
	bytes?: string | number;
	noTruncate?: boolean;
};

export const DEFAULT_DETAIL_BYTES = 8 * 1024;
export const DEFAULT_TOOL_BYTES = 4 * 1024;

export function parseByteOption(value: string | number | undefined, name: string): number | undefined {
	if (value === undefined) return undefined;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
	return number;
}

export function sliceTextByBytes(text: string, options: DebugDetailOptions = {}, defaultBytes = DEFAULT_DETAIL_BYTES): DebugTextSlice {
	const totalBytes = Buffer.byteLength(text, "utf8");
	const requestedFrom = parseByteOption(options.from, "--from") ?? 0;
	const from = Math.min(requestedFrom, totalBytes);
	const byteBudget = options.noTruncate ? undefined : (parseByteOption(options.bytes, "--bytes") ?? parseByteOption(options.maxBytes, "--max-bytes") ?? defaultBytes);
	if (byteBudget === undefined) {
		return {
			text: sliceByByteRange(text, from, totalBytes).text,
			totalBytes,
			from,
			bytesShown: Math.max(0, totalBytes - from),
			truncatedBefore: from > 0,
			truncatedAfter: false,
		};
	}
	const range = sliceByByteRange(text, from, from + byteBudget);
	return {
		text: range.text,
		totalBytes,
		from: range.actualStart,
		bytesShown: range.bytesShown,
		truncatedBefore: range.actualStart > 0,
		truncatedAfter: range.actualEnd < totalBytes,
	};
}

export function formatTruncationFooter(slice: DebugTextSlice, commands: { nextChunk?: string; full?: string } = {}): string[] {
	if (!slice.truncatedBefore && !slice.truncatedAfter) return [];
	const lines = [`[truncated: showing ${slice.bytesShown} of ${slice.totalBytes} bytes from ${slice.from}]`];
	if (slice.truncatedAfter && commands.nextChunk) {
		lines.push("Next chunk:");
		lines.push(`  ${commands.nextChunk}`);
	}
	if (commands.full) {
		lines.push("Full:");
		lines.push(`  ${commands.full}`);
	}
	return lines;
}

export function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function sliceByByteRange(text: string, startByte: number, endByte: number): { text: string; actualStart: number; actualEnd: number; bytesShown: number } {
	let currentByte = 0;
	let output = "";
	let actualStart: number | undefined;
	let actualEnd: number | undefined;
	for (const char of text) {
		const charBytes = Buffer.byteLength(char, "utf8");
		const charStart = currentByte;
		const charEnd = currentByte + charBytes;
		currentByte = charEnd;
		if (charEnd <= startByte) continue;
		if (charStart < startByte) continue;
		if (charEnd > endByte) break;
		if (actualStart === undefined) actualStart = charStart;
		actualEnd = charEnd;
		output += char;
	}
	const normalizedStart = actualStart ?? Math.min(startByte, currentByte);
	const normalizedEnd = actualEnd ?? normalizedStart;
	return { text: output, actualStart: normalizedStart, actualEnd: normalizedEnd, bytesShown: normalizedEnd - normalizedStart };
}

export function formatPrimitive(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	return String(value);
}
