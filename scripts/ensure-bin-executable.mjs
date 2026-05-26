#!/usr/bin/env node
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binPaths = ["dist/bin/pibo.js", "dist/bin/rg.js"];

for (const binPath of binPaths) {
	chmodSync(join(root, binPath), 0o755);
}
