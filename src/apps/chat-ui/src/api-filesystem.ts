import { requestJson } from "./api-http";

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

export async function browseFilesystem(path?: string): Promise<FilesystemBrowseResult> {
	const trimmed = path?.trim();
	const query = trimmed ? `?path=${encodeURIComponent(trimmed)}` : "";
	return requestJson<FilesystemBrowseResult>(`/api/chat/filesystem/browse${query}`);
}
