import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const terminalViewSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8");
const terminalLineSource = fs.readFileSync("src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx", "utf8");
const terminalLayoutSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");
const compactTerminalSources = [
	terminalViewSource,
	terminalLineSource,
	terminalLayoutSource,
	...[
		"TerminalCompactionCard.tsx",
		"TerminalModelCard.tsx",
		"TerminalModelInferenceMetrics.tsx",
		"TerminalToolMetrics.tsx",
	].map((name) => fs.readFileSync(`src/apps/chat-ui/src/session-views/compact-terminal/${name}`, "utf8")),
].join("\n");

test("Terminal rows use the full viewport width and a compact aligned content gutter", () => {
	assert.match(terminalViewSource, /const renderRow[\s\S]*?\(\s*<div>\s*<TerminalRow/);
	assert.match(terminalLineSource, /grid-cols-\[1\.25rem_minmax\(0,1fr\)\] leading-\[1\.45\]/);
	assert.match(terminalLineSource, /line\.prefix === "bullet" && PrefixIcon \? <PrefixIcon size=\{13\}/);
	assert.match(terminalViewSource, /ml-5 min-w-0" data-pibo-component="TerminalAssistantMessage"/);
	assert.match(terminalViewSource, /nameParts\.includes\("read"\)\) return BookOpenCheck/);
	assert.match(terminalViewSource, /nameParts\.includes\("write"\) \|\| nameParts\.includes\("edit"\)\) return Pencil/);
	assert.match(terminalViewSource, /row\.kind === "tool\.image" \|\| row\.kind === "tool\.group\.images"\) return ImageIcon/);
	assert.match(terminalViewSource, /row\.kind === "execution\.compaction"\) return FileArchive/);
	assert.match(terminalLayoutSource, /<div>\s*<div className="group border-b border-\[#141414\] py-2">/);
	assert.doesNotMatch(compactTerminalSources, /1\.9rem|return "•"/);
});
