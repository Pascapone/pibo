import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginSetupContext } from "./host.js";
import { PiboWebHttpError } from "../web/http.js";
import { createWebAnnotationsWebApp } from "../web-annotations/api.js";
import { prepareWebAnnotationMessageAttachments } from "../web-annotations/attachments.js";
import { createDefaultWebAnnotationStore } from "../web-annotations/store.js";
import { createWebAnnotationToolProfiles } from "../web-annotations/tools.js";
import {
	PIBO_CHAT_EXTENSION_SERVICE,
	type PiboChatExtensionService,
} from "./product-services.js";

const PIBO_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Backend entry used by the ordinary staged Web Annotations package. */
export function setup(context: PluginSetupContext): () => void {
	for (const profile of createWebAnnotationToolProfiles()) context.register(profile.name, profile);
	const webApp = createWebAnnotationsWebApp();
	context.register("api", webApp);
	context.register("skill", {
		name: "web-annotations",
		path: resolve(PIBO_PACKAGE_ROOT, "skills", "builtin", "web-annotations", "SKILL.md"),
		kind: "builtin",
	});
	context.register("annotations", {});
	context.register("build-context", {});
	context.register("terminal", {});
	const store = createDefaultWebAnnotationStore();
	const chatExtensions = context.services.require<PiboChatExtensionService>(PIBO_CHAT_EXTENSION_SERVICE);
	const disposeAugmenter = chatExtensions.registerMessageAugmenter((input) => {
		let prepared;
		try {
			prepared = prepareWebAnnotationMessageAttachments({
				store,
				piboSessionId: input.piboSessionId,
				messageText: input.messageText,
				attachmentIds: input.body.webAnnotationIds,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new PiboWebHttpError(message, /not available for this app/.test(message) ? 404 : 400);
		}
		return {
			messageText: prepared.messageText,
			...(prepared.attachments.length ? {
				payload: {
					webAnnotationIds: prepared.ids,
					webAnnotationAttachments: prepared.attachments,
					webAnnotationContext: prepared.modelContext,
				},
			} : {}),
			commit() {
				for (const annotation of prepared.annotations) {
					if (annotation.status !== "attached") store.patchAnnotation(annotation.piboSessionId, annotation.id, { status: "attached" });
				}
			},
		};
	});
	return () => {
		disposeAugmenter();
		store.close();
		webApp.dispose?.();
	};
}
