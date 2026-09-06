export type ToolCallMetrics = {
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	/** Payload-size estimates, not provider usage or billing. */
	tokenBasis: "chars/4";
};

/** Bounded structural walk; never tokenize, copy or scan large strings. */
export function estimateToolPayloadTokens(payload: unknown): number | undefined {
	let budget = 10_000;
	const seen = new WeakSet<object>();
	function size(value: unknown, depth: number): number {
		if (--budget < 0 || depth > 64) return NaN;
		if (typeof value === "string") return value.length;
		if (value === null) return 4;
		if (typeof value === "boolean") return value ? 4 : 5;
		if (typeof value === "number") return String(value).length;
		if (typeof value !== "object" || seen.has(value)) return NaN;
		seen.add(value);
		let chars = 2;
		if (Array.isArray(value)) {
			for (const item of value) {
				chars += size(item, depth + 1) + 1;
				if (!Number.isFinite(chars)) return NaN;
			}
		} else {
			const record = value as Record<string, unknown>;
			// Binary/media payloads have no meaningful character-based token count.
			if (["image", "audio", "document", "resource", "image_url"].includes(String(record.type))) return NaN;
			for (const key in record) {
				if (--budget < 0) return NaN;
				if (!Object.hasOwn(record, key) || record[key] === undefined) continue;
				chars += key.length + 3 + size(record[key], depth + 1) + 1;
				if (!Number.isFinite(chars)) return NaN;
			}
		}
		seen.delete(value);
		return chars;
	}
	try {
		const chars = size(payload, 0);
		return Number.isFinite(chars) ? Math.ceil(chars / 4) : undefined;
	} catch {
		// Diagnostics must not turn an otherwise successful tool into a failure.
		return undefined;
	}
}

export class ToolCallMetricsCollector {
	private readonly active = new Map<string, { startedAt: number; inputTokens?: number }>();

	start(id: string, args: unknown, now = performance.now()): void {
		if (this.active.has(id)) return;
		this.active.set(id, { startedAt: now, inputTokens: estimateToolPayloadTokens(args) });
	}

	finish(id: string, result: unknown, now = performance.now()): ToolCallMetrics {
		const started = this.active.get(id);
		this.active.delete(id);
		// Harness result metadata is not model-visible tool output.
		const output = result && typeof result === "object" && "content" in result
			? result.content : result;
		return {
			tokenBasis: "chars/4",
			durationMs: started ? Math.max(0, now - started.startedAt) : undefined,
			inputTokens: started?.inputTokens,
			outputTokens: estimateToolPayloadTokens(output),
		};
	}

	clear(): void {
		this.active.clear();
	}
}
