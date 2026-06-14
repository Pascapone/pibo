import { readFileSync, existsSync } from "node:fs";

/**
 * WSL (Windows Subsystem for Linux) detection helpers.
 *
 * Pibo is a Linux-first tool. Native Windows is not supported, but Pibo runs
 * unmodified inside WSL2 because WSL2 is a real Linux kernel. These helpers
 * let setup, doctor, and CLI commands detect WSL and surface platform-specific
 * guidance (e.g. "running in WSL" vs "this is native Windows, install WSL").
 *
 * The detection is purely informational. Callers decide how to react; the WSL
 * helpers never throw and never spawn processes.
 */

export type WslVersion = 1 | 2;

export type WslInfo = {
	/** True if the current process is running inside any WSL distribution. */
	isWsl: boolean;
	/** WSL major version when detectable, otherwise undefined. */
	version: WslVersion | undefined;
	/** Human-readable distro name (e.g. "Ubuntu", "Debian GNU/Linux"). */
	distro: string | undefined;
	/** True when /mnt/c (or another Windows drive) is reachable, useful for path guidance. */
	hasWindowsMount: boolean;
};

/**
 * Pure parser for the WSL release string.
 *
 * WSL2 kernels report strings like:
 *   "5.15.90.1-microsoft-standard-WSL2"
 *   "5.15.0-1054-azure-wsl2"
 * WSL1 kernels report:
 *   "4.4.0-19041-Microsoft"
 *
 * Returns true when the string looks like a WSL kernel release.
 */
export function parseWslRelease(release: string | undefined): boolean {
	if (!release) return false;
	return /\b(microsoft|wsl2?)\b/i.test(release);
}

/**
 * Pure parser that extracts the WSL major version (1 or 2) from a release string.
 * Returns undefined when the string is not WSL or the version cannot be determined.
 */
export function parseWslVersion(release: string | undefined): WslVersion | undefined {
	if (!release) return undefined;
	if (!parseWslRelease(release)) return undefined;
	// WSL2 explicitly mentions "WSL2" (with digit) in the osrelease.
	// WSL1 mentions "Microsoft" without the digit.
	if (/\bwsl2\b/i.test(release)) return 2;
	// Some WSL2 kernels do not include the literal "WSL2" token; the kernel
	// version alone is not a reliable signal because WSL1 also exists. We
	// require the WSL2 marker or the "microsoft-standard-WSL2" suffix to claim
	// WSL2; otherwise default to WSL1 when WSL is detected.
	return 1;
}

/**
 * Pure parser for /etc/os-release PRETTY_NAME. Returns undefined when the file
 * is not the standard os-release format or cannot be parsed.
 */
export function parseDistroFromOsRelease(contents: string | undefined): string | undefined {
	if (!contents) return undefined;
	const match = contents.match(/^PRETTY_NAME=(.+)$/m);
	if (!match) return undefined;
	const raw = match[1]?.trim();
	if (!raw) return undefined;
	const unquoted = raw.replace(/^["']|["']$/g, "");
	return unquoted.length > 0 ? unquoted : undefined;
}

function readProcOsRelease(): string | undefined {
	try {
		return readFileSync("/proc/sys/kernel/osrelease", "utf8");
	} catch {
		return undefined;
	}
}

function readEtcOsRelease(): string | undefined {
	try {
		return readFileSync("/etc/os-release", "utf8");
	} catch {
		return undefined;
	}
}

function detectWindowsMount(): boolean {
	return existsSync("/mnt/c") || existsSync("/mnt/wsl");
}

/**
 * Detect whether the current process is running inside a WSL distribution.
 * Returns true on WSL1 and WSL2.
 */
export function isWsl(): boolean {
	return parseWslRelease(readProcOsRelease());
}

/**
 * Return structured WSL information for the current process. Safe to call on
 * any platform; non-WSL hosts return { isWsl: false, version: undefined, ... }.
 */
export function getWslInfo(): WslInfo {
	const release = readProcOsRelease();
	const isWslResult = parseWslRelease(release);
	if (!isWslResult) {
		return {
			isWsl: false,
			version: undefined,
			distro: undefined,
			hasWindowsMount: false,
		};
	}
	return {
		isWsl: true,
		version: parseWslVersion(release),
		distro: parseDistroFromOsRelease(readEtcOsRelease()),
		hasWindowsMount: detectWindowsMount(),
	};
}
