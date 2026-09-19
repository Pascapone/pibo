import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/App.tsx"), "utf8");
const sidebarSource = readFileSync(resolve(here, "../src/apps/chat-ui/src/session-sidebar.tsx"), "utf8");

test("Sessions new-agent preference is restored and persisted by room", () => {
	assert.match(appSource, /const roomId = bootstrap\.selectedRoomId/);
	assert.match(appSource, /readStoredNewSessionProfile\(roomId\)/);
	assert.match(appSource, /roomId\.startsWith\("optimistic-room-"\)/);
	assert.match(appSource, /const legacyProfile = storedProfile \? "" : readStoredNewSessionProfile\(\)/);
	assert.match(appSource, /writeStoredNewSessionProfile\(nextProfile, roomId\)/);
	assert.match(appSource, /writeStoredNewSessionProfile\(profile, roomId\)/);
	assert.doesNotMatch(appSource, /useState\(readStoredNewSessionProfile\)/);
	assert.match(appSource, /removeStoredNewSessionProfile\(tempId\)/);
	assert.match(sidebarSource, /disabled: !newSessionProfileReady \|\| !newSessionProfileOptions\.length \|\| creatingSession \|\| creatingRoom \|\| isArchivedRoom\(room\) \|\| roomSessionsLoading,/);
	assert.match(sidebarSource, /label=\{`New session in \$\{room\.name\}`\}/);
	assert.match(sidebarSource, /agent\.name === sessionActions\.defaultProfile \? <Check/);
	assert.match(sidebarSource, /sessionActions\.onNewSessionProfileChange\(agent\.name, room\.id\);/);
	assert.match(sidebarSource, /void sessionActions\.onCreateSession\(room\.id, agent\.name\);/);
});
