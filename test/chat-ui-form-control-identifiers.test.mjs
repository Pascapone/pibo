import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const normalizeLineEndings = (text) => text.replaceAll("\r\n", "\n");
const sidebarSource = normalizeLineEndings(readFileSync(resolve(here, "../src/apps/chat-ui/src/session-sidebar.tsx"), "utf8"));
const composerSource = normalizeLineEndings(readFileSync(resolve(here, "../src/apps/chat-ui/src/composer/Composer.tsx"), "utf8"));

test("visible Chat Web form controls have stable unique identifiers", () => {
	assert.match(sidebarSource, /<select\n\s+id="new-session-agent-select"\n\s+value=\{newSessionProfile\}/);
	assert.match(composerSource, /<textarea\n\s+id="message-composer-input"\n\s+ref=\{inputRef\}/);
});
