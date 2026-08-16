import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	CODEX_APP_SERVER_GENERATED_BUNDLE_SHA256,
	CODEX_APP_SERVER_GENERATED_TYPES_INDEX_SHA256,
	CODEX_APP_SERVER_PROTOCOL_NAME,
	CODEX_APP_SERVER_SCHEMA_SHA256,
	CODEX_APP_SERVER_SUPPORTED_RANGE,
	CODEX_APP_SERVER_V2_SCHEMA_SHA256,
	CODEX_APP_SERVER_VERSION,
} from "../dist/agent-runtimes/codex-native/protocol-version.js";

const fullSchemaPath = new URL("../src/agent-runtimes/codex-native/generated/codex_app_server_protocol.schemas.json", import.meta.url);
const v2SchemaPath = new URL("../src/agent-runtimes/codex-native/generated/codex_app_server_protocol.v2.schemas.json", import.meta.url);

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

test("Codex native protocol checkpoint pins the exact Pibo2 App Server version", () => {
	assert.equal(CODEX_APP_SERVER_VERSION, "0.147.0");
	assert.equal(CODEX_APP_SERVER_SUPPORTED_RANGE, ">=0.147.0 <0.148.0");
	assert.equal(CODEX_APP_SERVER_PROTOCOL_NAME, "codex-app-server-v2");
	assert.match(CODEX_APP_SERVER_GENERATED_TYPES_INDEX_SHA256, /^[a-f0-9]{64}$/);
	assert.match(CODEX_APP_SERVER_GENERATED_BUNDLE_SHA256, /^[a-f0-9]{64}$/);
});

test("Codex native protocol checkpoint stores unmodified stable generated schemas", async () => {
	const [fullBytes, v2Bytes] = await Promise.all([readFile(fullSchemaPath), readFile(v2SchemaPath)]);
	assert.equal(sha256(fullBytes), CODEX_APP_SERVER_SCHEMA_SHA256);
	assert.equal(sha256(v2Bytes), CODEX_APP_SERVER_V2_SCHEMA_SHA256);

	const full = JSON.parse(fullBytes);
	const v2 = JSON.parse(v2Bytes);
	assert.equal(full.title, "CodexAppServerProtocol");
	assert.equal(v2.title, "CodexAppServerProtocolV2");
	assert.equal(Object.keys(full.definitions).length, 82);
	assert.equal(Object.keys(v2.definitions).length, 557);

	for (const definition of [
		"CommandExecutionRequestApprovalParams",
		"FileChangeRequestApprovalParams",
		"ToolRequestUserInputParams",
		"ServerRequest",
	]) {
		assert.ok(full.definitions[definition], `missing full protocol definition ${definition}`);
	}
	const serverRequestMethods = full.definitions.ServerRequest.oneOf
		.map((entry) => entry.properties?.method?.enum?.[0])
		.filter(Boolean);
	assert.ok(serverRequestMethods.includes("item/commandExecution/requestApproval"));
	assert.ok(serverRequestMethods.includes("item/fileChange/requestApproval"));
	assert.ok(serverRequestMethods.includes("item/tool/requestUserInput"));
	for (const definition of [
		"ThreadStartParams",
		"ThreadResumeParams",
		"ThreadReadParams",
		"ThreadListParams",
		"TurnStartParams",
		"TurnSteerParams",
		"TurnInterruptParams",
		"ModelListParams",
		"Model",
		"ModelServiceTier",
		"ReasoningEffortOption",
		"ThreadSettingsUpdatedNotification",
		"ModelReroutedNotification",
		"SkillsExtraRootsSetParams",
		"SkillsListParams",
		"ListMcpServerStatusParams",
		"McpServerToolCallParams",
		"ThreadTokenUsageUpdatedNotification",
		"ServerRequestResolvedNotification",
	]) {
		assert.ok(v2.definitions[definition], `missing v2 protocol definition ${definition}`);
	}
	for (const field of ["model", "serviceTier", "personality", "config", "developerInstructions"]) {
		assert.ok(v2.definitions.ThreadStartParams.properties[field], `thread/start is missing ${field}`);
		assert.ok(v2.definitions.ThreadResumeParams.properties[field], `thread/resume is missing ${field}`);
	}
	for (const field of ["model", "effort", "summary", "serviceTier", "personality"]) {
		assert.ok(v2.definitions.TurnStartParams.properties[field], `turn/start is missing ${field}`);
	}
	const clientRequestMethods = v2.definitions.ClientRequest.oneOf
		.map((entry) => entry.properties?.method?.enum?.[0])
		.filter(Boolean);
	assert.ok(clientRequestMethods.includes("mcpServerStatus/list"));
	for (const unsupportedInventoryMethod of ["tool/list", "tools/list", "nativeTool/list", "nativeTools/list"]) {
		assert.equal(clientRequestMethods.includes(unsupportedInventoryMethod), false);
	}
});
