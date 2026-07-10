const DOWNLOAD_FILENAME_RE = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i;

export type ChatUploadedFile = {
	name: string;
	path: string;
	bytes: number;
};

export type ChatUploadResult = {
	uploadDir: string;
	files: ChatUploadedFile[];
};

export async function uploadChatFiles(files: readonly File[]): Promise<ChatUploadResult> {
	const form = new FormData();
	for (const file of files) form.append("files", file, file.name);
	const response = await fetch("/api/chat/upload", {
		method: "POST",
		body: form,
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Upload failed";
		throw new Error(message);
	}
	return response.json() as Promise<ChatUploadResult>;
}

export type ChatDownloadProgress = {
	path: string;
	filename: string;
	receivedBytes: number;
	totalBytes?: number;
};

export type ChatDownloadResult = ChatDownloadProgress;

export type ChatDownloadOptions = {
	piboSessionId?: string;
	roomId?: string;
	onStart?: (progress: ChatDownloadProgress) => void;
	onProgress?: (progress: ChatDownloadProgress) => void;
};

export async function downloadChatFile(path: string, options: ChatDownloadOptions = {}): Promise<ChatDownloadResult> {
	const params = new URLSearchParams({ path });
	if (options.piboSessionId) params.set("piboSessionId", options.piboSessionId);
	if (options.roomId) params.set("roomId", options.roomId);
	const response = await fetch(`/api/chat/download?${params.toString()}`);
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Download failed";
		throw new Error(message);
	}
	const filename = downloadFilename(response.headers.get("content-disposition"));
	const totalBytes = parseContentLength(response.headers.get("content-length"));
	const started = { path, filename, receivedBytes: 0, totalBytes };
	options.onStart?.(started);
	const blob = await readDownloadBlob(response, started, options.onProgress);
	triggerBrowserDownload(blob, filename);
	return { path, filename, receivedBytes: blob.size, totalBytes };
}

async function readDownloadBlob(
	response: Response,
	base: ChatDownloadProgress,
	onProgress?: (progress: ChatDownloadProgress) => void,
): Promise<Blob> {
	if (!response.body) {
		const blob = await response.blob();
		onProgress?.({ ...base, receivedBytes: blob.size });
		return blob;
	}
	const reader = response.body.getReader();
	const chunks: BlobPart[] = [];
	let receivedBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		chunks.push(new Uint8Array(value));
		receivedBytes += value.byteLength;
		onProgress?.({ ...base, receivedBytes });
	}
	return new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
	const href = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = filename;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(href);
}

function parseContentLength(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function downloadFilename(contentDisposition: string | null): string {
	const match = contentDisposition?.match(DOWNLOAD_FILENAME_RE);
	const encoded = match?.[1];
	if (encoded) return decodeURIComponent(encoded);
	return match?.[2] ?? "download";
}
