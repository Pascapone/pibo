import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolDefinitionContext, ToolProfile } from "../core/profiles.js";
import { legacyOwnerScopeForPreCutoverSchemas } from "../owner-scope-compat.js";
import {
	WEB_ANNOTATION_STATUSES,
	type WebAnnotation,
	type WebAnnotationListFilter,
	type WebAnnotationStatus,
} from "./types.js";
import { createDefaultWebAnnotationStore, type WebAnnotationStore } from "./store.js";
import { assertWebAnnotationStatusTransition, sanitizeWebAnnotationText, WEB_ANNOTATION_LIMITS } from "./validation.js";

export const WEB_ANNOTATION_TOOL_NAMES = [
	"web_annotations_list",
	"web_annotations_get",
	"web_annotations_watch",
	"web_annotations_acknowledge",
	"web_annotations_resolve",
	"web_annotations_dismiss",
] as const;

export type WebAnnotationToolName = (typeof WEB_ANNOTATION_TOOL_NAMES)[number];

export type WebAnnotationToolProfileOptions = {
	store?: WebAnnotationStore;
};

type ToolParams = {
	piboSessionId?: string;
	status?: WebAnnotationStatus;
	limit?: number;
	annotationId?: string;
	summary?: string;
	reason?: string;
	afterCreatedAt?: string;
	timeoutMs?: number;
};

type RequiredToolContext = {
	ownerScope: string;
	piboSessionId: string;
	piboRoomId?: string;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_WATCH_TIMEOUT_MS = 5_000;
const MAX_WATCH_TIMEOUT_MS = 30_000;
const WATCH_POLL_MS = 250;
const TEXT_LIMIT = 280;
const DETAIL_TEXT_LIMIT = WEB_ANNOTATION_LIMITS.text;
const SOURCE_HINT_LIMIT = 5;

let defaultStore: WebAnnotationStore | undefined;

function getDefaultStore(): WebAnnotationStore {
	defaultStore ??= createDefaultWebAnnotationStore();
	return defaultStore;
}

function normalizeLimit(limit: number | undefined, fallback = DEFAULT_LIST_LIMIT): number {
	if (limit === undefined || !Number.isFinite(limit)) return fallback;
	return Math.max(1, Math.min(Math.floor(limit), MAX_LIST_LIMIT));
}

function normalizeTimeout(timeoutMs: number | undefined): number {
	if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_WATCH_TIMEOUT_MS;
	return Math.max(0, Math.min(Math.floor(timeoutMs), MAX_WATCH_TIMEOUT_MS));
}

function truncate(value: string | undefined, max = TEXT_LIMIT): string | undefined {
	return sanitizeWebAnnotationText(value, { max, field: "web annotation tool output" });
}

function requireContext(context: ToolDefinitionContext, params: ToolParams): RequiredToolContext {
	const piboSessionId = params.piboSessionId?.trim() || context.piboSessionId?.trim();
	if (!piboSessionId) throw new Error("Web Annotation tools require a Pibo Session ID from runtime context or piboSessionId input");
	return {
		ownerScope: legacyOwnerScopeForPreCutoverSchemas(),
		piboSessionId,
		piboRoomId: context.piboRoomId,
	};
}

function requireAnnotationId(params: ToolParams): string {
	const id = params.annotationId?.trim();
	if (!id) throw new Error("annotationId is required");
	return id;
}

function sourceHintSummary(annotation: WebAnnotation): string | undefined {
	const hint = annotation.target?.sourceHints?.[0];
	if (!hint) return undefined;
	const location = hint.file
		? `${hint.file}${hint.line !== undefined ? `:${hint.line}` : ""}${hint.column !== undefined ? `:${hint.column}` : ""}`
		: hint.id ?? hint.component;
	return [hint.kind, hint.confidence, location].filter(Boolean).join(" · ");
}

function positionSummary(annotation: WebAnnotation): string | undefined {
	const box = annotation.target?.boundingBox;
	if (box) return `x${box.x} y${box.y} ${box.width}x${box.height}`;
	const position = annotation.target?.position;
	return position ? `x${position.x} y${position.y}` : undefined;
}

function compactAnnotation(annotation: WebAnnotation) {
	return {
		id: annotation.id,
		status: annotation.status,
		targetKind: annotation.targetKind,
		url: truncate(annotation.url, 200),
		label: truncate(annotation.target?.label),
		selector: truncate(annotation.target?.selector),
		sourceHint: truncate(sourceHintSummary(annotation)),
		position: positionSummary(annotation),
		note: truncate(annotation.note),
		createdAt: annotation.createdAt,
		updatedAt: annotation.updatedAt,
	};
}

function detailedAnnotation(annotation: WebAnnotation) {
	return {
		...compactAnnotation(annotation),
		piboSessionId: annotation.piboSessionId,
		piboRoomId: annotation.piboRoomId,
		bindingId: annotation.bindingId,
		title: truncate(annotation.title),
		targetId: annotation.targetId,
		resolvedAt: annotation.resolvedAt,
		resolvedBy: annotation.resolvedBy,
		summary: truncate(annotation.summary, DETAIL_TEXT_LIMIT),
		viewport: annotation.viewport,
		screenshotRef: annotation.screenshotRef ? {
			artifactId: annotation.screenshotRef.artifactId,
			path: truncate(annotation.screenshotRef.path, 300),
			mimeType: annotation.screenshotRef.mimeType,
			width: annotation.screenshotRef.width,
			height: annotation.screenshotRef.height,
			createdAt: annotation.screenshotRef.createdAt,
		} : undefined,
		target: annotation.target ? {
			kind: annotation.target.kind,
			label: truncate(annotation.target.label, DETAIL_TEXT_LIMIT),
			selector: truncate(annotation.target.selector, DETAIL_TEXT_LIMIT),
			domPath: truncate(annotation.target.domPath, DETAIL_TEXT_LIMIT),
			fullDomPath: truncate(annotation.target.fullDomPath, DETAIL_TEXT_LIMIT),
			tagName: truncate(annotation.target.tagName),
			stableId: truncate(annotation.target.stableId),
			classSummary: truncate(annotation.target.classSummary, DETAIL_TEXT_LIMIT),
			text: truncate(annotation.target.text, DETAIL_TEXT_LIMIT),
			selectedText: truncate(annotation.target.selectedText, DETAIL_TEXT_LIMIT),
			htmlHint: truncate(annotation.target.htmlHint, DETAIL_TEXT_LIMIT),
			accessibility: annotation.target.accessibility,
			boundingBox: annotation.target.boundingBox,
			position: annotation.target.position,
			sourceHints: annotation.target.sourceHints?.slice(0, SOURCE_HINT_LIMIT).map((hint) => ({
				kind: hint.kind,
				confidence: hint.confidence,
				id: truncate(hint.id, DETAIL_TEXT_LIMIT),
				file: truncate(hint.file, DETAIL_TEXT_LIMIT),
				line: hint.line,
				column: hint.column,
				component: truncate(hint.component, DETAIL_TEXT_LIMIT),
				componentPath: hint.componentPath?.slice(0, SOURCE_HINT_LIMIT).map((part) => truncate(part, 120) ?? ""),
			})),
		} : undefined,
		thread: annotation.thread?.slice(-10).map((message) => ({
			id: message.id,
			role: message.role,
			content: truncate(message.content, DETAIL_TEXT_LIMIT),
			createdAt: message.createdAt,
		})),
	};
}

function listFilter(context: RequiredToolContext, params: ToolParams): WebAnnotationListFilter {
	return {
		ownerScope: context.ownerScope,
		piboSessionId: context.piboSessionId,
		status: params.status,
		limit: normalizeLimit(params.limit),
	};
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function ok(text: string, details: unknown) {
	return { content: [{ type: "text" as const, text }], details };
}

function fail(message: string, details?: unknown) {
	return {
		content: [{ type: "text" as const, text: `Web annotations error: ${message}` }],
		details: details ?? { ok: false, error: message },
		isError: true,
	};
}

function getAnnotationForLifecycle(store: WebAnnotationStore, context: RequiredToolContext, id: string): WebAnnotation | undefined {
	return store.getAnnotation(context.ownerScope, context.piboSessionId, id);
}

function assertLifecycleTransition(annotation: WebAnnotation, action: "acknowledge" | "resolve" | "dismiss"): void {
	if (annotation.status === "resolved") throw new Error(`Annotation ${annotation.id} is already resolved`);
	if (annotation.status === "dismissed") throw new Error(`Annotation ${annotation.id} is already dismissed`);
	const nextStatus = action === "acknowledge" ? "acknowledged" : action === "resolve" ? "resolved" : "dismissed";
	assertWebAnnotationStatusTransition(annotation.status, nextStatus);
}

function createListTool(store: WebAnnotationStore, context: ToolDefinitionContext): ToolDefinition {
	return defineTool({
		name: "web_annotations_list",
		label: "Web Annotations List",
		description: "List bounded web annotations for the current Pibo session or an explicitly authorized session.",
		promptSnippet: "List web annotations for this Pibo session. Use status and limit to keep output compact.",
		parameters: Type.Object({
			piboSessionId: Type.Optional(Type.String({ description: "Optional Pibo Session ID; defaults to current runtime session." })),
			status: Type.Optional(StringEnum([...WEB_ANNOTATION_STATUSES], { description: "Optional annotation status filter." })),
			limit: Type.Optional(Type.Number({ description: "Maximum annotations to return; capped." })),
		}),
		async execute(_toolCallId, params: ToolParams) {
			try {
				const resolved = requireContext(context, params);
				const annotations = store.listAnnotations(listFilter(resolved, params)).map(compactAnnotation);
				return ok(formatJson({ ok: true, piboSessionId: resolved.piboSessionId, annotations }), {
					ok: true,
					piboSessionId: resolved.piboSessionId,
					annotations,
				});
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		},
	});
}

function createGetTool(store: WebAnnotationStore, context: ToolDefinitionContext): ToolDefinition {
	return defineTool({
		name: "web_annotations_get",
		label: "Web Annotations Get",
		description: "Get one authorized web annotation with bounded target metadata.",
		promptSnippet: "Get one web annotation by id to inspect target metadata, source hints, note, status, and thread summary.",
		parameters: Type.Object({
			annotationId: Type.String({ description: "Web annotation id." }),
			piboSessionId: Type.Optional(Type.String({ description: "Optional Pibo Session ID; defaults to current runtime session." })),
		}),
		async execute(_toolCallId, params: ToolParams) {
			try {
				const resolved = requireContext(context, params);
				const id = requireAnnotationId(params);
				const annotation = store.getAnnotation(resolved.ownerScope, resolved.piboSessionId, id);
				if (!annotation) return fail(`Annotation ${id} was not found for this session`, { ok: false, annotationId: id, piboSessionId: resolved.piboSessionId });
				const detail = detailedAnnotation(annotation);
				return ok(formatJson({ ok: true, annotation: detail }), { ok: true, annotation: detail });
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		},
	});
}

function createLifecycleTool(
	name: "web_annotations_acknowledge" | "web_annotations_resolve" | "web_annotations_dismiss",
	store: WebAnnotationStore,
	context: ToolDefinitionContext,
): ToolDefinition {
	const action = name === "web_annotations_acknowledge" ? "acknowledge" : name === "web_annotations_resolve" ? "resolve" : "dismiss";
	return defineTool({
		name,
		label: name.replaceAll("_", " "),
		description: `${action[0].toUpperCase()}${action.slice(1)} an authorized web annotation.`,
		promptSnippet: `${action[0].toUpperCase()}${action.slice(1)} a web annotation after inspecting it and deciding the lifecycle update is appropriate.`,
		parameters: Type.Object({
			annotationId: Type.String({ description: "Web annotation id." }),
			piboSessionId: Type.Optional(Type.String({ description: "Optional Pibo Session ID; defaults to current runtime session." })),
			summary: Type.Optional(Type.String({ description: "Optional work summary. Used by acknowledge/resolve." })),
			reason: Type.Optional(Type.String({ description: "Optional dismiss reason." })),
		}),
		async execute(_toolCallId, params: ToolParams) {
			try {
				const resolved = requireContext(context, params);
				const id = requireAnnotationId(params);
				const existing = getAnnotationForLifecycle(store, resolved, id);
				if (!existing) return fail(`Annotation ${id} was not found for this session`, { ok: false, annotationId: id, piboSessionId: resolved.piboSessionId });
				assertLifecycleTransition(existing, action);

				const updated = action === "acknowledge"
					? store.acknowledgeAnnotation(resolved.ownerScope, resolved.piboSessionId, id, params.summary)
					: action === "resolve"
						? store.resolveAnnotation(resolved.ownerScope, resolved.piboSessionId, id, params.summary, "agent")
						: store.dismissAnnotation(resolved.ownerScope, resolved.piboSessionId, id, params.reason);
				if (!updated) return fail(`Annotation ${id} could not be updated`, { ok: false, annotationId: id });
				const detail = compactAnnotation(updated);
				return ok(formatJson({ ok: true, annotation: detail }), { ok: true, annotation: detail });
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		},
	});
}

function createWatchTool(store: WebAnnotationStore, context: ToolDefinitionContext): ToolDefinition {
	return defineTool({
		name: "web_annotations_watch",
		label: "Web Annotations Watch",
		description: "Wait briefly for new web annotations in the current or authorized Pibo session.",
		promptSnippet: "Wait briefly for new web annotations. Keep timeout bounded; use run-control if a longer background wait is needed.",
		parameters: Type.Object({
			piboSessionId: Type.Optional(Type.String({ description: "Optional Pibo Session ID; defaults to current runtime session." })),
			status: Type.Optional(StringEnum([...WEB_ANNOTATION_STATUSES], { description: "Optional annotation status filter." })),
			afterCreatedAt: Type.Optional(Type.String({ description: "Only return annotations created after this ISO timestamp." })),
			limit: Type.Optional(Type.Number({ description: "Maximum annotations to return; capped." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Bounded wait timeout in milliseconds; capped." })),
		}),
		async execute(_toolCallId, params: ToolParams) {
			try {
				const resolved = requireContext(context, params);
				const timeoutMs = normalizeTimeout(params.timeoutMs);
				const started = Date.now();
				const afterCreatedAt = params.afterCreatedAt;

				while (true) {
					const annotations = store.listAnnotations(listFilter(resolved, params))
						.filter((annotation) => !afterCreatedAt || annotation.createdAt > afterCreatedAt)
						.map(compactAnnotation);
					if (annotations.length > 0) {
						return ok(formatJson({ ok: true, timedOut: false, piboSessionId: resolved.piboSessionId, annotations }), {
							ok: true,
							timedOut: false,
							piboSessionId: resolved.piboSessionId,
							annotations,
						});
					}
					if (Date.now() - started >= timeoutMs) {
						return ok(formatJson({ ok: true, timedOut: true, piboSessionId: resolved.piboSessionId, annotations: [] }), {
							ok: true,
							timedOut: true,
							piboSessionId: resolved.piboSessionId,
							annotations: [],
						});
					}
					await new Promise((resolve) => setTimeout(resolve, Math.min(WATCH_POLL_MS, timeoutMs)));
				}
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error));
			}
		},
	});
}

export function createWebAnnotationToolProfiles(options: WebAnnotationToolProfileOptions = {}): ToolProfile[] {
	const store = options.store;
	const createStore = () => store ?? getDefaultStore();
	return [
		{
			name: "web_annotations_list",
			description: "List bounded web annotations for the current Pibo session.",
			yieldable: false,
			createDefinition: (context) => createListTool(createStore(), context),
		},
		{
			name: "web_annotations_get",
			description: "Get one authorized web annotation with bounded target metadata.",
			yieldable: false,
			createDefinition: (context) => createGetTool(createStore(), context),
		},
		{
			name: "web_annotations_watch",
			description: "Wait briefly for new web annotations in the current Pibo session.",
			yieldable: true,
			createDefinition: (context) => createWatchTool(createStore(), context),
		},
		{
			name: "web_annotations_acknowledge",
			description: "Acknowledge an authorized web annotation.",
			yieldable: false,
			createDefinition: (context) => createLifecycleTool("web_annotations_acknowledge", createStore(), context),
		},
		{
			name: "web_annotations_resolve",
			description: "Resolve an authorized web annotation with an optional summary.",
			yieldable: false,
			createDefinition: (context) => createLifecycleTool("web_annotations_resolve", createStore(), context),
		},
		{
			name: "web_annotations_dismiss",
			description: "Dismiss an authorized web annotation with an optional reason.",
			yieldable: false,
			createDefinition: (context) => createLifecycleTool("web_annotations_dismiss", createStore(), context),
		},
	];
}
