import { closeSync, constants, createReadStream, existsSync, fstatSync, mkdirSync, openSync, readSync, realpathSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { piboHomePath } from "../../core/pibo-home.js";
import { protectPrivateDirectorySync, protectPrivateFileSync } from "../../core/private-path.js";
import { PiboWebHttpError } from "../../web/http.js";
import { imageMimeTypeFromBytes, TRACE_IMAGE_MAX_DECODED_BYTES, type TraceImagePayload } from "./trace-v2.js";

export const CHAT_UPLOAD_DIR = piboHomePath("uploads");
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

export function ensurePrivateChatUploadDirectory(): string {
	mkdirSync(CHAT_UPLOAD_DIR, { recursive: true, mode: 0o700 });
	protectPrivateDirectorySync(CHAT_UPLOAD_DIR);
	return CHAT_UPLOAD_DIR;
}

export async function saveUploadedChatFiles(request: Request): Promise<{ uploadDir: string; files: Array<{ name: string; path: string; bytes: number }> }> {
	const form = await request.formData();
	const files: UploadedChatFile[] = [];
	for (const value of form.getAll("files")) {
		if (isUploadedChatFile(value)) files.push(value);
	}
	if (!files.length) throw new PiboWebHttpError("No files were uploaded", 400);

	ensurePrivateChatUploadDirectory();
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

export type ResolvedImagePreviewPath = {
	path: string;
	allowedRoots: readonly string[];
};

export function resolveImagePreviewPath(path: string, basePath: string): ResolvedImagePreviewPath {
	return resolveImagePreviewPathWithinRoots(resolveDownloadPath(path, basePath), [basePath, CHAT_UPLOAD_DIR]);
}

export function resolveImagePreviewPathWithinRoots(path: string, allowedRootPaths: readonly string[]): ResolvedImagePreviewPath {
	let canonicalPath: string;
	try {
		canonicalPath = realpathSync(path);
	} catch {
		throw new PiboWebHttpError("Image preview file was not found", 404);
	}
	const allowedRoots: string[] = [];
	for (const allowedRoot of allowedRootPaths) {
		if (!existsSync(allowedRoot)) continue;
		const canonicalRoot = realpathSync(allowedRoot);
		allowedRoots.push(canonicalRoot);
	}
	if (allowedRoots.some((allowedRoot) => isPathInsideRoot(canonicalPath, allowedRoot))) {
		return { path: canonicalPath, allowedRoots };
	}
	throw new PiboWebHttpError("Image preview path is outside its authorized roots", 403);
}

export function responseChatFileDownload(absolutePath: string): Response {
	const stats = requireChatFile(absolutePath);
	return new Response(Readable.toWeb(createReadStream(absolutePath)) as any, {
		headers: {
			"content-type": contentTypeForDownload(absolutePath),
			"content-length": String(stats.size),
			"content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(basename(absolutePath)),
			"cache-control": "no-store",
		},
	});
}

export function responseChatImagePreview(absolutePath: string, allowedRoots?: readonly string[]): Response {
	const { bytes, stats } = readBoundedImageFile(absolutePath, TRACE_IMAGE_MAX_DECODED_BYTES, allowedRoots);
	const mimeType = imageMimeTypeFromBytes(bytes.subarray(0, Math.min(32, bytes.byteLength)));
	if (!mimeType) throw new PiboWebHttpError("Unsupported image preview format", 415);
	return new Response(bytes, {
		headers: imagePreviewHeaders({
			mimeType,
			contentLength: stats.size,
			filename: basename(absolutePath),
			cacheControl: "no-store",
		}),
	});
}

export function responseChatTraceImage(image: TraceImagePayload): Response {
	return new Response(image.bytes, {
		headers: imagePreviewHeaders({
			mimeType: image.mimeType,
			contentLength: image.bytes.byteLength,
			cacheControl: "private, max-age=31536000, immutable",
		}),
	});
}

function requireChatFile(absolutePath: string): Stats {
	let stats: Stats;
	try {
		stats = statSync(absolutePath);
	} catch {
		throw new PiboWebHttpError("File not found: " + absolutePath, 404);
	}
	if (!stats.isFile()) throw new PiboWebHttpError("Path is not a file: " + absolutePath, 400);
	return stats;
}

function readBoundedImageFile(absolutePath: string, maxBytes: number, allowedRoots?: readonly string[]): { bytes: Buffer; stats: Stats } {
	let descriptor: number;
	try {
		descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch (error) {
		if (isFileSystemError(error) && error.code === "ELOOP") throw new PiboWebHttpError("Image preview path changed during authorization", 409);
		throw new PiboWebHttpError("File not found: " + absolutePath, 404);
	}
	try {
		const stats = fstatSync(descriptor);
		if (!stats.isFile()) throw new PiboWebHttpError("Path is not a file: " + absolutePath, 400);
		if (allowedRoots?.length) assertOpenedImagePathAuthority(absolutePath, stats, allowedRoots);
		if (stats.size > maxBytes) throw new PiboWebHttpError(`Image preview exceeds the ${maxBytes}-byte limit`, 413);
		const bytes = Buffer.alloc(stats.size);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const read = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
			if (read === 0) break;
			offset += read;
		}
		if (offset !== bytes.byteLength) throw new PiboWebHttpError("Image changed while it was being read", 409);
		const extra = Buffer.alloc(1);
		if (readSync(descriptor, extra, 0, 1, offset) !== 0) throw new PiboWebHttpError(`Image preview exceeds the ${maxBytes}-byte limit`, 413);
		return { bytes, stats };
	} finally {
		closeSync(descriptor);
	}
}

function assertOpenedImagePathAuthority(absolutePath: string, openedStats: Stats, allowedRoots: readonly string[]): void {
	let currentPath: string;
	let currentStats: Stats;
	try {
		currentPath = realpathSync(absolutePath);
		currentStats = statSync(currentPath);
	} catch {
		throw new PiboWebHttpError("Image preview path changed during authorization", 409);
	}
	if (currentStats.dev !== openedStats.dev || currentStats.ino !== openedStats.ino) {
		throw new PiboWebHttpError("Image preview file changed during authorization", 409);
	}
	if (!allowedRoots.some((allowedRoot) => isPathInsideRoot(currentPath, allowedRoot))) {
		throw new PiboWebHttpError("Image preview path escaped its authorized root", 403);
	}
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function imagePreviewHeaders(input: {
	mimeType: string;
	contentLength: number;
	filename?: string;
	cacheControl: string;
}): Record<string, string> {
	return {
		"content-type": input.mimeType,
		"content-length": String(input.contentLength),
		...(input.filename ? { "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent(input.filename) } : {}),
		"cache-control": input.cacheControl,
		"x-content-type-options": "nosniff",
		"cross-origin-resource-policy": "same-origin",
	};
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
		if (!isPathInsideUploadDir(absolutePath)) throw new PiboWebHttpError("Attached uploads must be under the configured Pibo uploads directory", 400);
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
	return isPathInsideRoot(path, CHAT_UPLOAD_DIR);
}

function isPathInsideRoot(path: string, root: string): boolean {
	const child = relative(root, path);
	return child !== "" && child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(child);
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
			writeFileSync(targetPath, bytes, { flag: "wx", mode: 0o600 });
			try {
				protectPrivateFileSync(targetPath);
			} catch (error) {
				rmSync(targetPath, { force: true });
				throw error;
			}
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
