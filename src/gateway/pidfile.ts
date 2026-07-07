import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { piboHomePath } from "../core/pibo-home.js";

function gatewayPidPath(port?: number): string {
	return piboHomePath(port === undefined ? "gateway.pid" : `gateway-${port}.pid`);
}

function fallbackGatewayPidPath(): string {
	return piboHomePath("gateway-fallback.pid");
}

export function readPidFile(port?: number): number | undefined {
	try {
		const path = gatewayPidPath(port);
		if (!existsSync(path)) return undefined;
		const pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
		if (Number.isNaN(pid)) return undefined;
		try {
			process.kill(pid, 0);
			return pid;
		} catch {
			return undefined;
		}
	} catch {
		return undefined;
	}
}

export function clearPidFile(port?: number): void {
	try {
		const path = gatewayPidPath(port);
		if (existsSync(path)) {
			unlinkSync(path);
		}
	} catch {
		// ignore
	}
}

export function writeGatewayPid(port?: number): void {
	const existingPid = readPidFile(port);
	if (existingPid !== undefined && existingPid !== process.pid) {
		throw new Error(`Gateway already running (PID ${existingPid})`);
	}
	writeFileSync(gatewayPidPath(port), String(process.pid), "utf-8");
}

export function readFallbackPidFile(): number | undefined {
	try {
		const path = fallbackGatewayPidPath();
		if (!existsSync(path)) return undefined;
		const pid = parseInt(readFileSync(path, "utf-8").trim(), 10);
		if (Number.isNaN(pid)) return undefined;
		try {
			process.kill(pid, 0);
			return pid;
		} catch {
			return undefined;
		}
	} catch {
		return undefined;
	}
}

export function clearFallbackPidFile(): void {
	try {
		const path = fallbackGatewayPidPath();
		if (existsSync(path)) {
			unlinkSync(path);
		}
	} catch {
		// ignore
	}
}

export function writeFallbackGatewayPid(): void {
	const existingPid = readFallbackPidFile();
	if (existingPid !== undefined && existingPid !== process.pid) {
		throw new Error(`Fallback gateway already running (PID ${existingPid})`);
	}
	writeFileSync(fallbackGatewayPidPath(), String(process.pid), "utf-8");
}
