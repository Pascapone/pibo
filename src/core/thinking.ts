import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";

export const PIBO_THINKING_LEVELS = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

export type PiboThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]> | "none" | "ultra";

export type PiNativeThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

/** Map Pibo thinking levels onto the Pi-native range ("none" disables, "ultra" clamps to "max"). */
export function mapThinkingLevelForPi(level: PiboThinkingLevel | undefined): PiNativeThinkingLevel | undefined {
	if (level === undefined) return undefined;
	if (level === "none") return "off";
	if (level === "ultra") return "max";
	return level;
}

export function isPiboThinkingLevel(value: string): value is PiboThinkingLevel {
	return (PIBO_THINKING_LEVELS as readonly string[]).includes(value);
}

export function parsePiboThinkingLevel(value: string): PiboThinkingLevel {
	if (isPiboThinkingLevel(value)) return value;
	throw new Error(`Invalid thinking level "${value}". Valid values: ${PIBO_THINKING_LEVELS.join(", ")}`);
}
