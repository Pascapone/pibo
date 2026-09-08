import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(`src/apps/chat-ui/src/${path}`, "utf8");

test("terminal tools expand directly and keep payload readers behind expansion", () => {
	const source = read("session-views/compact-terminal/CompactTerminalSessionView.tsx");
	assert.doesNotMatch(source, /Show full content|Hide full content/);
	assert.match(source, /onClick=\{row.expandable \? handleRowClick : undefined\}/);
	assert.match(source, /max-h-\[7\.25em\] overflow-hidden/);
	assert.match(source, /expanded && \(!imageRow \|\| !images.length \|\| row.status === "error"\) \? \(\s*<TerminalDetails/);
	assert.match(source, /expanded && imageRow && images.length/);
	assert.match(source, /onClick=\{\(\) => onViewImages\(images, index\)\}/, "thumbnail navigation retains gallery order");
	assert.match(source, /overflow-x-auto/);
	assert.match(source, /loading="eager"/, "dialog images must not wait for lazy visibility while loading");
	assert.doesNotMatch(source, /loadState === "loaded" \? "block" : "invisible"/);
});

test("sidebar keeps existing indentation and puts layers before the status lamp", () => {
	const source = read("session-node.tsx");
	assert.match(source, /paddingLeft: 8 \+ depth \* 14/);
	assert.ok(source.indexOf("<Layers size={12}") < source.indexOf("<span className={signal.className}"));
	assert.match(source, /index === node.children.length - 1 \? "h-4" : "bottom-0"/);
	assert.match(source, /pointer-events-none absolute top-4 h-px w-2 bg-slate-600\/45/);
});

test("image upload names open the shared dialog without changing detach or copy", () => {
	const source = read("composer/Composer.tsx");
	assert.match(source, /onClick=\{\(\) => setPreviewAttachment\(attachment\)\}/);
	assert.match(source, /piboSessionId=\{sessionId\}/);
	assert.match(source, /onDetachUploadAttachment\(attachment.id\)/);
	assert.match(source, /copyTextToClipboard\(attachment.path\)/);
});
