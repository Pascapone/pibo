import assert from "node:assert/strict";
import test from "node:test";
import { setupMuseNativeRuntime } from "../dist/plugins/packaged-runtime-muse-native.js";
import {
	MUSE_NATIVE_PROFILE_NAME,
	MUSE_NATIVE_RUNTIME_INSTANCE_ID,
} from "../dist/plugins/builtin.js";
import {
	MUSE_NATIVE_RUNTIME_PLUGIN_ID,
	museNativeRuntimePackageManifest,
} from "../dist/plugins/default-packages.js";

test("Muse native packaged setup registers exactly the manifest contributions", () => {
	assert.equal(MUSE_NATIVE_RUNTIME_PLUGIN_ID, "pibo.runtime-muse-native");
	assert.equal(MUSE_NATIVE_RUNTIME_INSTANCE_ID, "muse-native");
	assert.equal(MUSE_NATIVE_PROFILE_NAME, "muse-native");

	const manifest = museNativeRuntimePackageManifest();
	assert.equal(manifest.id, "pibo.runtime-muse-native");
	const registered = [];
	const context = {
		register: (localId, value) => {
			registered.push([localId, value]);
			return () => {};
		},
	};
	setupMuseNativeRuntime(context);
	assert.deepEqual(
		registered.map(([localId]) => localId).sort(),
		manifest.contributions.map((contribution) => contribution.id).sort(),
	);
	const byId = new Map(registered);
	assert.equal(byId.get("driver").descriptor.id, "muse-native");
	assert.equal(byId.get("instance").id, "muse-native");
	assert.equal(byId.get("instance").adapterId, "muse-native");
	assert.equal(byId.get("profile").name, "muse-native");
	assert.equal(byId.has("approval-response"), false);
	assert.equal(byId.has("user-input-response"), false);
	const runtimeRequests = manifest.contributions.find((contribution) => contribution.id === "runtime-requests");
	assert.equal(runtimeRequests.view.exportName, "RuntimeRequestsView");
	assert.deepEqual(runtimeRequests.runtime.adapterIds, ["muse-native"]);
});
