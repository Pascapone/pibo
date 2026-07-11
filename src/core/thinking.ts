import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";

export const PIBO_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type PiboThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export function isPiboThinkingLevel(value: string): value is PiboThinkingLevel {
	return (PIBO_THINKING_LEVELS as readonly string[]).includes(value);
}

export function parsePiboThinkingLevel(value: string): PiboThinkingLevel {
	if (isPiboThinkingLevel(value)) return value;
	throw new Error(`Invalid thinking level "${value}". Valid values: ${PIBO_THINKING_LEVELS.join(", ")}`);
}
