const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|credential|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|token|secret|password)/i;

export function redactCodexNativeSensitiveText(value: string): string {
	return value
		.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/\b(?:sk|pk|ghp|github_pat|pibo)[-_][A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
		.replace(/\b(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|token|secret|password)\b(\s*["']?\s*[:=]\s*["']?)([^\s"'&,}]+)/gi, "$1$2[redacted]");
}

export function redactCodexNativeValue(value: unknown, key?: string, depth = 0): unknown {
	if (key && SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
	if (depth > 32) return "[maximum depth reached]";
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "string") return redactCodexNativeSensitiveText(value);
	if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
	if (Array.isArray(value)) return value.map((entry) => redactCodexNativeValue(entry, undefined, depth + 1));
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [entryKey, entryValue] of Object.entries(value)) {
			if (entryValue !== undefined) result[entryKey] = redactCodexNativeValue(entryValue, entryKey, depth + 1);
		}
		return result;
	}
	return String(value);
}
