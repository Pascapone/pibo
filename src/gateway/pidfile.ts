import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPiboHome, piboHomePath } from "../core/pibo-home.js";

function gatewayPidPath(): string {
	return piboHomePath("gateway.pid");
}

function fallbackGatewayPidPath(): string {
	return piboHomePath("gateway-fallback.pid");
}

function legacyGatewayPidPaths(): string[] {
	try {
		const home = getPiboHome();
		return readdirSync(home)
			.filter((name) => /^gateway-\d+\.pid$/.test(name))
			.map((name) => join(home, name));
	} catch {
		return [];
	}
}

function storedPid(path: string): number | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
		return Number.isNaN(pid) ? undefined : pid;
	} catch {
		return undefined;
	}
}

function livePid(path: string): number | undefined {
	const pid = storedPid(path);
	if (pid === undefined) return undefined;
	try {
		process.kill(pid, 0);
		return pid;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EPERM") return pid;
		return undefined;
	}
}

function claimPidFile(path: string, label: string): void {
	mkdirSync(dirname(path), { recursive: true });
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			writeFileSync(path, String(process.pid), { encoding: "utf-8", flag: "wx" });
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existingPid = livePid(path);
			if (existingPid === process.pid) return;
			if (existingPid !== undefined) throw new Error(`${label} already running (PID ${existingPid})`);
			try { unlinkSync(path); } catch (unlinkError) {
				if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
			}
		}
	}
	throw new Error(`Unable to claim ${label.toLowerCase()} PID file`);
}

function clearPidFileIfOwned(path: string): void {
	try {
		if (storedPid(path) === process.pid) unlinkSync(path);
	} catch {
		// ignore
	}
}

export function readPidFile(): number | undefined {
	return livePid(gatewayPidPath()) ?? legacyGatewayPidPaths().map(livePid).find((pid) => pid !== undefined);
}

export function clearPidFile(): void {
	try {
		const path = gatewayPidPath();
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// ignore
	}
}

export function releaseGatewayPid(): void {
	clearPidFileIfOwned(gatewayPidPath());
}

export function writeGatewayPid(): void {
	const existingPid = readPidFile();
	if (existingPid !== undefined && existingPid !== process.pid) {
		throw new Error(`Gateway already running (PID ${existingPid})`);
	}
	for (const path of legacyGatewayPidPaths()) {
		if (livePid(path) !== undefined) continue;
		try { unlinkSync(path); } catch {}
	}
	claimPidFile(gatewayPidPath(), "Gateway");
}

export function readFallbackPidFile(): number | undefined {
	return livePid(fallbackGatewayPidPath());
}

export function clearFallbackPidFile(): void {
	try {
		const path = fallbackGatewayPidPath();
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// ignore
	}
}

export function releaseFallbackGatewayPid(): void {
	clearPidFileIfOwned(fallbackGatewayPidPath());
}

export function writeFallbackGatewayPid(): void {
	claimPidFile(fallbackGatewayPidPath(), "Fallback gateway");
}
