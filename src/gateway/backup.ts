import { execSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const BACKUP_DIR = join(homedir(), ".pibo", "stable");
const BACKUP_META_PATH = join(BACKUP_DIR, ".backup-meta.json");

export type BackupMeta = {
	commit: string | null;
	installedAt: string;
	sourcePath: string;
};

function getGitCommit(sourcePath: string): string | null {
	try {
		return execSync("git rev-parse HEAD", { cwd: sourcePath, encoding: "utf-8" }).trim();
	} catch {
		return null;
	}
}

function isExcludedPath(source: string, srcRoot: string): boolean {
	const rel = relative(srcRoot, source);
	return rel === "node_modules" || rel.startsWith("node_modules/") || rel === ".git" || rel.startsWith(".git/");
}

export function installBackup(sourcePath?: string): void {
	const src = sourcePath ?? process.cwd();
	if (!existsSync(join(src, "package.json"))) {
		throw new Error(`No package.json found at ${src}`);
	}

	if (existsSync(BACKUP_DIR)) {
		rmSync(BACKUP_DIR, { recursive: true, force: true });
	}
	mkdirSync(BACKUP_DIR, { recursive: true });

	cpSync(src, BACKUP_DIR, {
		recursive: true,
		filter: (source) => !isExcludedPath(source, src),
	});

	// Symlink .pibo in the backup dir so the fallback process finds config,
	// sessions, auth DB and user skills in the same location as the main gateway.
	const backupDotPibo = join(BACKUP_DIR, ".pibo");
	const realDotPibo = join(homedir(), ".pibo");
	try {
		if (existsSync(backupDotPibo)) {
			const stat = lstatSync(backupDotPibo);
			if (!stat.isSymbolicLink()) {
				rmSync(backupDotPibo, { recursive: true, force: true });
				symlinkSync(realDotPibo, backupDotPibo, "dir");
			}
		} else {
			symlinkSync(realDotPibo, backupDotPibo, "dir");
		}
	} catch {
		// ignore if symlink already exists or fails
	}

	execSync("npm install", { cwd: BACKUP_DIR, stdio: "inherit" });
	execSync("npm run build", { cwd: BACKUP_DIR, stdio: "inherit" });

	const meta: BackupMeta = {
		commit: getGitCommit(src),
		installedAt: new Date().toISOString(),
		sourcePath: src,
	};
	writeFileSync(BACKUP_META_PATH, JSON.stringify(meta, null, 2));

	console.log(`Backup installed at ${BACKUP_DIR}`);
	console.log(`  Commit: ${meta.commit ?? "unknown"}`);
	console.log(`  Installed at: ${meta.installedAt}`);
}

export function updateBackup(): void {
	const currentStatus = getBackupStatus();
	const sourcePath = currentStatus?.sourcePath ?? process.cwd();
	installBackup(sourcePath);
}

export function getBackupStatus(): BackupMeta | null {
	if (!existsSync(BACKUP_META_PATH)) return null;
	try {
		return JSON.parse(readFileSync(BACKUP_META_PATH, "utf-8")) as BackupMeta;
	} catch {
		return null;
	}
}

export function removeBackup(): void {
	if (existsSync(BACKUP_DIR)) {
		rmSync(BACKUP_DIR, { recursive: true, force: true });
	}
	console.log("Backup removed.");
}
