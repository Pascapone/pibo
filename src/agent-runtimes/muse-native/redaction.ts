import { redactSensitiveText, redactSensitiveValue } from "../../core/sensitive-data-redaction.js";

export function redactMuseNativeSensitiveText(value: string): string {
	return redactSensitiveText(value);
}

export function redactMuseNativeValue(value: unknown, key?: string, depth = 0): unknown {
	return redactSensitiveValue(value, key, depth);
}
