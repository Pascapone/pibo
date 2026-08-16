export function redactCodexNativeSensitiveText(value: string): string {
	return value
		.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/\b(?:sk|pk|ghp|github_pat|pibo)[-_][A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
		.replace(/\b(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|token|secret|password)\b(\s*["']?\s*[:=]\s*["']?)([^\s"'&,}]+)/gi, "$1$2[redacted]");
}
