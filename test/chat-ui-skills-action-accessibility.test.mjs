import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/apps/chat-ui/src/settings/SettingsView.tsx"), "utf8");

test("user skill icon actions expose matching accessible names and tooltips", () => {
	assert.match(source, /title=\{`\$\{skill\.enabled \? "Disable" : "Enable"\} \$\{skill\.name\}`\}/);
	assert.match(source, /aria-label=\{`\$\{skill\.enabled \? "Disable" : "Enable"\} \$\{skill\.name\}`\}/);
	assert.match(source, /title=\{`Edit \$\{skill\.name\}`\}/);
	assert.match(source, /aria-label=\{`Edit \$\{skill\.name\}`\}/);
	assert.match(source, /title=\{`Delete \$\{skill\.name\}`\}/);
	assert.match(source, /aria-label=\{`Delete \$\{skill\.name\}`\}/);
});
