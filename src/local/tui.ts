import { InitialSessionContextBuilder, type InitialSessionContext } from "../core/profiles.js";
import { runPiboTui } from "../core/runtime.js";
import {
	createLocalRoutedTuiClient,
	type LocalRoutedTuiOptions,
} from "./client.js";
import { createLocalRoutedTuiExtension } from "./extension.js";

export {
	LOCAL_TUI_CHANNEL_NAME,
	LocalRoutedTuiClient,
	createLocalRoutedTuiClient,
} from "./client.js";
export type {
	LocalRoutedTuiCapabilities,
	LocalRoutedTuiClientLike,
	LocalRoutedTuiEventListener,
	LocalRoutedTuiOptions,
} from "./client.js";
export { createLocalRoutedTuiExtension } from "./extension.js";

function createLocalControllerProfile(): InitialSessionContext {
	return new InitialSessionContextBuilder("pibo-local-routed-controller")
		.withBuiltinTools("disabled")
		.createSession();
}

export async function runLocalRoutedTui(options: LocalRoutedTuiOptions = {}): Promise<void> {
	const client = createLocalRoutedTuiClient(options);

	try {
		await runPiboTui({
			cwd: options.cwd,
			persistSession: false,
			profile: createLocalControllerProfile(),
			extensionFactories: [createLocalRoutedTuiExtension(client)],
		});
	} finally {
		await client.close();
	}
}
