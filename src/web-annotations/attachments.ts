import type { WebAnnotation, WebAnnotationSourceHint } from "./types.js";
import type { WebAnnotationStore } from "./store.js";
import { sanitizeWebAnnotationText, WEB_ANNOTATION_LIMITS } from "./validation.js";

export const WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT = WEB_ANNOTATION_LIMITS.attachments;

export type WebAnnotationMessageAttachment = {
	id: string;
	status: WebAnnotation["status"];
	targetKind: WebAnnotation["targetKind"];
	piboSessionId: string;
	piboRoomId?: string;
	url: string;
	label?: string;
	selector?: string;
	primaryTarget?: string;
	piboContext?: string;
	sourceHint?: string;
	sourceHints?: string[];
	position?: string;
	text?: string;
	note: string;
	createdAt: string;
};

export type PreparedWebAnnotationAttachments = {
	ids: string[];
	annotations: WebAnnotation[];
	attachments: WebAnnotationMessageAttachment[];
	modelContext: string;
	messageText: string;
};

export function normalizeWebAnnotationAttachmentIds(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error("webAnnotationIds must be an array");
	if (value.length > WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT) throw new Error(`At most ${WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT} web annotations can be attached`);
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") throw new Error("webAnnotationIds entries must be strings");
		const id = item.trim();
		if (!id) throw new Error("webAnnotationIds entries must be non-empty strings");
		if (id.length > 160) throw new Error("web annotation id is too long");
		if (!seen.has(id)) {
			seen.add(id);
			ids.push(id);
		}
	}
	return ids;
}

export function serializeWebAnnotationAttachment(annotation: WebAnnotation): WebAnnotationMessageAttachment {
	const attachment: WebAnnotationMessageAttachment = {
		id: annotation.id,
		status: annotation.status,
		targetKind: annotation.targetKind,
		piboSessionId: annotation.piboSessionId,
		piboRoomId: annotation.piboRoomId,
		url: truncateInline(annotation.url, 240) ?? annotation.url,
		note: truncateInline(annotation.note, 400) ?? "",
		createdAt: annotation.createdAt,
	};
	const label = truncateInline(annotation.target?.label, 160);
	const selector = truncateInline(annotation.target?.selector ?? annotation.target?.domPath ?? annotation.target?.stableId, 220);
	const sourceHint = truncateInline(sourceHintSummary(annotation.target?.sourceHints?.[0]), 220);
	const sourceHints = sourceHintSummaries(annotation.target?.sourceHints).map((hint) => truncateInline(hint, 220)).filter((hint): hint is string => Boolean(hint));
	const primaryTarget = truncateInline(primaryTargetSummary(annotation.target?.sourceHints), 220);
	const piboContext = truncateInline(piboContextSummary(annotation.target?.sourceHints), 260);
	const position = positionSummary(annotation);
	const text = truncateInline(annotation.target?.selectedText ?? annotation.target?.text, 220);
	if (label) attachment.label = label;
	if (selector) attachment.selector = selector;
	if (primaryTarget) attachment.primaryTarget = primaryTarget;
	if (piboContext) attachment.piboContext = piboContext;
	if (sourceHint) attachment.sourceHint = sourceHint;
	if (sourceHints.length) attachment.sourceHints = sourceHints;
	if (position) attachment.position = position;
	if (text) attachment.text = text;
	return attachment;
}

export function prepareWebAnnotationMessageAttachments(input: {
	store: WebAnnotationStore;
	ownerScope: string;
	piboSessionId: string;
	messageText: string;
	attachmentIds: unknown;
}): PreparedWebAnnotationAttachments {
	const ids = normalizeWebAnnotationAttachmentIds(input.attachmentIds);
	if (!ids.length) {
		return { ids: [], annotations: [], attachments: [], modelContext: "", messageText: input.messageText };
	}
	const annotations = ids.map((id) => {
		const annotation = input.store.getAnnotationForOwner(input.ownerScope, id);
		if (!annotation) throw new Error(`Web Annotation ${id} is not available in this app`);
		if (annotation.status === "resolved" || annotation.status === "dismissed") {
			throw new Error(`Web Annotation ${id} cannot be attached because it is ${annotation.status}`);
		}
		return annotation;
	});
	const modelContext = renderAttachedWebAnnotations(annotations);
	return {
		ids,
		annotations,
		attachments: annotations.map(serializeWebAnnotationAttachment),
		modelContext,
		messageText: modelContext ? `${input.messageText.trimEnd()}\n\n${modelContext}` : input.messageText,
	};
}

export function renderAttachedWebAnnotations(annotations: readonly WebAnnotation[]): string {
	const bounded = annotations.slice(0, WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT);
	if (!bounded.length) return "";
	const lines = ["<attached-web-annotations>"];
	bounded.forEach((annotation, index) => {
		const target = annotation.target;
		const sourceHint = sourceHintSummary(target?.sourceHints?.[0]);
		const sourceHints = sourceHintSummaries(target?.sourceHints);
		const primaryTarget = primaryTargetSummary(target?.sourceHints);
		const piboContext = piboContextSummary(target?.sourceHints);
		const position = positionSummary(annotation);
		lines.push(`${index + 1}. ${escapeBlockValue(annotation.id)}`);
		lines.push(`targetKind: ${escapeBlockValue(annotation.targetKind)}`);
		lines.push(`sourceSession: ${escapeBlockValue(annotation.piboSessionId)}`);
		if (annotation.piboRoomId) lines.push(`sourceRoom: ${escapeBlockValue(annotation.piboRoomId)}`);
		lines.push(`url: ${escapeBlockValue(truncateInline(annotation.url, 240) ?? "")}`);
		if (target?.label) lines.push(`label: ${escapeBlockValue(truncateInline(target.label, 160) ?? "")}`);
		if (primaryTarget) lines.push(`primaryTarget: ${escapeBlockValue(truncateInline(primaryTarget, 220) ?? "")}`);
		if (piboContext) lines.push(`piboContext: ${escapeBlockValue(truncateInline(piboContext, 260) ?? "")}`);
		const selector = target?.selector ?? target?.domPath ?? target?.stableId;
		if (selector) lines.push(`selector: ${escapeBlockValue(truncateInline(selector, 220) ?? "")}`);
		if (sourceHint) lines.push(`sourceHint: ${escapeBlockValue(truncateInline(sourceHint, 220) ?? "")}`);
		if (sourceHints.length > 1) lines.push(`sourceHints: ${escapeBlockValue(truncateInline(sourceHints.slice(0, 5).join(" | "), 500) ?? "")}`);
		if (position) lines.push(`position: ${escapeBlockValue(position)}`);
		const text = target?.selectedText ?? target?.text;
		if (text) lines.push(`text: ${escapeBlockValue(truncateInline(text, 220) ?? "")}`);
		if (target?.htmlHint) lines.push(`htmlHint: ${escapeBlockValue(truncateInline(target.htmlHint, 180) ?? "")}`);
		lines.push(`comment: ${escapeBlockValue(truncateInline(annotation.note, 400) ?? "")}`);
	});
	lines.push("</attached-web-annotations>");
	return lines.join("\n");
}

function primaryTargetSummary(hints: readonly WebAnnotationSourceHint[] | undefined): string | undefined {
	const hint = hints?.find((candidate) => candidate.kind === "pibo-shared-card")
		?? hints?.find((candidate) => candidate.kind === "pibo-markdown")
		?? hints?.find((candidate) => candidate.kind === "pibo-terminal-row")
		?? hints?.find((candidate) => candidate.kind === "pibo-component")
		?? hints?.[0];
	if (!hint) return undefined;
	if (hint.kind === "pibo-shared-card") return [hint.component, hint.id === "status" ? "status card" : hint.id].filter(Boolean).join(" ");
	if (hint.kind === "pibo-terminal-row") return [hint.component ?? "TerminalRow", rawString(hint, "rowKind") ?? hint.id].filter(Boolean).join(" ");
	if (hint.kind === "pibo-markdown") return [hint.component ?? "MarkdownRenderer", hint.id].filter(Boolean).join(" ");
	return hint.component ?? hint.id;
}

function piboContextSummary(hints: readonly WebAnnotationSourceHint[] | undefined): string | undefined {
	if (!hints?.length) return undefined;
	const parts: string[] = [];
	for (const hint of hints) {
		if (!hint.kind.startsWith("pibo-")) continue;
		const values = [
			hint.component ? `component=${hint.component}` : undefined,
			hint.id ? `${hint.kind.replace(/^pibo-/, "")}=${hint.id}` : undefined,
			rawString(hint, "rowKind") ? `rowKind=${rawString(hint, "rowKind")}` : undefined,
			rawString(hint, "rowStatus") ? `rowStatus=${rawString(hint, "rowStatus")}` : undefined,
			rawString(hint, "eventId") ? `eventId=${rawString(hint, "eventId")}` : undefined,
			rawString(hint, "traceNodeId") ? `traceNodeId=${rawString(hint, "traceNodeId")}` : undefined,
			rawString(hint, "runId") ? `runId=${rawString(hint, "runId")}` : undefined,
			rawString(hint, "piboSessionId") ? `piboSessionId=${rawString(hint, "piboSessionId")}` : undefined,
		].filter(Boolean).join(", ");
		if (values && !parts.includes(values)) parts.push(values);
		if (parts.length >= 3) break;
	}
	return parts.length ? parts.join(" | ") : undefined;
}

function sourceHintSummaries(hints: readonly WebAnnotationSourceHint[] | undefined): string[] {
	return hints?.map(sourceHintSummary).filter((summary): summary is string => Boolean(summary)).slice(0, 6) ?? [];
}

function sourceHintSummary(hint: WebAnnotationSourceHint | undefined): string | undefined {
	if (!hint) return undefined;
	const location = hint.file
		? `${hint.file}${hint.line !== undefined ? `:${hint.line}` : ""}${hint.column !== undefined ? `:${hint.column}` : ""}`
		: [hint.component, hint.id].filter(Boolean).join(" ") || undefined;
	const rawBits = [rawString(hint, "rowKind"), rawString(hint, "eventId"), rawString(hint, "traceNodeId")].filter(Boolean).join(" · ");
	return [location, hint.confidence, hint.kind, rawBits].filter(Boolean).join(" · ");
}

function rawString(hint: WebAnnotationSourceHint, key: string): string | undefined {
	const value = hint.raw?.[key];
	return typeof value === "string" && value ? value : undefined;
}

function positionSummary(annotation: WebAnnotation): string | undefined {
	const box = annotation.target?.boundingBox;
	if (box) return `x${formatNumber(box.x)} y${formatNumber(box.y)} ${formatNumber(box.width)}x${formatNumber(box.height)}`;
	const position = annotation.target?.position;
	return position ? `x${formatNumber(position.x)} y${formatNumber(position.y)}` : undefined;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function truncateInline(value: string | undefined, max: number): string | undefined {
	return sanitizeWebAnnotationText(value, { max, field: "web annotation attachment" });
}

function escapeBlockValue(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

