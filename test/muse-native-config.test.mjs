import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	defaultMuseNativeRuntimeConfig,
	parseMuseNativeRuntimeConfig,
} from "../dist/agent-runtimes/muse-native/config.js";

test("muse native default config selects the muse executable and on-request approvals", () => {
	const config = defaultMuseNativeRuntimeConfig();
	assert.equal(config.executable, "muse");
	assert.equal(config.approvalMode, "onRequest");
	assert.equal(config.sandbox, "auto");
	assert.equal(config.experimentalSdkGate, true);
	assert.equal(config.diagnosticTimeoutMs, 5_000);
	assert.equal(config.startupTimeoutMs, 10_000);
	assert.equal(config.requestTimeoutMs, 1_800_000);
	assert.equal(config.shutdownTimeoutMs, 2_000);
	assert.ok(config.homeRoot.length > 0);
	assert.ok(config.environmentAllowlist.includes("PATH"));
});

test("muse native config parsing accepts overrides and rejects invalid values", () => {
	const homeRoot = join(tmpdir(), "muse-runtime-home");
	const config = parseMuseNativeRuntimeConfig({
		executable: "/usr/local/bin/muse",
		homeRoot,
		approvalMode: "denyUnmatched",
		sandbox: "disabled",
		experimentalSdkGate: false,
		requestTimeoutMs: 30_000,
	});
	assert.equal(config.executable, "/usr/local/bin/muse");
	assert.equal(config.homeRoot, homeRoot);
	assert.equal(config.approvalMode, "denyUnmatched");
	assert.equal(config.sandbox, "disabled");
	assert.equal(config.experimentalSdkGate, false);
	assert.equal(config.requestTimeoutMs, 30_000);

	assert.throws(() => parseMuseNativeRuntimeConfig({ unknownField: true }), /unsupported config field/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ approvalMode: "sometimes" }), /approvalMode/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ sandbox: "sometimes" }), /sandbox/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ executable: "  " }), /executable/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ homeRoot: "relative/path" }), /absolute path/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ requestTimeoutMs: 0 }), /requestTimeoutMs/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ requestTimeoutMs: 31 * 60 * 1_000 }), /requestTimeoutMs/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ environmentAllowlist: ["HOME"] }), /reserved key/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ environmentAllowlist: ["MUSE_EXPERIMENTAL_SDK_ENABLED"] }), /reserved key/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ environmentAllowlist: ["PATH", "path"] }), /duplicate key/);
	assert.throws(() => parseMuseNativeRuntimeConfig({ experimentalSdkGate: "yes" }), /experimentalSdkGate/);
});
