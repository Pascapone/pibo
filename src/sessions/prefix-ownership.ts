import { createHash } from "node:crypto";
import { open, lstat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureDurableDirectory, PrefixRecoveryRequiredError } from "./prefix-capsule.js";

/**
 * SQLite's OS file lock belongs to this process and is released on process death.
 * Dedicated files avoid holding a transaction in the shared session database.
 * Never unlink these files during release: replacing an inode would split owners.
 */
export class PrefixSessionOwnership {
	private constructor(private databases: DatabaseSync[]) {}

	static async acquire(root: string, identities: readonly string[]): Promise<PrefixSessionOwnership> {
		const directory = join(root, "ownership");
		await ensureDurableDirectory(directory);
		const databases: DatabaseSync[] = [];
		try {
			for (const identity of [...new Set(identities)].sort()) {
				const key = createHash("sha256").update(identity).digest("hex");
				const path = join(directory, `${key}.sqlite`);
				// Never open/close an existing SQLite inode outside SQLite: POSIX
				// close() could release another connection's process-owned lock.
				try { const file = await open(path, "wx", 0o600); await file.close(); }
				catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
				if (!(await lstat(path)).isFile()) throw new PrefixRecoveryRequiredError("ownership file changed");
				const database = new DatabaseSync(path);
				databases.push(database);
				// Fail immediately on contention. No timers, heartbeat writes or polling.
				database.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;");
			}
			return new PrefixSessionOwnership(databases);
		} catch (error) {
			for (const database of databases.reverse()) database.close();
			if (error instanceof PrefixRecoveryRequiredError) throw error;
			throw new PrefixRecoveryRequiredError("protected session ownership is unavailable or already held by another runtime");
		}
	}

	release(): void {
		for (const database of this.databases.splice(0).reverse()) database.close();
	}
}
