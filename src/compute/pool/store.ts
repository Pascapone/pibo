import { mkdirSync } from "node:fs";
import { chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DeploymentLeaseRecord, DeploymentLeaseStatus, DeploymentSeedMode, DeploymentSlotDefinition, DeploymentSlotRecord, DeploymentSlotState } from "./types.js";

interface SlotRow {
	id: string;
	ordinal: number;
	web_port: number;
	gateway_port: number;
	public_url: string | null;
	state: DeploymentSlotState;
	active_lease_id: string | null;
	dirty_reason: string | null;
	updated_at: string;
}

interface LeaseRow {
	id: string;
	slot_id: string;
	holder: string;
	seed_mode: DeploymentSeedMode;
	artifact_sha256: string;
	artifact_runtime_path: string;
	package_version: string | null;
	commit_sha: string | null;
	container_name: string;
	public_url: string | null;
	status: DeploymentLeaseStatus;
	created_at: string;
	expires_at: string;
	renewed_at: string | null;
	released_at: string | null;
	failed_at: string | null;
	failure_snapshot_path: string | null;
	last_error: string | null;
}

function slotFromRow(row: SlotRow): DeploymentSlotRecord {
	return {
		id: row.id,
		ordinal: row.ordinal,
		webPort: row.web_port,
		gatewayPort: row.gateway_port,
		publicUrl: row.public_url ?? undefined,
		state: row.state,
		activeLeaseId: row.active_lease_id ?? undefined,
		dirtyReason: row.dirty_reason ?? undefined,
		updatedAt: row.updated_at,
	};
}

function leaseFromRow(row: LeaseRow): DeploymentLeaseRecord {
	return {
		id: row.id,
		slotId: row.slot_id,
		holder: row.holder,
		seedMode: row.seed_mode,
		artifactSha256: row.artifact_sha256,
		artifactRuntimePath: row.artifact_runtime_path,
		packageVersion: row.package_version ?? undefined,
		commit: row.commit_sha ?? undefined,
		containerName: row.container_name,
		publicUrl: row.public_url ?? undefined,
		status: row.status,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		renewedAt: row.renewed_at ?? undefined,
		releasedAt: row.released_at ?? undefined,
		failedAt: row.failed_at ?? undefined,
		failureSnapshotPath: row.failure_snapshot_path ?? undefined,
		lastError: row.last_error ?? undefined,
	};
}

export class DeploymentPoolStore {
	readonly path: string;
	private readonly db: DatabaseSync;

	constructor(path: string, slots: DeploymentSlotDefinition[]) {
		this.path = path === ":memory:" ? path : resolve(path);
		if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
		this.db = new DatabaseSync(this.path);
		this.db.exec("PRAGMA busy_timeout = 10000");
		if (this.path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.applySchema();
		this.ensureSlots(slots);
		if (this.path !== ":memory:") chmodSync(this.path, 0o600);
	}

	private applySchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS deployment_pool_slots (
				id TEXT PRIMARY KEY,
				ordinal INTEGER NOT NULL UNIQUE,
				web_port INTEGER NOT NULL UNIQUE,
				gateway_port INTEGER NOT NULL UNIQUE,
				public_url TEXT,
				state TEXT NOT NULL,
				active_lease_id TEXT,
				dirty_reason TEXT,
				updated_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS deployment_pool_leases (
				id TEXT PRIMARY KEY,
				slot_id TEXT NOT NULL,
				holder TEXT NOT NULL,
				seed_mode TEXT NOT NULL,
				artifact_sha256 TEXT NOT NULL,
				artifact_runtime_path TEXT NOT NULL,
				package_version TEXT,
				commit_sha TEXT,
				container_name TEXT NOT NULL,
				public_url TEXT,
				status TEXT NOT NULL,
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				renewed_at TEXT,
				released_at TEXT,
				failed_at TEXT,
				failure_snapshot_path TEXT,
				last_error TEXT
			);
			CREATE INDEX IF NOT EXISTS deployment_pool_leases_status_idx
				ON deployment_pool_leases (status, expires_at);
			CREATE INDEX IF NOT EXISTS deployment_pool_leases_slot_idx
				ON deployment_pool_leases (slot_id, created_at DESC);
		`);
	}

	private ensureSlots(slots: DeploymentSlotDefinition[]): void {
		const now = new Date().toISOString();
		const insert = this.db.prepare(`
			INSERT INTO deployment_pool_slots (id, ordinal, web_port, gateway_port, public_url, state, updated_at)
			VALUES (?, ?, ?, ?, ?, 'free', ?)
			ON CONFLICT(id) DO UPDATE SET
				ordinal=excluded.ordinal,
				web_port=excluded.web_port,
				gateway_port=excluded.gateway_port,
				public_url=excluded.public_url
		`);
		for (const slot of slots) insert.run(slot.id, slot.ordinal, slot.webPort, slot.gatewayPort, slot.publicUrl ?? null, now);
	}

	listSlots(): DeploymentSlotRecord[] {
		return (this.db.prepare("SELECT * FROM deployment_pool_slots ORDER BY ordinal").all() as unknown as SlotRow[]).map(slotFromRow);
	}

	getSlot(id: string): DeploymentSlotRecord | undefined {
		const row = this.db.prepare("SELECT * FROM deployment_pool_slots WHERE id = ?").get(id) as SlotRow | undefined;
		return row ? slotFromRow(row) : undefined;
	}

	listLeases(options: { includeInactive?: boolean } = {}): DeploymentLeaseRecord[] {
		const where = options.includeInactive ? "" : "WHERE status IN ('provisioning', 'ready', 'releasing')";
		return (this.db.prepare(`SELECT * FROM deployment_pool_leases ${where} ORDER BY created_at DESC`).all() as unknown as LeaseRow[]).map(leaseFromRow);
	}

	getLease(id: string): DeploymentLeaseRecord | undefined {
		const row = this.db.prepare("SELECT * FROM deployment_pool_leases WHERE id = ?").get(id) as LeaseRow | undefined;
		return row ? leaseFromRow(row) : undefined;
	}

	reserveLease(input: {
		id: string;
		holder: string;
		seedMode: DeploymentSeedMode;
		artifactSha256: string;
		artifactRuntimePath: string;
		packageVersion?: string;
		commit?: string;
		createdAt: string;
		expiresAt: string;
		maxActive: number;
	}): { slot: DeploymentSlotRecord; lease: DeploymentLeaseRecord } {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const active = this.db.prepare("SELECT COUNT(*) AS count FROM deployment_pool_slots WHERE state IN ('provisioning', 'ready', 'releasing')").get() as { count: number };
			if (Number(active.count) >= input.maxActive) {
				const nearest = this.db.prepare(`
					SELECT MIN(l.expires_at) AS nearest_expiry
					FROM deployment_pool_slots s
					JOIN deployment_pool_leases l ON l.id = s.active_lease_id
					WHERE s.state IN ('provisioning', 'ready', 'releasing')
				`).get() as { nearest_expiry?: string | null };
				throw new Error(`Deployment pool capacity reached (${input.maxActive} active)${nearest.nearest_expiry ? `; nearest expiry ${nearest.nearest_expiry}` : ""}`);
			}
			const row = this.db.prepare("SELECT * FROM deployment_pool_slots WHERE state = 'free' ORDER BY ordinal LIMIT 1").get() as SlotRow | undefined;
			if (!row) throw new Error("No free deployment pool slot is available");
			const slot = slotFromRow(row);
			const containerName = `pibo-pool-${slot.id}`;
			this.db.prepare(`
				INSERT INTO deployment_pool_leases (
					id, slot_id, holder, seed_mode, artifact_sha256, artifact_runtime_path,
					package_version, commit_sha, container_name, public_url, status, created_at, expires_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisioning', ?, ?)
			`).run(
				input.id, slot.id, input.holder, input.seedMode, input.artifactSha256, input.artifactRuntimePath,
				input.packageVersion ?? null, input.commit ?? null, containerName, slot.publicUrl ?? null, input.createdAt, input.expiresAt,
			);
			this.db.prepare("UPDATE deployment_pool_slots SET state='provisioning', active_lease_id=?, dirty_reason=NULL, updated_at=? WHERE id=?")
				.run(input.id, input.createdAt, slot.id);
			this.db.exec("COMMIT");
			return { slot: this.getSlot(slot.id)!, lease: this.getLease(input.id)! };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	markReady(leaseId: string, now = new Date().toISOString()): DeploymentLeaseRecord {
		const lease = this.requireLease(leaseId);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.prepare("UPDATE deployment_pool_leases SET status='ready', last_error=NULL WHERE id=?").run(leaseId);
			this.db.prepare("UPDATE deployment_pool_slots SET state='ready', dirty_reason=NULL, updated_at=? WHERE id=? AND active_lease_id=?")
				.run(now, lease.slotId, leaseId);
			this.db.exec("COMMIT");
			return this.requireLease(leaseId);
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	markReleasing(leaseId: string, now = new Date().toISOString()): DeploymentLeaseRecord {
		const lease = this.requireLease(leaseId);
		this.db.prepare("UPDATE deployment_pool_leases SET status='releasing' WHERE id=? AND status IN ('provisioning','ready','releasing')").run(leaseId);
		this.db.prepare("UPDATE deployment_pool_slots SET state='releasing', updated_at=? WHERE id=? AND active_lease_id=?").run(now, lease.slotId, leaseId);
		return this.requireLease(leaseId);
	}

	markReleased(leaseId: string, status: "released" | "expired", now = new Date().toISOString()): DeploymentLeaseRecord {
		const lease = this.requireLease(leaseId);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.prepare("UPDATE deployment_pool_leases SET status=?, released_at=?, last_error=NULL WHERE id=?").run(status, now, leaseId);
			this.db.prepare("UPDATE deployment_pool_slots SET state='free', active_lease_id=NULL, dirty_reason=NULL, updated_at=? WHERE id=? AND active_lease_id=?")
				.run(now, lease.slotId, leaseId);
			this.db.exec("COMMIT");
			return this.requireLease(leaseId);
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	markFailed(leaseId: string, error: string, snapshotPath: string | undefined, options: { slotClean: boolean; now?: string } = { slotClean: false }): DeploymentLeaseRecord {
		const lease = this.requireLease(leaseId);
		const now = options.now ?? new Date().toISOString();
		this.db.exec("BEGIN IMMEDIATE");
		try {
			this.db.prepare("UPDATE deployment_pool_leases SET status='failed', failed_at=?, failure_snapshot_path=?, last_error=? WHERE id=?")
				.run(now, snapshotPath ?? null, error, leaseId);
			if (options.slotClean) {
				this.db.prepare("UPDATE deployment_pool_slots SET state='free', active_lease_id=NULL, dirty_reason=NULL, updated_at=? WHERE id=? AND active_lease_id=?")
					.run(now, lease.slotId, leaseId);
			} else {
				this.db.prepare("UPDATE deployment_pool_slots SET state='dirty', dirty_reason=?, updated_at=? WHERE id=? AND active_lease_id=?")
					.run(error, now, lease.slotId, leaseId);
			}
			this.db.exec("COMMIT");
			return this.requireLease(leaseId);
		} catch (caught) {
			this.db.exec("ROLLBACK");
			throw caught;
		}
	}

	renewLease(leaseId: string, holder: string, expiresAt: string, now = new Date().toISOString()): DeploymentLeaseRecord {
		const result = this.db.prepare(`
			UPDATE deployment_pool_leases SET expires_at=?, renewed_at=?
			WHERE id=? AND holder=? AND status='ready'
		`).run(expiresAt, now, leaseId, holder);
		if (Number(result.changes ?? 0) !== 1) throw new Error(`Active deployment lease "${leaseId}" for holder "${holder}" was not found`);
		return this.requireLease(leaseId);
	}

	freeDirtySlot(slotId: string, now = new Date().toISOString()): void {
		this.db.prepare("UPDATE deployment_pool_slots SET state='free', active_lease_id=NULL, dirty_reason=NULL, updated_at=? WHERE id=?")
			.run(now, slotId);
	}

	private requireLease(id: string): DeploymentLeaseRecord {
		const lease = this.getLease(id);
		if (!lease) throw new Error(`Deployment lease "${id}" was not found`);
		return lease;
	}

	close(): void {
		this.db.close();
	}
}
