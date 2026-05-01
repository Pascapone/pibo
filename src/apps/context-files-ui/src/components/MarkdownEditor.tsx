import "../prism-client";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	CodeMirrorEditor,
	CodeToggle,
	CreateLink,
	DiffSourceToggleWrapper,
	IS_CODE,
	InsertCodeBlock,
	InsertTable,
	InsertThematicBreak,
	ListsToggle,
	MDXEditor,
	UndoRedo,
	codeBlockPlugin,
	codeMirrorPlugin,
	diffSourcePlugin,
	frontmatterPlugin,
	headingsPlugin,
	linkDialogPlugin,
	linkPlugin,
	listsPlugin,
	markdownShortcutPlugin,
	quotePlugin,
	realmPlugin,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	createRootEditorSubscription$,
} from "@mdxeditor/editor";
import {
	$getSelection,
	$isRangeSelection,
	$isRootOrShadowRoot,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_RIGHT_COMMAND,
	type ElementNode,
	type LexicalNode,
	type TextNode,
} from "lexical";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { SaveState } from "../api";
import "@mdxeditor/editor/style.css";

type MarkdownEditorProps = {
	documentKey: string;
	initialMarkdown: string;
	onPersist(markdown: string): Promise<void>;
	onSaveStateChange(state: SaveState): void;
};

export type MarkdownEditorHandle = {
	flushSave(): Promise<void>;
	getMarkdown(): string;
};

const AUTOSAVE_DELAY_MS = 900;

const CODE_BLOCK_LANGUAGES = {
	txt: "Text",
	text: "Text",
	plaintext: "Plain Text",
	md: "Markdown",
	ts: "TypeScript",
	tsx: "TSX",
	js: "JavaScript",
	json: "JSON",
	css: "CSS",
	bash: "Bash",
	sh: "Shell",
	shell: "Shell",
	yaml: "YAML",
	yml: "YAML",
	toml: "TOML",
	cron: "Cron",
} as const;

function getInlineCodeExitTarget(node: TextNode): { parent: ElementNode; offset: number } | null {
	let current: LexicalNode = node;
	let movedAcrossInlineBoundary = false;

	while (true) {
		const parent = current.getParent();
		if (parent === null || $isRootOrShadowRoot(parent)) return null;

		const nextSibling = current.getNextSibling();
		if (nextSibling !== null) {
			if (!movedAcrossInlineBoundary && $isTextNode(nextSibling)) return null;
			return { parent, offset: current.getIndexWithinParent() + 1 };
		}

		if (!parent.isInline()) return { parent, offset: current.getIndexWithinParent() + 1 };

		current = parent;
		movedAcrossInlineBoundary = true;
	}
}

const inlineCodeArrowExitPlugin = realmPlugin({
	init(realm) {
		realm.pub(createRootEditorSubscription$, (editor) => {
			return editor.registerCommand(
				KEY_ARROW_RIGHT_COMMAND,
				(event) => {
					const keyboardEvent = event as KeyboardEvent;
					if (keyboardEvent.shiftKey || keyboardEvent.altKey || keyboardEvent.ctrlKey || keyboardEvent.metaKey) return false;

					let handled = false;
					editor.update(() => {
						const selection = $getSelection();
						if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") return;

						const anchorNode = selection.anchor.getNode();
						if (
							!$isTextNode(anchorNode) ||
							(anchorNode.getFormat() & IS_CODE) === 0 ||
							selection.anchor.offset !== anchorNode.getTextContentSize()
						) {
							return;
						}

						const exitTarget = getInlineCodeExitTarget(anchorNode);
						if (!exitTarget) return;
						selection.anchor.set(exitTarget.parent.getKey(), exitTarget.offset, "element");
						selection.focus.set(exitTarget.parent.getKey(), exitTarget.offset, "element");
						selection.setFormat(selection.format & ~IS_CODE);
						handled = true;
					});

					if (!handled) return false;
					keyboardEvent.preventDefault();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			);
		});
	},
});

export const MarkdownEditor = memo(
	forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditorImpl(
		{ documentKey, initialMarkdown, onPersist, onSaveStateChange },
		ref,
	) {
		const editorRef = useRef<MDXEditorMethods>(null);
		const previousDocumentKeyRef = useRef(documentKey);
		const currentMarkdownRef = useRef(initialMarkdown);
		const savedMarkdownRef = useRef(initialMarkdown);
		const savePromiseRef = useRef<Promise<void> | null>(null);
		const timeoutRef = useRef<number | null>(null);
		const ignoreNextChangeRef = useRef(true);
		const [editorMode, setEditorMode] = useState<"rich" | "plain">("rich");
		const [plainMarkdown, setPlainMarkdown] = useState(initialMarkdown);

		const clearAutosaveTimer = useCallback(() => {
			if (timeoutRef.current !== null) {
				window.clearTimeout(timeoutRef.current);
				timeoutRef.current = null;
			}
		}, []);

		const persistIfNeeded = useCallback(async () => {
			if (savePromiseRef.current) await savePromiseRef.current;
			const nextMarkdown = currentMarkdownRef.current;
			if (nextMarkdown === savedMarkdownRef.current) {
				onSaveStateChange("saved");
				return;
			}

			onSaveStateChange("saving");
			const savePromise = (async () => {
				await onPersist(nextMarkdown);
				savedMarkdownRef.current = nextMarkdown;
			})();
			savePromiseRef.current = savePromise;

			try {
				await savePromise;
				if (currentMarkdownRef.current === savedMarkdownRef.current) {
					onSaveStateChange("saved");
					return;
				}
				await persistIfNeeded();
			} catch {
				onSaveStateChange("error");
				throw new Error("Autosave failed");
			} finally {
				if (savePromiseRef.current === savePromise) savePromiseRef.current = null;
			}
		}, [onPersist, onSaveStateChange]);

		const scheduleAutosave = useCallback(() => {
			clearAutosaveTimer();
			timeoutRef.current = window.setTimeout(() => {
				timeoutRef.current = null;
				void persistIfNeeded();
			}, AUTOSAVE_DELAY_MS);
		}, [clearAutosaveTimer, persistIfNeeded]);

		const handleEditorChange = useCallback(
			(markdown: string) => {
				if (ignoreNextChangeRef.current) {
					ignoreNextChangeRef.current = false;
					currentMarkdownRef.current = markdown;
					savedMarkdownRef.current = markdown;
					setPlainMarkdown(markdown);
					onSaveStateChange("saved");
					return;
				}
				currentMarkdownRef.current = markdown;
				onSaveStateChange("idle");
				scheduleAutosave();
			},
			[onSaveStateChange, scheduleAutosave],
		);

		const plugins = useMemo(
			() => [
				headingsPlugin(),
				listsPlugin(),
				quotePlugin(),
				thematicBreakPlugin(),
				linkPlugin(),
				linkDialogPlugin(),
				tablePlugin(),
				codeBlockPlugin({
					defaultCodeBlockLanguage: "txt",
					codeBlockEditorDescriptors: [{ priority: -10, match: () => true, Editor: CodeMirrorEditor }],
				}),
				codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES }),
				frontmatterPlugin(),
				diffSourcePlugin({ viewMode: "rich-text" }),
				markdownShortcutPlugin(),
				inlineCodeArrowExitPlugin(),
				toolbarPlugin({
					toolbarContents: () => (
						<>
							<DiffSourceToggleWrapper options={["rich-text", "source"]}>
								<UndoRedo />
								<BoldItalicUnderlineToggles />
								<CodeToggle />
								<BlockTypeSelect />
								<ListsToggle />
								<CreateLink />
								<InsertTable />
								<InsertThematicBreak />
								<InsertCodeBlock />
							</DiffSourceToggleWrapper>
						</>
					),
				}),
			],
			[],
		);

		useImperativeHandle(ref, () => ({
			flushSave: async () => {
				clearAutosaveTimer();
				await persistIfNeeded();
			},
			getMarkdown: () => currentMarkdownRef.current,
		}));

		useEffect(() => {
			return () => {
				clearAutosaveTimer();
			};
		}, [clearAutosaveTimer]);

		useEffect(() => {
			const documentChanged = previousDocumentKeyRef.current !== documentKey;
			const contentChangedExternally = initialMarkdown !== savedMarkdownRef.current;
			if (!documentChanged && !contentChangedExternally) return;

			previousDocumentKeyRef.current = documentKey;
			clearAutosaveTimer();
			savePromiseRef.current = null;
			currentMarkdownRef.current = initialMarkdown;
			savedMarkdownRef.current = initialMarkdown;
			ignoreNextChangeRef.current = true;
			setPlainMarkdown(initialMarkdown);
			setEditorMode("rich");
			onSaveStateChange("saved");
			editorRef.current?.setMarkdown(initialMarkdown);
		}, [documentKey, initialMarkdown, onSaveStateChange, clearAutosaveTimer]);

		if (editorMode === "plain") {
			return (
				<div className="plain-markdown-fallback">
					<p className="plain-markdown-fallback__notice">
						The rich editor could not safely load this document. You are editing raw markdown.
					</p>
					<textarea
						className="plain-markdown-fallback__textarea"
						value={plainMarkdown}
						onChange={(event) => {
							const markdown = event.currentTarget.value;
							setPlainMarkdown(markdown);
							currentMarkdownRef.current = markdown;
							onSaveStateChange("idle");
							scheduleAutosave();
						}}
						spellCheck={false}
					/>
				</div>
			);
		}

		return (
			<MDXEditor
				ref={editorRef}
				markdown={initialMarkdown}
				onChange={handleEditorChange}
				onError={(payload) => {
					console.error("MDXEditor error", payload);
					setPlainMarkdown(currentMarkdownRef.current);
					setEditorMode("plain");
				}}
				contentEditableClassName="mdx-content"
				plugins={plugins}
			/>
		);
	}),
);
