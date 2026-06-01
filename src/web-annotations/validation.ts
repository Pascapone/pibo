import type { PiboJsonObject, PiboJsonValue } from "../core/events.js";
import {
	WEB_ANNOTATION_SOURCE_HINT_KINDS,
	isWebAnnotationBindingState,
	isWebAnnotationStatus,
	isWebAnnotationTargetKind,
	type AddWebAnnotationThreadMessageInput,
	type CreateWebAnnotationBindingInput,
	type CreateWebAnnotationInput,
	type PatchWebAnnotationBindingInput,
	type PatchWebAnnotationInput,
	type WebAnnotationAccessibilityHint,
	type WebAnnotationScreenshotRef,
	type WebAnnotationSourceHint,
	type WebAnnotationStatus,
	type WebAnnotationTarget,
	type WebAnnotationTargetKind,
	type WebAnnotationViewport,
} from "./types.js";

export const WEB_ANNOTATION_LIMITS = {
	id: 160,
	piboSessionId: 160,
	piboRoomId: 160,
	url: 2_000,
	title: 200,
	note: 2_000,
	summary: 2_000,
	bindingToken: 240,
	selector: 1_000,
	domPath: 1_500,
	fullDomPath: 2_500,
	tagName: 80,
	stableId: 240,
	classSummary: 500,
	text: 1_000,
	selectedText: 1_000,
	htmlHint: 1_000,
	accessibilityText: 400,
	sourceHints: 10,
	sourceHintRawKeys: 30,
	sourceHintRawArray: 20,
	sourceHintRawDepth: 4,
	sourceHintRawString: 500,
	sourceHintComponentPath: 10,
	sourceHintText: 500,
	screenshotRefText: 500,
	threadMessages: 100,
	threadMessage: 2_000,
	attachments: 5,
} as const;

export type SanitizeTextOptions = {
	max: number;
	field?: string;
	trim?: boolean;
	collapseWhitespace?: boolean;
	redactSecrets?: boolean;
};

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const SECRET_PATTERNS: Array<[RegExp, string | ((match: string) => string)]> = [
	[/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_SECRET]"],
	[/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, "[REDACTED_SECRET]"],
	[/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g, "[REDACTED_SECRET]"],
	[/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['\"]?[^\s'\"&<>]{8,}/gi, (match) => {
		const separator = match.includes("=") ? "=" : ":";
		return `${match.slice(0, match.indexOf(separator) + 1)}[REDACTED_SECRET]`;
	}],
];

export function redactWebAnnotationSecrets(value: string): string {
	let redacted = value;
	for (const [pattern, replacement] of SECRET_PATTERNS) {
		redacted = typeof replacement === "function"
			? redacted.replace(pattern, replacement)
			: redacted.replace(pattern, replacement);
	}
	return redacted;
}

export function sanitizeWebAnnotationText(value: unknown, options: SanitizeTextOptions): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error(`${options.field ?? "field"} must be a string`);
	let text = value.replace(CONTROL_CHARS, "");
	if (options.redactSecrets !== false) text = redactWebAnnotationSecrets(text);
	if (options.collapseWhitespace !== false) text = text.replace(/\s+/g, " ");
	if (options.trim !== false) text = text.trim();
	if (text.length > options.max) return `${text.slice(0, Math.max(0, options.max - 1))}…`;
	return text;
}

export function requireWebAnnotationText(value: unknown, options: SanitizeTextOptions): string {
	const text = sanitizeWebAnnotationText(value, options) ?? "";
	if (!text) throw new Error(`${options.field ?? "field"} is required`);
	return text;
}

export function normalizeWebAnnotationLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
	if (limit === undefined || !Number.isFinite(limit)) return defaultLimit;
	return Math.max(1, Math.min(Math.floor(limit), maxLimit));
}

export function normalizeWebAnnotationBindingInput(input: CreateWebAnnotationBindingInput): CreateWebAnnotationBindingInput {
	const normalized: CreateWebAnnotationBindingInput = {
		...input,
		id: sanitizeWebAnnotationText(input.id, { max: WEB_ANNOTATION_LIMITS.id, field: "id", redactSecrets: false }),
		piboSessionId: requireWebAnnotationText(input.piboSessionId, { max: WEB_ANNOTATION_LIMITS.piboSessionId, field: "piboSessionId", redactSecrets: false }),
		piboRoomId: sanitizeWebAnnotationText(input.piboRoomId, { max: WEB_ANNOTATION_LIMITS.piboRoomId, field: "piboRoomId", redactSecrets: false }),
		url: requireWebAnnotationText(input.url, { max: WEB_ANNOTATION_LIMITS.url, field: "url", redactSecrets: false }),
		title: sanitizeWebAnnotationText(input.title, { max: WEB_ANNOTATION_LIMITS.title, field: "title" }),
		metadata: normalizeWebAnnotationJsonObject(input.metadata, "metadata"),
	};
	if (input.state !== undefined && !isWebAnnotationBindingState(input.state)) throw new Error(`Invalid binding state: ${input.state}`);
	return normalized;
}

export function normalizeWebAnnotationBindingPatch(patch: PatchWebAnnotationBindingInput): PatchWebAnnotationBindingInput {
	if (patch.state !== undefined && !isWebAnnotationBindingState(patch.state)) throw new Error(`Invalid binding state: ${patch.state}`);
	return {
		...patch,
		title: sanitizeWebAnnotationText(patch.title, { max: WEB_ANNOTATION_LIMITS.title, field: "title" }),
		targetId: patch.targetId === null ? null : sanitizeWebAnnotationText(patch.targetId, { max: WEB_ANNOTATION_LIMITS.id, field: "targetId", redactSecrets: false }),
		error: patch.error === null ? null : sanitizeWebAnnotationText(patch.error, { max: WEB_ANNOTATION_LIMITS.summary, field: "error" }),
		metadata: normalizeWebAnnotationJsonObject(patch.metadata, "metadata"),
	};
}

export function normalizeWebAnnotationCreateInput(input: CreateWebAnnotationInput): CreateWebAnnotationInput {
	if (input.status !== undefined && !isWebAnnotationStatus(input.status)) throw new Error(`Invalid annotation status: ${input.status}`);
	if (!isWebAnnotationTargetKind(input.targetKind)) throw new Error(`Invalid annotation target kind: ${input.targetKind}`);
	return {
		...input,
		id: sanitizeWebAnnotationText(input.id, { max: WEB_ANNOTATION_LIMITS.id, field: "id", redactSecrets: false }),
		piboSessionId: requireWebAnnotationText(input.piboSessionId, { max: WEB_ANNOTATION_LIMITS.piboSessionId, field: "piboSessionId", redactSecrets: false }),
		piboRoomId: sanitizeWebAnnotationText(input.piboRoomId, { max: WEB_ANNOTATION_LIMITS.piboRoomId, field: "piboRoomId", redactSecrets: false }),
		bindingId: sanitizeWebAnnotationText(input.bindingId, { max: WEB_ANNOTATION_LIMITS.id, field: "bindingId", redactSecrets: false }),
		note: requireWebAnnotationText(input.note, { max: WEB_ANNOTATION_LIMITS.note, field: "note" }),
		url: requireWebAnnotationText(input.url, { max: WEB_ANNOTATION_LIMITS.url, field: "url", redactSecrets: false }),
		title: sanitizeWebAnnotationText(input.title, { max: WEB_ANNOTATION_LIMITS.title, field: "title" }),
		targetId: sanitizeWebAnnotationText(input.targetId, { max: WEB_ANNOTATION_LIMITS.id, field: "targetId", redactSecrets: false }),
		viewport: normalizeWebAnnotationViewport(input.viewport),
		target: normalizeWebAnnotationTarget(input.target, input.targetKind),
		screenshotRef: normalizeWebAnnotationScreenshotRef(input.screenshotRef),
		metadata: normalizeWebAnnotationJsonObject(input.metadata, "metadata"),
	};
}

export function normalizeWebAnnotationPatchInput(patch: PatchWebAnnotationInput): PatchWebAnnotationInput {
	if (patch.status !== undefined && !isWebAnnotationStatus(patch.status)) throw new Error(`Invalid annotation status: ${patch.status}`);
	if (patch.resolvedBy !== undefined && patch.resolvedBy !== null && patch.resolvedBy !== "human" && patch.resolvedBy !== "agent") {
		throw new Error("resolvedBy must be human, agent, or null");
	}
	return {
		...patch,
		summary: patch.summary === null ? null : sanitizeWebAnnotationText(patch.summary, { max: WEB_ANNOTATION_LIMITS.summary, field: "summary" }),
		metadata: normalizeWebAnnotationJsonObject(patch.metadata, "metadata"),
	};
}

export function assertWebAnnotationStatusTransition(current: WebAnnotationStatus, next: WebAnnotationStatus | undefined): void {
	if (!next || next === current) return;
	if (current === "resolved") throw new Error("resolved annotations cannot transition to another status");
	if (current === "dismissed") throw new Error("dismissed annotations cannot transition to another status");
	if (current === "applying" && next === "dismissed") throw new Error("applying annotations cannot be dismissed");
}

export function normalizeWebAnnotationThreadMessageInput(input: AddWebAnnotationThreadMessageInput): AddWebAnnotationThreadMessageInput {
	if (input.role !== "human" && input.role !== "agent") throw new Error("role must be human or agent");
	return {
		...input,
		annotationId: requireWebAnnotationText(input.annotationId, { max: WEB_ANNOTATION_LIMITS.id, field: "annotationId", redactSecrets: false }),
		piboSessionId: requireWebAnnotationText(input.piboSessionId, { max: WEB_ANNOTATION_LIMITS.piboSessionId, field: "piboSessionId", redactSecrets: false }),
		content: requireWebAnnotationText(input.content, { max: WEB_ANNOTATION_LIMITS.threadMessage, field: "content" }),
		id: sanitizeWebAnnotationText(input.id, { max: WEB_ANNOTATION_LIMITS.id, field: "id", redactSecrets: false }),
	};
}

export function normalizeWebAnnotationViewport(value: WebAnnotationViewport | undefined): WebAnnotationViewport {
	if (!value || typeof value.width !== "number" || typeof value.height !== "number") throw new Error("viewport width and height are required");
	return {
		width: boundedNumber(value.width, 0, 20_000, "viewport.width"),
		height: boundedNumber(value.height, 0, 20_000, "viewport.height"),
		devicePixelRatio: value.devicePixelRatio === undefined ? undefined : boundedNumber(value.devicePixelRatio, 0.1, 10, "viewport.devicePixelRatio"),
	};
}

export function normalizeWebAnnotationTarget(value: WebAnnotationTarget | undefined, targetKind: WebAnnotationTargetKind): WebAnnotationTarget | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("target must be an object");
	return {
		kind: targetKind,
		label: sanitizeWebAnnotationText(value.label, { max: WEB_ANNOTATION_LIMITS.text, field: "target.label" }),
		selector: sanitizeWebAnnotationText(value.selector, { max: WEB_ANNOTATION_LIMITS.selector, field: "target.selector" }),
		domPath: sanitizeWebAnnotationText(value.domPath, { max: WEB_ANNOTATION_LIMITS.domPath, field: "target.domPath" }),
		fullDomPath: sanitizeWebAnnotationText(value.fullDomPath, { max: WEB_ANNOTATION_LIMITS.fullDomPath, field: "target.fullDomPath" }),
		tagName: sanitizeWebAnnotationText(value.tagName, { max: WEB_ANNOTATION_LIMITS.tagName, field: "target.tagName", redactSecrets: false }),
		stableId: sanitizeWebAnnotationText(value.stableId, { max: WEB_ANNOTATION_LIMITS.stableId, field: "target.stableId" }),
		classSummary: sanitizeWebAnnotationText(value.classSummary, { max: WEB_ANNOTATION_LIMITS.classSummary, field: "target.classSummary" }),
		text: sanitizeWebAnnotationText(value.text, { max: WEB_ANNOTATION_LIMITS.text, field: "target.text" }),
		selectedText: sanitizeWebAnnotationText(value.selectedText, { max: WEB_ANNOTATION_LIMITS.selectedText, field: "target.selectedText" }),
		htmlHint: sanitizeWebAnnotationText(value.htmlHint, { max: WEB_ANNOTATION_LIMITS.htmlHint, field: "target.htmlHint" }),
		accessibility: normalizeAccessibilityHint(value.accessibility),
		boundingBox: value.boundingBox ? {
			x: boundedNumber(value.boundingBox.x, -100_000, 100_000, "target.boundingBox.x"),
			y: boundedNumber(value.boundingBox.y, -100_000, 100_000, "target.boundingBox.y"),
			width: boundedNumber(value.boundingBox.width, 0, 100_000, "target.boundingBox.width"),
			height: boundedNumber(value.boundingBox.height, 0, 100_000, "target.boundingBox.height"),
		} : undefined,
		position: value.position ? {
			x: boundedNumber(value.position.x, -100_000, 100_000, "target.position.x"),
			y: boundedNumber(value.position.y, -100_000, 100_000, "target.position.y"),
		} : undefined,
		sourceHints: normalizeSourceHints(value.sourceHints),
	};
}

export function normalizeWebAnnotationScreenshotRef(value: WebAnnotationScreenshotRef | undefined): WebAnnotationScreenshotRef | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("screenshotRef must be an object");
	return {
		artifactId: sanitizeWebAnnotationText(value.artifactId, { max: WEB_ANNOTATION_LIMITS.screenshotRefText, field: "screenshotRef.artifactId", redactSecrets: false }),
		path: sanitizeWebAnnotationText(value.path, { max: WEB_ANNOTATION_LIMITS.screenshotRefText, field: "screenshotRef.path", redactSecrets: false }),
		mimeType: sanitizeWebAnnotationText(value.mimeType, { max: 120, field: "screenshotRef.mimeType", redactSecrets: false }),
		width: value.width === undefined ? undefined : boundedNumber(value.width, 0, 50_000, "screenshotRef.width"),
		height: value.height === undefined ? undefined : boundedNumber(value.height, 0, 50_000, "screenshotRef.height"),
		createdAt: sanitizeWebAnnotationText(value.createdAt, { max: 80, field: "screenshotRef.createdAt", redactSecrets: false }),
	};
}

export function normalizeWebAnnotationJsonObject(value: PiboJsonObject | undefined, field: string): PiboJsonObject | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
	return normalizeJsonObject(value, 0);
}

function normalizeAccessibilityHint(value: WebAnnotationAccessibilityHint | undefined): WebAnnotationAccessibilityHint | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("target.accessibility must be an object");
	return {
		role: sanitizeWebAnnotationText(value.role, { max: WEB_ANNOTATION_LIMITS.accessibilityText, field: "target.accessibility.role" }),
		name: sanitizeWebAnnotationText(value.name, { max: WEB_ANNOTATION_LIMITS.accessibilityText, field: "target.accessibility.name" }),
		ariaLabel: sanitizeWebAnnotationText(value.ariaLabel, { max: WEB_ANNOTATION_LIMITS.accessibilityText, field: "target.accessibility.ariaLabel" }),
		focusable: typeof value.focusable === "boolean" ? value.focusable : undefined,
		description: sanitizeWebAnnotationText(value.description, { max: WEB_ANNOTATION_LIMITS.accessibilityText, field: "target.accessibility.description" }),
	};
}

function normalizeSourceHints(value: WebAnnotationSourceHint[] | undefined): WebAnnotationSourceHint[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error("target.sourceHints must be an array");
	return value.slice(0, WEB_ANNOTATION_LIMITS.sourceHints).map((hint) => {
		if (!hint || typeof hint !== "object" || Array.isArray(hint)) throw new Error("target.sourceHints entries must be objects");
		if (!(WEB_ANNOTATION_SOURCE_HINT_KINDS as readonly string[]).includes(hint.kind)) throw new Error(`Invalid source hint kind: ${hint.kind}`);
		if (hint.confidence !== "high" && hint.confidence !== "medium" && hint.confidence !== "low") throw new Error("Invalid source hint confidence");
		return {
			kind: hint.kind,
			confidence: hint.confidence,
			id: sanitizeWebAnnotationText(hint.id, { max: WEB_ANNOTATION_LIMITS.sourceHintText, field: "sourceHint.id" }),
			file: sanitizeWebAnnotationText(hint.file, { max: WEB_ANNOTATION_LIMITS.sourceHintText, field: "sourceHint.file" }),
			line: hint.line === undefined ? undefined : boundedNumber(hint.line, 0, 1_000_000, "sourceHint.line"),
			column: hint.column === undefined ? undefined : boundedNumber(hint.column, 0, 1_000_000, "sourceHint.column"),
			component: sanitizeWebAnnotationText(hint.component, { max: WEB_ANNOTATION_LIMITS.sourceHintText, field: "sourceHint.component" }),
			componentPath: hint.componentPath?.slice(0, WEB_ANNOTATION_LIMITS.sourceHintComponentPath).map((part) => sanitizeWebAnnotationText(part, { max: 120, field: "sourceHint.componentPath" }) ?? ""),
			raw: normalizeWebAnnotationJsonObject(hint.raw, "sourceHint.raw"),
		};
	});
}

function normalizeJsonValue(value: PiboJsonValue, depth: number): PiboJsonValue {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string") return sanitizeWebAnnotationText(value, { max: WEB_ANNOTATION_LIMITS.sourceHintRawString, field: "json" }) ?? "";
	if (Array.isArray(value)) {
		if (depth >= WEB_ANNOTATION_LIMITS.sourceHintRawDepth) return [];
		return value.slice(0, WEB_ANNOTATION_LIMITS.sourceHintRawArray).map((item) => normalizeJsonValue(item, depth + 1));
	}
	if (typeof value === "object") {
		if (depth >= WEB_ANNOTATION_LIMITS.sourceHintRawDepth) return {};
		return normalizeJsonObject(value, depth + 1);
	}
	return null;
}

function normalizeJsonObject(value: { [key: string]: PiboJsonValue }, depth: number): PiboJsonObject {
	const output: PiboJsonObject = {};
	for (const [key, rawValue] of Object.entries(value).slice(0, WEB_ANNOTATION_LIMITS.sourceHintRawKeys)) {
		const normalizedKey = sanitizeWebAnnotationText(key, { max: 120, field: "json key" }) ?? "key";
		output[normalizedKey] = normalizeJsonValue(rawValue, depth);
	}
	return output;
}

function boundedNumber(value: number, min: number, max: number, field: string): number {
	if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
	return Math.max(min, Math.min(max, value));
}
