import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { PiboWebHttpError } from "../../web/http.js";

export const CHAT_UPLOAD_DIR = resolve(os.homedir(), ".pibo", "uploads");
const CHAT_FILE_ATTACHMENT_LIMIT = 10;

export type ChatFileMessageAttachment = {
	name: string;
	path: string;
	bytes: number;
};

export type PreparedChatFileAttachments = {
	paths: string[];
	attachments: ChatFileMessageAttachment[];
	modelContext: string;
	messageText: string;
};

export function prepareChatFileAttachments(input: {
	messageText: string;
	attachmentPaths: unknown;
}): PreparedChatFileAttachments {
	const paths = normalizeChatFileAttachmentPaths(input.attachmentPaths);
	if (!paths.length) return { paths: [], attachments: [], modelContext: "", messageText: input.messageText };
	const attachments = paths.map(chatFileAttachmentForPath);
	const modelContext = renderAttachedChatFiles(attachments);
	return {
		paths,
		attachments,
		modelContext,
		messageText: modelContext ? `${input.messageText.trimEnd()}\n\n${modelContext}` : input.messageText,
	};
}

export async function saveUploadedChatFiles(request: Request): Promise<{ uploadDir: string; files: Array<{ name: string; path: string; bytes: number }> }> {
	const form = await request.formData();
	const files: UploadedChatFile[] = [];
	for (const value of form.getAll("files")) {
		if (isUploadedChatFile(value)) files.push(value);
	}
	if (!files.length) throw new PiboWebHttpError("No files were uploaded", 400);

	mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
	const saved = [];
	for (const file of files) {
		const name = sanitizeUploadFilename(file.name);
		const bytes = Buffer.from(await file.arrayBuffer());
		const targetPath = writeUploadedChatFile(name, bytes);
		saved.push({ name, path: targetPath, bytes: bytes.byteLength });
	}
	return { uploadDir: CHAT_UPLOAD_DIR, files: saved };
}

export function resolveDownloadPath(path: string, basePath: string): string {
	return isAbsolute(path) ? resolve(path) : resolve(basePath, path);
}

export function responseChatFileDownload(absolutePath: string): Response {
	let stats;
	try {
		stats = statSync(absolutePath);
	} catch {
		throw new PiboWebHttpError("File not found: " + absolutePath, 404);
	}
	if (!stats.isFile()) throw new PiboWebHttpError("Path is not a file: " + absolutePath, 400);
	return new Response(Readable.toWeb(createReadStream(absolutePath)) as any, {
		headers: {
			"content-type": contentTypeForDownload(absolutePath),
			"content-length": String(stats.size),
			"content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(basename(absolutePath)),
			"cache-control": "no-store",
		},
	});
}

function normalizeChatFileAttachmentPaths(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new PiboWebHttpError("fileAttachmentPaths must be an array", 400);
	if (value.length > CHAT_FILE_ATTACHMENT_LIMIT) throw new PiboWebHttpError(`At most ${CHAT_FILE_ATTACHMENT_LIMIT} uploaded files can be attached`, 400);
	const paths: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") throw new PiboWebHttpError("fileAttachmentPaths entries must be strings", 400);
		const absolutePath = resolve(item.trim());
		if (!item.trim()) throw new PiboWebHttpError("fileAttachmentPaths entries must be non-empty strings", 400);
		if (absolutePath.length > 4096) throw new PiboWebHttpError("uploaded file path is too long", 400);
		if (!isPathInsideUploadDir(absolutePath)) throw new PiboWebHttpError("Attached uploads must be under ~/.pibo/uploads", 400);
		if (!seen.has(absolutePath)) {
			seen.add(absolutePath);
			paths.push(absolutePath);
		}
	}
	return paths;
}

function chatFileAttachmentForPath(path: string): ChatFileMessageAttachment {
	if (!existsSync(path)) throw new PiboWebHttpError(`Uploaded file was not found: ${path}`, 404);
	const stats = statSync(path);
	if (!stats.isFile()) throw new PiboWebHttpError(`Uploaded attachment is not a file: ${path}`, 400);
	return { name: basename(path), path, bytes: stats.size };
}

function isPathInsideUploadDir(path: string): boolean {
	const uploadRelative = relative(CHAT_UPLOAD_DIR, path);
	return uploadRelative !== "" && !uploadRelative.startsWith("..") && !isAbsolute(uploadRelative);
}

function renderAttachedChatFiles(attachments: readonly ChatFileMessageAttachment[]): string {
	const bounded = attachments.slice(0, CHAT_FILE_ATTACHMENT_LIMIT);
	if (!bounded.length) return "";
	const lines = ["<attached-uploaded-files>"];
	bounded.forEach((attachment, index) => {
		lines.push(`${index + 1}. ${escapeChatFileBlockValue(attachment.name)}`);
		lines.push(`path: ${escapeChatFileBlockValue(attachment.path)}`);
		lines.push(`bytes: ${attachment.bytes}`);
	});
	lines.push("</attached-uploaded-files>");
	return lines.join("\n");
}

function escapeChatFileBlockValue(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

type UploadedChatFile = {
	name: string;
	size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
};

function isUploadedChatFile(value: unknown): value is UploadedChatFile {
	return typeof value === "object"
		&& value !== null
		&& typeof (value as { name?: unknown }).name === "string"
		&& typeof (value as { size?: unknown }).size === "number"
		&& typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function";
}

function sanitizeUploadFilename(name: string): string {
	const cleaned = basename(name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
	const safe = cleaned.replace(/[\\/]/g, "_");
	if (safe && !/^\.+$/.test(safe)) return safe;
	return `upload-${Date.now()}`;
}

function writeUploadedChatFile(filename: string, bytes: Buffer): string {
	for (let index = 0; index < 10_000; index += 1) {
		const targetPath = uploadPathForIndex(filename, index);
		try {
			writeFileSync(targetPath, bytes, { flag: "wx" });
			return targetPath;
		} catch (error) {
			if (isNodeError(error) && error.code === "EEXIST") continue;
			throw error;
		}
	}
	throw new PiboWebHttpError("Could not allocate upload filename", 500);
}

function uploadPathForIndex(filename: string, index: number): string {
	if (index === 0) return resolve(CHAT_UPLOAD_DIR, filename);
	const extension = extname(filename);
	const stem = filename.slice(0, filename.length - extension.length) || "upload";
	return resolve(CHAT_UPLOAD_DIR, `${stem}-${index}${extension}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}

function contentTypeForDownload(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".html":
		case ".htm":
			return "text/html; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".md":
		case ".txt":
		case ".log":
			return "text/plain; charset=utf-8";
		case ".pdf":
			return "application/pdf";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}
