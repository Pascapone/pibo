import { definePiboPlugin } from "../plugins/registry.js";
import { createPreviewWebApp, type PreviewWebAppOptions } from "./web-app.js";

export function createPiboPreviewPlugin(options: PreviewWebAppOptions = {}) {
	return definePiboPlugin({
		id: "pibo.session-live-previews",
		name: "Pibo Session Live Previews",
		register(api) {
			api.registerWebApp(createPreviewWebApp(options));
		},
	});
}
