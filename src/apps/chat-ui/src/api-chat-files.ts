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

export async function downloadChatFile(path: string, options: { piboSessionId?: string; roomId?: string } = {}): Promise<void> {
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
	const blob = await response.blob();
	const href = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = downloadFilename(response.headers.get("content-disposition"));
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(href);
}

function downloadFilename(contentDisposition: string | null): string {
	const match = contentDisposition?.match(DOWNLOAD_FILENAME_RE);
	const encoded = match?.[1];
	if (encoded) return decodeURIComponent(encoded);
	return match?.[2] ?? "download";
}
