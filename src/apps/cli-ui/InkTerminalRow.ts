import React from "react";
import { Box } from "ink";
import type { CompactTerminalLine, CompactTerminalRow } from "../../session-ui/index.js";
import { colorForRowKind, colorForStatus, markerForStatus } from "./inkColors.js";
import { formatInkJson } from "./inkJson.js";
import { renderInkMarkdownLines } from "./inkMarkdown.js";
import { InkTerminalLine } from "./InkTerminalLine.js";

export type InkTerminalRowProps = {
	row: CompactTerminalRow;
	maxLineChars?: number;
	maxMarkdownLines?: number;
};

export function InkTerminalRow({ row, maxLineChars = 220, maxMarkdownLines = 80 }: InkTerminalRowProps): React.ReactElement {
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
	);
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
