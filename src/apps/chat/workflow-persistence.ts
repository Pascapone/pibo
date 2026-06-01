import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../../core/events.js";
import type { PiboDataStore } from "../../data/pibo-store.js";
import { PiboWebHttpError } from "../../web/http.js";
import {
	allocateWorkflowPublishedVersion,
	canonicalWorkflowDefinitionJson,
	hashPromptAssetMarkdown,
	hashWorkflowDefinitionJson,
	normalizeWorkflowPromptAssetLabel,
	sanitizeWorkflowDiagnostics,
	workflowDraftDefinitionForPublishedVersion,
	type WorkflowArchiveStateRecord,
	type WorkflowDraftDiagnostic,
	type WorkflowDraftRecord,
	type WorkflowLifecycleEventInput,
	type WorkflowLifecycleEventRecord,
	type WorkflowLifecycleEventType,
	type WorkflowPromptAssetDocument,
	type WorkflowPromptAssetRecord,
	type WorkflowPromptAssetRevisionRecord,
	type WorkflowPublishedVersionRecord,
	type WorkflowTombstoneRecord,
	type WorkflowValidationSummary,
} from "./workflow-persistence-model.js";
export {
	canonicalWorkflowDefinitionJson,
	compareWorkflowSemver,
	hashPromptAssetMarkdown,
	hashWorkflowDefinitionJson,
	normalizeForCanonicalJson,
	normalizeWorkflowPromptAssetLabel,
	parseWorkflowSemver,
	sanitizeWorkflowDiagnostics,
} from "./workflow-persistence-model.js";
export type {
	WorkflowArchiveStateRecord,
	WorkflowDraftDiagnostic,
	WorkflowDraftRecord,
	WorkflowLifecycleEventInput,
	WorkflowLifecycleEventRecord,
	WorkflowLifecycleEventType,
	WorkflowPromptAssetDocument,
	WorkflowPromptAssetRecord,
	WorkflowPromptAssetRevisionRecord,
	WorkflowPublishedVersionRecord,
	WorkflowTombstoneRecord,
	WorkflowValidationResponse,
	WorkflowValidationSummary,
	WorkflowValidationTrigger,
} from "./workflow-persistence-model.js";

type WorkflowDraftStoreRow = {
	draft_id: string;
	workflow_id: string;
	source: "ui";
	status: "draft";
	base_workflow_id: string | null;
	base_workflow_version: string | null;
	base_definition_hash: string | null;
	target_workflow_version: string | null;
	version_intent: "patch" | "minor" | "major";
	definition_json: string;
	diagnostics_json: string;
	validation_json: string | null;
	validation_state: "unknown" | "valid" | "warning" | "error";
	revision: number;
	created_at: string;
	updated_at: string;
};

type WorkflowPromptAssetStoreRow = {
	asset_id: string;
	source: "ui";
	display_name: string;
	description: string | null;
	active_revision_id: string | null;
	created_at: string;
	updated_at: string;
};

type WorkflowPromptAssetRevisionStoreRow = {
	revision_id: string;
	asset_id: string;
	content_hash: string;
	markdown: string;
	created_at: string;
	created_by: string | null;
	based_on_revision_id: string | null;
};

type WorkflowPublishedVersionStoreRow = {
	workflow_id: string;
	version: string;
	source: "ui";
	status: "published";
	definition_hash: string;
	definition_json: string;
	published_from_draft_id: string | null;
	published_by: string | null;
	published_at: string;
	created_at: string;
};

type WorkflowArchiveStateStoreRow = {
	workflow_id: string;
	source: "ui";
	archived: number;
	archived_at: string | null;
	archived_by: string | null;
	archive_reason: string | null;
	updated_at: string;
};

type WorkflowTombstoneStoreRow = {
	workflow_id: string;
	source: "ui";
	deleted: number;
	deleted_at: string;
	deleted_by: string;
	last_known_title: string;
	last_known_version: string | null;
	last_definition_hash: string | null;
	updated_at: string;
};

type WorkflowLifecycleEventStoreRow = {
	id: string;
	type: WorkflowLifecycleEventType;
	actor_id: string | null;
	workflow_id: string | null;
	workflow_version: string | null;
	draft_id: string | null;
	project_id: string | null;
	pibo_session_id: string | null;
	workflow_run_id: string | null;
	status: WorkflowLifecycleEventRecord["status"] | null;
	validation_json: string | null;
	diagnostics_json: string;
	payload_json: string | null;
	created_at: string;
};

export class ChatWorkflowDraftStore {
	constructor(private readonly dataStore: PiboDataStore) {
		rebuildWorkflowTableWithoutOwnerScope(this.dataStore.db, WORKFLOW_UI_DRAFTS_OWNERLESS_TABLE);
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_ui_drafts (
				draft_id TEXT PRIMARY KEY,
				workflow_id TEXT NOT NULL,
				source TEXT NOT NULL,
				status TEXT NOT NULL,
				base_workflow_id TEXT,
				base_workflow_version TEXT,
				base_definition_hash TEXT,
				target_workflow_version TEXT,
				version_intent TEXT NOT NULL,
				definition_json TEXT NOT NULL,
				diagnostics_json TEXT NOT NULL,
				validation_json TEXT,
				validation_state TEXT NOT NULL,
				revision INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_ui_drafts_one_active
				ON workflow_ui_drafts(workflow_id)
				WHERE status = 'draft';
			CREATE INDEX IF NOT EXISTS idx_workflow_ui_drafts_updated
				ON workflow_ui_drafts(updated_at, draft_id);
		`);
	}

	getDraft(draftId: string): WorkflowDraftRecord | undefined {
		const row = this.dataStore.db.prepare("SELECT * FROM workflow_ui_drafts WHERE draft_id = ?").get(draftId) as WorkflowDraftStoreRow | undefined;
		return row ? workflowDraftFromStoreRow(row) : undefined;
	}

	findActiveDraftByWorkflowId(workflowId: string): WorkflowDraftRecord | undefined {
		const row = this.dataStore.db
			.prepare("SELECT * FROM workflow_ui_drafts WHERE workflow_id = ? AND status = 'draft' ORDER BY updated_at DESC, draft_id ASC LIMIT 1")
			.get(workflowId) as WorkflowDraftStoreRow | undefined;
		return row ? workflowDraftFromStoreRow(row) : undefined;
	}

	listDrafts(filter: { workflowId?: string } = {}): WorkflowDraftRecord[] {
		const rows = filter.workflowId
			? this.dataStore.db
				.prepare("SELECT * FROM workflow_ui_drafts WHERE workflow_id = ? ORDER BY updated_at DESC, draft_id ASC")
				.all(filter.workflowId) as WorkflowDraftStoreRow[]
			: this.dataStore.db
				.prepare("SELECT * FROM workflow_ui_drafts ORDER BY workflow_id ASC, updated_at DESC, draft_id ASC")
				.all() as WorkflowDraftStoreRow[];
		return rows.map(workflowDraftFromStoreRow);
	}

	saveDraft(record: WorkflowDraftRecord): void {
		this.dataStore.transaction(() => {
			const conflict = this.dataStore.db
				.prepare("SELECT draft_id FROM workflow_ui_drafts WHERE workflow_id = ? AND status = 'draft' AND draft_id <> ? LIMIT 1")
				.get(record.workflowId, record.draftId) as { draft_id: string } | undefined;
			if (conflict) {
				throw new PiboWebHttpError(`Workflow '${record.workflowId}' already has an active draft '${conflict.draft_id}'`, 409);
			}

			this.dataStore.db.prepare(`
				INSERT INTO workflow_ui_drafts (
					draft_id,
					workflow_id,
					source,
					status,
					base_workflow_id,
					base_workflow_version,
					base_definition_hash,
					target_workflow_version,
					version_intent,
					definition_json,
					diagnostics_json,
					validation_json,
					validation_state,
					revision,
					created_at,
					updated_at
				) VALUES (${Array.from({ length: 16 }, () => "?").join(", ")})
				ON CONFLICT(draft_id) DO UPDATE SET
					workflow_id = excluded.workflow_id,
					source = excluded.source,
					status = excluded.status,
					base_workflow_id = excluded.base_workflow_id,
					base_workflow_version = excluded.base_workflow_version,
					base_definition_hash = excluded.base_definition_hash,
					target_workflow_version = excluded.target_workflow_version,
					version_intent = excluded.version_intent,
					definition_json = excluded.definition_json,
					diagnostics_json = excluded.diagnostics_json,
					validation_json = excluded.validation_json,
					validation_state = excluded.validation_state,
					revision = excluded.revision,
					created_at = excluded.created_at,
					updated_at = excluded.updated_at
			`).run(
				record.draftId,
				record.workflowId,
				record.source,
				record.status,
				record.baseWorkflowId ?? null,
				record.baseWorkflowVersion ?? null,
				record.baseDefinitionHash ?? null,
				record.targetWorkflowVersion ?? null,
				record.versionIntent,
				JSON.stringify(record.definition),
				JSON.stringify(sanitizeWorkflowDiagnostics(record.diagnostics)),
				record.validation ? JSON.stringify(record.validation) : null,
				record.validationState,
				record.revision,
				record.createdAt,
				record.updatedAt,
			);
		});
	}
}

function workflowDraftFromStoreRow(row: WorkflowDraftStoreRow): WorkflowDraftRecord {
	return {
		draftId: row.draft_id,
		workflowId: row.workflow_id,
		source: row.source,
		status: row.status,
		...(row.base_workflow_id ? { baseWorkflowId: row.base_workflow_id } : {}),
		...(row.base_workflow_version ? { baseWorkflowVersion: row.base_workflow_version } : {}),
		...(row.base_definition_hash ? { baseDefinitionHash: row.base_definition_hash } : {}),
		...(row.target_workflow_version ? { targetWorkflowVersion: row.target_workflow_version } : {}),
		versionIntent: row.version_intent,
		definition: JSON.parse(row.definition_json) as PiboJsonObject,
		diagnostics: sanitizeWorkflowDiagnostics(JSON.parse(row.diagnostics_json)),
		...(row.validation_json ? { validation: JSON.parse(row.validation_json) as WorkflowValidationSummary } : {}),
		validationState: row.validation_state,
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}


export class ChatWorkflowPublishedVersionStore {
	constructor(private readonly dataStore: PiboDataStore) {
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_published_versions (
				workflow_id TEXT NOT NULL,
				version TEXT NOT NULL,
				source TEXT NOT NULL,
				status TEXT NOT NULL,
				definition_hash TEXT NOT NULL,
				definition_json TEXT NOT NULL,
				published_from_draft_id TEXT,
				published_by TEXT,
				published_at TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (workflow_id, version)
			);

			CREATE INDEX IF NOT EXISTS idx_workflow_published_versions_workflow
				ON workflow_published_versions(workflow_id, version);
			CREATE INDEX IF NOT EXISTS idx_workflow_published_versions_published_at
				ON workflow_published_versions(published_at);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_published_versions_draft
				ON workflow_published_versions(published_from_draft_id)
				WHERE published_from_draft_id IS NOT NULL;
		`);
	}

	getPublishedVersionByDraftId(draftId: string): WorkflowPublishedVersionRecord | undefined {
		const row = this.dataStore.db
			.prepare("SELECT * FROM workflow_published_versions WHERE published_from_draft_id = ? ORDER BY published_at ASC LIMIT 1")
			.get(draftId) as WorkflowPublishedVersionStoreRow | undefined;
		return row ? workflowPublishedVersionFromStoreRow(row) : undefined;
	}

	listPublishedVersions(filter: { workflowId?: string } = {}): WorkflowPublishedVersionRecord[] {
		const rows = filter.workflowId
			? this.dataStore.db
				.prepare("SELECT * FROM workflow_published_versions WHERE workflow_id = ? ORDER BY workflow_id ASC, version ASC")
				.all(filter.workflowId) as WorkflowPublishedVersionStoreRow[]
			: this.dataStore.db
				.prepare("SELECT * FROM workflow_published_versions ORDER BY workflow_id ASC, version ASC")
				.all() as WorkflowPublishedVersionStoreRow[];
		return rows.map(workflowPublishedVersionFromStoreRow);
	}

	publishDraft(input: {
		draft: WorkflowDraftRecord;
		versionIntent: "patch" | "minor" | "major";
		publishedBy: string;
		reservedVersions: string[];
	}): { record: WorkflowPublishedVersionRecord; alreadyPublished: boolean } {
		return this.dataStore.transaction(() => {
			const alreadyPublished = this.getPublishedVersionByDraftId(input.draft.draftId);
			if (alreadyPublished) return { record: alreadyPublished, alreadyPublished: true };

			const existingVersions = [
				...input.reservedVersions,
				...this.listPublishedVersions({ workflowId: input.draft.workflowId }).map((record) => record.version),
			];
			const version = allocateWorkflowPublishedVersion({
				draft: input.draft,
				versionIntent: input.versionIntent,
				existingVersions,
			});
			const definition = workflowDraftDefinitionForPublishedVersion(input.draft.definition, input.draft.workflowId, version);
			const now = new Date().toISOString();
			const record: WorkflowPublishedVersionRecord = {
				workflowId: input.draft.workflowId,
				version,
				source: "ui",
				status: "published",
				definition,
				definitionHash: hashWorkflowDefinitionJson(definition),
				publishedFromDraftId: input.draft.draftId,
				publishedBy: input.publishedBy,
				publishedAt: now,
				createdAt: now,
			};
			this.insertPublishedVersion(record);
			return { record, alreadyPublished: false };
		});
	}

	private insertPublishedVersion(record: WorkflowPublishedVersionRecord): void {
		this.dataStore.db.prepare(`
			INSERT INTO workflow_published_versions (
				workflow_id,
				version,
				source,
				status,
				definition_hash,
				definition_json,
				published_from_draft_id,
				published_by,
				published_at,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			record.workflowId,
			record.version,
			record.source,
			record.status,
			record.definitionHash,
			canonicalWorkflowDefinitionJson(record.definition),
			record.publishedFromDraftId ?? null,
			record.publishedBy ?? null,
			record.publishedAt,
			record.createdAt,
		);
	}
}

function workflowPublishedVersionFromStoreRow(row: WorkflowPublishedVersionStoreRow): WorkflowPublishedVersionRecord {
	return {
		workflowId: row.workflow_id,
		version: row.version,
		source: row.source,
		status: row.status,
		definitionHash: row.definition_hash,
		definition: JSON.parse(row.definition_json) as PiboJsonObject,
		...(row.published_from_draft_id ? { publishedFromDraftId: row.published_from_draft_id } : {}),
		...(row.published_by ? { publishedBy: row.published_by } : {}),
		publishedAt: row.published_at,
		createdAt: row.created_at,
	};
}

export class ChatWorkflowPromptAssetStore {
	constructor(private readonly dataStore: PiboDataStore) {
		rebuildWorkflowTableWithoutOwnerScope(this.dataStore.db, WORKFLOW_PROMPT_ASSETS_OWNERLESS_TABLE);
		rebuildWorkflowTableWithoutOwnerScope(this.dataStore.db, WORKFLOW_PROMPT_ASSET_REVISIONS_OWNERLESS_TABLE);
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_prompt_assets (
				asset_id TEXT PRIMARY KEY,
				source TEXT NOT NULL,
				display_name TEXT NOT NULL,
				description TEXT,
				active_revision_id TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS workflow_prompt_asset_revisions (
				revision_id TEXT PRIMARY KEY,
				asset_id TEXT NOT NULL,
				content_hash TEXT NOT NULL,
				markdown TEXT NOT NULL,
				created_at TEXT NOT NULL,
				created_by TEXT,
				based_on_revision_id TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_workflow_prompt_asset_revisions_asset
				ON workflow_prompt_asset_revisions(asset_id, created_at DESC);
		`);
	}

	listAssets(): WorkflowPromptAssetRecord[] {
		const rows = this.dataStore.db
			.prepare("SELECT * FROM workflow_prompt_assets ORDER BY display_name ASC, asset_id ASC")
			.all() as WorkflowPromptAssetStoreRow[];
		return rows.map(workflowPromptAssetFromStoreRow);
	}

	getAsset(assetId: string): WorkflowPromptAssetRecord | undefined {
		const row = this.dataStore.db
			.prepare("SELECT * FROM workflow_prompt_assets WHERE asset_id = ?")
			.get(assetId) as WorkflowPromptAssetStoreRow | undefined;
		return row ? workflowPromptAssetFromStoreRow(row) : undefined;
	}

	getActiveRevision(assetId: string): WorkflowPromptAssetRevisionRecord | undefined {
		const asset = this.getAsset(assetId);
		if (!asset?.activeRevisionId) return undefined;
		const row = this.dataStore.db
			.prepare("SELECT * FROM workflow_prompt_asset_revisions WHERE asset_id = ? AND revision_id = ?")
			.get(assetId, asset.activeRevisionId) as WorkflowPromptAssetRevisionStoreRow | undefined;
		return row ? workflowPromptAssetRevisionFromStoreRow(row) : undefined;
	}

	saveRevision(input: {
		assetId?: string;
		displayName: string;
		description?: string;
		markdown: string;
		actorId?: string;
	}): WorkflowPromptAssetDocument {
		return this.dataStore.transaction(() => {
			const now = new Date().toISOString();
			const assetId = input.assetId?.trim() || `ui.promptAssets.${randomUUID()}`;
			const existing = this.getAsset(assetId);
			const revisionId = `wpar_${randomUUID()}`;
			const contentHash = hashPromptAssetMarkdown(input.markdown);
			this.dataStore.db.prepare(`
				INSERT INTO workflow_prompt_assets (
					asset_id,
					source,
					display_name,
					description,
					active_revision_id,
					created_at,
					updated_at
				) VALUES (${Array.from({ length: 7 }, () => "?").join(", ")})
				ON CONFLICT(asset_id) DO UPDATE SET
					display_name = excluded.display_name,
					description = excluded.description,
					active_revision_id = excluded.active_revision_id,
					updated_at = excluded.updated_at
			`).run(
				assetId,
				"ui",
				normalizeWorkflowPromptAssetLabel(input.displayName),
				input.description?.trim() || null,
				revisionId,
				existing?.createdAt ?? now,
				now,
			);
			this.dataStore.db.prepare(`
				INSERT INTO workflow_prompt_asset_revisions (
					revision_id,
					asset_id,
					content_hash,
					markdown,
					created_at,
					created_by,
					based_on_revision_id
				) VALUES (${Array.from({ length: 7 }, () => "?").join(", ")})
			`).run(
				revisionId,
				assetId,
				contentHash,
				input.markdown,
				now,
				input.actorId ?? null,
				existing?.activeRevisionId ?? null,
			);
			const asset = this.getAsset(assetId);
			const revision = this.getActiveRevision(assetId);
			if (!asset || !revision) throw new Error(`Failed to save workflow prompt asset '${assetId}'`);
			return workflowPromptAssetDocumentFromRecords(asset, revision);
		});
	}
}

function workflowPromptAssetFromStoreRow(row: WorkflowPromptAssetStoreRow): WorkflowPromptAssetRecord {
	return {
		assetId: row.asset_id,
		source: row.source,
		displayName: row.display_name,
		...(row.description ? { description: row.description } : {}),
		...(row.active_revision_id ? { activeRevisionId: row.active_revision_id } : {}),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function workflowPromptAssetRevisionFromStoreRow(row: WorkflowPromptAssetRevisionStoreRow): WorkflowPromptAssetRevisionRecord {
	return {
		revisionId: row.revision_id,
		assetId: row.asset_id,
		contentHash: row.content_hash,
		markdown: row.markdown,
		createdAt: row.created_at,
		...(row.created_by ? { createdBy: row.created_by } : {}),
		...(row.based_on_revision_id ? { basedOnRevisionId: row.based_on_revision_id } : {}),
	};
}

export function workflowPromptAssetDocumentFromRecords(asset: WorkflowPromptAssetRecord, revision: WorkflowPromptAssetRevisionRecord): WorkflowPromptAssetDocument {
	return {
		id: asset.assetId,
		displayName: asset.displayName,
		...(asset.description ? { description: asset.description } : {}),
		source: asset.source,
		readOnly: false,
		revisionId: revision.revisionId,
		contentHash: revision.contentHash,
		markdown: revision.markdown,
		createdAt: asset.createdAt,
		updatedAt: asset.updatedAt,
	};
}

export class ChatWorkflowArchiveStore {
	constructor(private readonly dataStore: PiboDataStore) {
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_archive_states (
				workflow_id TEXT PRIMARY KEY,
				source TEXT NOT NULL,
				archived INTEGER NOT NULL,
				archived_at TEXT,
				archived_by TEXT,
				archive_reason TEXT,
				updated_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_workflow_archive_states_archived
				ON workflow_archive_states(archived, updated_at);
		`);
	}

	setWorkflowArchived(input: { workflowId: string; archivedBy: string; archiveReason?: string }): WorkflowArchiveStateRecord {
		const existing = this.getWorkflowArchiveState(input.workflowId);
		const now = new Date().toISOString();
		const archiveReason = input.archiveReason ?? existing?.archiveReason;
		const record: WorkflowArchiveStateRecord = {
			workflowId: input.workflowId,
			source: "ui",
			archived: true,
			archivedAt: existing?.archivedAt ?? now,
			archivedBy: input.archivedBy,
			...(archiveReason ? { archiveReason } : {}),
			updatedAt: now,
		};
		this.saveWorkflowArchiveState(record);
		return record;
	}

	saveWorkflowArchiveState(record: WorkflowArchiveStateRecord): void {
		this.dataStore.db.prepare(`
			INSERT INTO workflow_archive_states (
				workflow_id,
				source,
				archived,
				archived_at,
				archived_by,
				archive_reason,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(workflow_id) DO UPDATE SET
				source = excluded.source,
				archived = excluded.archived,
				archived_at = excluded.archived_at,
				archived_by = excluded.archived_by,
				archive_reason = excluded.archive_reason,
				updated_at = excluded.updated_at
		`).run(
			record.workflowId,
			record.source,
			record.archived ? 1 : 0,
			record.archivedAt ?? null,
			record.archivedBy ?? null,
			record.archiveReason ?? null,
			record.updatedAt,
		);
	}

	getWorkflowArchiveState(workflowId: string): WorkflowArchiveStateRecord | undefined {
		const row = this.dataStore.db.prepare("SELECT * FROM workflow_archive_states WHERE workflow_id = ?").get(workflowId) as WorkflowArchiveStateStoreRow | undefined;
		return row ? workflowArchiveStateFromStoreRow(row) : undefined;
	}
}

function workflowArchiveStateFromStoreRow(row: WorkflowArchiveStateStoreRow): WorkflowArchiveStateRecord {
	return {
		workflowId: row.workflow_id,
		source: row.source,
		archived: row.archived === 1,
		...(row.archived_at ? { archivedAt: row.archived_at } : {}),
		...(row.archived_by ? { archivedBy: row.archived_by } : {}),
		...(row.archive_reason ? { archiveReason: row.archive_reason } : {}),
		updatedAt: row.updated_at,
	};
}

export class ChatWorkflowTombstoneStore {
	constructor(private readonly dataStore: PiboDataStore) {
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_delete_tombstones (
				workflow_id TEXT PRIMARY KEY,
				source TEXT NOT NULL,
				deleted INTEGER NOT NULL,
				deleted_at TEXT NOT NULL,
				deleted_by TEXT NOT NULL,
				last_known_title TEXT NOT NULL,
				last_known_version TEXT,
				last_definition_hash TEXT,
				updated_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_workflow_delete_tombstones_deleted
				ON workflow_delete_tombstones(deleted, updated_at);
		`);
	}

	setWorkflowDeleted(input: {
		workflowId: string;
		deletedBy: string;
		lastKnownTitle: string;
		lastKnownVersion?: string;
		lastDefinitionHash?: string;
	}): WorkflowTombstoneRecord {
		const existing = this.getWorkflowTombstone(input.workflowId);
		const now = new Date().toISOString();
		const record: WorkflowTombstoneRecord = {
			workflowId: input.workflowId,
			source: "ui",
			deleted: true,
			deletedAt: existing?.deletedAt ?? now,
			deletedBy: input.deletedBy,
			lastKnownTitle: input.lastKnownTitle,
			...(input.lastKnownVersion ? { lastKnownVersion: input.lastKnownVersion } : {}),
			...(input.lastDefinitionHash ? { lastDefinitionHash: input.lastDefinitionHash } : {}),
			updatedAt: now,
		};
		this.saveWorkflowTombstone(record);
		return record;
	}

	getWorkflowTombstone(workflowId: string): WorkflowTombstoneRecord | undefined {
		const row = this.dataStore.db.prepare("SELECT * FROM workflow_delete_tombstones WHERE workflow_id = ? AND deleted = 1").get(workflowId) as WorkflowTombstoneStoreRow | undefined;
		return row ? workflowTombstoneFromStoreRow(row) : undefined;
	}

	private saveWorkflowTombstone(record: WorkflowTombstoneRecord): void {
		this.dataStore.db.prepare(`
			INSERT INTO workflow_delete_tombstones (
				workflow_id,
				source,
				deleted,
				deleted_at,
				deleted_by,
				last_known_title,
				last_known_version,
				last_definition_hash,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(workflow_id) DO UPDATE SET
				source = excluded.source,
				deleted = excluded.deleted,
				deleted_at = excluded.deleted_at,
				deleted_by = excluded.deleted_by,
				last_known_title = excluded.last_known_title,
				last_known_version = excluded.last_known_version,
				last_definition_hash = excluded.last_definition_hash,
				updated_at = excluded.updated_at
		`).run(
			record.workflowId,
			record.source,
			record.deleted ? 1 : 0,
			record.deletedAt,
			record.deletedBy,
			record.lastKnownTitle,
			record.lastKnownVersion ?? null,
			record.lastDefinitionHash ?? null,
			record.updatedAt,
		);
	}
}

function workflowTombstoneFromStoreRow(row: WorkflowTombstoneStoreRow): WorkflowTombstoneRecord {
	return {
		workflowId: row.workflow_id,
		source: row.source,
		deleted: row.deleted === 1,
		deletedAt: row.deleted_at,
		deletedBy: row.deleted_by,
		lastKnownTitle: row.last_known_title,
		...(row.last_known_version ? { lastKnownVersion: row.last_known_version } : {}),
		...(row.last_definition_hash ? { lastDefinitionHash: row.last_definition_hash } : {}),
		updatedAt: row.updated_at,
	};
}

export class ChatWorkflowLifecycleEventStore {
	constructor(private readonly dataStore: PiboDataStore) {
		rebuildWorkflowTableWithoutOwnerScope(this.dataStore.db, WORKFLOW_LIFECYCLE_EVENTS_OWNERLESS_TABLE);
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_lifecycle_events (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				actor_id TEXT,
				workflow_id TEXT,
				workflow_version TEXT,
				draft_id TEXT,
				project_id TEXT,
				pibo_session_id TEXT,
				workflow_run_id TEXT,
				status TEXT,
				validation_json TEXT,
				diagnostics_json TEXT NOT NULL,
				payload_json TEXT,
				created_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_workflow_lifecycle_events_type
				ON workflow_lifecycle_events(type, created_at);
			CREATE INDEX IF NOT EXISTS idx_workflow_lifecycle_events_workflow
				ON workflow_lifecycle_events(workflow_id, workflow_version, created_at);
			CREATE INDEX IF NOT EXISTS idx_workflow_lifecycle_events_project_session
				ON workflow_lifecycle_events(project_id, pibo_session_id, created_at);
		`);
	}

	record(input: WorkflowLifecycleEventInput): WorkflowLifecycleEventRecord {
		const event: WorkflowLifecycleEventRecord = {
			id: input.id ?? `wfle_${randomUUID()}`,
			type: input.type,
			...(input.actorId ? { actorId: input.actorId } : {}),
			...(input.workflowId ? { workflowId: input.workflowId } : {}),
			...(input.workflowVersion ? { workflowVersion: input.workflowVersion } : {}),
			...(input.draftId ? { draftId: input.draftId } : {}),
			...(input.projectId ? { projectId: input.projectId } : {}),
			...(input.piboSessionId ? { piboSessionId: input.piboSessionId } : {}),
			...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
			...(input.status ? { status: input.status } : {}),
			...(input.validation ? { validation: input.validation } : {}),
			diagnostics: sanitizeWorkflowDiagnostics(input.diagnostics ?? []),
			...(input.payload ? { payload: input.payload } : {}),
			createdAt: input.createdAt ?? new Date().toISOString(),
		};
		this.dataStore.db.prepare(`
			INSERT INTO workflow_lifecycle_events (
				id,
				type,
				actor_id,
				workflow_id,
				workflow_version,
				draft_id,
				project_id,
				pibo_session_id,
				workflow_run_id,
				status,
				validation_json,
				diagnostics_json,
				payload_json,
				created_at
			) VALUES (${Array.from({ length: 14 }, () => "?").join(", ")})
		`).run(
			event.id,
			event.type,
			event.actorId ?? null,
			event.workflowId ?? null,
			event.workflowVersion ?? null,
			event.draftId ?? null,
			event.projectId ?? null,
			event.piboSessionId ?? null,
			event.workflowRunId ?? null,
			event.status ?? null,
			event.validation ? JSON.stringify(event.validation) : null,
			JSON.stringify(event.diagnostics),
			event.payload ? JSON.stringify(event.payload) : null,
			event.createdAt,
		);
		return event;
	}

	listEvents(filter: {
		type?: string;
		workflowId?: string;
		draftId?: string;
		projectId?: string;
		piboSessionId?: string;
		workflowRunId?: string;
		limit?: number;
	}): WorkflowLifecycleEventRecord[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (filter.type) {
			clauses.push("type = ?");
			values.push(filter.type);
		}
		if (filter.workflowId) {
			clauses.push("workflow_id = ?");
			values.push(filter.workflowId);
		}
		if (filter.draftId) {
			clauses.push("draft_id = ?");
			values.push(filter.draftId);
		}
		if (filter.projectId) {
			clauses.push("project_id = ?");
			values.push(filter.projectId);
		}
		if (filter.piboSessionId) {
			clauses.push("pibo_session_id = ?");
			values.push(filter.piboSessionId);
		}
		if (filter.workflowRunId) {
			clauses.push("workflow_run_id = ?");
			values.push(filter.workflowRunId);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.dataStore.db.prepare(`
			SELECT * FROM workflow_lifecycle_events
			${where}
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		`).all(...values, filter.limit ?? 100) as WorkflowLifecycleEventStoreRow[];
		return rows.map(workflowLifecycleEventFromStoreRow);
	}
}

function workflowLifecycleEventFromStoreRow(row: WorkflowLifecycleEventStoreRow): WorkflowLifecycleEventRecord {
	return {
		id: row.id,
		type: row.type,
		...(row.actor_id ? { actorId: row.actor_id } : {}),
		...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
		...(row.workflow_version ? { workflowVersion: row.workflow_version } : {}),
		...(row.draft_id ? { draftId: row.draft_id } : {}),
		...(row.project_id ? { projectId: row.project_id } : {}),
		...(row.pibo_session_id ? { piboSessionId: row.pibo_session_id } : {}),
		...(row.workflow_run_id ? { workflowRunId: row.workflow_run_id } : {}),
		...(row.status ? { status: row.status } : {}),
		...(row.validation_json ? { validation: JSON.parse(row.validation_json) as WorkflowValidationSummary } : {}),
		diagnostics: sanitizeWorkflowDiagnostics(JSON.parse(row.diagnostics_json)),
		...(row.payload_json ? { payload: JSON.parse(row.payload_json) as PiboJsonObject } : {}),
		createdAt: row.created_at,
	};
}

type OwnerlessWorkflowTableSpec = {
	name: string;
	createSql: string;
	columns: Array<{ name: string; fallback: string }>;
};

const WORKFLOW_UI_DRAFTS_OWNERLESS_TABLE: OwnerlessWorkflowTableSpec = {
	name: "workflow_ui_drafts",
	createSql: `CREATE TABLE __pibo_ownerless_workflow_ui_drafts (
		draft_id TEXT PRIMARY KEY,
		workflow_id TEXT NOT NULL,
		source TEXT NOT NULL,
		status TEXT NOT NULL,
		base_workflow_id TEXT,
		base_workflow_version TEXT,
		base_definition_hash TEXT,
		target_workflow_version TEXT,
		version_intent TEXT NOT NULL,
		definition_json TEXT NOT NULL,
		diagnostics_json TEXT NOT NULL,
		validation_json TEXT,
		validation_state TEXT NOT NULL,
		revision INTEGER NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	columns: [
		{ name: "draft_id", fallback: "'draft_legacy_' || lower(hex(randomblob(8)))" },
		{ name: "workflow_id", fallback: "'legacy-workflow'" },
		{ name: "source", fallback: "'ui'" },
		{ name: "status", fallback: "'draft'" },
		{ name: "base_workflow_id", fallback: "NULL" },
		{ name: "base_workflow_version", fallback: "NULL" },
		{ name: "base_definition_hash", fallback: "NULL" },
		{ name: "target_workflow_version", fallback: "NULL" },
		{ name: "version_intent", fallback: "'patch'" },
		{ name: "definition_json", fallback: "'{}'" },
		{ name: "diagnostics_json", fallback: "'[]'" },
		{ name: "validation_json", fallback: "NULL" },
		{ name: "validation_state", fallback: "'unknown'" },
		{ name: "revision", fallback: "1" },
		{ name: "created_at", fallback: "CURRENT_TIMESTAMP" },
		{ name: "updated_at", fallback: "CURRENT_TIMESTAMP" },
	],
};

const WORKFLOW_PROMPT_ASSETS_OWNERLESS_TABLE: OwnerlessWorkflowTableSpec = {
	name: "workflow_prompt_assets",
	createSql: `CREATE TABLE __pibo_ownerless_workflow_prompt_assets (
		asset_id TEXT PRIMARY KEY,
		source TEXT NOT NULL,
		display_name TEXT NOT NULL,
		description TEXT,
		active_revision_id TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	columns: [
		{ name: "asset_id", fallback: "'asset_legacy_' || lower(hex(randomblob(8)))" },
		{ name: "source", fallback: "'ui'" },
		{ name: "display_name", fallback: "'Legacy Prompt Asset'" },
		{ name: "description", fallback: "NULL" },
		{ name: "active_revision_id", fallback: "NULL" },
		{ name: "created_at", fallback: "CURRENT_TIMESTAMP" },
		{ name: "updated_at", fallback: "CURRENT_TIMESTAMP" },
	],
};

const WORKFLOW_PROMPT_ASSET_REVISIONS_OWNERLESS_TABLE: OwnerlessWorkflowTableSpec = {
	name: "workflow_prompt_asset_revisions",
	createSql: `CREATE TABLE __pibo_ownerless_workflow_prompt_asset_revisions (
		revision_id TEXT PRIMARY KEY,
		asset_id TEXT NOT NULL,
		content_hash TEXT NOT NULL,
		markdown TEXT NOT NULL,
		created_at TEXT NOT NULL,
		created_by TEXT,
		based_on_revision_id TEXT
	);`,
	columns: [
		{ name: "revision_id", fallback: "'rev_legacy_' || lower(hex(randomblob(8)))" },
		{ name: "asset_id", fallback: "'asset_legacy'" },
		{ name: "content_hash", fallback: "'sha256:legacy'" },
		{ name: "markdown", fallback: "''" },
		{ name: "created_at", fallback: "CURRENT_TIMESTAMP" },
		{ name: "created_by", fallback: "NULL" },
		{ name: "based_on_revision_id", fallback: "NULL" },
	],
};

const WORKFLOW_LIFECYCLE_EVENTS_OWNERLESS_TABLE: OwnerlessWorkflowTableSpec = {
	name: "workflow_lifecycle_events",
	createSql: `CREATE TABLE __pibo_ownerless_workflow_lifecycle_events (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		actor_id TEXT,
		workflow_id TEXT,
		workflow_version TEXT,
		draft_id TEXT,
		project_id TEXT,
		pibo_session_id TEXT,
		workflow_run_id TEXT,
		status TEXT,
		validation_json TEXT,
		diagnostics_json TEXT NOT NULL,
		payload_json TEXT,
		created_at TEXT NOT NULL
	);`,
	columns: [
		{ name: "id", fallback: "'wfle_legacy_' || lower(hex(randomblob(8)))" },
		{ name: "type", fallback: "'workflow.draft.saved'" },
		{ name: "actor_id", fallback: "NULL" },
		{ name: "workflow_id", fallback: "NULL" },
		{ name: "workflow_version", fallback: "NULL" },
		{ name: "draft_id", fallback: "NULL" },
		{ name: "project_id", fallback: "NULL" },
		{ name: "pibo_session_id", fallback: "NULL" },
		{ name: "workflow_run_id", fallback: "NULL" },
		{ name: "status", fallback: "NULL" },
		{ name: "validation_json", fallback: "NULL" },
		{ name: "diagnostics_json", fallback: "'[]'" },
		{ name: "payload_json", fallback: "NULL" },
		{ name: "created_at", fallback: "CURRENT_TIMESTAMP" },
	],
};

function rebuildWorkflowTableWithoutOwnerScope(db: DatabaseSync, spec: OwnerlessWorkflowTableSpec): void {
	if (!workflowTableHasOwnerScope(db, spec.name)) return;
	const columns = new Set((db.prepare(`PRAGMA table_info(${quoteIdentifier(spec.name)})`).all() as Array<{ name: string }>).map((column) => column.name));
	const columnNames = spec.columns.map((column) => quoteIdentifier(column.name)).join(", ");
	const selectColumns = spec.columns.map((column) => workflowColumnSelect(columns, column.name, column.fallback)).join(", ");
	const legacyTable = `__pibo_legacy_${spec.name}_owner_scope`;
	const ownerlessTable = `__pibo_ownerless_${spec.name}`;
	db.exec(`
		BEGIN IMMEDIATE;
		ALTER TABLE ${quoteIdentifier(spec.name)} RENAME TO ${quoteIdentifier(legacyTable)};
		${spec.createSql}
		INSERT INTO ${quoteIdentifier(ownerlessTable)} (${columnNames})
			SELECT ${selectColumns} FROM ${quoteIdentifier(legacyTable)};
		DROP TABLE ${quoteIdentifier(legacyTable)};
		ALTER TABLE ${quoteIdentifier(ownerlessTable)} RENAME TO ${quoteIdentifier(spec.name)};
		COMMIT;
	`);
}

function workflowTableHasOwnerScope(db: DatabaseSync, tableName: string): boolean {
	const table = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { found: number } | undefined;
	if (!table) return false;
	return (db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>).some((column) => column.name === "owner_scope");
}

function workflowColumnSelect(columns: Set<string>, columnName: string, fallback: string): string {
	return columns.has(columnName) ? quoteIdentifier(columnName) : `${fallback} AS ${quoteIdentifier(columnName)}`;
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
