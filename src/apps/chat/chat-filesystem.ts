import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { getDefaultPiboWorkspace } from "../../core/workspace.js";
import { PiboWebHttpError } from "../../web/http.js";

export const FILESYSTEM_BROWSE_PATH_LIMIT = 4096;
export const FILESYSTEM_BROWSE_ENTRY_LIMIT = 2000;

export type FilesystemBrowseEntry = {
	name: string;
	path: string;
	modifiedAt: string | null;
};

export type FilesystemBrowseResult = {
	path: string;
	parent: string | null;
	separator: "/" | "\\";
	roots: string[];
	entries: FilesystemBrowseEntry[];
	truncated: boolean;
};

export function browseFilesystemDirectory(requestedPath?: string | null): FilesystemBrowseResult {
	const raw = requestedPath?.trim() || getDefaultPiboWorkspace();
	if (raw.length > FILESYSTEM_BROWSE_PATH_LIMIT) throw new PiboWebHttpError("Browse path is too long", 400);
	if (!isAbsolute(raw)) throw new PiboWebHttpError("Browse path must be an absolute path", 400);
	const resolved = resolve(raw);
	let canonical: string;
	try {
		canonical = realpathSync(resolved);
	} catch {
		throw new PiboWebHttpError(`Browse path was not found: ${raw}`, 404);
	}
	let stats;
	try {
		stats = statSync(canonical);
	} catch {
		throw new PiboWebHttpError(`Browse path was not found: ${raw}`, 404);
	}
	if (!stats.isDirectory()) throw new PiboWebHttpError(`Browse path is not a directory: ${raw}`, 400);
	let dirents;
	try {
		dirents = readdirSync(canonical, { withFileTypes: true });
	} catch (error) {
		if (isErrno(error) && (error.code === "EACCES" || error.code === "EPERM")) {
			throw new PiboWebHttpError(`Browse path is not accessible: ${raw}`, 403);
		}
		if (isErrno(error) && error.code === "ENOENT") throw new PiboWebHttpError(`Browse path was not found: ${raw}`, 404);
		if (isErrno(error) && error.code === "ENOTDIR") throw new PiboWebHttpError(`Browse path is not a directory: ${raw}`, 400);
		throw new PiboWebHttpError(`Browse path cannot be listed: ${raw}`, 500);
	}
	const entries: FilesystemBrowseEntry[] = [];
	for (const dirent of dirents) {
		const childPath = resolve(canonical, dirent.name);
		let isDirectory = dirent.isDirectory();
		if (!isDirectory && dirent.isSymbolicLink()) {
			try {
				isDirectory = statSync(childPath).isDirectory();
			} catch {
				continue;
			}
		}
		if (!isDirectory) continue;
		let modifiedAt: string | null = null;
		try {
			modifiedAt = statSync(childPath).mtime.toISOString();
		} catch {
			continue;
		}
		entries.push({ name: dirent.name, path: childPath, modifiedAt });
	}
	entries.sort((left, right) => left.name.localeCompare(right.name, "de", { sensitivity: "base" }));
	const truncated = entries.length > FILESYSTEM_BROWSE_ENTRY_LIMIT;
	const parent = dirname(canonical);
	return {
		path: canonical,
		parent: parent === canonical ? null : parent,
		separator: sep === "\\" ? "\\" : "/",
		roots: listFilesystemRoots(),
		entries: truncated ? entries.slice(0, FILESYSTEM_BROWSE_ENTRY_LIMIT) : entries,
		truncated,
	};
}

export function listFilesystemRoots(): string[] {
	if (process.platform !== "win32") return [resolve(sep)];
	const roots: string[] = [];
	for (let code = 65; code <= 90; code += 1) {
		const root = `${String.fromCharCode(code)}:\\`;
		try {
			if (existsSync(root)) roots.push(root);
		} catch {
			continue;
		}
	}
	return roots.length ? roots : [resolve(sep)];
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}
