import { defineTestCapabilitySetup } from "./capability-host.mjs";
import { createPiboContextFilesWebAppContribution } from "../../dist/plugins/context-files.js";


/** Test-only registry bridge for Context Files web integration tests. */
export function createPiboContextFilesPlugin(options = {}) {
	return defineTestCapabilitySetup({
		id: "test.pibo-context-files-legacy-fixture",
		name: "Pibo Context Files Test Fixture",
		register(api) { api.registerWebApp(createPiboContextFilesWebAppContribution(api, options)); },
	});
}
