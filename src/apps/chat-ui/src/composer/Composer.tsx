import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { Copy, SendHorizontal, X } from "lucide-react";
import { uploadChatFiles, type ChatUploadedFile } from "../api-chat-files";
import type { WebAnnotationMessageAttachment } from "../api-web-annotations";
import { appendStoredComposerHistory, readStoredComposerHistory } from "../app-storage";
import type { UploadedChatAttachment } from "../chat-upload-attachments";
import { copyTextToClipboard } from "../clipboard";

type ComposerCommand = {
	slash: string;
	description: string;
};

export type ComposerProps = {
	sessionId: string | null;
	disabled?: boolean;
	commands: ComposerCommand[];
	skills: Array<{ name: string; description?: string; path?: string }>;
	value: string;
	focusSignal: number;
	selectedWebAnnotations: WebAnnotationMessageAttachment[];
	selectedUploadAttachments: UploadedChatAttachment[];
	onValueChange: (value: string) => void;
	onCommand: (text: string) => Promise<boolean>;
	onDetachWebAnnotation: (annotationId: string) => void;
	onClearWebAnnotations: () => void;
	onAttachUploadedFiles: (files: readonly ChatUploadedFile[]) => void;
	onDetachUploadAttachment: (attachmentId: string) => void;
	onClearUploadAttachments: () => void;
	onSend: (text: string) => Promise<void>;
};

function boundedUiText(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

export function Composer({
	sessionId,
	disabled = false,
	commands,
	skills,
	value,
	focusSignal,
	selectedWebAnnotations,
	selectedUploadAttachments,
	onValueChange,
	onCommand,
	onDetachWebAnnotation,
	onClearWebAnnotations,
	onAttachUploadedFiles,
	onDetachUploadAttachment,
	onClearUploadAttachments,
	onSend,
}: ComposerProps) {
	const composerRootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const clipboardUploadButtonRef = useRef<HTMLButtonElement>(null);
	const activeCommandRef = useRef<HTMLButtonElement>(null);
	const activeSkillRef = useRef<HTMLButtonElement>(null);
	const historyNavRef = useRef<{ entries: string[]; index: number; draft: string } | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [activeSkillIndex, setActiveSkillIndex] = useState(0);
	const [cursorPos, setCursorPos] = useState(0);
	const [dismissedSuggestionKeys, setDismissedSuggestionKeys] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [uploadStatus, setUploadStatus] = useState<{ message: string; copyText?: string; error: boolean } | null>(null);
	const [pendingClipboardImage, setPendingClipboardImage] = useState<ClipboardImageUpload | null>(null);

	const skillTrigger = useMemo(() => {
		for (let i = cursorPos - 1; i >= 0; i--) {
			const char = value[i];
			if (char === " " || char === "\n" || char === "\t") break;
			if (char === "$") {
				if (i > 0 && value[i - 1] === "\\") continue;
				const query = value.slice(i + 1, cursorPos).toLowerCase();
				return { query, startPos: i, endPos: cursorPos };
			}
		}
		return null;
	}, [value, cursorPos]);

	const commandTrigger = value.trim().startsWith("/") ? value.trim().split(/\s+/)[0] : null;
	const skillSuggestionKey = skillTrigger ? composerSkillSuggestionKey(skillTrigger.startPos, value.slice(skillTrigger.startPos, cursorPos)) : null;
	const commandSuggestionKey = commandTrigger ? composerCommandSuggestionKey(commandTrigger) : null;

	const rawFilteredSkills = useMemo(() => {
		if (!skillTrigger) return [];
		return skills.filter((skill) => skill.name.toLowerCase().startsWith(skillTrigger.query));
	}, [skillTrigger, skills]);

	const rawFiltered = useMemo(() => {
		if (!commandTrigger) return [];
		return commands.filter((command) => command.slash.startsWith(commandTrigger));
	}, [commandTrigger, commands]);

	const filteredSkills = skillSuggestionKey && dismissedSuggestionKeys.includes(skillSuggestionKey) ? [] : rawFilteredSkills;
	const filtered = commandSuggestionKey && dismissedSuggestionKeys.includes(commandSuggestionKey) ? [] : rawFiltered;

	const dismissSuggestionKey = useCallback((key: string | null) => {
		if (!key) return;
		setDismissedSuggestionKeys((current) => current.includes(key) ? current : [...current, key]);
	}, []);

	const dismissVisibleSuggestions = useCallback(() => {
		const keys = [
			rawFilteredSkills.length ? skillSuggestionKey : null,
			rawFiltered.length ? commandSuggestionKey : null,
		].filter((key): key is string => Boolean(key));
		if (!keys.length) return;
		setDismissedSuggestionKeys((current) => {
			const next = new Set(current);
			for (const key of keys) next.add(key);
			return next.size === current.length ? current : [...next];
		});
	}, [commandSuggestionKey, rawFiltered.length, rawFilteredSkills.length, skillSuggestionKey]);

	useEffect(() => {
		const currentKeys = [skillSuggestionKey, commandSuggestionKey].filter((key): key is string => Boolean(key));
		setDismissedSuggestionKeys((current) => current.filter((key) => currentKeys.includes(key)));
	}, [commandSuggestionKey, skillSuggestionKey]);

	useEffect(() => {
		if (!filtered.length || activeIndex < filtered.length) return;
		setActiveIndex(0);
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		if (!filteredSkills.length || activeSkillIndex < filteredSkills.length) return;
		setActiveSkillIndex(0);
	}, [activeSkillIndex, filteredSkills.length]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => activeCommandRef.current?.scrollIntoView({ block: "nearest" }));
		return () => cancelAnimationFrame(frame);
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => activeSkillRef.current?.scrollIntoView({ block: "nearest" }));
		return () => cancelAnimationFrame(frame);
	}, [activeSkillIndex, filteredSkills.length]);

	useEffect(() => {
		historyNavRef.current = null;
	}, [sessionId]);

	useEffect(() => {
		if (!pendingClipboardImage) return;
		const frame = requestAnimationFrame(() => clipboardUploadButtonRef.current?.focus());
		return () => {
			cancelAnimationFrame(frame);
			URL.revokeObjectURL(pendingClipboardImage.previewUrl);
		};
	}, [pendingClipboardImage]);

	useEffect(() => {
		if (focusSignal <= 0) return;
		const input = inputRef.current;
		if (!input) return;
		const cursorPosition = input.value.length;
		input.focus();
		input.setSelectionRange(cursorPosition, cursorPosition);
		setCursorPos(cursorPosition);
	}, [focusSignal]);

	useEffect(() => {
		if (!filtered.length && !filteredSkills.length) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (composerRootRef.current?.contains(target)) return;
			dismissVisibleSuggestions();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	}, [dismissVisibleSuggestions, filtered.length, filteredSkills.length]);

	useLayoutEffect(() => {
		resizeComposerInput(inputRef.current);
	}, [value]);

	const insertSkill = (skillName: string) => {
		if (!skillTrigger || !inputRef.current) return;
		const before = value.slice(0, skillTrigger.startPos);
		const after = value.slice(skillTrigger.endPos);
		const newValue = before + "$" + skillName + after;
		onValueChange(newValue);
		dismissSuggestionKey(composerSkillSuggestionKey(skillTrigger.startPos, `$${skillName}`));
		const newCursorPos = skillTrigger.startPos + 1 + skillName.length;
		setCursorPos(newCursorPos);
		requestAnimationFrame(() => {
			inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
			setCursorPos(newCursorPos);
		});
	};

	const setHistoryValue = (text: string) => {
		onValueChange(text);
		requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			const cursorPosition = input.value.length;
			input.setSelectionRange(cursorPosition, cursorPosition);
			setCursorPos(cursorPosition);
		});
	};

	const navigateHistory = (direction: "previous" | "next") => {
		const existing = historyNavRef.current;
		if (!existing) {
			if (direction === "next" || value !== "") return false;
			const entries = readStoredComposerHistory();
			if (!entries.length) return false;
			const index = direction === "previous" ? entries.length - 1 : 0;
			historyNavRef.current = { entries, index, draft: value };
			setHistoryValue(entries[index]);
			return true;
		}

		if (direction === "previous") {
			const index = Math.max(0, existing.index - 1);
			historyNavRef.current = { ...existing, index };
			setHistoryValue(existing.entries[index]);
			return true;
		}

		const index = existing.index + 1;
		if (index >= existing.entries.length) {
			historyNavRef.current = null;
			setHistoryValue(existing.draft);
			return true;
		}
		historyNavRef.current = { ...existing, index };
		setHistoryValue(existing.entries[index]);
		return true;
	};

	const openUploadDialog = () => {
		if (disabled || uploading) return;
		fileInputRef.current?.click();
	};

	const closeClipboardImageDialog = () => {
		setPendingClipboardImage(null);
	};

	const handleClipboardImagePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		if (disabled || uploading) return;
		const imageFiles = clipboardImageFiles(event.clipboardData);
		if (!imageFiles.length) return;

		event.preventDefault();
		dismissVisibleSuggestions();
		setUploadStatus(null);
		const file = imageFiles[0];
		setPendingClipboardImage((current) => {
			if (current) URL.revokeObjectURL(current.previewUrl);
			return {
				file,
				previewUrl: URL.createObjectURL(file),
			};
		});
	};

	const confirmClipboardImageUpload = async () => {
		if (!pendingClipboardImage || uploading) return;
		const file = pendingClipboardImage.file;
		setPendingClipboardImage(null);
		await handleFileSelection([file]);
	};

	const handleFileSelection = async (selectedFiles: readonly File[]) => {
		if (!selectedFiles.length) return;
		setUploading(true);
		setUploadStatus({ message: `Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}...`, error: false });
		try {
			const result = await uploadChatFiles(selectedFiles);
			onAttachUploadedFiles(result.files);
			setUploadStatus(null);
		} catch (caught) {
			setUploadStatus({ message: caught instanceof Error ? caught.message : String(caught), error: true });
		} finally {
			setUploading(false);
		}
	};

	const submit = async () => {
		if (disabled) return;
		const text = value.trim();
		if (!text) return;
		if (filteredSkills.length) {
			insertSkill(filteredSkills[Math.min(activeSkillIndex, filteredSkills.length - 1)].name);
			return;
		}
		if (filtered.length && !commands.some((command) => command.slash === text.split(/\s+/)[0])) {
			const selectedSlash = filtered[Math.min(activeIndex, filtered.length - 1)].slash;
			onValueChange(selectedSlash);
			dismissSuggestionKey(composerCommandSuggestionKey(selectedSlash));
			return;
		}
		historyNavRef.current = null;
		appendStoredComposerHistory(text);
		onValueChange("");
		if (text.split(/\s+/)[0] === "/upload") {
			openUploadDialog();
			return;
		}
		if (text.startsWith("/") && (await onCommand(text))) return;
		await onSend(text);
	};

	return (
		<div
			ref={composerRootRef}
			data-pibo-debug="composer"
			data-pibo-session-id={sessionId ?? undefined}
			data-pibo-state={disabled ? "disabled" : value ? "non-empty" : "empty"}
			className="relative p-3 bg-[#151f24] border-t border-slate-800 max-[980px]:p-2"
		>
			<input
				ref={fileInputRef}
				type="file"
				multiple
				className="hidden"
				onChange={(event) => {
					const files = Array.from(event.target.files ?? []);
					event.target.value = "";
					void handleFileSelection(files);
				}}
			/>
			{uploadStatus ? (
				<div className={`mb-2 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs ${uploadStatus.error ? "border-red-900 bg-red-950/40 text-red-200" : uploadStatus.copyText ? "border-green-900/60 bg-green-950/30 text-green-300" : "border-slate-700 bg-[#0e1116] text-slate-300"}`}>
					<span className="min-w-0 flex-1 truncate">{uploadStatus.message}</span>
					{uploadStatus.copyText ? (
						<button
							type="button"
							onClick={() => void copyTextToClipboard(uploadStatus.copyText!)}
							title="Copy uploaded file path"
							aria-label="Copy uploaded file path"
							className="shrink-0 rounded-sm p-0.5 text-slate-400 hover:bg-slate-800 hover:text-[#11a4d4]"
						>
							<Copy size={13} />
						</button>
					) : null}
					<button
						type="button"
						onClick={() => setUploadStatus(null)}
						title="Hide upload status"
						aria-label="Hide upload status"
						className="shrink-0 rounded-sm p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
					>
						<X size={13} />
					</button>
				</div>
			) : null}
			{pendingClipboardImage ? (
				<div
					className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
					role="dialog"
					aria-modal="true"
					aria-label="Upload pasted image"
					onKeyDown={(event) => {
						if (event.key === "Escape") closeClipboardImageDialog();
					}}
				>
					<div className="w-full max-w-md rounded-sm border border-slate-700 bg-[#151f24] shadow-2xl">
						<div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
							<div>
								<div className="text-sm font-semibold text-slate-100">Pasted image detected</div>
								<div className="mt-1 text-xs text-slate-400">Upload this clipboard image to ~/.pibo/uploads?</div>
							</div>
							<button type="button" onClick={closeClipboardImageDialog} className="rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Cancel pasted image upload">
								<X size={14} />
							</button>
						</div>
						<div className="space-y-3 px-4 py-4">
							<img src={pendingClipboardImage.previewUrl} alt="Pasted clipboard image preview" className="max-h-64 w-full rounded-sm border border-slate-800 bg-[#0e1116] object-contain" />
							<div className="flex items-center justify-between gap-3 text-xs text-slate-400">
								<span className="min-w-0 truncate font-mono">{pendingClipboardImage.file.name}</span>
								<span className="shrink-0 font-mono">{formatBytes(pendingClipboardImage.file.size)}</span>
							</div>
						</div>
						<div className="flex justify-end gap-2 border-t border-slate-800 px-4 py-3">
							<button type="button" onClick={closeClipboardImageDialog} className="h-8 rounded-sm border border-slate-700 px-3 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100">Cancel</button>
							<button ref={clipboardUploadButtonRef} type="button" onClick={() => void confirmClipboardImageUpload()} disabled={uploading} className="h-8 rounded-sm bg-[#11a4d4] px-3 text-xs font-medium text-white disabled:opacity-50">Upload image</button>
						</div>
					</div>
				</div>
			) : null}
			{filteredSkills.length ? (
				<div className="absolute left-3 bottom-full mb-2 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-emerald-500 rounded-sm shadow-xl">
					{filteredSkills.map((skill, index) => (
						<button
							key={skill.name}
							ref={index === activeSkillIndex ? activeSkillRef : null}
							type="button"
							onClick={() => insertSkill(skill.name)}
							className={`w-full grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-left border-b border-slate-800 ${index === activeSkillIndex ? "bg-emerald-500/15" : ""}`}
						>
							<span className="font-mono text-emerald-400">${skill.name}</span>
							<span className="text-xs text-slate-400">{skill.description ?? skill.path ?? ""}</span>
						</button>
					))}
				</div>
			) : null}
			{selectedUploadAttachments.length ? (
				<div className="mb-2 rounded-sm border border-slate-800 bg-[#0e1116] px-2.5 py-1.5" data-pibo-debug="composer-upload-attachments" data-upload-attachment-count={selectedUploadAttachments.length}>
					<div className="mb-1.5 flex items-center justify-between gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Attached uploads</div>
						<button type="button" onClick={onClearUploadAttachments} className="text-[11px] text-slate-500 hover:text-[#11a4d4]">Clear</button>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{selectedUploadAttachments.map((attachment) => (
							<div key={attachment.id} title={attachment.path} className="inline-flex max-w-80 items-center gap-1 rounded-sm border border-emerald-500/45 bg-emerald-500/10 px-2 py-1 text-left text-[11px] text-slate-200" data-pibo-debug="composer-upload-attachment-chip" data-upload-path={attachment.path}>
								<span className="min-w-0 truncate">{boundedUiText(attachment.name || attachment.path, 100)}</span>
								<button type="button" onClick={() => void copyTextToClipboard(attachment.path)} title="Copy uploaded file path" aria-label="Copy uploaded file path" className="shrink-0 rounded-sm p-0.5 text-emerald-300 hover:bg-slate-800 hover:text-[#11a4d4]">
									<Copy size={11} />
								</button>
								<button type="button" onClick={() => onDetachUploadAttachment(attachment.id)} title={`Detach ${attachment.name || attachment.path}`} aria-label={`Detach ${attachment.name || attachment.path}`} className="shrink-0 rounded-sm p-0.5 text-emerald-300 hover:bg-slate-800 hover:text-slate-100">
									<X size={11} />
								</button>
							</div>
						))}
					</div>
				</div>
			) : null}
			{selectedWebAnnotations.length ? (
				<div className="mb-2 rounded-sm border border-slate-800 bg-[#0e1116] px-3 py-2" data-pibo-debug="composer-web-annotations" data-web-annotation-count={selectedWebAnnotations.length}>
					<div className="mb-2 flex items-center justify-between gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Attached web annotations</div>
						<button type="button" onClick={onClearWebAnnotations} className="text-[11px] text-slate-500 hover:text-[#11a4d4]">Clear</button>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{selectedWebAnnotations.map((annotation) => (
							<button key={annotation.id} type="button" onClick={() => onDetachWebAnnotation(annotation.id)} title={`Detach ${annotation.id}`} className="inline-flex max-w-72 items-center gap-1 rounded-sm border border-[#11a4d4]/50 bg-[#11a4d4]/10 px-2 py-1 text-left text-[11px] text-slate-200" data-pibo-debug="composer-web-annotation-chip" data-web-annotation-id={annotation.id}>
								<span className="min-w-0 truncate">{boundedUiText(annotation.primaryTarget || annotation.label || annotation.note || annotation.id, 100)}</span>
								<X size={11} className="shrink-0 text-[#11a4d4]" />
							</button>
						))}
					</div>
				</div>
			) : null}
			{filtered.length ? (
				<div className="absolute left-3 bottom-full mb-2 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-[#11a4d4] rounded-sm shadow-xl">
					{filtered.map((command, index) => (
						<button
							key={command.slash}
							ref={index === activeIndex ? activeCommandRef : null}
							type="button"
							onClick={() => {
								onValueChange(command.slash);
								dismissSuggestionKey(composerCommandSuggestionKey(command.slash));
								setActiveIndex(index);
							}}
							className={`w-full grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-left border-b border-slate-800 ${index === activeIndex ? "bg-[#11a4d4]/15" : ""}`}
						>
							<span className="font-mono text-[#11a4d4]">{command.slash}</span>
							<span className="text-xs text-slate-400">{command.description}</span>
						</button>
					))}
				</div>
			) : null}
			<div className="grid grid-cols-[1fr_auto] items-end gap-2">
				<textarea
					ref={inputRef}
					data-pibo-debug="composer-input"
					data-pibo-session-id={sessionId ?? undefined}
					data-pibo-state={disabled ? "disabled" : value ? "non-empty" : "empty"}
					rows={1}
					value={value}
					disabled={disabled}
					onChange={(event) => {
						historyNavRef.current = null;
						onValueChange(event.target.value);
						setCursorPos(event.target.selectionStart);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape" && (filteredSkills.length || filtered.length)) {
							event.preventDefault();
							event.stopPropagation();
							dismissVisibleSuggestions();
							return;
						}
						if (filteredSkills.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveSkillIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filteredSkills.length : (current - 1 + filteredSkills.length) % filteredSkills.length,
							);
							return;
						}
						if (filtered.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filtered.length : (current - 1 + filtered.length) % filtered.length,
							);
							return;
						}
						if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.altKey && !event.ctrlKey && !event.metaKey) {
							if (navigateHistory(event.key === "ArrowUp" ? "previous" : "next")) {
								event.preventDefault();
								return;
							}
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
						}
					}}
					onPaste={handleClipboardImagePaste}
					placeholder={disabled ? "Select a session to message" : "Send Message (/ for commands or $ for skills)"}
					className="h-10 min-h-10 resize-none overflow-hidden bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm leading-5 outline-none focus:border-[#11a4d4] disabled:opacity-50 [scrollbar-gutter:stable]"
				/>
				<button
					type="button"
					disabled={disabled || uploading}
					onClick={() => void submit()}
					title="Send message"
					aria-label="Send message"
					className="h-10 w-10 self-end inline-flex items-center justify-center bg-[#11a4d4] rounded-sm text-white disabled:opacity-50"
				>
					<SendHorizontal size={16} />
				</button>
			</div>
		</div>
	);
}

type ClipboardImageUpload = {
	file: File;
	previewUrl: string;
};

function composerSkillSuggestionKey(startPos: number, token: string): string {
	return `skill:${startPos}:${token}`;
}

function composerCommandSuggestionKey(commandToken: string): string {
	return `command:${commandToken}`;
}

function clipboardImageFiles(data: DataTransfer): File[] {
	const itemFiles = Array.from(data.items)
		.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => Boolean(file));
	const files = itemFiles.length ? itemFiles : Array.from(data.files).filter((file) => file.type.startsWith("image/"));
	return files.map(normalizeClipboardImageFile);
}

function normalizeClipboardImageFile(file: File): File {
	if (file.name && file.name !== "image.png") return file;
	return new File([file], screenshotUploadFilename(file.type), {
		type: file.type || "image/png",
		lastModified: Date.now(),
	});
}

function screenshotUploadFilename(type: string): string {
	const extension = imageExtension(type);
	const now = new Date();
	const stamp = [
		now.getFullYear(),
		padDatePart(now.getMonth() + 1),
		padDatePart(now.getDate()),
		"-",
		padDatePart(now.getHours()),
		padDatePart(now.getMinutes()),
		padDatePart(now.getSeconds()),
	].join("");
	return `screenshot-${stamp}${extension}`;
}

function imageExtension(type: string): string {
	switch (type) {
		case "image/jpeg":
			return ".jpg";
		case "image/gif":
			return ".gif";
		case "image/webp":
			return ".webp";
		case "image/svg+xml":
			return ".svg";
		default:
			return ".png";
	}
}

function padDatePart(value: number): string {
	return String(value).padStart(2, "0");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function resizeComposerInput(input: HTMLTextAreaElement | null) {
	if (!input) return;
	if (!input.value.includes("\n") && input.value.length < 80) {
		input.style.height = "";
		input.style.overflowY = "hidden";
		return;
	}
	const style = window.getComputedStyle(input);
	const lineHeight = cssPx(style.lineHeight, 20);
	const borderFrame = cssPx(style.borderTopWidth) + cssPx(style.borderBottomWidth);
	const maxScrollHeight = lineHeight * 5 + cssPx(style.paddingTop) + cssPx(style.paddingBottom);

	input.style.height = "auto";
	const scrollHeight = input.scrollHeight;
	const hasOverflow = scrollHeight > maxScrollHeight;
	input.style.height = `${Math.min(scrollHeight, maxScrollHeight) + borderFrame}px`;
	input.style.overflowY = hasOverflow ? "auto" : "hidden";
	if (hasOverflow && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
		input.scrollTop = scrollHeight;
	}
}

function cssPx(value: string, fallback = 0): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
