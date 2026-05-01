import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { ContextFileProfile, ContextFileScope, ContextFileSource } from "../core/profiles.js";
import type { PiboJsonObject } from "../core/events.js";
import { PiboWebHttpError, readJsonBody, responseHtml, responseJson } from "../web/http.js";
import type { PiboWebAppContext, PiboWebSession } from "../web/types.js";
import { definePiboPlugin } from "./registry.js";
import type { PiboPlugin, PiboPluginApi, PiboProductEvent } from "./types.js";

export const CONTEXT_FILES_APP_NAME = "pibo.context-files";
export const CONTEXT_FILES_MOUNT_PATH = "/apps/context-files";
export const CONTEXT_FILES_API_PREFIX = "/api/context-files";

const CONTEXT_FILES_UI_DIST_DIR = resolve(process.cwd(), "dist/apps/context-files-ui");
const POLL_INTERVAL_MS = 1000;

export type ContextFilesPluginOptions = {
	storePath?: string;
	managedRoot?: string;
	globalDir?: string;
	agentWorkspaceRoot?: string;
};

type ManagedContextFile = {
	key: string;
	label: string;
	path: string;
	scope: ContextFileScope;
	agentProfileName?: string;
};

type ManagedContextFileStore = {
	files: ManagedContextFile[];
};

type ContextFileInfo = {
	key: string;
	label?: string;
	path: string;
	absolutePath: string;
	source: ContextFileSource;
	scope: ContextFileScope;
	agentProfileName?: string;
	managed: boolean;
	dynamic: boolean;
	editable: boolean;
	removable: boolean;
	exists: boolean;
	bytes?: number;
	updatedAt?: string;
	version?: string;
};

type ContextFileDocument = ContextFileInfo & {
	markdown: string;
};

type WatchSnapshot = {
	exists: boolean;
	version?: string;
	updatedAt?: string;
	bytes?: number;
};

type ResolvedContextFilesPaths = {
	storePath: string;
	managedRoot: string;
	globalDir: string;
	agentWorkspaceRoot: string;
};

function getPiboHome(): string {
	return process.env.PIBO_HOME || join(homedir(), ".pibo");
}

function resolveContextFilesPaths(options: ContextFilesPluginOptions): ResolvedContextFilesPaths {
	const managedRoot = resolve(options.managedRoot ?? join(getPiboHome(), "context-files"));
	return {
		managedRoot,
		storePath: resolve(options.storePath ?? join(managedRoot, "index.json")),
		globalDir: resolve(options.globalDir ?? join(managedRoot, "global")),
		agentWorkspaceRoot: resolve(options.agentWorkspaceRoot ?? join(getPiboHome(), "agent-workspaces")),
	};
}

function readManagedStore(storePath: string): ManagedContextFileStore {
	if (!existsSync(storePath)) return { files: [] };
	const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<ManagedContextFileStore>;
	if (!Array.isArray(parsed.files)) return { files: [] };
	return {
		files: parsed.files.flatMap((file): ManagedContextFile[] => {
			if (!file || typeof file !== "object") return [];
			const candidate = file as Partial<ManagedContextFile>;
			if (typeof candidate.key !== "string" || typeof candidate.path !== "string") return [];
			const label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : candidate.key;
			const scope = candidate.scope === "agent" ? "agent" : "global";
			const agentProfileName = scope === "agent" && typeof candidate.agentProfileName === "string"
				? candidate.agentProfileName
				: undefined;
			if (scope === "agent" && !agentProfileName) return [];
			return [{
				key: candidate.key,
				label,
				path: candidate.path,
				scope,
				...(agentProfileName ? { agentProfileName } : {}),
			}];
		}),
	};
}

function writeManagedStore(storePath: string, store: ManagedContextFileStore): void {
	mkdirSync(dirname(storePath), { recursive: true });
	writeFileSync(storePath, `${JSON.stringify({ files: store.files }, null, 2)}\n`, "utf8");
}

function normalizeLabel(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("label must be a string", 400);
	const trimmed = value.trim();
	if (!trimmed) throw new PiboWebHttpError("label is required", 400);
	return trimmed;
}

function normalizeOptionalLabel(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("label must be a string", 400);
	const trimmed = value.trim();
	return trimmed || undefined;
}

function normalizeMarkdown(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("markdown must be a string", 400);
	return value;
}

function normalizeExpectedVersion(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("expectedVersion must be a string", 400);
	return value;
}

function normalizeScope(value: unknown, fallback: ContextFileScope = "global"): ContextFileScope {
	if (value === undefined || value === null) return fallback;
	if (value === "global" || value === "agent") return value;
	throw new PiboWebHttpError("scope must be global or agent", 400);
}

function normalizeAgentProfileName(value: unknown, required: boolean): string | undefined {
	if (value === undefined || value === null) {
		if (required) throw new PiboWebHttpError("agentProfileName is required for agent context files", 400);
		return undefined;
	}
	if (typeof value !== "string") throw new PiboWebHttpError("agentProfileName must be a string", 400);
	const trimmed = value.trim();
	if (!trimmed) {
		if (required) throw new PiboWebHttpError("agentProfileName is required for agent context files", 400);
		return undefined;
	}
	return trimmed;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
	if (value === undefined || value === null) return fallback;
	if (typeof value !== "boolean") throw new PiboWebHttpError("boolean field must be a boolean", 400);
	return value;
}

function slugSegment(value: string): string {
	const key = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return key || "context-file";
}

function uniqueKey(base: string, used: ReadonlySet<string>): string {
	if (!used.has(base)) return base;
	let index = 2;
	while (used.has(`${base}-${index}`)) index += 1;
	return `${base}-${index}`;
}

function uniquePath(dir: string, filename: string, currentPath?: string): string {
	const extension = extname(filename) || ".md";
	const baseName = slugSegment(filename.slice(0, filename.length - extension.length) || filename);
	let candidate = resolve(dir, `${baseName}${extension}`);
	if (currentPath && candidate === currentPath) return candidate;
	let index = 2;
	while (existsSync(candidate) && candidate !== currentPath) {
		candidate = resolve(dir, `${baseName}-${index}${extension}`);
		index += 1;
	}
	return candidate;
}

function managedFileName(label: string): string {
	return `${slugSegment(label)}.md`;
}

function profileForManaged(file: ManagedContextFile): ContextFileProfile {
	return {
		key: file.key,
		label: file.label,
		path: file.path,
		source: "managed",
		scope: file.scope,
		agentProfileName: file.agentProfileName,
	};
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

async function fileSnapshot(path: string): Promise<WatchSnapshot> {
	try {
		const [stats, content] = await Promise.all([stat(path), readFile(path, "utf8")]);
		return {
			exists: true,
			bytes: Buffer.byteLength(content, "utf8"),
			updatedAt: stats.mtime.toISOString(),
			version: hashContent(content),
		};
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
		if (code === "ENOENT") return { exists: false };
		throw error;
	}
}

function snapshotFromSync(path: string): WatchSnapshot {
	try {
		const stats = statSync(path);
		const content = readFileSync(path, "utf8");
		return {
			exists: true,
			bytes: Buffer.byteLength(content, "utf8"),
			updatedAt: stats.mtime.toISOString(),
			version: hashContent(content),
		};
	} catch {
		return { exists: false };
	}
}

function sameSnapshot(left: WatchSnapshot | undefined, right: WatchSnapshot): boolean {
	return left?.exists === right.exists && left?.version === right.version && left?.updatedAt === right.updatedAt;
}

function contentType(pathname: string): string {
	const ext = extname(pathname);
	if (ext === ".js") return "text/javascript; charset=utf-8";
	if (ext === ".css") return "text/css; charset=utf-8";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".json") return "application/json; charset=utf-8";
	return "application/octet-stream";
}

function builtAsset(pathname: string): Response | undefined {
	const relativePath = pathname.slice(`${CONTEXT_FILES_MOUNT_PATH}/`.length);
	if (!relativePath || relativePath.includes("..")) return undefined;
	const assetPath = resolve(CONTEXT_FILES_UI_DIST_DIR, relativePath);
	if (!assetPath.startsWith(CONTEXT_FILES_UI_DIST_DIR) || !existsSync(assetPath)) return undefined;
	return new Response(readFileSync(assetPath), {
		headers: { "content-type": contentType(assetPath) },
	});
}

function responseBuiltIndex(): Response | undefined {
	const indexPath = resolve(CONTEXT_FILES_UI_DIST_DIR, "index.html");
	if (!existsSync(indexPath)) return undefined;
	return responseHtml(readFileSync(indexPath, "utf8"));
}

function fallbackHtml(): Response {
	return responseHtml(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Pibo Context Files</title></head>
<body><p>Context Files UI has not been built. Run <code>npm run context-files-ui:build</code>.</p></body>
</html>`);
}

function writeSse(
	controller: ReadableStreamDefaultController<Uint8Array>,
	eventName: string,
	payload: unknown,
	id?: string,
): void {
	const encoder = new TextEncoder();
	const lines = [`event: ${eventName}`];
	if (id) lines.push(`id: ${id}`);
	lines.push(`data: ${JSON.stringify(payload)}`, "", "");
	controller.enqueue(encoder.encode(lines.join("\n")));
}

function writeSseComment(controller: ReadableStreamDefaultController<Uint8Array>, comment: string): void {
	controller.enqueue(new TextEncoder().encode(`: ${comment}\n\n`));
}

function productEventMatches(event: PiboProductEvent): boolean {
	return event.type.startsWith("context-file.");
}

function emitContextFileEvent(
	context: PiboWebAppContext,
	type: string,
	source: PiboProductEvent["source"],
	actorId: string | undefined,
	payload: PiboJsonObject,
): PiboProductEvent | undefined {
	return context.channelContext.emitProductEvent?.({
		type,
		source,
		actorId,
		payload,
	});
}

function contextFilePayload(file: ContextFileInfo): PiboJsonObject {
	return {
		key: file.key,
		...(file.label ? { label: file.label } : {}),
		path: file.path,
		absolutePath: file.absolutePath,
		source: file.source,
		scope: file.scope,
		managed: file.managed,
		...(file.agentProfileName ? { agentProfileName: file.agentProfileName } : {}),
		exists: file.exists,
		...(file.bytes !== undefined ? { bytes: file.bytes } : {}),
		...(file.updatedAt ? { updatedAt: file.updatedAt } : {}),
		...(file.version ? { version: file.version } : {}),
	};
}

function eventStream(context: PiboWebAppContext): Response {
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			writeSse(controller, "pibo-product", {
				type: "context-file.ready",
				source: "plugin",
				payload: {},
			});
			unsubscribe = context.channelContext.subscribeProductEvents?.((event) => {
				if (!productEventMatches(event)) return;
				writeSse(controller, "pibo-product", event, event.id);
			});
			heartbeat = setInterval(() => writeSseComment(controller, "heartbeat"), 25000);
		},
		cancel() {
			unsubscribe?.();
			if (heartbeat) clearInterval(heartbeat);
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
			connection: "keep-alive",
		},
	});
}

class ContextFileService {
	private readonly managed = new Map<string, ManagedContextFile>();
	private readonly snapshots = new Map<string, WatchSnapshot>();
	private pollTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly paths: ResolvedContextFilesPaths,
		private readonly api: Pick<PiboPluginApi, "upsertContextFile" | "removeContextFile">,
	) {
		for (const file of readManagedStore(paths.storePath).files) {
			this.managed.set(file.key, file);
			this.api.upsertContextFile(profileForManaged(file));
		}
	}

	list(context: PiboWebAppContext): ContextFileInfo[] {
		return (context.channelContext.getCapabilityCatalog?.().contextFiles ?? []).map((file) => {
			const managed = this.managed.get(file.key);
			const source = managed ? "managed" : file.source ?? "plugin";
			const scope = managed?.scope ?? file.scope ?? "global";
			const path = managed?.path ?? file.path;
			const absolutePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
			const agentProfileName = managed?.agentProfileName ?? file.agentProfileName;
			const snapshot = snapshotFromSync(absolutePath);
			return {
				key: file.key,
				label: managed?.label ?? file.label,
				path,
				absolutePath,
				source,
				scope,
				...(agentProfileName ? { agentProfileName } : {}),
				managed: source === "managed",
				dynamic: source === "managed",
				editable: true,
				removable: source === "managed",
				...snapshot,
			};
		});
	}

	async read(context: PiboWebAppContext, key: string): Promise<ContextFileDocument> {
		const file = this.requireInfo(context, key);
		const markdown = await readFile(file.absolutePath, "utf8");
		const snapshot = await fileSnapshot(file.absolutePath);
		return { ...file, ...snapshot, markdown };
	}

	async create(context: PiboWebAppContext, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const label = normalizeLabel(body.label ?? body.title);
		const markdown = normalizeMarkdown(body.markdown ?? "");
		const scope = normalizeScope(body.scope);
		const agentProfileName = normalizeAgentProfileName(body.agentProfileName, scope === "agent");
		const targetDir = this.resolveManagedDir(scope, agentProfileName);
		const absolutePath = uniquePath(targetDir, managedFileName(label));
		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, markdown, "utf8");
		const key = this.addManaged(context, {
			key: uniqueKey(`ctx:${slugSegment(label)}`, new Set(this.list(context).map((file) => file.key))),
			label,
			path: absolutePath,
			scope,
			...(agentProfileName ? { agentProfileName } : {}),
		});
		const document = await this.read(context, key);
		this.emitChanged(context, "context-file.created", "web", webSession.ownerScope, document);
		return document;
	}

	async update(context: PiboWebAppContext, key: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const file = this.requireInfo(context, key);
		const markdown = normalizeMarkdown(body.markdown);
		const expectedVersion = normalizeExpectedVersion(body.expectedVersion);
		const current = await this.read(context, key);
		if (expectedVersion && current.version && expectedVersion !== current.version) {
			return Promise.reject(new ContextFileConflictError(current));
		}
		await mkdir(dirname(file.absolutePath), { recursive: true });
		await writeFile(file.absolutePath, markdown, "utf8");
		const updated = await this.read(context, key);
		this.snapshots.set(key, this.snapshotFromInfo(updated));
		this.emitChanged(context, "context-file.updated", "web", webSession.ownerScope, updated);
		return updated;
	}

	async updateMetadata(context: PiboWebAppContext, key: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const managed = this.managed.get(key);
		if (!managed) throw new PiboWebHttpError("Only managed context files can be changed", 403);

		const label = normalizeOptionalLabel(body.label) ?? managed.label;
		const scope = normalizeScope(body.scope, managed.scope);
		const agentProfileName = normalizeAgentProfileName(body.agentProfileName, scope === "agent");
		const oldPath = managed.path;
		let nextPath = oldPath;
		if (scope !== managed.scope || agentProfileName !== managed.agentProfileName || label !== managed.label) {
			nextPath = uniquePath(this.resolveManagedDir(scope, agentProfileName), managedFileName(label), oldPath);
		}

		if (nextPath !== oldPath) {
			const markdown = await readFile(oldPath, "utf8").catch(() => "");
			await mkdir(dirname(nextPath), { recursive: true });
			await writeFile(nextPath, markdown, "utf8");
			await rm(oldPath, { force: true });
		}

		const updated: ManagedContextFile = {
			key,
			label,
			path: nextPath,
			scope,
			...(agentProfileName ? { agentProfileName } : {}),
		};
		this.managed.set(key, updated);
		this.api.upsertContextFile(profileForManaged(updated));
		this.persist();
		const document = await this.read(context, key);
		this.emitChanged(context, "context-file.metadata_updated", "web", webSession.ownerScope, document);
		return document;
	}

	async remove(context: PiboWebAppContext, key: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<{ removed: string }> {
		const file = this.requireInfo(context, key);
		const managed = this.managed.get(key);
		if (!managed) throw new PiboWebHttpError("Only managed context files can be removed", 403);
		const deleteFile = normalizeBoolean(body.deleteFile, true);
		if (deleteFile) await rm(file.absolutePath, { force: true });
		this.managed.delete(key);
		this.api.removeContextFile(key);
		this.persist();
		this.emitChanged(context, "context-file.removed", "web", webSession.ownerScope, file);
		return { removed: key };
	}

	startWatcher(context: PiboWebAppContext): void {
		if (this.pollTimer) return;
		for (const file of this.list(context)) this.snapshots.set(file.key, this.snapshotFromInfo(file));
		this.pollTimer = setInterval(() => {
			void this.poll(context);
		}, POLL_INTERVAL_MS);
	}

	stopWatcher(): void {
		if (!this.pollTimer) return;
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
	}

	private async poll(context: PiboWebAppContext): Promise<void> {
		for (const file of this.list(context)) {
			const snapshot = await fileSnapshot(file.absolutePath);
			const previous = this.snapshots.get(file.key);
			if (sameSnapshot(previous, snapshot)) continue;
			this.snapshots.set(file.key, snapshot);
			emitContextFileEvent(context, "context-file.external_updated", "filesystem", undefined, {
				...contextFilePayload(file),
				exists: snapshot.exists,
				...(snapshot.bytes !== undefined ? { bytes: snapshot.bytes } : {}),
				...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}),
				...(snapshot.version ? { version: snapshot.version } : {}),
			});
		}
	}

	private addManaged(context: PiboWebAppContext, file: ManagedContextFile): string {
		this.managed.set(file.key, file);
		this.api.upsertContextFile(profileForManaged(file));
		this.persist();
		return file.key;
	}

	private requireInfo(context: PiboWebAppContext, key: string): ContextFileInfo {
		const file = this.list(context).find((item) => item.key === key);
		if (!file) throw new PiboWebHttpError(`Unknown context file "${key}"`, 404);
		return file;
	}

	private resolveManagedDir(scope: ContextFileScope, agentProfileName: string | undefined): string {
		if (scope === "global") return this.paths.globalDir;
		if (!agentProfileName) throw new PiboWebHttpError("agentProfileName is required for agent context files", 400);
		return resolve(this.paths.agentWorkspaceRoot, slugSegment(agentProfileName), "context-files");
	}

	private snapshotFromInfo(file: ContextFileInfo): WatchSnapshot {
		return {
			exists: file.exists,
			bytes: file.bytes,
			updatedAt: file.updatedAt,
			version: file.version,
		};
	}

	private persist(): void {
		writeManagedStore(this.paths.storePath, { files: [...this.managed.values()] });
	}

	private emitChanged(
		context: PiboWebAppContext,
		type: string,
		source: PiboProductEvent["source"],
		actorId: string | undefined,
		file: ContextFileInfo,
	): void {
		emitContextFileEvent(context, type, source, actorId, contextFilePayload(file));
	}
}

class ContextFileConflictError extends Error {
	constructor(readonly document: ContextFileDocument) {
		super("Context file changed before save");
		this.name = "ContextFileConflictError";
	}
}

function apiFilePath(pathname: string): string | undefined {
	if (!pathname.startsWith(`${CONTEXT_FILES_API_PREFIX}/`)) return undefined;
	return decodeURIComponent(pathname.slice(CONTEXT_FILES_API_PREFIX.length + 1));
}

function isAppPath(pathname: string): boolean {
	return pathname === CONTEXT_FILES_MOUNT_PATH || pathname.startsWith(`${CONTEXT_FILES_MOUNT_PATH}/`);
}

function createContextFilesWebApp(service: ContextFileService) {
	return {
		name: CONTEXT_FILES_APP_NAME,
		mountPath: CONTEXT_FILES_MOUNT_PATH,
		apiPrefix: CONTEXT_FILES_API_PREFIX,
		async handleRequest(request: Request, context: PiboWebAppContext): Promise<Response | undefined> {
			const url = new URL(request.url);
			const asset = builtAsset(url.pathname);
			if (asset) return asset;

			if (isAppPath(url.pathname) && request.method === "GET") {
				return responseBuiltIndex() ?? fallbackHtml();
			}

			if (url.pathname === CONTEXT_FILES_API_PREFIX && request.method === "GET") {
				await context.requireSession({ request });
				service.startWatcher(context);
				return responseJson({ files: service.list(context) });
			}

			if (url.pathname === CONTEXT_FILES_API_PREFIX && request.method === "POST") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				return responseJson({ file: await service.create(context, body, webSession) }, { status: 201 });
			}

			if (url.pathname === `${CONTEXT_FILES_API_PREFIX}/events` && request.method === "GET") {
				await context.requireSession({ request });
				service.startWatcher(context);
				return eventStream(context);
			}

			const key = apiFilePath(url.pathname);
			if (!key || key === "events") return undefined;

			if (request.method === "GET") {
				await context.requireSession({ request });
				service.startWatcher(context);
				return responseJson({ file: await service.read(context, key) });
			}

			if (request.method === "PUT") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				try {
					return responseJson({ file: await service.update(context, key, body, webSession) });
				} catch (error) {
					if (error instanceof ContextFileConflictError) {
						return responseJson({ error: error.message, file: error.document }, { status: 409 });
					}
					throw error;
				}
			}

			if (request.method === "PATCH") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				return responseJson({ file: await service.updateMetadata(context, key, body, webSession) });
			}

			if (request.method === "DELETE") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				return responseJson(await service.remove(context, key, body, webSession));
			}

			return undefined;
		},
	};
}

export function createPiboContextFilesPlugin(options: ContextFilesPluginOptions = {}): PiboPlugin {
	const paths = resolveContextFilesPaths(options);
	return definePiboPlugin({
		id: "pibo.context-files",
		name: "Pibo Context Files",
		register(api) {
			const service = new ContextFileService(paths, api);
			api.registerWebApp(createContextFilesWebApp(service));
		},
	});
}
