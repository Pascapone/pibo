import { mkdir, readFile, writeFile } from "node:fs/promises";
import { platform, release, arch } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { Type, type ImageContent } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolDefinitionContext, ToolProfile } from "../core/profiles.js";
import { getPiboHome } from "../core/pibo-home.js";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const DEFAULT_CODEX_BACKEND_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_IMAGE_MODEL = "gpt-image-2";
const MAX_EDIT_IMAGES = 5;
const OPENAI_JWT_CLAIM_PATH = "https://api.openai.com/auth";

type ImageOperation = "generate" | "edit";

type CodexImageGenerationDetails = {
	provider: "openai-codex";
	api: "codex-chatgpt-images";
	operation: ImageOperation;
	model: "gpt-image-2";
	savedPath: string;
	artifactId: string;
	referencedImageCount: number;
	endpoint: "generations" | "edits";
	created?: number;
	background?: string;
	quality?: string;
	size?: string;
};

type CodexImageResponse = {
	created?: number;
	data?: Array<{ b64_json?: string }>;
	background?: string;
	quality?: string;
	size?: string;
};

type CodexImageRequest = {
	prompt: string;
	background: "auto";
	model: typeof CODEX_IMAGE_MODEL;
	quality: "auto";
	size: "auto";
	images?: Array<{ image_url: string }>;
};

type CodexImageAuth = {
	accessToken: string;
	accountId: string;
};

function trimTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}

export function resolveCodexImageUrl(operation: "generations" | "edits", baseUrl?: string): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BACKEND_BASE_URL;
	let normalized = trimTrailingSlashes(raw.trim());
	if (normalized.endsWith("/codex/responses")) normalized = normalized.slice(0, -"/responses".length);
	if (!normalized.endsWith("/codex")) normalized = `${normalized}/codex`;
	return `${normalized}/images/${operation}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function getOpenAiAccountId(accessToken: string, storedAccountId: unknown): string | undefined {
	if (typeof storedAccountId === "string" && storedAccountId.trim().length > 0) return storedAccountId;
	const payload = decodeJwtPayload(accessToken);
	const auth = payload?.[OPENAI_JWT_CLAIM_PATH];
	if (!auth || typeof auth !== "object" || Array.isArray(auth)) return undefined;
	const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === "string" && accountId.trim().length > 0 ? accountId : undefined;
}

async function getCodexImageAuth(): Promise<CodexImageAuth> {
	const authStorage = AuthStorage.create();
	const credential = authStorage.get(OPENAI_CODEX_PROVIDER);
	if (credential?.type !== "oauth") {
		throw new Error("codex_image_generation requires ChatGPT/Codex OAuth login for provider openai-codex. Use the existing OpenAI Codex login flow; API keys are not supported for this tool.");
	}

	const accessToken = await authStorage.getApiKey(OPENAI_CODEX_PROVIDER, { includeFallback: false });
	if (!accessToken) {
		throw new Error("codex_image_generation could not load a ChatGPT/Codex OAuth access token for provider openai-codex. Please log in again with the OpenAI Codex login flow.");
	}

	const accountId = getOpenAiAccountId(accessToken, credential.accountId);
	if (!accountId) {
		throw new Error("codex_image_generation could not resolve the ChatGPT account id from the openai-codex OAuth credential. Please log in again with the OpenAI Codex login flow.");
	}

	return { accessToken, accountId };
}

function mimeTypeForPath(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		default:
			return "image/png";
	}
}

function resolveCwd(baseCwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(baseCwd, path);
}

function isImageContent(value: unknown): value is ImageContent {
	return Boolean(value)
		&& typeof value === "object"
		&& (value as { type?: unknown }).type === "image"
		&& typeof (value as { data?: unknown }).data === "string"
		&& typeof (value as { mimeType?: unknown }).mimeType === "string";
}

function imageContentToDataUrl(image: ImageContent): string {
	if (image.data.startsWith("data:")) return image.data;
	return `data:${image.mimeType};base64,${image.data}`;
}

async function imageFileToDataUrl(cwd: string, path: string): Promise<string> {
	const resolved = resolveCwd(cwd, path);
	const data = await readFile(resolved);
	return `data:${mimeTypeForPath(resolved)};base64,${data.toString("base64")}`;
}

function contentFromSessionEntry(entry: unknown): unknown {
	if (!entry || typeof entry !== "object") return undefined;
	const record = entry as Record<string, unknown>;
	if (record.type === "message") {
		const message = record.message;
		return message && typeof message === "object" ? (message as Record<string, unknown>).content : undefined;
	}
	if (record.type === "custom_message") return record.content;
	return undefined;
}

function recentImagesFromSessionEntries(entries: unknown[], count: number): Array<{ image_url: string }> {
	const images: string[] = [];
	for (const entry of [...entries].reverse()) {
		const content = contentFromSessionEntry(entry);
		if (!Array.isArray(content)) continue;
		for (const item of [...content].reverse()) {
			if (!isImageContent(item)) continue;
			images.push(imageContentToDataUrl(item));
			if (images.length === count) break;
		}
		if (images.length === count) break;
	}
	images.reverse();
	return images.map((image_url) => ({ image_url }));
}

function validateImageArgs(params: {
	prompt: string;
	referenced_image_paths?: string[];
	num_last_images_to_include?: number;
}): void {
	if (params.prompt.trim().length === 0) throw new Error("`prompt` must not be empty.");
	const pathCount = params.referenced_image_paths?.length ?? 0;
	if (pathCount > MAX_EDIT_IMAGES) throw new Error(`\`referenced_image_paths\` must contain at most ${MAX_EDIT_IMAGES} paths.`);
	if (pathCount > 0 && params.num_last_images_to_include !== undefined) {
		throw new Error("Provide only one of `referenced_image_paths` or `num_last_images_to_include`.");
	}
	if (params.num_last_images_to_include !== undefined) {
		if (!Number.isInteger(params.num_last_images_to_include) || params.num_last_images_to_include < 1 || params.num_last_images_to_include > MAX_EDIT_IMAGES) {
			throw new Error(`\`num_last_images_to_include\` must be an integer between 1 and ${MAX_EDIT_IMAGES}.`);
		}
	}
}

function sanitizePathPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "unknown";
}

function artifactPath(sessionId: string | undefined, toolCallId: string): { artifactId: string; savedPath: string } {
	const safeSessionId = sanitizePathPart(sessionId?.trim() || "local");
	const safeToolCallId = sanitizePathPart(toolCallId || `image_${Date.now()}`);
	const artifactId = `${safeSessionId}/${safeToolCallId}.png`;
	return {
		artifactId,
		savedPath: join(getPiboHome(), "generated_images", safeSessionId, `${safeToolCallId}.png`),
	};
}

async function saveGeneratedImage(sessionId: string | undefined, toolCallId: string, b64Json: string): Promise<{ artifactId: string; savedPath: string }> {
	const target = artifactPath(sessionId, toolCallId);
	await mkdir(dirname(target.savedPath), { recursive: true });
	await writeFile(target.savedPath, Buffer.from(b64Json.trim(), "base64"));
	return target;
}

function truncateErrorBody(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > 1000 ? `${compact.slice(0, 1000)}…` : compact;
}

async function postCodexImageRequest(
	operation: "generations" | "edits",
	body: CodexImageRequest,
	auth: CodexImageAuth,
	signal: AbortSignal | undefined,
	baseUrl?: string,
): Promise<CodexImageResponse> {
	const url = resolveCodexImageUrl(operation, baseUrl);
	const response = await fetch(url, {
		method: "POST",
		signal,
		headers: {
			Authorization: `Bearer ${auth.accessToken}`,
			"chatgpt-account-id": auth.accountId,
			originator: "pi",
			"User-Agent": `pibo (${platform()} ${release()}; ${arch()})`,
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Codex image ${operation} request failed: ${response.status}${text ? ` ${truncateErrorBody(text)}` : ""}`);
	}

	return await response.json() as CodexImageResponse;
}

function firstImageB64(response: CodexImageResponse): string {
	const b64 = response.data?.[0]?.b64_json;
	if (!b64 || typeof b64 !== "string") throw new Error("Codex image generation returned no image data.");
	return b64;
}

function createRequest(prompt: string, images?: Array<{ image_url: string }>): CodexImageRequest {
	return {
		...(images && images.length > 0 ? { images } : {}),
		prompt,
		background: "auto",
		model: CODEX_IMAGE_MODEL,
		quality: "auto",
		size: "auto",
	};
}

async function collectEditImages(
	params: { referenced_image_paths?: string[]; num_last_images_to_include?: number },
	cwd: string,
	sessionEntries: unknown[],
): Promise<Array<{ image_url: string }>> {
	const paths = params.referenced_image_paths ?? [];
	if (paths.length > 0) {
		return await Promise.all(paths.map(async (path) => ({ image_url: await imageFileToDataUrl(cwd, path) })));
	}
	if (params.num_last_images_to_include !== undefined) {
		const images = recentImagesFromSessionEntries(sessionEntries, params.num_last_images_to_include);
		if (images.length !== params.num_last_images_to_include) {
			throw new Error(`Requested the last ${params.num_last_images_to_include} conversation images, but only ${images.length} were available.`);
		}
		return images;
	}
	return [];
}

export type CodexImageGenerationToolOptions = {
	/** Test-only override for mocked Codex backend validation. Production callers should leave this unset. */
	baseUrl?: string;
};

export function createCodexImageGenerationToolDefinition(context: ToolDefinitionContext = {}, options: CodexImageGenerationToolOptions = {}): ToolDefinition {
	return defineTool({
		name: "codex_image_generation",
		label: "Codex Image Generation",
		description: "Generates or edits images through the ChatGPT/Codex backend API using openai-codex OAuth entitlement. Does not use the public OpenAI Images API.",
		promptSnippet: "Use codex_image_generation to create an image from a prompt, or to edit referenced/recent images with the Codex/ChatGPT image backend.",
		promptGuidelines: [
			"Use codex_image_generation for image generation and image edits when the user asks for pictures, visual variants, or edits to existing images.",
			"For edits, pass either referenced_image_paths for local image files or num_last_images_to_include for recent conversation images, but not both.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			prompt: Type.String({ description: "Image generation/editing prompt. Be specific about the desired final image." }),
			referenced_image_paths: Type.Optional(Type.Array(Type.String({ description: "Local filesystem image path to edit." }), { description: `Optional local image paths to edit. At most ${MAX_EDIT_IMAGES}.` })),
			num_last_images_to_include: Type.Optional(Type.Number({ description: `Use the last N conversation images as edit references. Must be between 1 and ${MAX_EDIT_IMAGES}.` })),
		}),
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			validateImageArgs(params);
			const images = await collectEditImages(params, ctx.cwd, ctx.sessionManager.getBranch());
			const operation: ImageOperation = images.length > 0 ? "edit" : "generate";
			const endpoint = operation === "edit" ? "edits" : "generations";
			const auth = await getCodexImageAuth();
			const response = await postCodexImageRequest(endpoint, createRequest(params.prompt, images), auth, signal, options.baseUrl);
			const result = firstImageB64(response);
			const saved = await saveGeneratedImage(context.piboSessionId, toolCallId, result);

			const details: CodexImageGenerationDetails = {
				provider: OPENAI_CODEX_PROVIDER,
				api: "codex-chatgpt-images",
				operation,
				model: CODEX_IMAGE_MODEL,
				savedPath: saved.savedPath,
				artifactId: saved.artifactId,
				referencedImageCount: images.length,
				endpoint,
				created: response.created,
				background: response.background,
				quality: response.quality,
				size: response.size,
			};

			return {
				content: [
					{ type: "image", data: result, mimeType: "image/png" },
					{ type: "text", text: `Generated image saved to ${saved.savedPath}` },
				],
				details,
			};
		},
	});
}

export function createCodexImageGenerationToolProfile(): ToolProfile {
	return {
		name: "codex_image_generation",
		description: "Generate and edit images through the ChatGPT/Codex backend API using openai-codex OAuth.",
		createDefinition: createCodexImageGenerationToolDefinition,
	};
}
