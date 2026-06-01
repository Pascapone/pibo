import type { PiboJsonObject } from "../core/events.js";

export const WEB_ANNOTATION_STATUSES = [
	"open",
	"attached",
	"acknowledged",
	"applying",
	"needs_review",
	"resolved",
	"dismissed",
	"failed",
] as const;

export type WebAnnotationStatus = (typeof WEB_ANNOTATION_STATUSES)[number];

export const WEB_ANNOTATION_TARGET_KINDS = ["element", "text", "region", "visual", "pin"] as const;

export type WebAnnotationTargetKind = (typeof WEB_ANNOTATION_TARGET_KINDS)[number];

export const WEB_ANNOTATION_BINDING_STATES = ["active", "injected", "error", "closed", "removed"] as const;

export type WebAnnotationBindingState = (typeof WEB_ANNOTATION_BINDING_STATES)[number];

export const WEB_ANNOTATION_SOURCE_HINT_KINDS = [
	"pibo-id",
	"pibo-component",
	"pibo-debug",
	"pibo-terminal-row",
	"pibo-shared-card",
	"pibo-markdown",
	"test-id",
	"locatorjs",
	"react-fiber",
	"jsx-source",
	"dom-fallback",
] as const;

export type WebAnnotationSourceHintKind = (typeof WEB_ANNOTATION_SOURCE_HINT_KINDS)[number];

export type WebAnnotationSourceHintConfidence = "high" | "medium" | "low";

export type WebAnnotationThreadRole = "human" | "agent";

export type WebAnnotationResolvedBy = "human" | "agent";

export type WebAnnotationBoundingBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type WebAnnotationViewport = {
	width: number;
	height: number;
	devicePixelRatio?: number;
};

export type WebAnnotationScreenshotRef = {
	artifactId?: string;
	path?: string;
	mimeType?: string;
	width?: number;
	height?: number;
	createdAt?: string;
};

export type WebAnnotationSourceHint = {
	kind: WebAnnotationSourceHintKind;
	confidence: WebAnnotationSourceHintConfidence;
	id?: string;
	file?: string;
	line?: number;
	column?: number;
	component?: string;
	componentPath?: string[];
	raw?: PiboJsonObject;
};

export type WebAnnotationAccessibilityHint = {
	role?: string;
	name?: string;
	ariaLabel?: string;
	focusable?: boolean;
	description?: string;
};

export type WebAnnotationTarget = {
	kind: WebAnnotationTargetKind;
	label?: string;
	selector?: string;
	domPath?: string;
	fullDomPath?: string;
	tagName?: string;
	stableId?: string;
	classSummary?: string;
	text?: string;
	selectedText?: string;
	htmlHint?: string;
	accessibility?: WebAnnotationAccessibilityHint;
	boundingBox?: WebAnnotationBoundingBox;
	position?: { x: number; y: number };
	sourceHints?: WebAnnotationSourceHint[];
};

export type WebAnnotationThreadMessage = {
	id: string;
	role: WebAnnotationThreadRole;
	content: string;
	createdAt: string;
};

export type WebAnnotationBinding = {
	id: string;
	piboSessionId: string;
	piboRoomId?: string;
	state: WebAnnotationBindingState;
	url: string;
	title?: string;
	targetId?: string;
	createdAt: string;
	updatedAt?: string;
	lastInjectedAt?: string;
	closedAt?: string;
	error?: string;
	metadata?: PiboJsonObject;
};

export type WebAnnotation = {
	id: string;
	piboSessionId: string;
	piboRoomId?: string;
	bindingId?: string;
	status: WebAnnotationStatus;
	note: string;
	url: string;
	title?: string;
	targetId?: string;
	targetKind: WebAnnotationTargetKind;
	viewport: WebAnnotationViewport;
	target?: WebAnnotationTarget;
	screenshotRef?: WebAnnotationScreenshotRef;
	thread?: WebAnnotationThreadMessage[];
	createdAt: string;
	updatedAt?: string;
	resolvedAt?: string;
	resolvedBy?: WebAnnotationResolvedBy;
	summary?: string;
	metadata?: PiboJsonObject;
};

export type CreateWebAnnotationBindingInput = {
	id?: string;
	piboSessionId: string;
	piboRoomId?: string;
	url: string;
	title?: string;
	targetId?: string;
	state?: WebAnnotationBindingState;
	metadata?: PiboJsonObject;
};

export type PatchWebAnnotationBindingInput = {
	state?: WebAnnotationBindingState;
	title?: string;
	targetId?: string | null;
	lastInjectedAt?: string | null;
	closedAt?: string | null;
	error?: string | null;
	metadata?: PiboJsonObject;
};

export type CreateWebAnnotationInput = {
	id?: string;
	piboSessionId: string;
	piboRoomId?: string;
	bindingId?: string;
	status?: WebAnnotationStatus;
	note: string;
	url: string;
	title?: string;
	targetId?: string;
	targetKind: WebAnnotationTargetKind;
	viewport: WebAnnotationViewport;
	target?: WebAnnotationTarget;
	screenshotRef?: WebAnnotationScreenshotRef;
	metadata?: PiboJsonObject;
};

export type WebAnnotationListFilter = {
	piboSessionId?: string;
	status?: WebAnnotationStatus;
	limit?: number;
};

export type PatchWebAnnotationInput = {
	status?: WebAnnotationStatus;
	summary?: string | null;
	resolvedBy?: WebAnnotationResolvedBy | null;
	metadata?: PiboJsonObject;
};

export type AddWebAnnotationThreadMessageInput = {
	annotationId: string;
	piboSessionId: string;
	role: WebAnnotationThreadRole;
	content: string;
	id?: string;
};

export function isWebAnnotationStatus(value: string): value is WebAnnotationStatus {
	return (WEB_ANNOTATION_STATUSES as readonly string[]).includes(value);
}

export function isWebAnnotationTargetKind(value: string): value is WebAnnotationTargetKind {
	return (WEB_ANNOTATION_TARGET_KINDS as readonly string[]).includes(value);
}

export function isWebAnnotationBindingState(value: string): value is WebAnnotationBindingState {
	return (WEB_ANNOTATION_BINDING_STATES as readonly string[]).includes(value);
}
