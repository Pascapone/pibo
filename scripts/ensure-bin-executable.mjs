#!/usr/bin/env node
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const binPath = join(root, "dist/bin/pibo.js");

chmodSync(binPath, 0o755);
