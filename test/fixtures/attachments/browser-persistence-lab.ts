/** Real-browser module fixtures only. No Chat backend, authentication, provider,
 * Composer or native-tool acceptance. Never opens the application database. */
import { openIndexedAttachmentDraft } from "../../../src/apps/chat-ui/src/attachments/core-attachment-indexed-draft";
import { openAttachmentStores } from "../../../src/apps/chat-ui/src/attachments/core-attachment-persistence";
import { transitionCoreAttachmentDraft } from "../../../src/apps/chat-ui/src/attachments/core-attachment-transitions";
import {
	openAttachmentDatabase, ATTACHMENT_DRAFT_STORE_NAME, ATTACHMENT_BLOB_STORE_NAME,
	ATTACHMENT_COPY_STORE_NAME, ATTACHMENT_LEGACY_CLAIM_STORE_NAME, ATTACHMENT_LEGACY_BACKUP_STORE_NAME,
	attachmentIdbRequest as req, attachmentIdbTransaction as tx,
} from "../../../src/apps/chat-ui/src/attachments/core-attachment-database";
import { CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX } from "../../../src/apps/chat-ui/src/attachments/core-attachment-draft";

const PREFIX = "pibo-k07-fixture-";
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
function equal(a: unknown, b: unknown, message = "values differ") { assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); }
async function rejects(promise: Promise<unknown>, code: string) {
	try { await promise; } catch (error) { equal((error as { code: string }).code, code); return; }
	throw new Error(`Expected rejection ${code}`);
}
function safeName(name: string) { assert(name.startsWith(PREFIX) && name.length > PREFIX.length, "not an owned fixture database"); return name; }
function note(sessionId: string, text = "kept") { return { kind: "add" as const, input: { sessionId, type: "pibo.core/note", schemaVersion: 1, payload: { text } } }; }
function image(sessionId: string, ids: string[], bytes = 1) {
	return { kind: "add" as const, input: { sessionId, type: "pibo.core/image", schemaVersion: 1, payload: { title: "fixture" }, media: ids.map((id) => ({ draftResourceId: id, mimeType: "image/png", bytes })) } };
}
function openDraft(name: string, ownerUserId = "owner", sessionId = "ps_fixture") {
	return openIndexedAttachmentDraft({ factory: indexedDB, databaseName: safeName(name), ownerUserId, sessionId });
}
async function drop(name: string) {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(safeName(name));
		request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error("Fixture cleanup blocked by an owned open handle"));
	});
}
async function version2(name: string) {
	return await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(safeName(name), 2);
		request.onupgradeneeded = () => {
			const blobs = request.result.createObjectStore(ATTACHMENT_BLOB_STORE_NAME, { keyPath: "blobId" });
			blobs.createIndex("by-owner-session-draft", ["ownerUserId", "sessionId", "draftId"]);
			request.result.createObjectStore(ATTACHMENT_COPY_STORE_NAME, { keyPath: "ownerUserId" });
		};
		request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
	});
}

const nonce = crypto.randomUUID();
let peer: Window | null = null;
let rpcId = 0;
let resolvePeerReady: () => void;
const peerReady = new Promise<void>((resolve) => { resolvePeerReady = resolve; });
window.addEventListener("message", (event) => {
	if (event.source === peer && event.origin === location.origin && event.data?.nonce === nonce && event.data?.ready === true) resolvePeerReady();
});
function callPeer(operation: string, data: Record<string, unknown> = {}): Promise<Record<string, any>> {
	const id = ++rpcId;
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => { window.removeEventListener("message", listener); reject(new Error("Owned peer did not respond")); }, 10000);
		const listener = (event: MessageEvent) => {
			if (event.source !== peer || event.origin !== location.origin || event.data?.nonce !== nonce || event.data?.id !== id) return;
			clearTimeout(timeout); window.removeEventListener("message", listener); resolve(event.data.result);
		};
		window.addEventListener("message", listener);
		peer!.postMessage({ nonce, id, operation, ...data }, location.origin);
	});
}

async function runCases() {
	let readinessTimer: ReturnType<typeof setTimeout>;
	try { await Promise.race([peerReady, new Promise<never>((_, reject) => { readinessTimer = setTimeout(() => reject(new Error("Owned peer did not become ready")), 10000); })]); }
	finally { clearTimeout(readinessTimer!); }
	const results: { name: string; pass: boolean; error?: string }[] = [];
	const run = async (label: string, body: (name: string) => Promise<void>) => {
		const name = safeName(PREFIX + nonce + "-" + label);
		try { await body(name); results.push({ name: label, pass: true }); }
		catch (error) { results.push({ name: label, pass: false, error: error instanceof Error ? error.stack : String(error) }); }
		finally { try { await drop(name); } catch (error) { results.push({ name: label + " cleanup", pass: false, error: String(error) }); } }
		document.querySelector("pre")!.textContent = JSON.stringify(results, null, 2);
	};
	await run("cas-scope-capture", async (name) => {
		const a = await openDraft(name), b = await openDraft(name), foreign = await openDraft(name, "foreign"), session = await openDraft(name, "owner", "ps_other");
		try {
			equal((await a.load()).revision, 0);
			const command = note("ps_fixture"); const pending = a.execute(0, command); command.input.payload.text = "mutated";
			const added = await pending; equal((added.current.view.records[0].payload as { text: string }).text, "kept");
			await rejects(b.execute(0, note("ps_fixture")), "ATT_STALE_REVISION");
			equal((await b.load()).revision, 1); equal((await foreign.load()).revision, 0); equal((await session.load()).revision, 0);
			const changed = await b.execute(1, { kind: "update", id: added.result, expectedRevision: 1, next: { payload: { text: "new" } } });
			equal(changed.current.revision, 2);
			class NotJson { text = "no"; }
			await rejects(a.execute(2, { ...note("ps_fixture"), input: { ...note("ps_fixture").input, payload: new NotJson() } }), "ATT_INVALID_JSON");
			a.close(); await rejects(a.load(), "ATT_ACCESS_DENIED"); equal(((await b.load()).view.records[0].payload as { text: string }).text, "new");
		} finally { a.close(); b.close(); foreign.close(); session.close(); }
	});
	await run("atomic-bytes-and-immutable-owner", async (name) => {
		const draft = await openDraft(name), other = await openDraft(name, "other"), stores = await openAttachmentStores(indexedDB, "owner", name);
		try {
			const bytes = (blobId: string, data = [7]) => ({ blobId, mimeType: "image/png", data: new Uint8Array(data) });
			await rejects(draft.execute(0, image("ps_fixture", ["first", "bad"]), [bytes("first"), bytes("bad", [1, 2])]), "ATT_INVALID_JSON");
			equal((await draft.load()).revision, 0); equal(await stores.blobs.getBlob("first"), undefined);
			const result = await draft.execute(0, image("ps_fixture", ["immutable"]), [bytes("immutable")]);
			equal(result.current.revision, 1);
			await rejects(other.execute(0, image("ps_fixture", ["immutable"]), [bytes("immutable", [8])]), "ATT_STALE_REVISION");
			equal((await other.load()).revision, 0); equal([...(await stores.blobs.getBlob("immutable"))!.data], [7]);
			const otherStores = await openAttachmentStores(indexedDB, "other", name);
			try { equal(await otherStores.blobs.getBlob("immutable"), undefined); await rejects(otherStores.blobs.putBlob({ sessionId: "ps_fixture", draftId: "x", blobId: "immutable", mimeType: "image/png", data: new Uint8Array([9]) }), "ATT_STALE_REVISION"); }
			finally { otherStores.close(); }
		} finally { draft.close(); other.close(); stores.close(); }
	});
	await run("frozen-holders-and-consumption", async (name) => {
		const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
		try {
			const added = await draft.execute(0, image("ps_fixture", ["held"]), [{ blobId: "held", mimeType: "image/png", data: new Uint8Array([1]) }]);
			equal(await stores.blobs.deleteBlob("held"), false);
			const a = await draft.execute(added.current.revision, { kind: "freeze", clientTxnId: "a", text: "message" });
			const b = await draft.execute(a.current.revision, { kind: "freeze", clientTxnId: "b", text: "message" });
			const removed = await draft.execute(b.current.revision, { kind: "remove", id: added.result });
			equal(await stores.blobs.deleteBlob("held"), false);
			const acceptedA = await draft.execute(removed.current.revision, { kind: "accept", snapshot: a.result, receipt: { clientTxnId: "a", accepted: true } });
			assert(await stores.blobs.getBlob("held"), "other open snapshot lost its bytes");
			const acceptedB = await draft.execute(acceptedA.current.revision, { kind: "accept", snapshot: b.result, receipt: { clientTxnId: "b", accepted: true } });
			equal(await stores.blobs.getBlob("held"), undefined);
			const duplicate = await draft.execute(acceptedB.current.revision, { kind: "accept", snapshot: b.result, receipt: { clientTxnId: "b", accepted: true } });
			equal(duplicate.current.revision, acceptedB.current.revision); assert(duplicate.result.duplicate);
		} finally { draft.close(); stores.close(); }
	});
	await run("clear-tombstone-no-aba", async (name) => {
		const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
		try {
			const added = await draft.execute(0, note("ps_fixture"));
			await stores.clearOwner(); const cleared = await draft.load();
			assert(cleared.revision > added.current.revision); equal(cleared.view.records, []);
			await rejects(draft.execute(0, note("ps_fixture")), "ATT_STALE_REVISION");
			await rejects(draft.execute(added.current.revision, note("ps_fixture")), "ATT_STALE_REVISION");
			assert((await draft.execute(cleared.revision, note("ps_fixture"))).current.revision > cleared.revision);
		} finally { draft.close(); stores.close(); }
	});
	await run("explicit-legacy-custody-race", async (name) => {
		const session = "ps_fixture_" + nonce;
		const key = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + session;
		const raw = transitionCoreAttachmentDraft(null, session, note(session)).text!;
		localStorage.setItem(key, raw);
		const a = await openDraft(name, "a", session), b = await openDraft(name, "b", session);
		let reads = 0;
		const storage = { getItem(key: string) { reads++; return localStorage.getItem(key); } };
		try {
			equal((await a.load()).view.records, []); equal((await b.load()).view.records, []); equal(reads, 0);
			const outcomes = await Promise.allSettled([a.adoptLegacy({ confirmCustody: true, kind: "unowned", storage }), b.adoptLegacy({ confirmCustody: true, kind: "unowned", storage })]);
			equal(outcomes.filter((value) => value.status === "fulfilled").length, 1); equal(reads, 1, "foreign claimant read legacy content");
			const winner = outcomes[0].status === "fulfilled" ? a : b, loser = winner === a ? b : a;
			equal(localStorage.getItem(key), raw); equal((await winner.readLegacyBackup("unowned"))!.rawText, raw); equal(await loser.readLegacyBackup("unowned"), undefined);
			localStorage.setItem(key, "changed later"); equal((await winner.readLegacyBackup("unowned"))!.rawText, raw);
			await rejects(loser.adoptLegacy({ confirmCustody: true, kind: "unowned", storage }), "ATT_ACCESS_DENIED"); equal(reads, 1);
			const owner = winner.ownerUserId; winner.close(); await rejects(winner.load(), "ATT_ACCESS_DENIED");
			const reopened = await openDraft(name, owner, session); try { equal((await reopened.load()).view.records.length, 1); } finally { reopened.close(); }
		} finally { a.close(); b.close(); localStorage.removeItem(key); }
	});
	await run("same-owner-custody-and-text-restore-cas", async (name) => {
		const session = "ps_fixture_scoped_" + nonce;
		const key = `pibo.attachments.owner.owner.${CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX}${session}`;
		const raw = transitionCoreAttachmentDraft(null, session, note(session)).text!;
		localStorage.setItem(key, raw);
		const a = await openDraft(name, "owner", session), b = await openDraft(name, "owner", session);
		const stores = await openAttachmentStores(indexedDB, "owner", name), db = await openAttachmentDatabase(indexedDB, name);
		try {
			const outcomes = await Promise.allSettled([a.adoptLegacy({ confirmCustody: true, kind: "owner-scoped", storage: localStorage }), b.adoptLegacy({ confirmCustody: true, kind: "owner-scoped", storage: localStorage })]);
			equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
			const failure = outcomes.find((entry) => entry.status === "rejected") as PromiseRejectedResult;
			equal(failure.reason.code, "ATT_STALE_REVISION", "serialized loser must hit CAS, not a uniqueness violation");
			const claim = await tx(db, [ATTACHMENT_LEGACY_CLAIM_STORE_NAME], "readonly", async ([store]) => req(store.get(key)));
			assert(!Object.hasOwn(claim, "rawText"), "global custody metadata contains private text");
			await stores.clearOwner(); const cleared = await a.load();
			equal((await a.readLegacyBackup("owner-scoped"))!.rawText, raw);
			await rejects(a.restoreLegacyText(0, "owner-scoped"), "ATT_STALE_REVISION");
			const restored = await a.restoreLegacyText(cleared.revision, "owner-scoped");
			assert(restored.revision > cleared.revision); equal(restored.view.records.length, 1);
			await rejects(a.restoreLegacyText(restored.revision, "owner-scoped"), "ATT_STALE_REVISION");
			equal(localStorage.getItem(key), raw);
		} finally { a.close(); b.close(); stores.close(); db.close(); localStorage.removeItem(key); }
	});
	await run("corrupt-legacy-and-backup-fail-closed", async (name) => {
		const session = "ps_fixture_corrupt_" + nonce, key = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + session;
		localStorage.setItem(key, "{corrupt");
		const a = await openDraft(name, "owner", session), b = await openDraft(name, "other", session), db = await openAttachmentDatabase(indexedDB, name);
		try {
			await rejects(a.adoptLegacy({ confirmCustody: true, kind: "unowned", storage: localStorage }), "ATT_STORAGE_FAILED");
			equal(localStorage.getItem(key), "{corrupt"); equal((await a.load()).revision, 0);
			equal(await tx(db, [ATTACHMENT_LEGACY_CLAIM_STORE_NAME], "readonly", async ([store]) => req(store.get(key))), undefined);
			const raw = transitionCoreAttachmentDraft(null, session, note(session)).text!; localStorage.setItem(key, raw);
			await b.adoptLegacy({ confirmCustody: true, kind: "unowned", storage: localStorage }); equal(await a.readLegacyBackup("unowned"), undefined);
			await tx(db, [ATTACHMENT_LEGACY_BACKUP_STORE_NAME], "readwrite", async ([store]) => { const backup = await req(store.get(["other", key])); await req(store.put({ ...backup, sourceDigest: "tampered" })); });
			await rejects(b.readLegacyBackup("unowned"), "ATT_STORAGE_FAILED"); equal(localStorage.getItem(key), raw);
		} finally { a.close(); b.close(); db.close(); localStorage.removeItem(key); }
	});
	await run("text-restore-does-not-invent-deleted-bytes", async (name) => {
		const session = "ps_fixture_media_" + nonce, key = CORE_ATTACHMENT_DRAFT_STORAGE_PREFIX + session;
		const source = transitionCoreAttachmentDraft(null, session, image(session, ["legacy-image"])); localStorage.setItem(key, source.text!);
		const draft = await openDraft(name, "owner", session), stores = await openAttachmentStores(indexedDB, "owner", name);
		try {
			await stores.blobs.putBlob({ sessionId: session, draftId: source.result, mimeType: "image/png", blobId: "legacy-image", data: new Uint8Array([1]) });
			await draft.adoptLegacy({ confirmCustody: true, kind: "unowned", storage: localStorage });
			await stores.clearOwner(); const cleared = await draft.load();
			const restored = await draft.restoreLegacyText(cleared.revision, "unowned");
			equal(await stores.blobs.getBlob("legacy-image"), undefined);
			await rejects(draft.execute(restored.revision, { kind: "freeze", clientTxnId: "missing", text: "not sendable" }), "ATT_BYTES_MISSING");
			equal((await draft.load()).revision, restored.revision); equal((await draft.load()).view.openSnapshots, []);
		} finally { draft.close(); stores.close(); localStorage.removeItem(key); }
	});
	await run("corrupt-text-preserved", async (name) => {
		const db = await openAttachmentDatabase(indexedDB, name), draft = await openDraft(name);
		try {
			await tx(db, [ATTACHMENT_DRAFT_STORE_NAME], "readwrite", async ([store]) => { await req(store.put({ ownerUserId: "owner", sessionId: "ps_fixture", revision: 1, writerEpoch: "fixture", updatedAt: "clock", rawText: "{broken" })); });
			await rejects(draft.load(), "ATT_STORAGE_FAILED"); await rejects(draft.execute(1, note("ps_fixture")), "ATT_STORAGE_FAILED");
			const row = await tx(db, [ATTACHMENT_DRAFT_STORE_NAME], "readonly", async ([store]) => req(store.get(["owner", "ps_fixture"])));
			equal(row.rawText, "{broken"); equal(row.revision, 1);
		} finally { draft.close(); db.close(); }
	});
	await run("injected-write-abort-not-real-quota", async (name) => {
		const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
		const original = IDBObjectStore.prototype.put;
		try {
			try {
				IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) { if (this.name === ATTACHMENT_DRAFT_STORE_NAME) throw new DOMException("fixture quota failure", "QuotaExceededError"); return original.apply(this, args); };
				await rejects(draft.execute(0, image("ps_fixture", ["rollback"]), [{ blobId: "rollback", mimeType: "image/png", data: new Uint8Array([1]) }]), "ATT_STORAGE_FAILED");
			} finally { IDBObjectStore.prototype.put = original; }
			equal((await draft.load()).revision, 0); equal(await stores.blobs.getBlob("rollback"), undefined);
		} finally { draft.close(); stores.close(); }
	});
	await run("additive-v2-upgrade", async (name) => {
		const old = await version2(name);
		const blob = { blobId: "old", ownerUserId: "owner", sessionId: "ps_fixture", draftId: "att_old", mimeType: "image/png", size: 2, createdAt: "clock", data: new Uint8Array([3, 4]).buffer };
		const copy = { ownerUserId: "owner", copyId: "old-copy", stagedAt: "clock", sourceSessionId: "ps_fixture", sourceDraftId: "att_old", sourceRevision: 1, payload: { text: "old copy" }, media: [] };
		try { await tx(old, [ATTACHMENT_BLOB_STORE_NAME, ATTACHMENT_COPY_STORE_NAME], "readwrite", async ([blobs, copies]) => { await req(blobs.add(blob)); await req(copies.add(copy)); }); }
		finally { old.close(); }
		const draft = await openDraft(name), stores = await openAttachmentStores(indexedDB, "owner", name);
		try { equal((await draft.load()).revision, 0); equal([...(await stores.blobs.getBlob("old"))!.data], [3, 4]); equal(await stores.copy.load(), copy); }
		finally { draft.close(); stores.close(); }
	});
	await run("blocked-upgrade-is-not-late-success", async (name) => {
		const old = await version2(name);
		try { await rejects(openAttachmentDatabase(indexedDB, name), "ATT_STORAGE_FAILED"); equal(old.version, 2); }
		finally { old.close(); }
		const checked = await version2(name);
		try { equal(checked.version, 2); assert(!checked.objectStoreNames.contains(ATTACHMENT_DRAFT_STORE_NAME)); }
		finally { checked.close(); }
	});
	await run("closed-byte-facade-hides-pending-read", async (name) => {
		const stores = await openAttachmentStores(indexedDB, "owner", name);
		try {
			await stores.blobs.putBlob({ sessionId: "ps_fixture", draftId: "old", blobId: "retained", mimeType: "image/png", data: new Uint8Array([1]) });
			const pending = stores.blobs.getBlob("retained"); stores.close();
			await rejects(pending, "ATT_ACCESS_DENIED"); await rejects(stores.copy.load(), "ATT_ACCESS_DENIED");
			const reopened = await openAttachmentStores(indexedDB, "owner", name);
			try { equal([...(await reopened.blobs.getBlob("retained"))!.data], [1]); } finally { reopened.close(); }
		} finally { stores.close(); }
	});
	await run("versionchange-closes-owner-facade", async (name) => {
		const draft = await openDraft(name);
		let upgraded: IDBDatabase | undefined;
		try {
			await draft.execute(0, note("ps_fixture"));
			upgraded = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(safeName(name), 4); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
			await rejects(draft.load(), "ATT_ACCESS_DENIED");
			await rejects(draft.execute(1, note("ps_fixture")), "ATT_ACCESS_DENIED");
			const row = await tx(upgraded, [ATTACHMENT_DRAFT_STORE_NAME], "readonly", async ([store]) => req(store.get(["owner", "ps_fixture"]))); equal(row.revision, 1);
		} finally { draft.close(); upgraded?.close(); }
	});
	await run("two-real-tabs-one-cas-winner", async (name) => {
		const parent = await openDraft(name);
		try {
			const initialized = await callPeer("init", { databaseName: name }); assert(initialized.ok); equal(initialized.revision, 0); equal((await parent.load()).revision, 0);
			const main = parent.execute(0, note("ps_fixture", "main")).then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code }));
			const secondary = callPeer("execute", { command: note("ps_fixture", "peer") });
			const outcomes = await Promise.all([main, secondary]); equal(outcomes.filter((item) => item.ok).length, 1);
			const failed = outcomes.find((item) => !item.ok)! as { code: string }; equal(failed.code, "ATT_STALE_REVISION");
			equal((await parent.load()).revision, 1); equal((await parent.load()).view.records.length, 1);
		} finally { await callPeer("close"); parent.close(); }
	});
	peer?.close();
	const summary = { kind: "real-browser-persistence-modules-only", userAgent: navigator.userAgent, pass: results.filter((item) => item.pass).length, fail: results.filter((item) => !item.pass).length, results };
	(window as any).fixtureResults = summary;
	document.querySelector("pre")!.textContent = JSON.stringify(summary, null, 2);
	document.querySelector("h1")!.textContent = summary.fail ? "Persistence fixtures FAILED" : "Persistence fixtures PASS";
}

if (location.pathname === "/peer") {
	document.body.innerHTML = "<h1>Owned second-tab fixture</h1><p>No application database is opened here.</p>";
	const expectedNonce = new URLSearchParams(location.search).get("nonce");
	let draft: Awaited<ReturnType<typeof openDraft>> | undefined;
	window.addEventListener("message", async (event) => {
		if (event.source !== window.opener || event.origin !== location.origin || event.data?.nonce !== expectedNonce) return;
		const { operation, id } = event.data;
		let result: Record<string, unknown>;
		try {
			if (operation === "init") { draft = await openDraft(safeName(event.data.databaseName)); result = { ok: true, revision: (await draft.load()).revision }; }
			else if (operation === "execute") { await draft!.execute(0, event.data.command); result = { ok: true }; }
			else if (operation === "close") { draft?.close(); result = { ok: true }; }
			else throw new Error("Unknown fixture operation");
		} catch (error) { result = { ok: false, code: (error as any).code, error: String(error) }; }
		window.opener.postMessage({ nonce: expectedNonce, id, result }, location.origin);
	});
	window.opener.postMessage({ nonce: expectedNonce, ready: true }, location.origin);
} else {
	document.querySelector("button")!.addEventListener("click", () => {
		(document.querySelector("button") as HTMLButtonElement).disabled = true;
		peer = window.open(`/peer?nonce=${nonce}`, "_blank");
		if (!peer) throw new Error("Browser blocked the owned second fixture tab");
		void runCases().catch((error) => { (window as any).fixtureFailure = String(error); document.querySelector("pre")!.textContent = String(error); peer?.close(); });
	});
}
