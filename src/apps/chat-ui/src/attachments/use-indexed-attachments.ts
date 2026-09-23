import { useCallback, useEffect, useRef, useState } from "react";
import { ScopedIndexedAttachmentOwner } from "./core-attachment-owner.js";
import type { openIndexedAttachmentDraft } from "./core-attachment-indexed-draft.js";

type Draft = Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
type Loaded = Awaited<ReturnType<Draft["load"]>>;
type Scoped = { ownerUserId: string; sessionId: string; draft: Draft; loaded: Loaded };

/** Read the current owner+Pibo-Session's persisted draft. Never fall back to
 * a previous login's data while the new connection is opening. */
export function useIndexedComposerAttachments(ownerUserId: string | undefined, sessionId: string | null) {
	const owner = useRef(new ScopedIndexedAttachmentOwner());
	const [state, setState] = useState<Scoped | undefined>();
	const [failure, setFailure] = useState<{ ownerUserId: string; sessionId: string; message: string } | undefined>();
	useEffect(() => {
		if (!ownerUserId || !sessionId || typeof indexedDB === "undefined") { owner.current.close(); return; }
		let cancelled = false;
		void owner.current.select(ownerUserId, sessionId, indexedDB).then(async (draft) => {
			if (!draft) return;
			const loaded = await draft.load();
			if (!cancelled && owner.current.current(ownerUserId, sessionId) === draft) {
				setState({ ownerUserId, sessionId, draft, loaded }); setFailure(undefined);
			}
		}).catch((error) => {
			if (!cancelled) { owner.current.close(); setFailure({ ownerUserId, sessionId, message: error instanceof Error ? error.message : String(error) }); }
		});
		return () => { cancelled = true; owner.current.close(); };
	}, [ownerUserId, sessionId]);
	const scoped = state && ownerUserId && sessionId && state.ownerUserId === ownerUserId && state.sessionId === sessionId
		&& owner.current.current(ownerUserId, sessionId) === state.draft ? state : undefined;
	const reload = useCallback(async (): Promise<Loaded | undefined> => {
		if (!ownerUserId || !sessionId) return undefined;
		const draft = owner.current.current(ownerUserId, sessionId);
		if (!draft) return undefined;
		const loaded = await draft.load();
		owner.current.assertCurrent(ownerUserId, sessionId, draft);
		setState({ ownerUserId, sessionId, draft, loaded });
		return loaded;
	}, [ownerUserId, sessionId]);
	return { draft: scoped?.draft, loaded: scoped?.loaded, reload,
		assertCurrent: owner.current.assertCurrent.bind(owner.current),
		loading: Boolean(ownerUserId && sessionId && !scoped && !failure),
		error: failure && failure.ownerUserId === ownerUserId && failure.sessionId === sessionId ? failure.message : undefined };
}
