import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	generatedImageArtifactPath,
	generatedImageArtifactRoot,
} from "../core/generated-image-artifacts.js";

export const codexImageArtifactRoot = generatedImageArtifactRoot;
export const codexImageArtifactPath = generatedImageArtifactPath;

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
