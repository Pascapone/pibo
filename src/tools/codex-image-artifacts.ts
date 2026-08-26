import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getPiboHome } from "../core/pibo-home.js";

export function codexImageArtifactRoot(): string {
	return join(getPiboHome(), "generated_images");
}

export function codexImageArtifactPath(
	sessionId: string | undefined,
	toolCallId: string,
): { artifactId: string; savedPath: string } {
	const safeSessionId = sanitizePathPart(sessionId?.trim() || "local");
	const safeToolCallId = sanitizePathPart(toolCallId || `image_${Date.now()}`);
	const artifactId = `${safeSessionId}/${safeToolCallId}.png`;
	return {
		artifactId,
		savedPath: join(codexImageArtifactRoot(), safeSessionId, `${safeToolCallId}.png`),
	};
}

export async function saveCodexGeneratedImage(
	sessionId: string | undefined,
	toolCallId: string,
	b64Json: string,
): Promise<{ artifactId: string; savedPath: string }> {
	const target = codexImageArtifactPath(sessionId, toolCallId);
	await mkdir(dirname(target.savedPath), { recursive: true });
	await writeFile(target.savedPath, Buffer.from(b64Json.trim(), "base64"));
	return target;
}

function sanitizePathPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "unknown";
}
