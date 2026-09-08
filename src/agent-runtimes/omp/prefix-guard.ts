export const OMP_PREFIX_CODEC = "omp-18.1.10/openai-responses/v1";

/**
 * Native Bun extension for the pinned conformance fixture. Not a normal-adapter
 * activation: native resources, lifecycle and child ownership remain required.
 * Connection credentials arrive only through the private child environment.
 */
export function createOmpPrefixGuardSource(dateReminderModuleUrl: string): string {
	return String.raw`
import { open, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export default async function(pi) {
  let phase = "bootstrap";
  const fatal = () => { process.stderr.write("Pibo native prefix recovery required: " + phase + "\n"); process.exit(78); };
  const freeze = value => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  try {
    const endpoint = process.env.PIBO_PREFIX_ENDPOINT;
    const token = process.env.PIBO_PREFIX_TOKEN;
    const ready = process.env.PIBO_PREFIX_READY_FILE;
    const nonce = process.env.PIBO_PREFIX_READY_NONCE;
    if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1" || !token || !ready || !nonce) return fatal();
    const claimNativeIdentity = globalThis[Symbol.for("pibo.omp.prefix.claimNative")];
    if (typeof claimNativeIdentity !== "function") return fatal();
    delete globalThis[Symbol.for("pibo.omp.prefix.claimNative")];
    for (const key of ["PIBO_PREFIX_ENDPOINT", "PIBO_PREFIX_TOKEN", "PIBO_PREFIX_READY_FILE", "PIBO_PREFIX_READY_NONCE"]) delete process.env[key];
    const auth = { authorization: "Bearer " + token };
    phase = "restore";
    const response = await fetch(endpoint + "/snapshot", { headers: auth, signal: AbortSignal.timeout(5000) });
    let snapshot;
    if (response.status === 200) snapshot = JSON.parse(await response.text());
    else if (response.status !== 404) return fatal();
    if (snapshot && (snapshot.format !== 1 || !snapshot.providerStatic || !snapshot.calendar
      || typeof snapshot.calendar.date !== "string" || typeof snapshot.calendar.cwd !== "string"
      || typeof snapshot.nativeSessionId !== "string")) return fatal();
    if (snapshot) freeze(snapshot);

    const transitionResponse = await fetch(endpoint + "/transition", { headers: auth, signal: AbortSignal.timeout(4500) });
    if (transitionResponse.status !== 200) return fatal();
    let transition = await transitionResponse.json();
    let resolving;
    const syncNative = async manager => {
      const nativePath = manager.getSessionFile();
      if (!nativePath) return fatal();
      await manager.flush();
      const file = await open(nativePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { if (!(await file.stat()).isFile()) return fatal(); await file.sync(); }
      finally { await file.close(); }
      let directory = dirname(nativePath);
      while (true) {
        const handle = await open(directory, "r");
        try { await handle.sync(); } finally { await handle.close(); }
        const parent = dirname(directory); if (parent === directory) break; directory = parent;
      }
    };
    const mutateTransition = async (operation, payload) => {
      const response = await fetch(endpoint + "/compaction/" + operation, { method: "POST", headers: auth,
        body: JSON.stringify(payload), signal: AbortSignal.timeout(4500) });
      if (response.status !== 200) return fatal();
      transition = await response.json();
      return transition;
    };
    const resolveTransition = async manager => {
      if (resolving) return resolving;
      if (transition?.state !== "pending") return;
      resolving = (async () => {
        phase = "compaction-recovery";
        if (transition.nativeSessionId !== manager.getSessionId()) return fatal();
        const head = manager.getLeafId();
        let cursor = head;
        let changed = false;
        const visited = new Set();
        while (cursor !== transition.sourceHead) {
          if (cursor === null || visited.has(cursor) || visited.size >= 10000) return fatal();
          visited.add(cursor);
          const entry = manager.getEntry(cursor);
          if (!entry) return fatal();
          if (entry.type === "compaction") changed = true;
          cursor = entry.parentId;
        }
        if (head !== transition.sourceHead && !changed) return fatal();
        await syncNative(manager);
        await mutateTransition("finish", { id: transition.id, changed });
      })();
      try { await resolving; } finally { resolving = undefined; }
    };
    const lifecycle = handler => async (...args) => {
      const timeout = setTimeout(fatal, 5000);
      try { return await handler(...args); } catch { return fatal(); }
      finally { clearTimeout(timeout); }
    };

    let calendar = snapshot?.calendar;
    phase = "calendar-codec";
    const { DateCwdReminderInjector } = await import(${JSON.stringify(dateReminderModuleUrl)});
    const { EXTENSION_HANDLER_TIMEOUT_MS } = await import(${JSON.stringify(new URL('../extensibility/extensions/runner.ts', dateReminderModuleUrl).href)});
    if (EXTENSION_HANDLER_TIMEOUT_MS !== 30000) return fatal();
    const transform = DateCwdReminderInjector.prototype.transform;
    DateCwdReminderInjector.prototype.transform = function(context, date, cwd) {
      calendar ??= Object.freeze({ date, cwd });
      return transform.call(this, context, calendar.date, calendar.cwd);
    };

    const providerFields = new Set(["model", "instructions", "tools", "tool_choice", "parallel_tool_calls",
      "max_output_tokens", "temperature", "top_p", "reasoning", "text", "include", "prompt_cache_key",
      "prompt_cache_retention", "store", "stream", "stream_options", "service_tier", "truncation"]);
    const configFields = [...providerFields].filter(key => key !== "instructions" && key !== "tools");
    const validateTools = tools => {
      if (tools === undefined) return;
      if (!Array.isArray(tools)) return fatal();
      for (const tool of tools) {
        if (!tool || !["function", "custom"].includes(tool.type)) return fatal();
        const fields = tool.type === "function"
          ? ["type", "name", "description", "parameters", "strict", "defer_loading"]
          : ["type", "name", "description", "format"];
        // Provider-managed remote tools can contain execution credentials and
        // implicit schemas. They require a separate proven codec.
        if (Object.entries(tool).some(([key, value]) => value !== undefined && !fields.includes(key))) return fatal();
      }
    };
    if (snapshot && Object.keys(snapshot.providerStatic).some(key => !providerFields.has(key))) return fatal();
    if (snapshot) validateTools(snapshot.providerStatic.tools);
    let validated = false;
    pi.on("before_provider_request", async (event, ctx) => {
      // The pinned runner swallows errors and has a 30s handler deadline. Its
      // scoped context does not expose that deadline's signal, so our shorter
      // 5s deadline must terminate the child before native fallthrough.
      const signal = ctx.signal;
      signal?.addEventListener("abort", fatal, { once: true });
      const timeout = setTimeout(fatal, 5000);
      try {
        phase = "request-codec";
        if (signal?.aborted || ctx.model?.api !== "openai-responses" || !calendar
          || !event.payload || !Array.isArray(event.payload.input)) return fatal();
        if (Object.entries(event.payload).some(([key, value]) => value !== undefined && key !== "input" && !providerFields.has(key))) return fatal();
        validateTools(event.payload.tools);
        const manager = ctx.sessionManager;
        const nativeSessionId = manager.getSessionId();
        if (snapshot && snapshot.nativeSessionId !== nativeSessionId) return fatal();
        await resolveTransition(manager);
        if (!snapshot) {
          phase = "native-persistence";
          const historical = manager.getEntries().some(entry => entry.type === "message" && entry.message.role === "assistant");
          if (historical || typeof manager.ensureOnDisk !== "function") return fatal();
          await manager.ensureOnDisk();
          await syncNative(manager);
          // Clone once at capture. Native providers reuse mutable Tool-schema
          // objects internally; freezing those would break the next inference.
          const providerStatic = structuredClone(Object.fromEntries(Object.entries(event.payload).filter(([key, value]) => key !== "input" && value !== undefined)));
          snapshot = { format: 1, nativeSessionId, calendar, providerStatic };
          const payload = JSON.stringify(snapshot);
          phase = "durable-seal";
          const ack = await fetch(endpoint + "/seal", { method: "POST", headers: {
            ...auth, "x-native-session-id": nativeSessionId, "x-native-has-history": "false",
          }, body: payload, signal: AbortSignal.timeout(4500) });
          if (ack.status !== 200) return fatal();
          const receipt = await ack.json();
          if (receipt.digest !== createHash("sha256").update(payload).digest("hex")
            || !Number.isSafeInteger(receipt.epoch) || receipt.epoch < 1) return fatal();
          freeze(snapshot);
        }
        phase = "configuration";
        for (const field of configFields) {
          if (JSON.stringify(event.payload[field]) !== JSON.stringify(snapshot.providerStatic[field])) return fatal();
        }
        if (!validated) {
          phase = "tool-compatibility";
          // This initial codec requires an unchanged executable Tool envelope.
          // Later revisions can admit explicitly verified compatible changes.
          if (JSON.stringify(event.payload.tools) !== JSON.stringify(snapshot.providerStatic.tools)) return fatal();
          validated = true;
        }
        return { ...snapshot.providerStatic, input: event.payload.input };
      } catch { return fatal(); }
      finally { clearTimeout(timeout); signal?.removeEventListener("abort", fatal); }
    });
    // Native summarization uses the side stream, separate from the main agent's
    // before_provider_request hook. Do not replace its summarization envelope.
    const recoverBeforeInput = lifecycle(async (_event, ctx) => {
      phase = "ownership";
      await claimNativeIdentity(ctx.sessionManager.getSessionId());
      if (!snapshot) return;
      phase = "compaction-recovery";
      if (ctx.sessionManager.getSessionId() !== snapshot.nativeSessionId) return fatal();
      await resolveTransition(ctx.sessionManager);
    });
    // Resolve an unchanged head before the next user message is appended.
    // Doing this only at provider dispatch would make an aborted compaction
    // indistinguishable from an unrelated native history mutation.
    pi.on("session_start", recoverBeforeInput);
    pi.on("input", recoverBeforeInput);
    pi.on("session_before_compact", lifecycle(async (_event, ctx) => {
      phase = "compaction-prepare";
      if (!snapshot) return { cancel: true };
      await resolveTransition(ctx.sessionManager);
      await syncNative(ctx.sessionManager);
      await mutateTransition("begin", { sourceHead: ctx.sessionManager.getLeafId() });
    }));
    pi.on("session_compact", lifecycle(async (_event, ctx) => {
      if (!transition || transition.state !== "pending") return fatal();
      await resolveTransition(ctx.sessionManager);
    }));
    pi.on("session_before_switch", () => ({ cancel: true }));
    pi.on("session_before_branch", () => ({ cancel: true }));
    await writeFile(ready, JSON.stringify({ nonce, codec: ${JSON.stringify(OMP_PREFIX_CODEC)} }), { mode: 0o600 });
  } catch { return fatal(); }
}
`;
}
