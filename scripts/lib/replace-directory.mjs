import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function replaceDirectory(src, dst) {
	if (!existsSync(src)) throw new Error(`source directory not found: ${src}`);
	rmSync(dst, { recursive: true, force: true });
	copyDirectory(src, dst);
}

function copyDirectory(src, dst) {
	mkdirSync(dst, { recursive: true });
	for (const entry of readdirSync(src)) {
		const source = resolve(src, entry);
		const target = resolve(dst, entry);
		if (statSync(source).isDirectory()) copyDirectory(source, target);
		else copyFileSync(source, target);
	}
}
