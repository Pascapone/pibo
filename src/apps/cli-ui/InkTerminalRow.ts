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
	isExpanded?: boolean;
	isSelected?: boolean;
};

export function InkTerminalRow({ row, maxLineChars = 220, maxMarkdownLines = 80, isExpanded = false, isSelected = false }: InkTerminalRowProps): React.ReactElement {
	const card = isStructuredCardException(row) ? buildTerminalCardDescriptor(row) : undefined;
	const detailLines = isExpanded ? rowDetailLines(row, maxLineChars) : [];
	const selectedHint = isSelected && isExpandableTerminalRow(row) && !isExpanded
		? [React.createElement(Text, { color: "cyan", key: `${row.id}:selected-detail-hint` }, "  ↳ details available · press d or enter")]
		: [];
	if (card) return React.createElement(Box, { flexDirection: "column" }, React.createElement(InkTerminalCard, { card, maxLineChars }), ...selectedHint, ...detailLines);
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
		...selectedHint,
		...detailLines,
	);
}

function isStructuredCardException(row: CompactTerminalRow): boolean {
	return row.kind === "tool.status"
		|| row.kind === "tool.thinking"
		|| row.kind === "tool.login"
		|| row.kind === "tool.model";
}

export function isExpandableTerminalRow(row: CompactTerminalRow): boolean {
	return row.expandable === true
		|| row.input !== undefined
		|| row.output !== undefined
		|| Boolean(row.error)
		|| Boolean(row.linkedPiboSessionId)
		|| Boolean(row.previewOmission)
		|| Boolean(row.detailItems?.length);
}

export function InkTerminalCard({ card, maxLineChars: _maxLineChars = 220 }: { card: TerminalCardDescriptor; maxLineChars?: number }): React.ReactElement {
	const marker = markerForStatus(card.status);
	const color = colorForCardTone(card.tone) ?? colorForStatus(card.status);
	const statusLabel = card.status === "neutral" ? card.kind : `${card.kind} · ${card.status}`;
	const statusSummary = card.kind === "status" ? statusCardSummary(card) : undefined;
	const lines: React.ReactElement[] = [
		React.createElement(Text, { color, key: "header", bold: true }, cardLine(`${marker} ▣ ${card.title} — ${statusLabel}${statusSummary ? ` · ${statusSummary}` : ""}`)),
	];
	if (card.kind === "status") {
		lines.push(...statusCardCompactRows(card));
	} else {
		for (const [index, row] of card.rows.entries()) {
			const text = row.label ? `  ↳ ${row.label}: ${row.value}` : `  ↳ ${row.value}`;
			lines.push(React.createElement(Text, { color: colorForCardTone(row.tone) ?? "white", key: `row-${index}` }, cardLine(text)));
		}
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
	const fields = statusFieldMap(card);
	const runtime = fields.get("runtime") ?? card.status;
	const session = shortStatusValue(fields.get("session"));
	const model = shortStatusValue(fields.get("model"));
	const owner = abbreviateOwner(fields.get("owner"));
	return [runtime, session ? `session ${session}` : undefined, model ? `model ${model}` : undefined, owner ? `owner ${owner}` : undefined].filter(Boolean).join(" · ");
}

function statusCardCompactRows(card: TerminalCardDescriptor): React.ReactElement[] {
	const fields = statusFieldMap(card);
	const rows: React.ReactElement[] = [];
	const identity = [
		fields.get("owner") ? `owner ${abbreviateOwner(fields.get("owner"))}` : undefined,
		fields.get("session") ? `session ${shortStatusValue(fields.get("session"))}` : undefined,
		fields.get("profile") ? `profile ${fields.get("profile")}` : undefined,
		fields.get("model") ? `model ${fields.get("model")}` : undefined,
	].filter(Boolean).join(" · ");
	if (identity) rows.push(statusCardRow("identity", "Identity", identity));

	const runtime = [
		fields.get("runtime"),
		fieldIfMeaningful("queue", fields.get("queue")),
		fieldIfMeaningful("processing", fields.get("processing")),
		fieldIfMeaningful("streaming", fields.get("streaming")),
		fieldIfMeaningful("disposed", fields.get("disposed")),
		fields.get("session-status") ? `session ${fields.get("session-status")}` : undefined,
	].filter(Boolean).join(" · ");
	if (runtime) rows.push(statusCardRow("runtime", "Runtime", runtime, statusRuntimeTone(fields)));

	const location = fields.get("cwd");
	if (location) rows.push(statusCardRow("location", "CWD", location));

	const settings = [
		fields.get("thinking") ? `thinking ${fields.get("thinking")}` : undefined,
		fieldIfEnabled("fast", fields.get("fast-mode")),
	].filter(Boolean).join(" · ");
	if (settings) rows.push(statusCardRow("settings", "Settings", settings, "yellow"));

	const provider = [
		fields.get("provider-plan") ? `plan ${fields.get("provider-plan")}` : undefined,
		fields.get("provider-credits") ? `credits ${fields.get("provider-credits")}` : undefined,
	].filter(Boolean).join(" · ");
	if (provider) rows.push(statusCardRow("provider", "Provider", provider));

	const tools = [
		fields.get("enabled-tools") ? `enabled ${foldedToolCount(fields.get("enabled-tools"))}` : undefined,
		fields.get("active-tools") ? `active ${activeToolSummary(fields.get("active-tools"))}` : undefined,
	].filter(Boolean).join(" · ");
	if (tools) rows.push(statusCardRow("tools", "Tools", `${tools} · names in details`, "cyan"));

	const message = fields.get("message");
	if (message) rows.push(statusCardRow("message", "Message", message, "neutral"));
	return rows;
}

function statusCardRow(id: string, label: string, value: string, tone: TerminalCardTone = "neutral"): React.ReactElement {
	return React.createElement(Text, { color: colorForCardTone(tone) ?? "white", key: `status-${id}` }, cardLine(`  ↳ ${label}: ${value}`));
}

function statusFieldMap(card: TerminalCardDescriptor): Map<string, string> {
	return new Map((card.statusView?.fields ?? []).map((field) => [field.id, field.value]));
}

function statusRuntimeTone(fields: Map<string, string>): TerminalCardTone {
	if (fields.get("disposed") === "yes" || fields.get("runtime") === "disconnected") return "red";
	if (fields.get("processing") === "yes" || fields.get("streaming") === "yes") return "cyan";
	return "green";
}

function fieldIfMeaningful(label: string, value: string | undefined): string | undefined {
	if (!value || value === "no" || value === "0") return undefined;
	return `${label} ${value}`;
}

function fieldIfEnabled(label: string, value: string | undefined): string | undefined {
	if (!value || value === "off" || value === "no") return undefined;
	return `${label} ${value}`;
}

function foldedToolCount(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const count = value.match(/^\d+/)?.[0] ?? value;
	return `${count} folded`;
}

function activeToolSummary(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const names = value.match(/\(([^)]+)\)/)?.[1];
	return names ?? foldedToolCount(value);
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
	const details = detailsForExpandedRow(row);
	if (!details.length) return [];
	const lines: React.ReactElement[] = [
		React.createElement(Text, { color: "yellow", key: `${row.id}:details-header`, bold: true }, "  └ Details"),
	];
	for (const [index, detail] of details.entries()) {
		for (const [lineIndex, text] of detailTextLines(detail, maxLineChars).entries()) {
			lines.push(React.createElement(Text, {
				color: detail.status === "error" ? "red" : "gray",
				key: `${row.id}:detail:${detail.id}:${index}:${lineIndex}`,
			}, lineIndex === 0 ? `    ${text}` : `      ${text}`));
		}
	}
	return lines;
}

function detailsForExpandedRow(row: CompactTerminalRow): CompactTerminalDetailItem[] {
	const details: CompactTerminalDetailItem[] = [...(row.detailItems ?? [])];
	if (details.length === 0 && (row.input !== undefined || row.output !== undefined || row.error || row.linkedPiboSessionId || row.previewOmission)) {
		details.push({
			id: `${row.id}:row-details`,
			label: "Row details",
			status: row.status,
			input: row.input,
			output: row.output,
			error: row.error,
			linkedPiboSessionId: row.linkedPiboSessionId,
			previewOmission: row.previewOmission,
		});
	}
	if (row.linkedPiboSessionId && !details.some((item) => item.linkedPiboSessionId === row.linkedPiboSessionId)) {
		details.push({ id: `${row.id}:linked-session`, label: "Linked session", status: "done", linkedPiboSessionId: row.linkedPiboSessionId });
	}
	return details;
}

function detailTextLines(detail: CompactTerminalDetailItem, maxLineChars: number): string[] {
	const label = detail.status === "error" && !/error/i.test(detail.label) ? `${detail.label} error` : detail.label;
	const lines: string[] = [`${label}:`];
	if (detail.previewOmission) {
		const source = sectionLabel(detail.previewOmission.source);
		lines.push(`${source}: ${detail.previewOmission.totalLineCount} lines total · ${detail.previewOmission.omittedLineCount} hidden while collapsed`);
	}
	if (detail.linkedPiboSessionId) lines.push(`Linked session: ${redactTerminalSecret(detail.linkedPiboSessionId)}`);
	if (detail.input !== undefined) lines.push("Input:", ...detailValueLines(detail.input, maxLineChars));
	if (detail.output !== undefined) lines.push("Output:", ...detailValueLines(detail.output, maxLineChars));
	if (detail.error) lines.push("Error:", ...redactedTextLines(detail.error));
	if (lines.length === 1) lines.push(detail.status);
	return lines;
}

function sectionLabel(source: NonNullable<CompactTerminalDetailItem["previewOmission"]>["source"]): string {
	if (source === "input") return "Input";
	if (source === "error") return "Error";
	if (source === "details") return "Details";
	return "Output";
}

function detailValueLines(value: unknown, maxLineChars: number): string[] {
	const text = typeof value === "string"
		? value
		: formatInkJson(value, { maxChars: Math.min(1600, Math.max(420, maxLineChars * 8)), maxDepth: 4, maxArrayItems: 12, maxObjectKeys: 20 });
	return redactedTextLines(text);
}

function redactedTextLines(value: string): string[] {
	const redacted = redactTerminalSecret(value).trimEnd();
	const lines = redacted.split(/\r?\n/);
	return lines.length > 0 && lines.some((line) => line.length > 0) ? lines : ["∅"];
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
