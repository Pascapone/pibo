/** Transaction-local facade over the existing synchronous draft engine.
 * No IDB, hooks or asynchronous work lives here. The engine's own serializer
 * supplies the write candidate; the caller must commit before publishing it. */
import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { invalidJson } from "../../../../attachments/json.js";
import {
	CoreAttachmentDraftStore, CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX,
	type CoreAttachmentDraftCommand, type CoreAttachmentDraftCommandResult,
	type CoreAttachmentDraftStoreOptions, type CoreAttachmentDraftView,
} from "./core-attachment-draft";

function scratch(rawText: string | null, sessionId: string, options?: CoreAttachmentDraftStoreOptions) {
	if (rawText !== null && typeof rawText !== "string") throw invalidJson("Stored draft text must be a string.");
	const expectedKey = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + sessionId;
	let text = rawText;
	const checkKey = (key: string) => {
		if (key !== expectedKey) throw invalidJson("Draft transition addressed a foreign storage key.");
	};
	const engine = new CoreAttachmentDraftStore({
		readText(key) { checkKey(key); return text; },
		writeText(key, value) { checkKey(key); text = value; },
		removeText() { throw invalidJson("Draft transitions cannot erase their storage entry."); },
	}, sessionId, options);
	// Do not turn an unreadable valuable entry into an empty writable draft.
	if (engine.storageError) throw new AttachmentDraftError(engine.storageError);
	return { engine, text: () => text };
}

export function readCoreAttachmentDraft(rawText: string | null, sessionId: string): CoreAttachmentDraftView {
	return scratch(rawText, sessionId).engine.view();
}

export function transitionCoreAttachmentDraft<C extends CoreAttachmentDraftCommand>(
	rawText: string | null, sessionId: string, command: C, options?: CoreAttachmentDraftStoreOptions,
): { text: string | null; result: CoreAttachmentDraftCommandResult<C>; view: CoreAttachmentDraftView } {
	const state = scratch(rawText, sessionId, options);
	const result = state.engine.executeCommand(command);
	return { text: state.text(), result, view: state.engine.view() };
}
