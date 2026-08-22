import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { protectPrivateDirectorySync } from "./private-path.js";

export function getPiboHome(): string {
	return process.env.PIBO_HOME || join(homedir(), ".pibo");
}

export function piboHomePath(...segments: string[]): string {
	return join(getPiboHome(), ...segments);
}

export function ensurePrivatePiboHome(path = getPiboHome()): string {
	const resolvedPath = resolve(path);
	if (existsSync(resolvedPath) && !statSync(resolvedPath).isDirectory()) {
		throw new Error(`Pibo Home must be a directory: ${resolvedPath}`);
	}
	mkdirSync(resolvedPath, { recursive: true, mode: 0o700 });
	protectPrivateDirectorySync(resolvedPath);
	return resolvedPath;
}

export function ensurePrivatePiboHomeForPath(path: string): boolean {
	if (path === ":memory:") return false;
	const home = resolve(getPiboHome());
	const target = resolve(path);
	const relativePath = relative(home, target);
	const outsideHome = relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
	if (outsideHome) return false;
	ensurePrivatePiboHome(home);
	return true;
}
