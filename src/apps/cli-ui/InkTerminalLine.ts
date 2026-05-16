import React from "react";
import { Box, Text } from "ink";
import type { CompactTerminalLine, TerminalInlineToken } from "../../session-ui/index.js";
import { colorForTone, type InkTerminalColor } from "./inkColors.js";
import { formatInlineJson, truncateTerminalText } from "./inkJson.js";

export type InkTerminalLineProps = {
	line: CompactTerminalLine;
	leadingMarker?: string;
	leadingColor?: InkTerminalColor;
	maxChars?: number;
};

export function InkTerminalLine({ line, leadingMarker, leadingColor, maxChars = 220 }: InkTerminalLineProps): React.ReactElement {
	const chunks = buildLineChunks(line, maxChars);
	return React.createElement(
		Box,
		{ flexDirection: "row" },
		React.createElement(Text, { color: leadingColor, key: "marker" }, markerText(line, leadingMarker)),
		...chunks.map((chunk, index) => React.createElement(Text, {
			bold: chunk.weight === "bold" || chunk.weight === "semibold",
			color: colorForTone(chunk.tone),
			dimColor: chunk.tone === "dim",
			italic: chunk.italic,
			key: `token-${index}`,
		}, chunk.text)),
	);
}

export function linePrefixSymbol(prefix: CompactTerminalLine["prefix"]): string {
	switch (prefix) {
		case "prompt":
			return "›";
		case "bullet":
			return "•";
		case "detail":
			return "↳";
		case "continuation":
			return " ";
		case "none":
		case undefined:
		default:
			return " ";
	}
}

type LineChunk = TerminalInlineToken;

function markerText(line: CompactTerminalLine, leadingMarker: string | undefined): string {
	const prefix = linePrefixSymbol(line.prefix);
	if (leadingMarker === undefined) return `${prefix} `;
	if (prefix.trim() && prefix !== leadingMarker) return `${leadingMarker} ${prefix} `;
	return `${leadingMarker} `;
}

function buildLineChunks(line: CompactTerminalLine, maxChars: number): LineChunk[] {
	const chunks: LineChunk[] = [...line.tokens];
	if (line.functionCall) {
		chunks.push({ text: line.functionCall.name, tone: "cyan", weight: "semibold" });
		if (line.functionCall.input !== undefined) chunks.push({ text: ` ${formatInlineJson(line.functionCall.input)}`, tone: "dim" });
	}
	if (chunks.length === 0) return [{ text: "∅", tone: "dim" }];
	let remaining = maxChars;
	return chunks.map((chunk) => {
		if (remaining <= 0) return { ...chunk, text: "" };
		const truncated = truncateTerminalText(chunk.text, remaining).replace(/\n/g, " ");
		remaining -= truncated.length;
		return { ...chunk, text: truncated };
	}).filter((chunk) => chunk.text.length > 0);
}
