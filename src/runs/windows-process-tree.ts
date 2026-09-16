import { execFile } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type WindowsProcessIdentity = {
	msysPid: number;
	windowsPid: number;
};

type WindowsProcessRow = WindowsProcessIdentity & {
	parentMsysPid: number;
	processGroupId: number;
};

export function windowsProcessTreeCommand(command: string, pidPath: string): string {
	const portablePidPath = pidPath.replaceAll("\\", "/");
	return [
		"__pibo_win_pid=\"$(ps -W | awk -v p=$$ 'NR > 1 && $1 == p { print $4; exit }')\"",
		"if [ -z \"$__pibo_win_pid\" ]; then printf '%s\\n' 'Pibo could not identify the Windows Bash process.' >&2; exit 125; fi",
		`printf '%s %s' "$$" "$__pibo_win_pid" > ${bashSingleQuote(portablePidPath)}`,
		"unset __pibo_win_pid",
		command,
	].join("\n");
}

export async function terminateWindowsProcessTree(pidPath: string): Promise<void> {
	const identity = await waitForWindowsProcessIdentity(pidPath);
	if (!identity) return;
	try {
		const rows = await listWindowsProcessTree(identity.msysPid);
		for (const row of rows) {
			try {
				process.kill(row.windowsPid, "SIGKILL");
			} catch {
				// The process may have exited between the snapshot and termination.
			}
		}
		for (let attempt = 0; attempt < 100 && processIsAlive(identity.windowsPid); attempt += 1) {
			await new Promise((resolveWait) => setTimeout(resolveWait, 25));
		}
		if (processIsAlive(identity.windowsPid)) {
			throw new Error(`Windows yielded-run process tree rooted at PID ${identity.windowsPid} is still active after termination.`);
		}
	} finally {
		removeWindowsProcessIdentity(pidPath);
	}
}

async function waitForWindowsProcessIdentity(pidPath: string): Promise<WindowsProcessIdentity | undefined> {
	for (let attempt = 0; attempt < 80; attempt += 1) {
		try {
			const match = readFileSync(pidPath, "utf8").trim().match(/^([1-9]\d*)\s+([1-9]\d*)$/);
			if (match) return { msysPid: Number(match[1]), windowsPid: Number(match[2]) };
		} catch {
			// The Bash wrapper may still be starting.
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	return undefined;
}

async function listWindowsProcessTree(rootMsysPid: number): Promise<WindowsProcessRow[]> {
	const { stdout } = await execFileAsync(windowsBashExecutable(), ["-lc", "ps -W"], {
		encoding: "utf8",
		timeout: 5_000,
		windowsHide: true,
	});
	return parseWindowsProcessTreeSnapshot(stdout, rootMsysPid);
}

export function parseWindowsProcessTreeSnapshot(stdout: string, rootMsysPid: number): WindowsProcessRow[] {
	const rows = stdout.split(/\r?\n/).flatMap((line) => {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 4 || !fields.slice(0, 4).every((field) => /^\d+$/.test(field))) return [];
		return [{
			msysPid: Number(fields[0]),
			parentMsysPid: Number(fields[1]),
			processGroupId: Number(fields[2]),
			windowsPid: Number(fields[3]),
		}];
	});
	const selected = new Set<number>([rootMsysPid]);
	for (let changed = true; changed;) {
		changed = false;
		for (const row of rows) {
			if (selected.has(row.msysPid)) continue;
			if (row.processGroupId === rootMsysPid || selected.has(row.parentMsysPid)) {
				selected.add(row.msysPid);
				changed = true;
			}
		}
	}
	const byPid = new Map(rows.map((row) => [row.msysPid, row]));
	return rows
		.filter((row) => selected.has(row.msysPid) && row.windowsPid > 0)
		.sort((left, right) => processTreeDepth(right, byPid) - processTreeDepth(left, byPid));
}

function processTreeDepth(row: WindowsProcessRow, byPid: ReadonlyMap<number, WindowsProcessRow>): number {
	let depth = 0;
	let current = row;
	const seen = new Set<number>();
	while (!seen.has(current.msysPid)) {
		seen.add(current.msysPid);
		const parent = byPid.get(current.parentMsysPid);
		if (!parent) break;
		depth += 1;
		current = parent;
	}
	return depth;
}

function windowsBashExecutable(): string {
	const candidates = [
		process.env.ProgramFiles ? join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : undefined,
		process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"]!, "Git", "bin", "bash.exe") : undefined,
	].filter((candidate): candidate is string => Boolean(candidate));
	return candidates.find((candidate) => existsSync(candidate)) ?? "bash.exe";
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function removeWindowsProcessIdentity(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Best-effort transient process metadata cleanup.
	}
}

function bashSingleQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}
