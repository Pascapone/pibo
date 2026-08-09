import type { MDXEditorMethods } from "@mdxeditor/editor";
import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	ChangeCodeMirrorLanguage,
	CodeMirrorEditor,
	CodeToggle,
	ConditionalContents,
	CreateLink,
	DiffSourceToggleWrapper,
	IS_CODE,
	InsertCodeBlock,
	InsertFrontmatter,
	InsertImage,
	InsertTable,
	InsertThematicBreak,
	ListsToggle,
	MDXEditor,
	Separator,
	StrikeThroughSupSubToggles,
	UndoRedo,
	codeBlockPlugin,
	codeMirrorPlugin,
	createRootEditorSubscription$,
	diffSourcePlugin,
	frontmatterPlugin,
	headingsPlugin,
	imagePlugin,
	linkDialogPlugin,
	linkPlugin,
	listsPlugin,
	markdownShortcutPlugin,
	quotePlugin,
	realmPlugin,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
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
import { FileText, Maximize2, Minimize2 } from "lucide-react";
import {
	forwardRef,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import "@mdxeditor/editor/style.css";

export type MarkdownEditorSaveState = "idle" | "saving" | "saved" | "error";

type MarkdownEditorProps = {
	documentKey: string;
	initialMarkdown: string;
	onPersist(markdown: string): Promise<void>;
	onSaveStateChange(state: MarkdownEditorSaveState): void;
	readOnly?: boolean;
	ariaLabel?: string;
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
	tsx: "TSX",
	ts: "TypeScript",
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
		realm.pub(createRootEditorSubscription$, (editor) =>
			editor.registerCommand(
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
			),
		);
	},
});

function RichTextToolbar() {
	return (
		<ConditionalContents
			options={[
				{
					when: (editor) => editor?.editorType === "codeblock",
					contents: () => (
						<>
							<UndoRedo />
							<Separator />
							<ChangeCodeMirrorLanguage />
							<Separator />
							<InsertCodeBlock />
						</>
					),
				},
				{
					fallback: () => (
						<>
							<UndoRedo />
							<Separator />
							<BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
							<StrikeThroughSupSubToggles options={["Strikethrough"]} />
							<CodeToggle />
							<Separator />
							<BlockTypeSelect />
							<ListsToggle />
							<CreateLink />
							<Separator />
							<InsertImage />
							<InsertTable />
							<InsertThematicBreak />
							<InsertCodeBlock />
							<InsertFrontmatter />
						</>
					),
				},
			]}
		/>
	);
}

export const MarkdownEditor = memo(
	forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditorImpl(
		{
			documentKey,
			initialMarkdown,
			onPersist,
			onSaveStateChange,
			readOnly = false,
			ariaLabel = "Markdown editor",
		},
		ref,
	) {
		const editorRef = useRef<MDXEditorMethods>(null);
		const plainTextareaRef = useRef<HTMLTextAreaElement>(null);
		const previousDocumentKeyRef = useRef(documentKey);
		const currentMarkdownRef = useRef(initialMarkdown);
		const savedMarkdownRef = useRef(initialMarkdown);
		const savingMarkdownRef = useRef<string | null>(null);
		const savePromiseRef = useRef<Promise<void> | null>(null);
		const timeoutRef = useRef<number | null>(null);
		const [editorMode, setEditorMode] = useState<"rich" | "plain">("rich");
		const [plainMarkdown, setPlainMarkdown] = useState(initialMarkdown);
		const [editorResetVersion, setEditorResetVersion] = useState(0);
		const [expanded, setExpanded] = useState(false);
		const [overlayContainer, setOverlayContainer] = useState<HTMLDivElement | null>(null);

		const clearAutosaveTimer = useCallback(() => {
			if (timeoutRef.current !== null) {
				window.clearTimeout(timeoutRef.current);
				timeoutRef.current = null;
			}
		}, []);

		const persistIfNeeded = useCallback(async () => {
			if (readOnly) {
				onSaveStateChange("saved");
				return;
			}
			if (savePromiseRef.current) await savePromiseRef.current;
			const nextMarkdown = currentMarkdownRef.current;
			if (nextMarkdown === savedMarkdownRef.current) {
				onSaveStateChange("saved");
				return;
			}

			onSaveStateChange("saving");
			savingMarkdownRef.current = nextMarkdown;
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
			} catch (error) {
				onSaveStateChange("error");
				throw error instanceof Error ? error : new Error("Autosave failed");
			} finally {
				if (savePromiseRef.current === savePromise) {
					savePromiseRef.current = null;
					savingMarkdownRef.current = null;
				}
			}
		}, [onPersist, onSaveStateChange, readOnly]);

		const scheduleAutosave = useCallback(() => {
			if (readOnly) return;
			clearAutosaveTimer();
			timeoutRef.current = window.setTimeout(() => {
				timeoutRef.current = null;
				void persistIfNeeded().catch(() => undefined);
			}, AUTOSAVE_DELAY_MS);
		}, [clearAutosaveTimer, persistIfNeeded, readOnly]);

		const handleEditorChange = useCallback(
			(markdown: string, initialMarkdownNormalize: boolean) => {
				currentMarkdownRef.current = markdown;
				setPlainMarkdown(markdown);
				if (initialMarkdownNormalize) {
					savedMarkdownRef.current = markdown;
					onSaveStateChange("saved");
					return;
				}
				if (readOnly) {
					onSaveStateChange("saved");
					return;
				}
				if (markdown === savedMarkdownRef.current) {
					clearAutosaveTimer();
					onSaveStateChange("saved");
					return;
				}
				onSaveStateChange("idle");
				scheduleAutosave();
			},
			[clearAutosaveTimer, onSaveStateChange, readOnly, scheduleAutosave],
		);

		const plugins = useMemo(
			() => [
				headingsPlugin(),
				listsPlugin(),
				quotePlugin(),
				thematicBreakPlugin(),
				linkPlugin(),
				linkDialogPlugin(),
				imagePlugin(),
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
						<DiffSourceToggleWrapper options={["rich-text", "source"]}>
							<RichTextToolbar />
						</DiffSourceToggleWrapper>
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

		useEffect(() => () => clearAutosaveTimer(), [clearAutosaveTimer]);

		useEffect(() => {
			const documentChanged = previousDocumentKeyRef.current !== documentKey;
			const contentChangedExternally = initialMarkdown !== savedMarkdownRef.current;
			const ownSaveEcho =
				!documentChanged &&
				savePromiseRef.current !== null &&
				initialMarkdown === savingMarkdownRef.current;
			if ((!documentChanged && !contentChangedExternally) || ownSaveEcho) return;

			previousDocumentKeyRef.current = documentKey;
			clearAutosaveTimer();
			savePromiseRef.current = null;
			savingMarkdownRef.current = null;
			currentMarkdownRef.current = initialMarkdown;
			savedMarkdownRef.current = initialMarkdown;
			setPlainMarkdown(initialMarkdown);
			setEditorMode("rich");
			if (!documentChanged) setEditorResetVersion((current) => current + 1);
			onSaveStateChange("saved");
		}, [documentKey, initialMarkdown, onSaveStateChange, clearAutosaveTimer]);

		useEffect(() => {
			if (!expanded) return;
			const previousOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				setExpanded(false);
			};
			window.addEventListener("keydown", handleKeyDown);
			const animationFrame = window.requestAnimationFrame(() => {
				if (editorMode === "plain" || readOnly) plainTextareaRef.current?.focus({ preventScroll: true });
				else editorRef.current?.focus(undefined, { preventScroll: true });
			});
			return () => {
				window.cancelAnimationFrame(animationFrame);
				window.removeEventListener("keydown", handleKeyDown);
				document.body.style.overflow = previousOverflow;
			};
		}, [editorMode, expanded, readOnly]);

		const editor = editorMode === "plain" || readOnly ? (
			<div className="markdown-editor__plain-fallback">
				<p className="markdown-editor__plain-notice">
					{readOnly
						? "This document is read-only. Create a managed copy to edit it."
						: "The rich editor could not safely load this document. You are editing raw Markdown."}
				</p>
				<textarea
					ref={plainTextareaRef}
					className="markdown-editor__plain-textarea"
					aria-label={`${ariaLabel} source`}
					value={readOnly ? initialMarkdown : plainMarkdown}
					readOnly={readOnly}
					onChange={(event) => {
						if (readOnly) return;
						const markdown = event.currentTarget.value;
						setPlainMarkdown(markdown);
						currentMarkdownRef.current = markdown;
						if (markdown === savedMarkdownRef.current) {
							clearAutosaveTimer();
							onSaveStateChange("saved");
							return;
						}
						onSaveStateChange("idle");
						scheduleAutosave();
					}}
					spellCheck={false}
				/>
			</div>
		) : (
			<MDXEditor
				key={`${documentKey}:${editorResetVersion}`}
				ref={editorRef}
				className="markdown-editor__mdx"
				markdown={initialMarkdown}
				onChange={handleEditorChange}
				onError={(payload) => {
					console.error("MDXEditor error", payload.error);
					const fallbackMarkdown = payload.source || currentMarkdownRef.current;
					currentMarkdownRef.current = fallbackMarkdown;
					setPlainMarkdown(fallbackMarkdown);
					setEditorMode("plain");
				}}
				contentEditableClassName="markdown-editor__content"
				placeholder={<span>Start writing Markdown…</span>}
				overlayContainer={overlayContainer}
				plugins={plugins}
			/>
		);

		return (
			<>
				{expanded ? (
					<button
						type="button"
						className="markdown-editor__backdrop"
						aria-label="Exit focused Markdown editor"
						onClick={() => setExpanded(false)}
					/>
				) : null}
				<div
					ref={setOverlayContainer}
					className={`markdown-editor-shell${expanded ? " markdown-editor-shell--expanded" : ""}`}
					aria-label={ariaLabel}
					data-expanded={expanded ? "true" : "false"}
					data-read-only={readOnly ? "true" : "false"}
				>
					<div className="markdown-editor__utility-bar">
						<div className="markdown-editor__identity">
							<FileText size={14} aria-hidden="true" />
							<span>Markdown</span>
							<span className="markdown-editor__mode-label">{readOnly ? "Read only" : editorMode === "plain" ? "Source fallback" : "Rich + source"}</span>
						</div>
						<button
							type="button"
							className="markdown-editor__expand-button"
							aria-label={expanded ? "Exit focused editor" : "Open focused editor"}
							aria-pressed={expanded}
							title={expanded ? "Exit focused editor (Esc)" : "Open focused editor"}
							onClick={() => setExpanded((current) => !current)}
						>
							{expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
							<span>{expanded ? "Exit focus" : "Focus"}</span>
						</button>
					</div>
					{editor}
				</div>
			</>
		);
	}),
);
