import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { ContextFileProfile, ContextFileScope, ContextFileSource } from "../core/profiles.js";
import type { PiboJsonObject } from "../core/events.js";
import { PiboWebHttpError, readJsonBody, responseHtml, responseJson } from "../web/http.js";
import type { PiboWebAppContext, PiboWebSession } from "../web/types.js";
import { definePiboPlugin } from "./registry.js";
import type {
	PiboCapabilityCatalog,
	PiboPlugin,
	PiboPluginApi,
	PiboProductEvent,
} from "./types.js";
import {
	buildContextFileDiff,
	ContextFileMetadataStore,
	hashContextFileContent,
	type ContextFileDiffChunk,
	type ContextFileLinkState,
	type StoredContextFileRecord,
	type StoredContextFileRevisionRecord,
} from "./context-files-store.js";

export const CONTEXT_FILES_APP_NAME = "pibo.context-files";
export const CONTEXT_FILES_MOUNT_PATH = "/apps/context-files";
export const CONTEXT_FILES_API_PREFIX = "/api/context-files";

const CONTEXT_FILES_UI_DIST_DIR = resolve(process.cwd(), "dist/apps/context-files-ui");
const POLL_INTERVAL_MS = 1000;

export type ContextFilesPluginOptions = {
	metadataPath?: string;
	storePath?: string;
	managedRoot?: string;
	globalDir?: string;
	agentWorkspaceRoot?: string;
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
	sourceRef?: string;
	sourceHash?: string;
	linkState: ContextFileLinkState;
	activeRevisionId?: string;
};

type ContextFileDocument = ContextFileInfo & {
	markdown: string;
};

type ContextFileRevisionInfo = {
	id: string;
	kind: "source-snapshot" | "working";
	contentHash: string;
	createdAt: string;
	actorId?: string;
	basedOnRevisionId?: string;
	sourceHashAtCreation?: string;
	note?: string;
	content: string;
	active: boolean;
};

type ContextFileDiffResponse = {
	base: {
		kind: "source" | "working";
		contentHash?: string;
	};
	target: {
		kind: "source" | "working";
		contentHash?: string;
	};
	chunks: ContextFileDiffChunk[];
};

type WatchSnapshot = {
	exists: boolean;
	version?: string;
	updatedAt?: string;
	bytes?: number;
	linkState?: ContextFileLinkState;
	sourceHash?: string;
	activeRevisionId?: string;
};

type ResolvedContextFilesPaths = {
	metadataPath: string;
	legacyStorePath: string;
	managedRoot: string;
	globalDir: string;
	agentWorkspaceRoot: string;
};

type FileSnapshot = WatchSnapshot & {
	content?: string;
};

type CatalogContextFile = PiboCapabilityCatalog["contextFiles"][number];

type SourceDescriptor = {
	key: string;
	label?: string;
	absolutePath: string;
	exists: boolean;
	content?: string;
	contentHash?: string;
};

function getPiboHome(): string {
	return process.env.PIBO_HOME || join(homedir(), ".pibo");
}

function resolveContextFilesPaths(options: ContextFilesPluginOptions): ResolvedContextFilesPaths {
	const managedRoot = resolve(options.managedRoot ?? join(getPiboHome(), "context-files"));
	const explicitStorePath = options.storePath ? resolve(options.storePath) : undefined;
	const metadataPath = resolve(
		options.metadataPath
			?? (explicitStorePath && extname(explicitStorePath) === ".sqlite"
				? explicitStorePath
				: join(managedRoot, "context-files.sqlite")),
	);
	const legacyStorePath = resolve(
		explicitStorePath && extname(explicitStorePath) !== ".sqlite"
			? explicitStorePath
			: join(managedRoot, "index.json"),
	);
	return {
		metadataPath,
		legacyStorePath,
		managedRoot,
		globalDir: resolve(options.globalDir ?? join(managedRoot, "global")),
		agentWorkspaceRoot: resolve(options.agentWorkspaceRoot ?? join(getPiboHome(), "agent-workspaces")),
	};
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

function normalizeRevisionId(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw new PiboWebHttpError("revisionId is required", 400);
	return value.trim();
}

function normalizeDiffSide(value: string | null, fallback: "source" | "working"): "source" | "working" {
	if (!value) return fallback;
	if (value === "source" || value === "working") return value;
	throw new PiboWebHttpError("diff side must be source or working", 400);
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

function labelFromManagedPath(path: string): string {
	const filename = path.split(/[\\/]/).pop() ?? path;
	const extension = extname(filename);
	const stem = extension ? filename.slice(0, -extension.length) : filename;
	const words = stem
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!words) return "Context File";
	return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function profileForManaged(file: StoredContextFileRecord): ContextFileProfile {
	return {
		key: file.key,
		label: file.label,
		path: file.managedPath,
		source: "managed",
		scope: file.scope,
		agentProfileName: file.agentProfileName,
	};
}

async function fileSnapshot(path: string): Promise<FileSnapshot> {
	try {
		const [stats, content] = await Promise.all([stat(path), readFile(path, "utf8")]);
		return {
			exists: true,
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			updatedAt: stats.mtime.toISOString(),
			version: hashContextFileContent(content),
		};
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
		if (code === "ENOENT") return { exists: false };
		throw error;
	}
}

function snapshotFromSync(path: string): FileSnapshot {
	try {
		const stats = statSync(path);
		const content = readFileSync(path, "utf8");
		return {
			exists: true,
			content,
			bytes: Buffer.byteLength(content, "utf8"),
			updatedAt: stats.mtime.toISOString(),
			version: hashContextFileContent(content),
		};
	} catch {
		return { exists: false };
	}
}

function sameSnapshot(left: WatchSnapshot | undefined, right: WatchSnapshot): boolean {
	return left?.exists === right.exists
		&& left?.version === right.version
		&& left?.updatedAt === right.updatedAt
		&& left?.bytes === right.bytes
		&& left?.linkState === right.linkState
		&& left?.sourceHash === right.sourceHash
		&& left?.activeRevisionId === right.activeRevisionId;
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
		editable: file.editable,
		removable: file.removable,
		linkState: file.linkState,
		...(file.agentProfileName ? { agentProfileName: file.agentProfileName } : {}),
		...(file.sourceRef ? { sourceRef: file.sourceRef } : {}),
		...(file.sourceHash ? { sourceHash: file.sourceHash } : {}),
		...(file.activeRevisionId ? { activeRevisionId: file.activeRevisionId } : {}),
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
	private readonly store: ContextFileMetadataStore;
	private readonly managed = new Map<string, StoredContextFileRecord>();
	private readonly snapshots = new Map<string, WatchSnapshot>();
	private pollTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly paths: ResolvedContextFilesPaths,
		private readonly api: Pick<PiboPluginApi, "upsertContextFile" | "removeContextFile">,
	) {
		this.store = new ContextFileMetadataStore(paths.metadataPath, paths.legacyStorePath);
		for (const file of this.store.listFiles()) {
			this.managed.set(file.key, file);
			this.api.upsertContextFile(profileForManaged(file));
		}
	}

	list(context: PiboWebAppContext): ContextFileInfo[] {
		this.discoverGlobalManagedFiles(context, false);
		const catalog = context.channelContext.getCapabilityCatalog?.().contextFiles ?? [];
		return catalog.map((file) => this.resolveCatalogInfo(context, file));
	}

	async read(context: PiboWebAppContext, key: string): Promise<ContextFileDocument> {
		this.discoverGlobalManagedFiles(context, false);
		const managed = this.managed.get(key);
		if (managed) {
			const file = this.resolveManagedInfo(context, managed);
			const activeRevision = file.activeRevisionId ? this.store.getRevision(file.activeRevisionId) : undefined;
			const snapshot = await fileSnapshot(file.absolutePath);
			const markdown = snapshot.exists ? (snapshot.content ?? "") : (activeRevision?.content ?? "");
			return {
				...file,
				bytes: snapshot.bytes ?? file.bytes,
				updatedAt: snapshot.updatedAt ?? file.updatedAt,
				version: snapshot.version ?? file.version,
				exists: snapshot.exists,
				markdown,
			};
		}

		const catalogFile = this.requirePluginCatalogFile(context, key);
		const source = await fileSnapshot(this.resolveCatalogPath(catalogFile.path));
		return {
			...this.resolvePluginInfo(catalogFile),
			bytes: source.bytes,
			updatedAt: source.updatedAt,
			version: source.version,
			exists: source.exists,
			markdown: source.content ?? "",
		};
	}

	async create(context: PiboWebAppContext, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const label = normalizeLabel(body.label ?? body.title);
		const markdown = normalizeMarkdown(body.markdown ?? "");
		const scope = normalizeScope(body.scope);
		const agentProfileName = normalizeAgentProfileName(body.agentProfileName, scope === "agent");
		const key = uniqueKey(`ctx:${slugSegment(label)}`, new Set(this.list(context).map((file) => file.key)));
		const targetDir = this.resolveManagedDir(scope, agentProfileName);
		const absolutePath = uniquePath(targetDir, managedFileName(label));
		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, markdown, "utf8");

		const record = this.store.createFile({
			key,
			label,
			managedPath: absolutePath,
			scope,
			agentProfileName,
		});
		const revision = this.store.appendRevision({
			contextFileKey: record.key,
			kind: "working",
			contentHash: hashContextFileContent(markdown),
			content: markdown,
			actorId: webSession.authSession.identity.userId,
			note: "Managed context file created",
		});
		const updated = this.store.updateFile({
			...record,
			activeRevisionId: revision.id,
			updatedAt: new Date().toISOString(),
		});
		this.upsertManaged(updated);
		const document = await this.read(context, updated.key);
		this.snapshots.set(updated.key, this.snapshotFromInfo(document));
		this.emitChanged(context, "context-file.created", "web", webSession.authSession.identity.userId, document);
		return document;
	}

	async createLinkedCopy(context: PiboWebAppContext, sourceKey: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const sourceFile = this.requirePluginCatalogFile(context, sourceKey);
		const sourceDescriptor = this.requireLivePluginSource(sourceFile);
		const label = normalizeOptionalLabel(body.label) ?? sourceFile.label ?? sourceKey;
		const scope = normalizeScope(body.scope, "global");
		const agentProfileName = normalizeAgentProfileName(body.agentProfileName, scope === "agent");
		const key = uniqueKey(`ctx:${slugSegment(label)}`, new Set(this.list(context).map((file) => file.key)));
		const targetDir = this.resolveManagedDir(scope, agentProfileName);
		const absolutePath = uniquePath(targetDir, managedFileName(label));
		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(absolutePath, sourceDescriptor.content ?? "", "utf8");

		const record = this.store.createFile({
			key,
			label,
			managedPath: absolutePath,
			scope,
			agentProfileName,
			sourceRef: this.pluginSourceRef(sourceFile),
			sourceHash: sourceDescriptor.contentHash,
		});
		const sourceRevision = this.store.appendRevision({
			contextFileKey: record.key,
			kind: "source-snapshot",
			contentHash: sourceDescriptor.contentHash!,
			content: sourceDescriptor.content ?? "",
			actorId: webSession.authSession.identity.userId,
			sourceHashAtCreation: sourceDescriptor.contentHash,
			note: "Plugin source linked",
		});
		const workingRevision = this.store.appendRevision({
			contextFileKey: record.key,
			kind: "working",
			contentHash: sourceDescriptor.contentHash!,
			content: sourceDescriptor.content ?? "",
			actorId: webSession.authSession.identity.userId,
			basedOnRevisionId: sourceRevision.id,
			sourceHashAtCreation: sourceDescriptor.contentHash,
			note: "Managed working copy created from plugin source",
		});
		const updated = this.store.updateFile({
			...record,
			activeRevisionId: workingRevision.id,
			sourceHash: sourceDescriptor.contentHash,
			updatedAt: new Date().toISOString(),
		});
		this.upsertManaged(updated);
		const document = await this.read(context, updated.key);
		this.snapshots.set(updated.key, this.snapshotFromInfo(document));
		this.emitChanged(context, "context-file.linked_from_plugin", "web", webSession.authSession.identity.userId, document);
		return document;
	}

	async update(context: PiboWebAppContext, key: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const record = this.requireManagedRecord(key);
		const markdown = normalizeMarkdown(body.markdown);
		const expectedVersion = normalizeExpectedVersion(body.expectedVersion);
		const current = await this.read(context, key);
		if (expectedVersion && current.version && expectedVersion !== current.version) {
			return Promise.reject(new ContextFileConflictError(current));
		}
		if (current.markdown === markdown) return current;

		const updatedRecord = await this.writeWorkingContent(record, markdown, {
			actorId: webSession.authSession.identity.userId,
			note: "Managed context file updated",
		});
		const updated = await this.read(context, updatedRecord.key);
		this.snapshots.set(updated.key, this.snapshotFromInfo(updated));
		this.emitChanged(context, "context-file.updated", "web", webSession.authSession.identity.userId, updated);
		return updated;
	}

	async updateMetadata(context: PiboWebAppContext, key: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const record = this.requireManagedRecord(key);
		const label = normalizeOptionalLabel(body.label) ?? record.label;
		const scope = normalizeScope(body.scope, record.scope);
		const agentProfileName = normalizeAgentProfileName(body.agentProfileName, scope === "agent");
		const oldPath = record.managedPath;
		const nextPath = scope !== record.scope || agentProfileName !== record.agentProfileName || label !== record.label
			? uniquePath(this.resolveManagedDir(scope, agentProfileName), managedFileName(label), oldPath)
			: oldPath;

		if (nextPath !== oldPath) {
			const currentContent = this.currentWorkingContent(record);
			await mkdir(dirname(nextPath), { recursive: true });
			await writeFile(nextPath, currentContent, "utf8");
			await rm(oldPath, { force: true });
		}

		const updated = this.store.updateFile({
			...record,
			label,
			managedPath: nextPath,
			scope,
			agentProfileName,
			updatedAt: new Date().toISOString(),
		});
		this.upsertManaged(updated);
		const document = await this.read(context, key);
		this.snapshots.set(key, this.snapshotFromInfo(document));
		this.emitChanged(context, "context-file.metadata_updated", "web", webSession.authSession.identity.userId, document);
		return document;
	}

	async resetToSource(context: PiboWebAppContext, key: string, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const record = this.requireManagedRecord(key);
		if (!record.sourceRef) throw new PiboWebHttpError("Only linked managed files can be reset to source", 400);
		const liveSource = this.requireLiveSourceForRecord(context, record);
		this.ensureSourceSnapshot(record, liveSource, webSession.authSession.identity.userId, "Source snapshot refreshed during reset");
		const updatedRecord = await this.writeWorkingContent(record, liveSource.content ?? "", {
			actorId: webSession.authSession.identity.userId,
			sourceHash: liveSource.contentHash,
			note: "Working copy reset to source",
		});
		const document = await this.read(context, updatedRecord.key);
		this.snapshots.set(updatedRecord.key, this.snapshotFromInfo(document));
		this.emitChanged(context, "context-file.reset_to_source", "web", webSession.authSession.identity.userId, document);
		return document;
	}

	async adoptSource(context: PiboWebAppContext, key: string, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const record = this.requireManagedRecord(key);
		if (!record.sourceRef) throw new PiboWebHttpError("Only linked managed files can adopt a source", 400);
		const liveSource = this.requireLiveSourceForRecord(context, record);
		this.ensureSourceSnapshot(record, liveSource, webSession.authSession.identity.userId, "Source snapshot adopted");
		const updatedRecord = await this.writeWorkingContent(record, liveSource.content ?? "", {
			actorId: webSession.authSession.identity.userId,
			sourceHash: liveSource.contentHash,
			note: "Plugin source adopted",
		});
		const document = await this.read(context, updatedRecord.key);
		this.snapshots.set(updatedRecord.key, this.snapshotFromInfo(document));
		this.emitChanged(context, "context-file.source_adopted", "web", webSession.authSession.identity.userId, document);
		return document;
	}

	async restoreRevision(context: PiboWebAppContext, key: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<ContextFileDocument> {
		const record = this.requireManagedRecord(key);
		const revisionId = normalizeRevisionId(body.revisionId);
		const revision = this.store.getRevision(revisionId);
		if (!revision || revision.contextFileKey !== key) throw new PiboWebHttpError(`Unknown revision "${revisionId}"`, 404);
		const updatedRecord = await this.writeWorkingContent(record, revision.content, {
			actorId: webSession.authSession.identity.userId,
			basedOnRevisionId: revision.id,
			note: `Revision restored from ${revision.id}`,
		});
		const document = await this.read(context, updatedRecord.key);
		this.snapshots.set(updatedRecord.key, this.snapshotFromInfo(document));
		this.emitChanged(context, "context-file.revision_restored", "web", webSession.authSession.identity.userId, document);
		return document;
	}

	listRevisions(context: PiboWebAppContext, key: string): { revisions: ContextFileRevisionInfo[]; activeRevisionId?: string } {
		const record = this.ensureManagedRecordSynced(this.requireManagedRecord(key));
		const revisions = this.store.listRevisions(key).map((revision) => this.revisionInfoFromRecord(revision, record.activeRevisionId));
		return {
			revisions,
			...(record.activeRevisionId ? { activeRevisionId: record.activeRevisionId } : {}),
		};
	}

	diff(context: PiboWebAppContext, key: string, baseKind: "source" | "working", targetKind: "source" | "working"): ContextFileDiffResponse {
		const record = this.ensureManagedRecordSynced(this.requireManagedRecord(key));
		const base = this.resolveDiffSide(context, record, baseKind);
		const target = this.resolveDiffSide(context, record, targetKind);
		return {
			base: {
				kind: baseKind,
				contentHash: base.contentHash,
			},
			target: {
				kind: targetKind,
				contentHash: target.contentHash,
			},
			chunks: buildContextFileDiff(base.content, target.content),
		};
	}

	async remove(context: PiboWebAppContext, key: string, body: Record<string, unknown>, webSession: PiboWebSession): Promise<{ removed: string }> {
		const file = this.requireInfo(context, key);
		const record = this.requireManagedRecord(key);
		const deleteFile = normalizeBoolean(body.deleteFile, true);
		if (deleteFile) await rm(record.managedPath, { force: true });
		this.managed.delete(key);
		this.store.deleteFile(key);
		this.api.removeContextFile(key);
		this.snapshots.delete(key);
		this.emitChanged(context, "context-file.removed", "web", webSession.authSession.identity.userId, file);
		return { removed: key };
	}

	startWatcher(context: PiboWebAppContext): void {
		if (this.pollTimer) return;
		this.discoverGlobalManagedFiles(context, false);
		for (const file of this.list(context)) this.snapshots.set(file.key, this.snapshotFromInfo(file));
		this.pollTimer = setInterval(() => {
			void this.poll(context);
		}, POLL_INTERVAL_MS);
		this.pollTimer.unref?.();
	}

	stopWatcher(): void {
		if (!this.pollTimer) return;
		clearInterval(this.pollTimer);
		this.pollTimer = undefined;
	}

	private async poll(context: PiboWebAppContext): Promise<void> {
		this.discoverGlobalManagedFiles(context, true);
		for (const file of this.list(context)) {
			const nextSnapshot = this.snapshotFromInfo(file);
			const previous = this.snapshots.get(file.key);
			if (sameSnapshot(previous, nextSnapshot)) continue;
			this.snapshots.set(file.key, nextSnapshot);
			const eventType = previous?.linkState !== "orphaned" && file.linkState === "orphaned"
				? "context-file.source_orphaned"
				: "context-file.external_updated";
			emitContextFileEvent(context, eventType, "filesystem", undefined, contextFilePayload(file));
		}
	}

	private discoverGlobalManagedFiles(context: PiboWebAppContext, emitEvents: boolean): StoredContextFileRecord[] {
		let entries: Array<{ name: string; isFile(): boolean }>;
		try {
			entries = readdirSync(this.paths.globalDir, { withFileTypes: true });
		} catch (error) {
			const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
			if (code === "ENOENT") return [];
			throw error;
		}

		const knownPaths = new Set([...this.managed.values()].map((file) => resolve(file.managedPath)));
		const usedKeys = new Set([
			...this.managed.keys(),
			...(context.channelContext.getCapabilityCatalog?.().contextFiles ?? []).map((file) => file.key),
		]);
		const discovered: StoredContextFileRecord[] = [];

		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const extension = extname(entry.name).toLowerCase();
			if (extension !== ".md" && extension !== ".markdown") continue;
			const absolutePath = resolve(this.paths.globalDir, entry.name);
			if (knownPaths.has(absolutePath)) continue;
			const snapshot = snapshotFromSync(absolutePath);
			if (!snapshot.exists || !snapshot.version) continue;

			const label = labelFromManagedPath(entry.name);
			const record = this.store.createFile({
				key: uniqueKey(`ctx:${slugSegment(entry.name.slice(0, -extension.length) || entry.name)}`, usedKeys),
				label,
				managedPath: absolutePath,
				scope: "global",
				createdAt: snapshot.updatedAt,
				updatedAt: snapshot.updatedAt,
			});
			const revision = this.store.appendRevision({
				contextFileKey: record.key,
				kind: "working",
				contentHash: snapshot.version,
				content: snapshot.content ?? "",
				createdAt: snapshot.updatedAt,
				note: "Global context file discovered on disk",
			});
			const updated = this.store.updateFile({
				...record,
				activeRevisionId: revision.id,
				updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
			});

			this.upsertManaged(updated);
			this.managed.set(updated.key, updated);
			knownPaths.add(absolutePath);
			usedKeys.add(updated.key);
			const info = this.resolveManagedInfo(context, updated);
			discovered.push(updated);
			if (emitEvents) {
				this.snapshots.set(updated.key, this.snapshotFromInfo(info));
				this.emitChanged(context, "context-file.created", "filesystem", undefined, info);
			}
		}

		return discovered;
	}

	private resolveCatalogInfo(context: PiboWebAppContext, file: CatalogContextFile): ContextFileInfo {
		const managed = this.managed.get(file.key);
		if (managed) return this.resolveManagedInfo(context, managed);
		return this.resolvePluginInfo(file);
	}

	private resolvePluginInfo(file: CatalogContextFile): ContextFileInfo {
		const absolutePath = this.resolveCatalogPath(file.path);
		const snapshot = snapshotFromSync(absolutePath);
		return {
			key: file.key,
			label: file.label,
			path: file.path,
			absolutePath,
			source: "plugin",
			scope: file.scope ?? "global",
			agentProfileName: file.agentProfileName,
			managed: false,
			dynamic: false,
			editable: false,
			removable: false,
			exists: snapshot.exists,
			bytes: snapshot.bytes,
			updatedAt: snapshot.updatedAt,
			version: snapshot.version,
			sourceRef: file.pluginId ? this.pluginSourceRef(file) : undefined,
			sourceHash: snapshot.version,
			linkState: "plugin-only",
		};
	}

	private resolveManagedInfo(context: PiboWebAppContext, file: StoredContextFileRecord): ContextFileInfo {
		const record = this.ensureManagedRecordSynced(file);
		const snapshot = snapshotFromSync(record.managedPath);
		const activeRevision = record.activeRevisionId ? this.store.getRevision(record.activeRevisionId) : undefined;
		const sourceDescriptor = record.sourceRef ? this.resolveLiveSource(context, record.sourceRef) : undefined;
		const sourceHash = sourceDescriptor?.contentHash ?? record.sourceHash;
		const workingHash = snapshot.version ?? activeRevision?.contentHash;
		const linkState = this.computeLinkState(record, sourceDescriptor, workingHash);
		return {
			key: record.key,
			label: record.label,
			path: record.managedPath,
			absolutePath: record.managedPath,
			source: "managed",
			scope: record.scope,
			agentProfileName: record.agentProfileName,
			managed: true,
			dynamic: true,
			editable: true,
			removable: true,
			exists: snapshot.exists,
			bytes: snapshot.bytes ?? (activeRevision ? Buffer.byteLength(activeRevision.content, "utf8") : undefined),
			updatedAt: snapshot.updatedAt ?? record.updatedAt,
			version: snapshot.version ?? activeRevision?.contentHash,
			sourceRef: record.sourceRef,
			sourceHash,
			linkState,
			activeRevisionId: record.activeRevisionId,
		};
	}

	private computeLinkState(
		record: StoredContextFileRecord,
		sourceDescriptor: SourceDescriptor | undefined,
		workingHash: string | undefined,
	): ContextFileLinkState {
		if (!record.sourceRef) return "managed-unlinked";
		if (!sourceDescriptor?.exists || !sourceDescriptor.contentHash) return "orphaned";
		if (record.sourceHash && sourceDescriptor.contentHash !== record.sourceHash) return "linked-stale";
		return workingHash === sourceDescriptor.contentHash ? "linked-clean" : "linked-dirty";
	}

	private ensureManagedRecordSynced(record: StoredContextFileRecord): StoredContextFileRecord {
		const snapshot = snapshotFromSync(record.managedPath);
		if (!snapshot.exists || !snapshot.version) return record;
		const activeRevision = record.activeRevisionId ? this.store.getRevision(record.activeRevisionId) : undefined;
		if (activeRevision?.contentHash === snapshot.version) return record;
		const revision = this.store.appendRevision({
			contextFileKey: record.key,
			kind: "working",
			contentHash: snapshot.version,
			content: snapshot.content ?? "",
			basedOnRevisionId: record.activeRevisionId,
			sourceHashAtCreation: record.sourceHash,
			note: activeRevision ? "External file update detected" : "Recovered working content from disk",
		});
		const updated = this.store.updateFile({
			...record,
			activeRevisionId: revision.id,
			updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
		});
		this.upsertManaged(updated);
		return updated;
	}

	private currentWorkingContent(record: StoredContextFileRecord): string {
		const snapshot = snapshotFromSync(record.managedPath);
		if (snapshot.exists) return snapshot.content ?? "";
		const revision = record.activeRevisionId ? this.store.getRevision(record.activeRevisionId) : undefined;
		return revision?.content ?? "";
	}

	private async writeWorkingContent(
		record: StoredContextFileRecord,
		content: string,
		options: {
			actorId?: string;
			basedOnRevisionId?: string;
			sourceHash?: string;
			note: string;
		},
	): Promise<StoredContextFileRecord> {
		await mkdir(dirname(record.managedPath), { recursive: true });
		await writeFile(record.managedPath, content, "utf8");
		const revision = this.store.appendRevision({
			contextFileKey: record.key,
			kind: "working",
			contentHash: hashContextFileContent(content),
			content,
			actorId: options.actorId,
			basedOnRevisionId: options.basedOnRevisionId ?? record.activeRevisionId,
			sourceHashAtCreation: options.sourceHash ?? record.sourceHash,
			note: options.note,
		});
		const updated = this.store.updateFile({
			...record,
			activeRevisionId: revision.id,
			sourceHash: options.sourceHash ?? record.sourceHash,
			updatedAt: new Date().toISOString(),
		});
		this.upsertManaged(updated);
		return updated;
	}

	private ensureSourceSnapshot(
		record: StoredContextFileRecord,
		source: SourceDescriptor,
		actorId: string,
		note: string,
	): StoredContextFileRevisionRecord {
		const existing = source.contentHash ? this.store.findLatestSourceSnapshot(record.key, source.contentHash) : undefined;
		if (existing) return existing;
		return this.store.appendRevision({
			contextFileKey: record.key,
			kind: "source-snapshot",
			contentHash: source.contentHash ?? hashContextFileContent(source.content ?? ""),
			content: source.content ?? "",
			actorId,
			sourceHashAtCreation: source.contentHash,
			note,
		});
	}

	private revisionInfoFromRecord(revision: StoredContextFileRevisionRecord, activeRevisionId: string | undefined): ContextFileRevisionInfo {
		return {
			id: revision.id,
			kind: revision.kind,
			contentHash: revision.contentHash,
			createdAt: revision.createdAt,
			actorId: revision.actorId,
			basedOnRevisionId: revision.basedOnRevisionId,
			sourceHashAtCreation: revision.sourceHashAtCreation,
			note: revision.note,
			content: revision.content,
			active: revision.id === activeRevisionId,
		};
	}

	private resolveDiffSide(
		context: PiboWebAppContext,
		record: StoredContextFileRecord,
		kind: "source" | "working",
	): { content: string; contentHash?: string } {
		if (kind === "working") {
			const content = this.currentWorkingContent(record);
			return { content, contentHash: hashContextFileContent(content) };
		}
		const liveSource = record.sourceRef ? this.resolveLiveSource(context, record.sourceRef) : undefined;
		if (liveSource?.exists) {
			return {
				content: liveSource.content ?? "",
				contentHash: liveSource.contentHash,
			};
		}
		const snapshot = record.sourceHash
			? this.store.findLatestSourceSnapshot(record.key, record.sourceHash)
			: this.store.findLatestSourceSnapshot(record.key);
		if (!snapshot) throw new PiboWebHttpError("No source snapshot available for diff", 404);
		return {
			content: snapshot.content,
			contentHash: snapshot.contentHash,
		};
	}

	private requirePluginCatalogFile(context: PiboWebAppContext, key: string): CatalogContextFile {
		const file = (context.channelContext.getCapabilityCatalog?.().contextFiles ?? []).find((candidate) => candidate.key === key);
		if (!file || (file.source ?? "plugin") !== "plugin") throw new PiboWebHttpError(`Unknown plugin context file "${key}"`, 404);
		return file;
	}

	private requireLivePluginSource(file: CatalogContextFile): SourceDescriptor {
		const descriptor = this.resolvePluginDescriptor(file);
		if (!descriptor.exists || !descriptor.contentHash) throw new PiboWebHttpError(`Plugin context file "${file.key}" is not readable`, 404);
		return descriptor;
	}

	private requireLiveSourceForRecord(context: PiboWebAppContext, record: StoredContextFileRecord): SourceDescriptor {
		const descriptor = record.sourceRef ? this.resolveLiveSource(context, record.sourceRef) : undefined;
		if (!descriptor?.exists || !descriptor.contentHash) throw new PiboWebHttpError("Linked source is not available", 404);
		return descriptor;
	}

	private resolveLiveSource(context: PiboWebAppContext, sourceRef: string): SourceDescriptor | undefined {
		const parsed = parseSourceRef(sourceRef);
		if (!parsed) return undefined;
		const file = (context.channelContext.getCapabilityCatalog?.().contextFiles ?? []).find((candidate) => (
			(candidate.source ?? "plugin") === "plugin"
				&& candidate.key === parsed.key
				&& candidate.pluginId === parsed.pluginId
		));
		return file ? this.resolvePluginDescriptor(file) : undefined;
	}

	private resolvePluginDescriptor(file: CatalogContextFile): SourceDescriptor {
		const absolutePath = this.resolveCatalogPath(file.path);
		const snapshot = snapshotFromSync(absolutePath);
		return {
			key: file.key,
			label: file.label,
			absolutePath,
			exists: snapshot.exists,
			content: snapshot.content,
			contentHash: snapshot.version,
		};
	}

	private pluginSourceRef(file: CatalogContextFile): string {
		if (!file.pluginId) throw new PiboWebHttpError(`Plugin id missing for context file "${file.key}"`, 500);
		return `plugin:${file.pluginId}:${file.key}`;
	}

	private resolveCatalogPath(path: string): string {
		return isAbsolute(path) ? path : resolve(process.cwd(), path);
	}

	private upsertManaged(file: StoredContextFileRecord): void {
		this.managed.set(file.key, file);
		this.api.upsertContextFile(profileForManaged(file));
	}

	private requireInfo(context: PiboWebAppContext, key: string): ContextFileInfo {
		const file = this.list(context).find((item) => item.key === key);
		if (!file) throw new PiboWebHttpError(`Unknown context file "${key}"`, 404);
		return file;
	}

	private requireManagedRecord(key: string): StoredContextFileRecord {
		const record = this.managed.get(key);
		if (!record) throw new PiboWebHttpError("Only managed context files can be changed", 403);
		return record;
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
			linkState: file.linkState,
			sourceHash: file.sourceHash,
			activeRevisionId: file.activeRevisionId,
		};
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

function parseSourceRef(value: string): { pluginId: string; key: string } | undefined {
	if (!value.startsWith("plugin:")) return undefined;
	const remainder = value.slice("plugin:".length);
	const separator = remainder.indexOf(":");
	if (separator === -1) return undefined;
	const pluginId = remainder.slice(0, separator);
	const key = remainder.slice(separator + 1);
	if (!pluginId || !key) return undefined;
	return { pluginId, key };
}

function apiPath(pathname: string): { key: string; action?: string } | undefined {
	if (!pathname.startsWith(`${CONTEXT_FILES_API_PREFIX}/`)) return undefined;
	const suffix = pathname.slice(CONTEXT_FILES_API_PREFIX.length + 1);
	if (!suffix) return undefined;
	const [encodedKey, ...actionParts] = suffix.split("/");
	if (!encodedKey) return undefined;
	return {
		key: decodeURIComponent(encodedKey),
		...(actionParts.length > 0 ? { action: actionParts.join("/") } : {}),
	};
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

			const path = apiPath(url.pathname);
			if (!path || path.key === "events") return undefined;

			if (!path.action && request.method === "GET") {
				await context.requireSession({ request });
				service.startWatcher(context);
				return responseJson({ file: await service.read(context, path.key) });
			}

			if (!path.action && request.method === "PUT") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				try {
					return responseJson({ file: await service.update(context, path.key, body, webSession) });
				} catch (error) {
					if (error instanceof ContextFileConflictError) {
						return responseJson({ error: error.message, file: error.document }, { status: 409 });
					}
					throw error;
				}
			}

			if (!path.action && request.method === "PATCH") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				return responseJson({ file: await service.updateMetadata(context, path.key, body, webSession) });
			}

			if (!path.action && request.method === "DELETE") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				return responseJson(await service.remove(context, path.key, body, webSession));
			}

			if (path.action === "link-from-plugin" && request.method === "POST") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				return responseJson({ file: await service.createLinkedCopy(context, path.key, body, webSession) }, { status: 201 });
			}

			if (path.action === "reset-to-source" && request.method === "POST") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				return responseJson({ file: await service.resetToSource(context, path.key, webSession) });
			}

			if (path.action === "restore-revision" && request.method === "POST") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				const body = await readJsonBody<Record<string, unknown>>(request);
				return responseJson({ file: await service.restoreRevision(context, path.key, body, webSession) });
			}

			if (path.action === "revisions" && request.method === "GET") {
				await context.requireSession({ request });
				service.startWatcher(context);
				return responseJson(service.listRevisions(context, path.key));
			}

			if (path.action === "diff" && request.method === "GET") {
				await context.requireSession({ request });
				service.startWatcher(context);
				const base = normalizeDiffSide(url.searchParams.get("base"), "source");
				const target = normalizeDiffSide(url.searchParams.get("target"), "working");
				return responseJson(service.diff(context, path.key, base, target));
			}

			if (path.action === "adopt-source" && request.method === "POST") {
				const webSession = await context.requireSession({ request });
				service.startWatcher(context);
				return responseJson({ file: await service.adoptSource(context, path.key, webSession) });
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
