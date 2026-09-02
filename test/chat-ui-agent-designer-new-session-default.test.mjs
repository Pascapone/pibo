import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("src/apps/chat-ui/src/App.tsx", "utf8");
const agentsViewSource = readFileSync("src/apps/chat-ui/src/agents/AgentsView.tsx", "utf8");

test("Agent Designer keeps browsing and explicit session creation separate from the new-session default", () => {
	assert.doesNotMatch(agentsViewSource, /\bonSelectRef\b|\bonSelect:\s*\(profile: string\)/);
	assert.doesNotMatch(appSource, /<AgentsView[\s\S]{0,500}onSelect=\{setPreferredNewSessionProfile\}/);
	assert.match(agentsViewSource, /onClick=[^\n]+onCreateSession\(draft\.profileName\)[^\n]+title="New Session With Agent"/);
	assert.doesNotMatch(agentsViewSource, /onCreateSession\([^)]*\);[\s\S]{0,120}writeStoredNewSessionProfile/);
});

test("only the Sessions new-session dropdown updates the persisted profile preference", () => {
	assert.match(appSource, /const setPreferredNewSessionProfile = useCallback\([\s\S]{0,500}writeStoredNewSessionProfile\(profile, roomId\)/);
	assert.equal(appSource.match(/onNewSessionProfileChange=\{setPreferredNewSessionProfile\}/g)?.length, 2);
	assert.equal(appSource.match(/setPreferredNewSessionProfile/g)?.length, 3);
});
