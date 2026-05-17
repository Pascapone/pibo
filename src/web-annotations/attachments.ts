import type { WebAnnotation, WebAnnotationSourceHint } from "./types.js";

export const WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT = 5;

export type WebAnnotationMessageAttachment = {
	id: string;
	status: WebAnnotation["status"];
	targetKind: WebAnnotation["targetKind"];
	url: string;
	label?: string;
	selector?: string;
	sourceHint?: string;
	position?: string;
	text?: string;
	note: string;
	createdAt: string;
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
		url: truncateInline(annotation.url, 240) ?? annotation.url,
		note: truncateInline(annotation.note, 400) ?? "",
		createdAt: annotation.createdAt,
	};
	const label = truncateInline(annotation.target?.label, 160);
	const selector = truncateInline(annotation.target?.selector ?? annotation.target?.domPath ?? annotation.target?.stableId, 220);
	const sourceHint = truncateInline(sourceHintSummary(annotation.target?.sourceHints?.[0]), 220);
	const position = positionSummary(annotation);
	const text = truncateInline(annotation.target?.selectedText ?? annotation.target?.text, 220);
	if (label) attachment.label = label;
	if (selector) attachment.selector = selector;
	if (sourceHint) attachment.sourceHint = sourceHint;
	if (position) attachment.position = position;
	if (text) attachment.text = text;
	return attachment;
}

export function renderAttachedWebAnnotations(annotations: readonly WebAnnotation[]): string {
	const bounded = annotations.slice(0, WEB_ANNOTATION_MESSAGE_ATTACHMENT_LIMIT);
	if (!bounded.length) return "";
	const lines = ["<attached-web-annotations>"];
	bounded.forEach((annotation, index) => {
		const target = annotation.target;
		const sourceHint = sourceHintSummary(target?.sourceHints?.[0]);
		const position = positionSummary(annotation);
		lines.push(`${index + 1}. ${escapeBlockValue(annotation.id)}`);
		lines.push(`targetKind: ${escapeBlockValue(annotation.targetKind)}`);
		lines.push(`url: ${escapeBlockValue(truncateInline(annotation.url, 240) ?? "")}`);
		if (target?.label) lines.push(`label: ${escapeBlockValue(truncateInline(target.label, 160) ?? "")}`);
		const selector = target?.selector ?? target?.domPath ?? target?.stableId;
		if (selector) lines.push(`selector: ${escapeBlockValue(truncateInline(selector, 220) ?? "")}`);
		if (sourceHint) lines.push(`sourceHint: ${escapeBlockValue(truncateInline(sourceHint, 220) ?? "")}`);
		if (position) lines.push(`position: ${escapeBlockValue(position)}`);
		const text = target?.selectedText ?? target?.text;
		if (text) lines.push(`text: ${escapeBlockValue(truncateInline(text, 220) ?? "")}`);
		if (target?.htmlHint) lines.push(`htmlHint: ${escapeBlockValue(truncateInline(target.htmlHint, 180) ?? "")}`);
		lines.push(`comment: ${escapeBlockValue(truncateInline(annotation.note, 400) ?? "")}`);
	});
	lines.push("</attached-web-annotations>");
	return lines.join("\n");
}

function sourceHintSummary(hint: WebAnnotationSourceHint | undefined): string | undefined {
	if (!hint) return undefined;
	const location = hint.file
		? `${hint.file}${hint.line !== undefined ? `:${hint.line}` : ""}${hint.column !== undefined ? `:${hint.column}` : ""}`
		: hint.id ?? hint.component;
	return [location, hint.confidence, hint.kind].filter(Boolean).join(" · ");
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
	if (value === undefined) return undefined;
	const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function escapeBlockValue(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

