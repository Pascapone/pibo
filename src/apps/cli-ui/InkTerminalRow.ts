import React from "react";
import { Box, Text } from "ink";
import { buildTerminalCardDescriptor, progressBarText, redactTerminalSecret, type CompactTerminalDetailItem, type CompactTerminalLine, type CompactTerminalRow, type TerminalCardDescriptor, type TerminalCardTone } from "../../session-ui/index.js";
import { colorForRowKind, colorForStatus, colorForTone, markerForStatus, type InkTerminalColor } from "./inkColors.js";
import { formatInkJson } from "./inkJson.js";
import { renderInkMarkdownLines } from "./inkMarkdown.js";
import { InkTerminalLine } from "./InkTerminalLine.js";

export type InkTerminalRowProps = {
	row: CompactTerminalRow;
	maxLineChars?: number;
	maxMarkdownLines?: number;
};

export function InkTerminalRow({ row, maxLineChars = 220, maxMarkdownLines = 80 }: InkTerminalRowProps): React.ReactElement {
	const card = buildTerminalCardDescriptor(row);
	const detailLines = rowDetailLines(row, maxLineChars);
	if (card) return React.createElement(Box, { flexDirection: "column" }, React.createElement(InkTerminalCard, { card, maxLineChars }), ...detailLines);
	const lines = rowLines(row, maxMarkdownLines);
	const statusColor = colorForStatus(row.status);
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		...lines.map((line, index) => React.createElement(InkTerminalLine, {
			key: `${row.id}-${index}`,
			leadingColor: index === 0 ? rowMarkerColor(row) ?? statusColor : undefined,
			leadingMarker: index === 0 ? rowMarker(row) : " ",
			line,
			maxChars: maxLineChars,
		})),
		...detailLines,
	);
}

export function InkTerminalCard({ card, maxLineChars: _maxLineChars = 220 }: { card: TerminalCardDescriptor; maxLineChars?: number }): React.ReactElement {
	const marker = markerForStatus(card.status);
	const color = colorForCardTone(card.tone) ?? colorForStatus(card.status);
	const statusLabel = card.status === "neutral" ? card.kind : `${card.kind} · ${card.status}`;
	const statusSummary = card.kind === "status" ? statusCardSummary(card) : undefined;
	const lines: React.ReactElement[] = [
		React.createElement(Text, { color, key: "header", bold: true }, cardLine(`${marker} ▣ ${card.title} — ${statusLabel}${statusSummary ? ` · ${statusSummary}` : ""}`)),
	];
	for (const [index, row] of card.rows.entries()) {
		const text = row.label ? `  ↳ ${row.label}: ${row.value}` : `  ↳ ${row.value}`;
		lines.push(React.createElement(Text, { color: colorForCardTone(row.tone) ?? "white", key: `row-${index}` }, cardLine(text)));
	}
	for (const progress of card.statusView?.progress ?? []) {
		const bar = inkProgressBarText(progress, 18);
		const detail = progress.state === "available" ? ` — ${progress.text}` : "";
		lines.push(React.createElement(Text, { color: progress.tone === "neutral" ? "gray" : colorForTone(progress.tone), key: `progress-${progress.id}` }, cardLine(`  ↳ ${progress.label}: ${bar}${detail}`)));
	}
	for (const [index, warning] of (card.statusView?.warnings ?? []).entries()) {
		lines.push(React.createElement(Text, { color: "yellow", key: `warning-${index}` }, cardLine(`  ⚠ ${warning}`)));
	}
	for (const [index, error] of (card.statusView?.errors ?? []).entries()) {
		lines.push(React.createElement(Text, { color: "red", key: `error-${index}` }, cardLine(`  ✕ ${error}`)));
	}
	if (card.actions?.length) {
		const actions = card.actions.map((action) => `${action.disabled ? "-" : "•"} ${action.label}`).join("  ");
		lines.push(React.createElement(Text, { color: "gray", key: "actions" }, cardLine(`  Actions: ${actions}`)));
	}
	if (lines.length === 1) lines.push(React.createElement(Text, { color: "gray", key: "empty" }, "  ↳ No details"));
	return React.createElement(Box, { flexDirection: "column" }, ...lines);
}

export function rowMarker(row: CompactTerminalRow): string {
	if (row.kind === "message.user") return "›";
	if (row.kind === "message.assistant") return row.status === "running" ? "…" : " ";
	if (row.kind === "error") return "✕";
	return markerForStatus(row.status);
}

function rowMarkerColor(row: CompactTerminalRow): ReturnType<typeof colorForRowKind> {
	return row.status === "error" ? colorForStatus("error") : colorForRowKind(row.kind);
}

function colorForCardTone(tone: TerminalCardTone | undefined): InkTerminalColor | undefined {
	if (tone === "neutral") return "gray";
	return colorForTone(tone as Parameters<typeof colorForTone>[0]);
}

function statusCardSummary(card: TerminalCardDescriptor): string {
	const fields = new Map((card.statusView?.fields ?? []).map((field) => [field.id, field.value]));
	const runtime = fields.get("runtime") ?? card.status;
	const session = shortStatusValue(fields.get("session"));
	const model = shortStatusValue(fields.get("model"));
	const owner = abbreviateOwner(fields.get("owner"));
	return [runtime, session ? `session ${session}` : undefined, model ? `model ${model}` : undefined, owner ? `owner ${owner}` : undefined].filter(Boolean).join(" · ");
}

function shortStatusValue(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value.split("|")[0]?.trim() || value;
}

function abbreviateOwner(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return value.replace(/\s*\([^)]*\)\s*$/, "").trim() || value;
}

function cardLine(value: string): string {
	return value.replace(/\s+/g, " ");
}

function inkProgressBarText(progress: Parameters<typeof progressBarText>[0], width: number): string {
	const boundedWidth = Math.max(4, Math.min(80, Math.floor(width)));
	const ascii = shouldUseAsciiProgress();
	if (progress.state !== "available" || progress.percent === undefined) {
		const empty = ascii ? "-".repeat(boundedWidth) : "░".repeat(boundedWidth);
		return `unavailable · ${empty}`;
	}
	const text = progressBarText(progress, boundedWidth);
	if (!ascii) return text;
	const filled = Math.round((Math.max(0, Math.min(100, progress.percent)) / 100) * boundedWidth);
	return `${"#".repeat(filled)}${"-".repeat(boundedWidth - filled)} ${progress.percent.toFixed(1)}%`;
}

function shouldUseAsciiProgress(): boolean {
	return Boolean(process.env.NO_COLOR) || process.env.TERM === "dumb" || process.env.PIBO_ASCII_PROGRESS === "1";
}

function rowDetailLines(row: CompactTerminalRow, maxLineChars: number): React.ReactElement[] {
	const details: CompactTerminalDetailItem[] = [...(row.detailItems ?? [])];
	if (row.linkedPiboSessionId && !details.some((item) => item.linkedPiboSessionId === row.linkedPiboSessionId)) {
		details.push({ id: `${row.id}:linked-session`, label: "Linked session", status: "done", linkedPiboSessionId: row.linkedPiboSessionId });
	}
	if (!details.length) return [];
	return details.flatMap((detail, index) => detailTextLines(detail, maxLineChars).map((text, lineIndex) => React.createElement(Text, {
		color: detail.status === "error" ? "red" : "gray",
		key: `${row.id}:detail:${detail.id}:${index}:${lineIndex}`,
	}, cardLine(lineIndex === 0 ? `  ↳ ${text}` : `    ${text}`))));
}

function detailTextLines(detail: CompactTerminalDetailItem, maxLineChars: number): string[] {
	const label = detail.status === "error" && !/error/i.test(detail.label) ? `${detail.label} error` : detail.label;
	const parts: string[] = [];
	if (detail.linkedPiboSessionId) parts.push(redactTerminalSecret(detail.linkedPiboSessionId));
	if (detail.input !== undefined) parts.push(`Input ${detailValueText(detail.input, maxLineChars)}`);
	if (detail.output !== undefined) parts.push(`Output ${detailValueText(detail.output, maxLineChars)}`);
	if (detail.error) parts.push(`Error ${redactTerminalSecret(detail.error)}`);
	if (parts.length === 0) parts.push(detail.status);
	return [`${label}: ${parts.join(" · ")}`];
}

function detailValueText(value: unknown, maxLineChars: number): string {
	const text = typeof value === "string"
		? value
		: formatInkJson(value, { maxChars: Math.min(420, Math.max(120, maxLineChars * 3)), maxDepth: 3, maxArrayItems: 4, maxObjectKeys: 8 });
	const redacted = redactTerminalSecret(text).replace(/\s+/g, " ").trim();
	return redacted;
}

function rowLines(row: CompactTerminalRow, maxMarkdownLines: number): CompactTerminalLine[] {
	if (row.lines.length > 0) return row.lines;
	if (row.markdown || typeof row.output === "string") {
		const markdown = row.markdown ?? String(row.output ?? "");
		return renderInkMarkdownLines(markdown, { maxLines: maxMarkdownLines }).map((text) => ({
			prefix: "none",
			tokens: [{ text, tone: row.kind === "reasoning" ? "amber" : undefined }],
		}));
	}
	if (row.error) return [{ prefix: "none", tokens: [{ text: row.error, tone: "red", weight: "semibold" }] }];
	if (row.output !== undefined) return jsonLines(row.output);
	if (row.input !== undefined) return jsonLines(row.input);
	return [{ prefix: "none", tokens: [{ text: fallbackLabel(row), tone: "dim" }] }];
}

function jsonLines(value: unknown): CompactTerminalLine[] {
	return formatInkJson(value).split("\n").map((text) => ({ prefix: "none", tokens: [{ text, tone: "dim" }] }));
}

function fallbackLabel(row: CompactTerminalRow): string {
	return `${row.kind} ${row.status}`.trim();
}
