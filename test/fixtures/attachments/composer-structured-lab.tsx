import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../../../src/apps/chat-ui/src/composer/Composer";
import { openIndexedAttachmentDraft } from "../../../src/apps/chat-ui/src/attachments/core-attachment-indexed-draft";
import { addWithProvider } from "../../../src/apps/chat-ui/src/attachments/core-attachment-provider-commands";
import { coreNoteProvider } from "../../../src/attachments/core-providers";

const sessionId = "ps_fixture_composer";
const ownerUserId = "fixture_owner_only";
// This disposable DB is unique to one static module-fixture origin/run. It
// never opens Chat Web's real database or exercises authenticated backend APIs.
const databaseName = `pibo-attachments-composer-ui-${crypto.randomUUID()}`;
type Draft = Awaited<ReturnType<typeof openIndexedAttachmentDraft>>;
type Loaded = Awaited<ReturnType<Draft["load"]>>;
const lookup = (type: string, scope: { sessionId: string }) => scope.sessionId === sessionId && type === "pibo.core/note" ? coreNoteProvider : undefined;

function Lab() {
 const [draft, setDraft] = useState<Draft>();
 const [loaded, setLoaded] = useState<Loaded>();
 const [text, setText] = useState("");
 const [sent, setSent] = useState<Array<{ text: string; count: number }>>([]);
 const [failure, setFailure] = useState("");
 useEffect(() => {
  let closed = false; let active: Draft | undefined;
  void openIndexedAttachmentDraft({ factory: indexedDB, ownerUserId, sessionId, databaseName }).then(async (opened) => {
   active = opened; const state = await opened.load();
   if (closed) opened.close(); else { setDraft(opened); setLoaded(state); }
  }).catch((error) => setFailure(String(error)));
  return () => { closed = true; active?.close(); };
 }, []);
 const reload = async (active: Draft) => { const state = await active.load(); setLoaded(state); return state; };
 const attachments = loaded?.view.records.map((record) => ({id: record.envelope.id, title: String((record.payload as { text?: unknown }).text ?? record.envelope.type)})) ?? [];
 (window as Window & { fixtureProbe?: () => unknown }).fixtureProbe = () => ({ ready: Boolean(draft), count: attachments.length, sent, failure, databaseName });
 return <main className="min-h-screen bg-[#101d22] p-4 text-slate-100 sm:p-8">
  <div className="mx-auto max-w-3xl overflow-hidden rounded-sm border border-slate-700 bg-[#1a262b]">
   <div className="border-b border-slate-700 px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#11a4d4]">K07 Composer component fixture — no Chat backend</div>
   <div className="h-36 border-b border-slate-800 px-4 py-3 text-sm text-slate-400">This static module fixture checks layout and native IndexedDB note controls. Sending only records a local test event; no message is posted.</div>
   {draft ? <Composer sessionId={sessionId} ownerUserId={ownerUserId} disabled={false} commands={[]} skills={[]} value={text} focusSignal={0}
    selectedWebAnnotations={[]} selectedUploadAttachments={[]} structuredAttachments={attachments}
    onAddStructuredNote={async note => { const current=await reload(draft); await addWithProvider({draft,expectedRevision:current.revision,lookup,scope:{sessionId},type:"pibo.core/note",schemaVersion:1,source:{text:note}});await reload(draft); }}
    onDetachStructuredAttachment={async id=>{const current=await reload(draft);const item=current.view.records.find(record=>record.envelope.id===id);if(!item)throw Error("Note changed");await draft.execute(current.revision,{kind:"remove",id:item.envelope.id});await reload(draft);}}
    onValueChange={setText} onCommand={async()=>false} onDetachWebAnnotation={()=>{}} onClearWebAnnotations={()=>{}}
    onAttachUploadedFiles={()=>{}} onDetachUploadAttachment={()=>{}} onClearUploadAttachments={()=>{}}
    onSend={async message=>setSent(current=>[...current,{text:message,count:attachments.length}])}/>
    : <div className="px-4 py-4 text-sm text-slate-400">Opening disposable browser draft…</div>}
   {failure ? <div role="alert" className="px-4 py-2 text-sm text-red-300">{failure}</div> : null}
   <div role="status" aria-live="polite" className="border-t border-slate-700 px-4 py-3 text-xs text-slate-400">{sent.length ? `Fixture only: ${sent.length} local send${sent.length === 1 ? "" : "s"}, latest text ${JSON.stringify(sent[sent.length - 1]!.text)}.` : "No local send recorded."}</div>
  </div>
 </main>;
}
createRoot(document.getElementById("root")!).render(<Lab />);
