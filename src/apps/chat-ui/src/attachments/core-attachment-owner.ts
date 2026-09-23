import { AttachmentDraftError } from "../../../../attachments/errors.js";
import { openIndexedAttachmentDraft } from "./core-attachment-indexed-draft.js";

type Draft = Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
type Open = typeof openIndexedAttachmentDraft;

/** Own one browser draft connection per login-owner/Pibo-Session pair. Late
 * opens from a previous login/session are closed, never published or erased. */
export class ScopedIndexedAttachmentOwner {
	private generation = 0;
	private active?: { ownerUserId: string; sessionId: string; draft: Draft };
	constructor(private readonly open: Open = openIndexedAttachmentDraft) {}
	async select(ownerUserId: string, sessionId: string, factory: IDBFactory): Promise<Draft | undefined> {
		this.close();
		const generation = this.generation;
		const draft = await this.open({ factory, ownerUserId, sessionId });
		if (generation !== this.generation) { draft.close(); return undefined; }
		this.active = { ownerUserId, sessionId, draft };
		return draft;
	}
	current(ownerUserId: string, sessionId: string): Draft | undefined {
		return this.active?.ownerUserId === ownerUserId && this.active.sessionId === sessionId ? this.active.draft : undefined;
	}
	assertCurrent(ownerUserId: string, sessionId: string, draft: Draft): void {
		if (this.current(ownerUserId, sessionId) !== draft) {
			throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "The login owner or Pibo Session changed during attachment delivery.", retryable: false });
		}
	}
	close(): void {
		this.generation++;
		this.active?.draft.close();
		this.active = undefined;
	}
}
