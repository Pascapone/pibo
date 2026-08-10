import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relativePath) {
	return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function assertAllMatch(source, checks) {
	for (const [label, pattern] of checks) assert.match(source, pattern, label);
}

test("Markdown editor hosts share one rich editor implementation", async () => {
	const chatWrapper = await readSource("src/apps/chat-ui/src/context/MarkdownEditor.tsx");
	const contextWrapper = await readSource("src/apps/context-files-ui/src/components/MarkdownEditor.tsx");
	const chatMain = await readSource("src/apps/chat-ui/src/main.tsx");
	const contextMain = await readSource("src/apps/context-files-ui/src/main.tsx");

	assert.match(chatWrapper, /export \{ MarkdownEditor, type MarkdownEditorHandle \} from "\.\.\/\.\.\/\.\.\/shared\/MarkdownEditor"/);
	assert.match(contextWrapper, /export \{ MarkdownEditor, type MarkdownEditorHandle \} from "\.\.\/\.\.\/\.\.\/shared\/MarkdownEditor"/);
	assert.match(chatMain, /import "\.\.\/\.\.\/shared\/markdown-editor\.css"/);
	assert.match(contextMain, /import "\.\.\/\.\.\/shared\/markdown-editor\.css"/);
});

test("Markdown editor exposes the standard rich Markdown surface and source escape hatch", async () => {
	const source = await readSource("src/apps/shared/MarkdownEditor.tsx");

	assertAllMatch(source, [
		["headings", /headingsPlugin\(\)/],
		["list parsing", /listsPlugin\(\)/],
		["ordered, unordered, and task list controls", /<ListsToggle \/>/],
		["quotes", /quotePlugin\(\)/],
		["thematic break parsing", /thematicBreakPlugin\(\)/],
		["thematic break insertion", /<InsertThematicBreak \/>/],
		["link parsing", /linkPlugin\(\)/],
		["link dialog", /linkDialogPlugin\(\)/],
		["link insertion", /<CreateLink \/>/],
		["image parsing", /imagePlugin\(\)/],
		["image insertion", /<InsertImage \/>/],
		["table parsing", /tablePlugin\(\)/],
		["table insertion", /<InsertTable \/>/],
		["inline code", /<CodeToggle \/>/],
		["fenced code parsing", /codeBlockPlugin\(/],
		["CodeMirror editing", /codeMirrorPlugin\(/],
		["fenced code insertion", /<InsertCodeBlock \/>/],
		["code language selection", /ChangeCodeMirrorLanguage/],
		["frontmatter parsing", /frontmatterPlugin\(\)/],
		["frontmatter insertion", /<InsertFrontmatter \/>/],
		["strikethrough", /StrikeThroughSupSubToggles options=\{\["Strikethrough"\]\}/],
		["Markdown shortcuts", /markdownShortcutPlugin\(\)/],
		["smart typing guidance", /Type # \+ Space for a heading or - \+ Space for a list/],
		["source mode plugin", /diffSourcePlugin\(\{ viewMode: "rich-text" \}\)/],
		["rich and source controls", /DiffSourceToggleWrapper options=\{\["rich-text", "source"\]\}/],
		["raw fallback", /markdown-editor__plain-textarea/],
	]);
});

test("Markdown editor keeps autosave stable without unhandled rejections or own-save remounts", async () => {
	const source = await readSource("src/apps/shared/MarkdownEditor.tsx");
	const contextView = await readSource("src/apps/chat-ui/src/context/ContextFilesView.tsx");
	const standalone = await readSource("src/apps/context-files-ui/src/main.tsx");
	const workflowPrompt = await readSource("src/apps/chat-ui/src/workflows/WorkflowPromptAssetEditor.tsx");

	assertAllMatch(source, [
		["scheduled autosave handles rejection after surfacing state", /void persistIfNeeded\(\)\.catch\(\(\) => undefined\)/],
		["initial normalization does not consume the first real edit", /\(markdown: string, initialMarkdownNormalize: boolean\)[\s\S]*if \(initialMarkdownNormalize\)/],
		["own save echoes use the in-flight snapshot instead of newer typing", /savingMarkdownRef\.current = nextMarkdown[\s\S]*const ownSaveEcho =[\s\S]*savePromiseRef\.current !== null[\s\S]*initialMarkdown === savingMarkdownRef\.current/],
		["external same-document updates reset the editor", /setEditorResetVersion\(\(current\) => current \+ 1\)/],
		["focused mode restores body scrolling", /document\.body\.style\.overflow = "hidden"[\s\S]*document\.body\.style\.overflow = previousOverflow/],
	]);
	assert.match(contextView, /documentKey=\{document\.key\}/);
	assert.match(standalone, /documentKey=\{document\.key\}/);
	for (const host of [contextView, standalone]) {
		assert.match(
			host,
			/const handleSubmit = useCallback\(async \(\) => \{[\s\S]*?await editorRef\.current\?\.flushSave\(\);[\s\S]*?createContextFile/,
			"creating a context file flushes pending editor changes first",
		);
	}
	assert.match(workflowPrompt, /const editorDocumentKey = `\$\{draft\.draftId\}:\$\{nodeId\}`/);
	assert.match(workflowPrompt, /await editorRef\.current\?\.flushSave\(\)[\s\S]*setSelectedRef\(nextRef\)/);
});

test("Markdown editor remains usable in narrow host panels and focused mode", async () => {
	const styles = await readSource("src/apps/shared/markdown-editor.css");
	const contextStyles = await readSource("src/apps/chat-ui/src/styles.css");
	const contextView = await readSource("src/apps/chat-ui/src/context/ContextFilesView.tsx");

	assertAllMatch(styles, [
		["focus mode fills the viewport without inheriting host width", /\.markdown-editor-shell--expanded \{[\s\S]*position: fixed;[\s\S]*width: auto !important/],
		["rich editor owns an internal scroll area", /\.mdxeditor-rich-text-editor \{[\s\S]*overflow: auto;[\s\S]*scrollbar-gutter: stable/],
		["source mode owns an internal scroll area", /\.mdxeditor-diff-source-wrapper \{[\s\S]*overflow: auto;[\s\S]*scrollbar-gutter: stable/],
		["narrow toolbars wrap before their controls overflow", /@container \(max-width: 48rem\)[\s\S]*\.mdxeditor-toolbar\[role="toolbar"\] \{[\s\S]*flex-wrap: wrap/],
		["narrow toolbar keeps source controls beside formatting rows", /\.mdxeditor-toolbar > div:first-child \{[\s\S]*flex: 1 1 calc\(100% - 5rem\)[\s\S]*_diffSourceToggleWrapper_[\s\S]*margin-left: 0 !important/],
		["content has a readable maximum width", /width: min\(100%, 56rem\)/],
		["unordered lists render visible markers", /\.markdown-editor__content ul \{[\s\S]*list-style-type: disc/],
		["ordered lists render visible markers", /\.markdown-editor__content ol \{[\s\S]*list-style-type: decimal/],
		["nested list markers remain distinct", /ul ul \{[\s\S]*list-style-type: circle[\s\S]*ul ul ul \{[\s\S]*list-style-type: square/],
		["task list checkboxes do not overlap text", /li\[role="checkbox"\] \{[\s\S]*padding-left: 1\.75rem;[\s\S]*list-style-type: none/],
		["toolbar icons use crisp even-pixel sizing", /width: 20px !important;[\s\S]*height: 20px !important;[\s\S]*opacity: 1;[\s\S]*shape-rendering: geometricPrecision/],
		["keyboard focus is visible", /:focus-visible[\s\S]*outline: 2px solid #11a4d4/],
	]);
	assert.match(contextStyles, /@media \(max-width: 1180px\)[\s\S]*\.context-files-panel \{[\s\S]*position: absolute/);
	assert.match(contextView, /window\.matchMedia\("\(max-width: 1180px\)"\)[\s\S]*setFilePanelOpen\(false\)/);
});
