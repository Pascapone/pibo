import { join } from "node:path";
import { getPiboHome } from "./pibo-home.js";

export function generatedImageArtifactRoot(): string {
	return join(getPiboHome(), "generated_images");
}

export function generatedImageArtifactPath(
	sessionId: string | undefined,
	toolCallId: string,
): { artifactId: string; savedPath: string } {
	const safeSessionId = sanitizePathPart(sessionId?.trim() || "local");
	const safeToolCallId = sanitizePathPart(toolCallId || `image_${Date.now()}`);
	const artifactId = `${safeSessionId}/${safeToolCallId}.png`;
	return {
		artifactId,
		savedPath: join(generatedImageArtifactRoot(), safeSessionId, `${safeToolCallId}.png`),
	};
}

function sanitizePathPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "unknown";
}
