import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadPiboModelDefaults, sanitizePiboModelDefaults, savePiboModelDefaults, selectRequestedFastMode, selectRequestedModelProfile, selectRequestedThinkingLevel } from "../dist/core/model-defaults.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";

test("model defaults persist and roundtrip", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-model-defaults-"));
	const saved = savePiboModelDefaults({
		main: { provider: "openai", id: "gpt-5.4" },
		subagent: { provider: "kimi-coding", id: "kimi-for-coding" },
		thinking: "high",
	}, cwd, "model-defaults.json");

	assert.deepEqual(saved, {
		main: { provider: "openai", id: "gpt-5.4" },
		subagent: { provider: "kimi-coding", id: "kimi-for-coding" },
		thinking: "high",
	});
	assert.deepEqual(loadPiboModelDefaults(cwd, "model-defaults.json"), saved);
});

test("model defaults sanitizer drops invalid values and preserves explicit false", () => {
	assert.deepEqual(sanitizePiboModelDefaults({
		main: { provider: " openai ", id: " gpt-5.4 " },
		subagent: { provider: "kimi-coding", id: "" },
		thinking: "medium",
		mainThinking: "invalid",
		subagentThinking: "low",
		fast: false,
		mainFast: "false",
		subagentFast: true,
		unknown: { provider: "ignored", id: "ignored" },
	}), {
		main: { provider: "openai", id: "gpt-5.4" },
		thinking: "medium",
		subagentThinking: "low",
		fast: false,
		subagentFast: true,
	});

	assert.deepEqual(sanitizePiboModelDefaults({
		main: { provider: "", id: "gpt-5.4" },
		subagent: [{ provider: "openai", id: "gpt-5.4" }],
		thinking: false,
		fast: "true",
	}), {});
});

test("model selection prefers hard pin, then role override, then defaults", () => {
	const defaults = {
		main: { provider: "openai", id: "gpt-5.4" },
		subagent: { provider: "kimi-coding", id: "kimi-for-coding" },
	};
	const mainProfile = new InitialSessionContextBuilder("main-profile").createSession();
	const childProfile = new InitialSessionContextBuilder("child-profile")
		.withParentSessionId("parent")
		.createSession();
	const overriddenMain = new InitialSessionContextBuilder("overridden-main")
		.withMainModel({ provider: "openai", id: "gpt-5.5" })
		.createSession();
	const overriddenChild = new InitialSessionContextBuilder("overridden-child")
		.withParentSessionId("parent")
		.withSubagentModel({ provider: "openai", id: "gpt-5.5-mini" })
		.createSession();
	const pinned = new InitialSessionContextBuilder("pinned")
		.withParentSessionId("parent")
		.withModel({ provider: "moonshotai", id: "kimi-k2.6" })
		.withSubagentModel({ provider: "openai", id: "gpt-5.5-mini" })
		.createSession();

	assert.deepEqual(selectRequestedModelProfile(mainProfile, defaults), defaults.main);
	assert.deepEqual(selectRequestedModelProfile(childProfile, defaults), defaults.subagent);
	assert.deepEqual(selectRequestedModelProfile(overriddenMain, defaults), { provider: "openai", id: "gpt-5.5" });
	assert.deepEqual(selectRequestedModelProfile(overriddenChild, defaults), { provider: "openai", id: "gpt-5.5-mini" });
	assert.deepEqual(selectRequestedModelProfile(pinned, defaults), { provider: "moonshotai", id: "kimi-k2.6" });
});

test("thinking selection prefers role override, profile override, then defaults", () => {
	const defaults = {
		thinking: "medium",
		mainThinking: "high",
		subagentThinking: "low",
	};
	const mainDefault = new InitialSessionContextBuilder("main-default-thinking").createSession();
	const subagentDefault = new InitialSessionContextBuilder("subagent-default-thinking")
		.withParentSessionId("parent")
		.createSession();
	const profileOverride = new InitialSessionContextBuilder("profile-thinking")
		.withThinkingLevel("xhigh")
		.createSession();
	const mainOverride = new InitialSessionContextBuilder("main-thinking")
		.withThinkingLevel("low")
		.withMainThinkingLevel("minimal")
		.createSession();
	const subagentOverride = new InitialSessionContextBuilder("subagent-thinking")
		.withParentSessionId("parent")
		.withThinkingLevel("low")
		.withSubagentThinkingLevel("minimal")
		.createSession();

	assert.equal(selectRequestedThinkingLevel(mainDefault, defaults), "high");
	assert.equal(selectRequestedThinkingLevel(subagentDefault, defaults), "low");
	assert.equal(selectRequestedThinkingLevel(profileOverride, defaults), "xhigh");
	assert.equal(selectRequestedThinkingLevel(mainOverride, defaults), "minimal");
	assert.equal(selectRequestedThinkingLevel(subagentOverride, defaults), "minimal");
	assert.equal(selectRequestedThinkingLevel(mainDefault, { thinking: "medium" }), "medium");
});

test("fast mode selection preserves explicit false and role-specific priority", () => {
	const defaults = {
		fast: true,
		mainFast: false,
		subagentFast: false,
	};
	const mainDefault = new InitialSessionContextBuilder("main-default-fast").createSession();
	const subagentDefault = new InitialSessionContextBuilder("subagent-default-fast")
		.withParentSessionId("parent")
		.createSession();
	const profileOverride = new InitialSessionContextBuilder("profile-fast")
		.withFastMode(false)
		.createSession();
	const mainOverride = new InitialSessionContextBuilder("main-fast")
		.withFastMode(true)
		.withMainFastMode(false)
		.createSession();
	const subagentOverride = new InitialSessionContextBuilder("subagent-fast")
		.withParentSessionId("parent")
		.withFastMode(true)
		.withSubagentFastMode(false)
		.createSession();

	assert.equal(selectRequestedFastMode(mainDefault, defaults), false);
	assert.equal(selectRequestedFastMode(subagentDefault, defaults), false);
	assert.equal(selectRequestedFastMode(profileOverride, { fast: true }), false);
	assert.equal(selectRequestedFastMode(mainOverride, defaults), false);
	assert.equal(selectRequestedFastMode(subagentOverride, defaults), false);
	assert.equal(selectRequestedFastMode(mainDefault, { fast: true }), true);
});
