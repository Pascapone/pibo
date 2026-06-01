import assert from "node:assert/strict";
import test from "node:test";
import { createCustomAgentProfileDefinition } from "../dist/apps/chat/agent-profiles.js";

test("custom agent profiles skip unknown context file references", () => {
	const profile = createCustomAgentProfileDefinition({
		id: "agent_test",
		profileName: "main-agent",
		displayName: "main-agent",
		nativeTools: [],
		skills: [],
		contextFiles: ["Codex Base Prompt", "ctx:pibo-docker-development"],
		subagents: [],
		mcpServers: [],
		piPackages: [],
		builtinTools: "default",
		builtinToolNames: ["read", "bash", "edit", "write"],
		autoContextFiles: true,
		runControl: false,
		createdAt: "2026-05-03T00:00:00.000Z",
		updatedAt: "2026-05-03T00:00:00.000Z",
	});

	const session = profile.create({
		getTool() {
			throw new Error("unexpected tool lookup");
		},
		getTools() {
			return [];
		},
		getSkill() {
			throw new Error("unexpected skill lookup");
		},
		getContextFile(key) {
			if (key === "Codex Base Prompt") return { key, path: "context/codex-base-prompt.md" };
			throw new Error(`Unknown context file "${key}"`);
		},
		getSubagent() {
			throw new Error("unexpected subagent lookup");
		},
		getSubagents() {
			return [];
		},
	});

	assert.deepEqual(session.contextFiles.map((file) => file.key), ["Codex Base Prompt"]);
});

test("custom agent profiles skip unknown skill references", () => {
	const profile = createCustomAgentProfileDefinition({
		id: "agent_test",
		profileName: "main-agent",
		displayName: "main-agent",
		nativeTools: [],
		skills: ["pi-agent-harness", "writing-clearly-and-concisely"],
		contextFiles: [],
		subagents: [],
		mcpServers: [],
		piPackages: [],
		builtinTools: "default",
		builtinToolNames: ["read", "bash", "edit", "write"],
		autoContextFiles: true,
		runControl: false,
		createdAt: "2026-05-03T00:00:00.000Z",
		updatedAt: "2026-05-03T00:00:00.000Z",
	});

	const session = profile.create({
		getTool() {
			throw new Error("unexpected tool lookup");
		},
		getTools() {
			return [];
		},
		getSkill(name) {
			if (name === "pi-agent-harness") return { name, path: "skills/builtin/pi-agent-harness/SKILL.md" };
			throw new Error(`Unknown skill "${name}"`);
		},
		getContextFile() {
			throw new Error("unexpected context file lookup");
		},
		getSubagent() {
			throw new Error("unexpected subagent lookup");
		},
		getSubagents() {
			return [];
		},
	});

	assert.deepEqual(session.skills.map((skill) => skill.name), ["pi-agent-harness"]);
});
