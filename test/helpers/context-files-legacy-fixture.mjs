import { createPiboContextFilesWebAppContribution } from "../../dist/plugins/context-files.js";
import { definePiboPlugin } from "../../dist/plugins/registry.js";

/** Test-only registry bridge for Context Files web integration tests. */
export function createPiboContextFilesPlugin(options = {}) {
	return definePiboPlugin({
		id: "test.pibo-context-files-legacy-fixture",
		name: "Pibo Context Files Test Fixture",
		register(api) { api.registerWebApp(createPiboContextFilesWebAppContribution(api, options)); },
	});
}
