import type { DatabaseSync } from "node:sqlite";
import { redactSensitiveText } from "../core/sensitive-data-redaction.js";

import type { PluginJsonValue, PluginRevision, PluginInstallation as SdkPluginInstallation, PluginConfigurationTarget, PluginConfigurationSnapshot, PluginSessionTabset } from "./manifest.js";
import type { EffectivePluginPlan } from "./contributions.js";
export type PluginJson = PluginJsonValue;
export class PluginValidationError extends Error {
	readonly code: string = "invalid-plugin-input";
}
export class PluginConflictError extends Error {
	readonly code = "revision-conflict";
	constructor(message = "Plugin state changed; read the current revision and retry") { super(message); }
}
export type PluginArtifact = PluginRevision;
export type StoredPluginInstallation = SdkPluginInstallation & { pendingArtifact?: PluginArtifact; diagnostic?: string; updatedAt: string };
export type PluginConfigTarget = PluginConfigurationTarget;
export type PluginConfiguration = PluginConfigurationSnapshot;
export type PluginTabset = PluginSessionTabset;
export interface PluginGenerationSnapshot {
	piboSessionId: string;
	generationId: string;
	plan: EffectivePluginPlan;
	createdAt: string;
}
export interface PluginBuildSnapshot {
	piboSessionId: string;
	generationId: string;
	snapshotId: string;
	kind: "actual" | "preview";
	data: unknown;
	createdAt: string;
}
/** Admission reservation, not a copy of the product session. Released only after runtime cleanup. */
export interface PluginGenerationAdmission {
	piboSessionId: string;
	generationId: string;
	revision: number;
	state: "reserved" | "released";
	plugins: { pluginId: string; revision: string }[];
	createdAt: string;
}
export interface PluginPersistedOperation {
	id: string;
	pluginId: string;
	revision: number;
	state: string;
	[key: string]: unknown;
}
export interface PluginJournalRecord {
	id: string;
	revision: number;
	state: string;
	[key: string]: unknown;
}

/** Canonical finite JSON; value-bearing config/snapshot writes also reject credential literals. */
export function pluginJson(value: unknown, secretValues = false): string {
	const ancestors = new Set<object>();
	function visit(input: unknown, key = ""): unknown {
		if (secretValues && /^(password|secret|token|apiKey|api_key|authorization|accessToken|refreshToken)$/i.test(key) && input !== null && input !== "") {
			if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || typeof (input as { secretRef?: unknown }).secretRef !== "string") throw new PluginValidationError(`Use a secretRef instead of a literal ${key}`);
		}
		if (secretValues && typeof input === "string" && redactSensitiveText(input) !== input) throw new PluginValidationError("Secret-like snapshot/configuration text must be redacted or referenced before persistence");
		if (input === null || typeof input === "boolean" || typeof input === "string") return input;
		if (typeof input === "number" && Number.isFinite(input)) return input;
		if (typeof input !== "object" || !input || ancestors.has(input)) throw new PluginValidationError("Expected finite, acyclic JSON");
		ancestors.add(input);
		let result: unknown;
		if (Array.isArray(input)) result = input.map((item) => visit(item));
		else {
			if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new PluginValidationError("Expected plain JSON object");
			result = Object.fromEntries(Object.keys(input).sort().filter((name) => (input as Record<string, unknown>)[name] !== undefined).map((name) => [name, visit((input as Record<string, unknown>)[name], name)]));
		}
		ancestors.delete(input);
		return result;
	}
	return JSON.stringify(visit(value));
}
export function pluginErrorMessage(error: unknown, fallback: string): string {
	return redactSensitiveText(error instanceof Error ? error.message : fallback).slice(0, 2000);
}
function nonempty(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new PluginValidationError(`Invalid ${label}`);
}
function revision(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new PluginValidationError("Expected a nonnegative integer revision");
}
function sessionId(value: unknown): asserts value is string {
	nonempty(value, "piboSessionId");
	if (!/^ps_[A-Za-z0-9_-]+$/.test(value)) throw new PluginValidationError("Expected a Pibo Session ID, not a room, profile or runtime ID");
}
export function installationArtifact(input: SdkPluginInstallation): PluginArtifact {
	return { pluginId: input.pluginId, revision: input.revision, version: input.version, contentHash: input.contentHash, source: input.source, manifest: input.manifest, artifactPath: input.artifactPath, createdAt: input.createdAt };
}
export function configTargetId(target: PluginConfigTarget): string {
	if (target.scope === "app") return "app";
	if (target.scope === "agent") return target.agentId;
	if (target.scope === "session") return target.piboSessionId;
	throw new PluginValidationError("Invalid configuration scope");
}
function decode<T>(row: unknown, column = "record_json"): T | undefined {
	return row ? JSON.parse((row as Record<string, string>)[column]!) as T : undefined;
}

export class PluginStore {
	constructor(readonly db: DatabaseSync) {}
	transaction<T>(action: () => T): T {
		if (this.db.isTransaction) return action();
		this.db.exec("BEGIN IMMEDIATE");
		try { const value = action(); this.db.exec("COMMIT"); return value; }
		catch (error) { this.db.exec("ROLLBACK"); throw error; }
	}
	listInstallations(pluginId?: string): StoredPluginInstallation[] {
		const rows = pluginId ? this.db.prepare("SELECT record_json FROM plugin_installations WHERE plugin_id = ?").all(pluginId) : this.db.prepare("SELECT record_json FROM plugin_installations ORDER BY plugin_id").all();
		return rows.map((row) => decode<StoredPluginInstallation>(row)!);
	}
	getInstallation(pluginId: string): StoredPluginInstallation | undefined {
		return decode(this.db.prepare("SELECT record_json FROM plugin_installations WHERE plugin_id = ?").get(pluginId));
	}
	putInstallation(input: StoredPluginInstallation, expectedRevision: number): StoredPluginInstallation {
		revision(expectedRevision); nonempty(input.pluginId, "pluginId");
		if (input.manifest.id !== input.pluginId || (input.pendingArtifact && input.pendingArtifact.pluginId !== input.pluginId)) throw new PluginValidationError("Artifact identity mismatch");
		if (!["staged", "installed", "active", "pending-activation", "retiring", "failed", "uninstalled"].includes(input.state)) throw new PluginValidationError("Invalid installation state");
		return this.transaction(() => {
			if ((this.getInstallation(input.pluginId)?.stateRevision ?? 0) !== expectedRevision) throw new PluginConflictError();
			this.putArtifact(installationArtifact(input));
			if (input.pendingArtifact) this.putArtifact(input.pendingArtifact);
			const value: StoredPluginInstallation = { ...input, stateRevision: expectedRevision + 1 };
			this.db.prepare("INSERT INTO plugin_installations VALUES (?, ?, ?, ?, ?) ON CONFLICT(plugin_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,record_json=excluded.record_json,updated_at=excluded.updated_at").run(value.pluginId, value.stateRevision, value.state, pluginJson(value), value.updatedAt);
			return value;
		});
	}
	putArtifact(artifact: PluginArtifact): void {
		const existing = this.db.prepare("SELECT record_json FROM plugin_artifacts WHERE plugin_id=? AND content_hash=?").get(artifact.pluginId, artifact.contentHash);
		const text = pluginJson(artifact);
		// Source provenance may differ when exactly the same package is reinstalled locally or from an archive.
		if (existing) {
			const previous = decode<PluginArtifact>(existing)!;
			if (pluginJson({ ...previous, source: artifact.source, createdAt: artifact.createdAt }) !== text) throw new PluginConflictError("Immutable artifact changed");
			return;
		}
		this.db.prepare("INSERT INTO plugin_artifacts VALUES (?, ?, ?)").run(artifact.pluginId, artifact.contentHash, text);
	}
	getArtifact(pluginId: string, contentHash: string): PluginArtifact | undefined {
		return decode(this.db.prepare("SELECT record_json FROM plugin_artifacts WHERE plugin_id=? AND content_hash=?").get(pluginId, contentHash));
	}
	getConfig(target: PluginConfigTarget): PluginConfiguration | undefined {
		const row = this.db.prepare("SELECT revision,value_json FROM plugin_configurations WHERE plugin_id=? AND scope=? AND target_id=?").get(target.pluginId, target.scope, configTargetId(target));
		return row ? JSON.parse(String(row.value_json)) : undefined;
	}
	putConfig(input: PluginConfiguration, expectedRevision: number): PluginConfiguration {
		revision(expectedRevision); const { target } = input; nonempty(target.pluginId, "pluginId");
		const targetId = configTargetId(target); nonempty(targetId, "config target");
		if (target.scope === "session") sessionId(target.piboSessionId);
		if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1 || !input.values || typeof input.values !== "object" || Array.isArray(input.values)) throw new PluginValidationError("Invalid config schema version or values object");
		const value = { ...input, revision: expectedRevision + 1 };
		const json = pluginJson(value, true);
		return this.transaction(() => {
			if ((this.getConfig(target)?.revision ?? 0) !== expectedRevision) throw new PluginConflictError();
			this.db.prepare("INSERT INTO plugin_configurations VALUES (?, ?, ?, ?, ?) ON CONFLICT(plugin_id,scope,target_id) DO UPDATE SET revision=excluded.revision,value_json=excluded.value_json").run(target.pluginId, target.scope, targetId, value.revision, json);
			return JSON.parse(json);
		});
	}
	getTabset(piboSessionId: string): PluginTabset | undefined {
		sessionId(piboSessionId);
		return decode(this.db.prepare("SELECT record_json FROM plugin_session_tabsets WHERE pibo_session_id=?").get(piboSessionId));
	}
	putTabset(input: PluginTabset, expectedRevision: number): PluginTabset {
		sessionId(input.piboSessionId); revision(expectedRevision);
		if (input.schemaVersion !== 1 || !Array.isArray(input.tabs) || input.tabs.length > 100) throw new PluginValidationError("Invalid tabset version or tab limit");
		const ids = new Set<string>();
		for (const tab of input.tabs) {
			nonempty(tab.instanceId, "tab id"); nonempty(tab.pluginId, "tab plugin"); nonempty(tab.viewId, "tab view"); nonempty(tab.pluginRevision, "tab revision");
			if (tab.piboSessionId !== input.piboSessionId || !tab.viewId.startsWith(`${tab.pluginId}/`) || ids.has(tab.instanceId) || !Number.isSafeInteger(tab.stateSchemaVersion) || tab.stateSchemaVersion < 1) throw new PluginValidationError("Duplicate, unbound or invalid tab");
			if (!tab.state || typeof tab.state !== "object" || Array.isArray(tab.state) || typeof tab.fallback !== "string") throw new PluginValidationError("Tab state/fallback is invalid");
			ids.add(tab.instanceId);
		}
		if (input.activeTabId !== null && !ids.has(input.activeTabId)) throw new PluginValidationError("Active tab is absent");
		if (!input.layout || typeof input.layout !== "object" || Array.isArray(input.layout)) throw new PluginValidationError("Tab layout must be a JSON object");
		const value = { ...input, revision: expectedRevision + 1 };
		const text = pluginJson(value, true);
		if (Buffer.byteLength(text) > 1024 * 1024) throw new PluginValidationError("Tabset exceeds 1 MiB; store payload references instead");
		return this.transaction(() => {
			if ((this.getTabset(input.piboSessionId)?.revision ?? 0) !== expectedRevision) throw new PluginConflictError();
			this.db.prepare("INSERT INTO plugin_session_tabsets VALUES (?, ?, ?) ON CONFLICT(pibo_session_id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json").run(value.piboSessionId, value.revision, text);
			return JSON.parse(text);
		});
	}
	putGenerationSnapshot(snapshot: PluginGenerationSnapshot): void {
		sessionId(snapshot.piboSessionId); nonempty(snapshot.generationId, "generationId");
		if (!snapshot.plan || snapshot.plan.schemaVersion !== 1 || snapshot.plan.kind !== "generation" || !snapshot.plan.valid || snapshot.plan.piboSessionId !== snapshot.piboSessionId || snapshot.plan.generation !== snapshot.generationId) throw new PluginValidationError("Generation snapshot requires a valid effective plan with matching session/generation identity");
		pluginJson({ selection: snapshot.plan.selection, configurations: snapshot.plan.configurations, effectiveConfigurations: snapshot.plan.contributions.map((item) => item.config) }, true);
		this.immutable("plugin_generation_snapshots", "generation_id", snapshot.piboSessionId, snapshot.generationId, snapshot,
			() => this.db.prepare("INSERT INTO plugin_generation_snapshots VALUES (?, ?, ?)").run(snapshot.piboSessionId, snapshot.generationId, pluginJson(snapshot)));
	}
	getGenerationSnapshot(piboSessionId: string, generationId: string): PluginGenerationSnapshot | undefined {
		return decode(this.db.prepare("SELECT record_json FROM plugin_generation_snapshots WHERE pibo_session_id=? AND generation_id=?").get(piboSessionId, generationId));
	}
	listGenerationSnapshots(piboSessionId: string): PluginGenerationSnapshot[] {
		return this.db.prepare("SELECT record_json FROM plugin_generation_snapshots WHERE pibo_session_id=? ORDER BY rowid").all(piboSessionId).map((row) => decode<PluginGenerationSnapshot>(row)!);
	}
	putBuildSnapshot(snapshot: PluginBuildSnapshot): void {
		sessionId(snapshot.piboSessionId); nonempty(snapshot.snapshotId, "snapshotId"); nonempty(snapshot.generationId, "generationId");
		if (snapshot.kind !== "actual" && snapshot.kind !== "preview") throw new PluginValidationError("Invalid snapshot kind");
		if (snapshot.kind === "actual" && !this.getGenerationSnapshot(snapshot.piboSessionId, snapshot.generationId)) throw new PluginValidationError("Actual build requires its persisted generation");
		pluginJson(snapshot.data, true);
		this.immutable("plugin_build_snapshots", "snapshot_id", snapshot.piboSessionId, snapshot.snapshotId, snapshot,
			() => this.db.prepare("INSERT INTO plugin_build_snapshots VALUES (?, ?, ?, ?, ?, ?)").run(snapshot.piboSessionId, snapshot.snapshotId, snapshot.generationId, snapshot.kind, snapshot.createdAt, pluginJson(snapshot)));
	}
	getBuildSnapshot(piboSessionId: string, snapshotId: string): PluginBuildSnapshot | undefined {
		return decode(this.db.prepare("SELECT record_json FROM plugin_build_snapshots WHERE pibo_session_id=? AND snapshot_id=?").get(piboSessionId, snapshotId));
	}
	listBuildSnapshots(piboSessionId: string): Omit<PluginBuildSnapshot, "data">[] {
		return this.db.prepare("SELECT snapshot_id,generation_id,kind,created_at FROM plugin_build_snapshots WHERE pibo_session_id=? ORDER BY rowid").all(piboSessionId).map((row) => ({ piboSessionId, snapshotId: String(row.snapshot_id), generationId: String(row.generation_id), kind: row.kind as "actual" | "preview", createdAt: String(row.created_at) }));
	}
	private immutable(table: string, key: string, session: string, id: string, value: unknown, insert: () => unknown): void {
		const text = pluginJson(value);
		if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new PluginValidationError("Snapshot exceeds 4 MiB; use retained payload references");
		this.transaction(() => {
			const row = this.db.prepare(`SELECT record_json FROM ${table} WHERE pibo_session_id=? AND ${key}=?`).get(session, id);
			if (row && row.record_json !== text) throw new PluginConflictError("Historical snapshot is immutable");
			if (!row) {
				const refs = new Set<string>();
				const visit = (input: unknown): void => {
					if (!input || typeof input !== "object") return;
					if (Array.isArray(input)) { input.forEach(visit); return; }
					for (const [name, child] of Object.entries(input)) {
						if (name === "payloadRef" && typeof child === "string") refs.add(child);
						else visit(child);
					}
				};
				visit(JSON.parse(text));
				for (const payloadId of refs) {
					if (!this.db.prepare("SELECT id FROM payloads WHERE id=? AND status='committed'").get(payloadId)) throw new PluginValidationError(`Snapshot references missing/uncommitted product payload: ${payloadId}`);
				}
				insert();
				for (const payloadId of refs) {
					this.db.prepare("INSERT INTO plugin_snapshot_payload_refs VALUES (?,?,?,?)").run(table, session, id, payloadId);
					this.db.prepare("UPDATE payloads SET ref_count=ref_count+1 WHERE id=?").run(payloadId);
				}
			}
		});
	}
	getAdmission(piboSessionId: string, generationId: string): PluginGenerationAdmission | undefined {
		return decode(this.db.prepare("SELECT record_json FROM plugin_generation_admissions WHERE pibo_session_id=? AND generation_id=?").get(piboSessionId, generationId));
	}
	listAdmissions(pluginId: string): PluginGenerationAdmission[] {
		return this.db.prepare("SELECT record_json FROM plugin_generation_admissions WHERE state='reserved'").all().map((row) => decode<PluginGenerationAdmission>(row)!).filter((record) => record.plugins.some((plugin) => plugin.pluginId === pluginId));
	}
	listSessionAdmissions(piboSessionId: string): PluginGenerationAdmission[] {
		sessionId(piboSessionId);
		return this.db.prepare("SELECT record_json FROM plugin_generation_admissions WHERE pibo_session_id=? AND state='reserved'").all(piboSessionId).map((row) => decode<PluginGenerationAdmission>(row)!);
	}
	putAdmission(input: PluginGenerationAdmission, expectedRevision: number): PluginGenerationAdmission {
		sessionId(input.piboSessionId); nonempty(input.generationId, "generationId"); revision(expectedRevision);
		return this.transaction(() => {
			if ((this.getAdmission(input.piboSessionId, input.generationId)?.revision ?? 0) !== expectedRevision) throw new PluginConflictError();
			const record = { ...input, revision: expectedRevision + 1 };
			this.db.prepare("INSERT INTO plugin_generation_admissions VALUES (?,?,?,?,?) ON CONFLICT(pibo_session_id,generation_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,record_json=excluded.record_json").run(record.piboSessionId, record.generationId, record.revision, record.state, pluginJson(record));
			return record;
		});
	}
	getOperation<T extends PluginPersistedOperation = PluginPersistedOperation>(id: string): T | undefined {
		return decode(this.db.prepare("SELECT record_json FROM plugin_operations WHERE id=?").get(id));
	}
	listOperations<T extends PluginPersistedOperation = PluginPersistedOperation>(): T[] {
		return this.db.prepare("SELECT record_json FROM plugin_operations ORDER BY rowid").all().map((row) => decode<T>(row)!);
	}
	putOperation<T extends PluginPersistedOperation>(input: T, expectedRevision: number): T {
		revision(expectedRevision);
		return this.transaction(() => {
			if ((this.getOperation(input.id)?.revision ?? 0) !== expectedRevision) throw new PluginConflictError();
			const value = { ...input, revision: expectedRevision + 1 };
			this.db.prepare("INSERT INTO plugin_operations VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state,record_json=excluded.record_json").run(value.id, value.pluginId, value.revision, value.state, pluginJson(value));
			return value;
		});
	}
	getJournal<T extends PluginJournalRecord>(id: string): T | undefined {
		return decode(this.db.prepare("SELECT record_json FROM plugin_migration_journal WHERE id=?").get(id));
	}
	listJournals<T extends PluginJournalRecord = PluginJournalRecord>(prefix?: string): T[] {
		const rows = prefix
			? this.db.prepare("SELECT record_json FROM plugin_migration_journal WHERE id LIKE ? ORDER BY rowid").all(`${prefix}%`)
			: this.db.prepare("SELECT record_json FROM plugin_migration_journal ORDER BY rowid").all();
		return rows.map((row) => decode<T>(row)!);
	}
	putJournal<T extends PluginJournalRecord>(input: T, expectedRevision: number): T {
		revision(expectedRevision);
		return this.transaction(() => {
			if ((this.getJournal(input.id)?.revision ?? 0) !== expectedRevision) throw new PluginConflictError();
			const value = { ...input, revision: expectedRevision + 1 };
			this.db.prepare("INSERT INTO plugin_migration_journal VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state,record_json=excluded.record_json").run(value.id, value.revision, value.state, pluginJson(value));
			return value;
		});
	}
}
