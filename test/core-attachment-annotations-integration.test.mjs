import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);

// Same-checkout component integration: the real annotation store/serializer and
// the private Core draft pilot. The storage/acceptance adapters are controlled
// test counterparts, not a claim of production composer/receipt or byte wiring.
test("annotation source changes cannot replace an attached Core draft snapshot", async () => {
  const program = `
    import assert from "node:assert/strict";
    import { WebAnnotationStore } from "./dist/web-annotations/store.js";
    import { prepareWebAnnotationMessageAttachments } from "./dist/web-annotations/attachments.js";
    import { CoreAttachmentDraftStore } from "./src/apps/chat-ui/src/attachments/core-attachment-draft.ts";
    const annotations = new WebAnnotationStore({ path: ":memory:" });
    const entries = new Map();
    const storage = { readText: k => entries.get(k) ?? null, writeText: (k,v) => entries.set(k,v), removeText: k => entries.delete(k) };
    try {
      annotations.createAnnotation({ id: "wa_joint", piboSessionId: "ps_joint", note: "original annotation", url: "https://fixture.invalid/page", targetKind: "text", viewport: { width: 1280, height: 800 }, target: { kind: "text", selector: "main h1", selectedText: "original selection" } });
      const prepared = prepareWebAnnotationMessageAttachments({ store: annotations, piboSessionId: "ps_joint", messageText: "Review", attachmentIds: ["wa_joint"] });
      const payload = JSON.parse(JSON.stringify(prepared.attachments[0]));
      const draft = new CoreAttachmentDraftStore(storage, "ps_joint", { createId: () => "att_joint" });
      const id = await draft.add({ sessionId: "ps_joint", type: "pibo.web-annotations/note", schemaVersion: 1, payload });
      annotations.patchAnnotation("ps_joint", "wa_joint", { note: "source changed after attaching" });
      assert.equal(annotations.getAnnotation("ps_joint", "wa_joint").note, "source changed after attaching");
      payload.note = "caller object changed";
      const reloaded = new CoreAttachmentDraftStore(storage, "ps_joint");
      assert.equal(reloaded.storageError, undefined);
      assert.equal(reloaded.get(id).payload.note, "original annotation");
      const frozen = reloaded.freezeForSend("txn_joint", "Review");
      assert.equal(frozen.attachments[0].payload.note, "original annotation");
      await reloaded.update(id, 1, { payload: { ...reloaded.get(id).payload, note: "new draft revision" } });
      assert.deepEqual(reloaded.applyAcceptance(frozen, { clientTxnId: "txn_joint", accepted: true }), { consumed: [], duplicate: false });
      const after = new CoreAttachmentDraftStore(storage, "ps_joint");
      assert.equal(after.get(id).payload.note, "new draft revision");
      assert.deepEqual(after.applyAcceptance(frozen, { clientTxnId: "txn_joint", accepted: true }), { consumed: [], duplicate: true });
      const next = after.freezeForSend("txn_joint_2", "Review updated");
      assert.deepEqual(after.applyAcceptance(next, { clientTxnId: "txn_joint_2", accepted: true }), { consumed: [id], duplicate: false });
      assert.deepEqual(new CoreAttachmentDraftStore(storage, "ps_joint").list(), []);
    } finally { annotations.close(); }
  `;
  try {
    await exec(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", program], { cwd: process.cwd(), timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    assert.fail(`Component integration failed: ${error.stderr ?? error.message}`);
  }
});
