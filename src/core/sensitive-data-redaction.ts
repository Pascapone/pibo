const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|credential|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|bearer|oauth|token|secret|password|passwd)/i;

const SENSITIVE_TEXT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
	[/\bBearer\s+\S+/gi, "Bearer [redacted]"],
	[/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, "[redacted]"],
	[/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]"],
	[/\b([A-Z0-9_]*(?:ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|ID[_-]?TOKEN|API[_-]?KEY|AUTHORIZATION|COOKIE|CREDENTIAL|OAUTH|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)\b(\s*["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi, "$1$2[redacted]"],
];

export function redactSensitiveText(value: string): string {
	let selected = value;
	for (const [pattern, replacement] of SENSITIVE_TEXT_PATTERNS) selected = selected.replace(pattern, replacement);
	return selected;
}

export function redactSensitiveValue(value: unknown, key?: string, depth = 0): unknown {
	if (key && SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
	if (depth > 32) return "[maximum depth reached]";
	if (value === null || value === undefined || typeof value === "boolean") return value;
	if (typeof value === "string") return redactSensitiveText(value);
	if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
	if (Array.isArray(value)) return value.map((entry) => redactSensitiveValue(entry, undefined, depth + 1));
	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
			if (entryValue !== undefined) result[entryKey] = redactSensitiveValue(entryValue, entryKey, depth + 1);
		}
		return result;
	}
	return String(value);
}
