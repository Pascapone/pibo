---
type: "Specification"
title: "Muse Native Runtime Adapter"
description: "Defines the native Muse (MSP) runtime registration, SDK-driven host lifecycle, session and turn operations, approvals, models, auth, and normalized events."
tags: ["runtime", "muse-native", "adapter", "msp", "sdk"]
status: "draft"
authority: "normative"
generated:
  by: "meta/muse"
  at: "2026-09-18T11:00:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "64064fded224866ead9981b94b4197e1e616ea3d"
  requirements:
    - id: "RUN-MUS-001"
      status: "implemented"
      sources:
        - path: "src/plugins/packaged-runtime-muse-native.ts"
          symbol: "setupMuseNativeRuntime"
      tests:
        - path: "test/muse-native-packaging.test.mjs"
          name: "Muse native packaged setup registers exactly the manifest contributions"
      failures:
        - "Manifest contribution ids and registered contribution ids must agree exactly."
      confidence: "high"
    - id: "RUN-MUS-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/muse-native/process.ts"
          symbol: "startMuseNativeHost"
      tests:
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native diagnose, auth, timeouts, and import rejection behave"
      failures:
        - "Startup, handshake, and shutdown are bounded; stderr is drained, redacted, and reported as diagnostics."
        - "The child uses a private generation home and environment allowlist; the SDK experimental gate is explicit configuration."
        - "Logout removes only providers.meta.api_key and preserves other bundles; an unparseable auth file aborts logout explicitly instead of deleting."
      confidence: "high"
    - id: "RUN-MUS-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/muse-native/turn.ts"
          symbol: "MuseNativeTurnController"
        - path: "src/agent-runtimes/muse-native/sessions.ts"
          symbol: "MuseNativeSessionController"
      tests:
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native sessions pass the reusable runtime-adapter contract"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native prompt streams tool events, usage, and context pressure"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native abort, steer, and failure terminals behave"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native turn survives backoff-like silence on a responsive host"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native turn fails fast when the host stops answering"
        - path: "test/muse-native-config.test.mjs"
          name: "muse native default config selects the muse executable and on-request approvals"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native reclaimed turns fail instead of completing"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native unknown terminals fail instead of completing"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native patch summaries emit one diff update per change"
      failures:
        - "Turns carry a Pibo-owned request idle timeout; silent expiry interrupts the native turn and fails explicitly."
        - "Launch failures, failed terminals, and cancelled terminals map to distinct normalized outcomes."
        - "Reclaimed (unqueued) and host-death (terminalUnknown) outcomes map to turn_failed, never turn_completed."
        - "Item routing isolates per-item failures behind a warning; one diff_updated is emitted per changed patch summary."
        - "Idle silence spans up to three requestTimeoutMs windows while host liveness probes answer (provider retry backoff); an unresponsive host fails at the first window."
      confidence: "high"
    - id: "RUN-MUS-004"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/muse-native/resource-delivery.ts"
          symbol: "MuseNativeResourceDelivery"
      tests:
        - path: "test/muse-native-resources.test.mjs"
          name: "Muse native delivers portable tools and external MCP servers through session config"
        - path: "test/muse-native-resources.test.mjs"
          name: "Muse native re-delivers fresh portable-tool credentials on resume"
      failures:
        - "The scoped tool credential is revoked on disposal; unresolved secrets never enter the delivered config."
        - "Reopen re-sends the fresh session MCP config on session/resume; host honor of resume config is not yet live-verified."
      confidence: "medium"
    - id: "RUN-MUS-005"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/muse-native/adapter.ts"
          symbol: "MuseNativeAgentRuntimeAdapter.resolveBinding"
      tests:
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native resume, binding inspection, profiles, and models behave"
      failures:
        - "Only the normalized sessionNotFound outcome authorizes missing; auth, startup, protocol, and transient failures propagate without reconstruction."
      confidence: "high"
    - id: "RUN-MUS-006"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/muse-native/turn.ts"
          symbol: "splitMuseToolIntent"
        - path: "src/agent-runtimes/muse-native/adapter.ts"
          symbol: "museNativeCapabilities"
      tests:
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native tool calls expose the model description as intent"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native tool calls without description emit no intent"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native tool intent extraction trims, bounds, and redacts"
      failures:
        - "Intent rides tool_call and tool_execution_started only; updated and finished carry none."
        - "Tools without a model-authored description omit intent and are hidden in intent display modes."
      confidence: "high"
---

# Scope

Own muse-native plugin/driver/profile registration, SDK-driven `muse serve` host lifecycle, session/turn operations, approvals, models, reasoning, compaction, auth status, resource delivery, binding inspection, and cleanup.

Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: The adapter spawns one `muse serve` host per runtime generation through `@muse-code/sdk` 1.3.0, completes the MSP handshake before other traffic, opens exactly one native session per host (start or resume), pumps view notifications into the SDK fold, and closes the host idempotently on dispose. The handshake requests the `sessionMcp` and `sessionListStream` capabilities; session start fails explicitly when MCP config is selected but the `sessionMcp` grant is withheld.
- State: Profile and instance are muse-native; the validated SDK/CLI pin is 1.3.0 with protocol muse-session-protocol; native session identity is persisted for resume.
- Turns: Prompts submit `turn/start` with text input and per-turn reasoning effort; deltas, items, usage, and terminals map to normalized semantic events. Steering submits on the steer lane while a turn runs; abort issues `turn/interrupt`. The turn timeout is idle-based: streamed items and deltas extend the `requestTimeoutMs` budget, and only silence trips it. A silent window triggers an `approval/listPending` host liveness probe; a responsive host earns up to three windows total (provider retry backoff stays silent on the turn streams), while an unresponsive host fails at the first window. The timeout message reports total silence and host responsiveness. The default `requestTimeoutMs` is 30 minutes with a 30-minute ceiling; long silent-but-healthy work such as builds and test suites is expected to fit one window.
- Approvals: Native approval requests park in the adapter until Pibo responds with a server-offered choice; disposal aborts parked approvals explicitly.
- Models: The catalog reads `model/list`; in-session switches use `session/setModel`; reasoning defaults sync with `session/setReasoningEffort` while per-turn options always carry the selected value.
- Profiles: `runtimeOptions.approvalMode` is exposed through the models `optionsSchema` and applied at session start. The profile thinking level seeds the initial reasoning effort (`off` maps to `none`); persisted session settings take precedence on resume. Mid-session reasoning changes accept `off` as `none`, matching the seed mapping.
- Resources: Selected Pibo tools ride the session-scoped tool MCP bridge as a `streamableHttp` session server; selected external MCP servers map to `streamableHttp`/`stdio` session servers. The host sends headers verbatim without `${VAR}` interpolation, so secret values are resolved against the scoped environment before delivery; the portable-tool credential keeps its 5-minute TTL, same-token renewal, and revocation on disposal. Reopen re-sends the fresh session MCP config on `session/resume` so rotated credentials reach the host (host honor of resume config is not yet live-verified).
- Intent: Tool calls move a trimmed, redacted, 512-char-bounded model-authored `description` arg (when present) into the shared `intent` slot on `tool_call` and `tool_execution_started` and strip it from the emitted args (Pi-style), so views never show it twice; the full wire args stay available in the native session log. Intent is opportunistic: only tools whose schema carries `description` (observed: shell) emit it; tools without one omit intent and are hidden in intent display modes, matching OMP. `tools.intentTracing` reports supported, non-configurable, enabled-by-default.
- Failure: Only the normalized `sessionNotFound` outcome is authoritative absence. Auth, startup, protocol, permission, and transient inspection failures remain unavailable errors and never authorize reconstruction.
- Security: The child uses a private generation home and environment allowlist; credentials and sensitive diagnostics are redacted; tool credentials are scoped and revoked on disposal.
- Sandbox: Shell sandboxing follows config `sandbox` (`auto` by default). On Linux, `auto` starts the host with `--disable-sandbox` and a warning diagnostic when bubblewrap is missing or non-functional, or when the muse executable lives inside the session workspace (which the sandbox refuses); `enabled` forces sandboxing and `disabled` always turns it off. Other platforms keep the default host posture.
- Auth seeding: Each generation copies the instance `auth.json` to both `$HOME/.config/muse/auth.json` and `$XDG_CONFIG_HOME/muse/auth.json`, because the host resolves its config root from `XDG_CONFIG_HOME` when the adapter sets it. `startAuth` merges `providers.meta.api_key` into the stored file and preserves subscription (device-login) bundles and other providers. Logout removes only `providers.meta.api_key` and refuses to delete an unparseable file.

# Requirements and invariants

## Requirement: RUN-MUS-001

The Muse Native plugin SHALL register driver, configured instance, and profile under muse-native without registering any alias.

## Requirement: RUN-MUS-002

The host starter SHALL complete the MSP handshake before other traffic and bound startup, request, and shutdown budgets, stderr diagnostics, crashes, and malformed frames.

## Requirement: RUN-MUS-003

Muse Native SHALL submit turns with Pibo-owned timeouts, normalize assistant, reasoning, tool, usage, and terminal outcomes, preserve restart-resumable native session identity, and support adopted forks and clones.

## Requirement: RUN-MUS-004

Muse Native resource delivery SHALL assemble selected Pibo tools and external MCP servers into session-start configuration, resolve secret references against the scoped environment before delivery, renew credentials while idle, and revoke access on disposal.

## Requirement: RUN-MUS-005

Muse Native binding inspection SHALL re-read the bound native session through a fresh host, return missing only for the normalized session-not-found outcome, and propagate every other inspection failure without creating or selecting a replacement runtime.

## Requirement: RUN-MUS-006

Muse Native SHALL expose a model-authored tool `description` as normalized intent on `tool_call` and `tool_execution_started` events (trimmed, redacted, bounded to 512 characters), strip it from the emitted args so views never show it twice, omit intent when no description is present, and report `tools.intentTracing` as supported, non-configurable, and enabled by default.

# Interfaces and ownership

Implemented public contracts:

- `MUSE_NATIVE_AGENT_RUNTIME_DRIVER`
- `MuseNativeSession`
- `MuseNativeSessionController`
- `MuseNativeTurnController`
- `MuseNativeRequestController`
- `MuseNativeResourceDelivery`
- `MuseSessionSettingsController`
- `MuseNativeAuthController`
- `startMuseNativeHost`
- `setupMuseNativeRuntime`

Related ownership boundaries:

- `SPC-RUN-001`: generic adapter contract.
- `SPC-RUN-003`: portable resource/tool selection and credentials.
- `SPC-RUN-008`: cross-runtime control precedence.

# Failure and security behavior

- Startup, request, and shutdown budgets are bounded; one redacted terminal failure is emitted per failed turn.
- A turn submit rejected as conflicting with an existing event triggers one same-host session re-sync and a single prompt retry; all other rejections surface immediately.
- The child uses a private generation home and environment allowlist; credentials and sensitive diagnostics are redacted; tool credentials are scoped and revoked on disposal.

# Known limits

- Live-host verification: the core path (auth merge, provider catalog, session open, reasoning selection, one inference turn) is verified against released `muse` 1.3.0 with subscription auth (`muse-spark-1.3-contributor`, reasoning `none`). Remaining live-host gaps before production use: honoring of `config.mcpServers` on start and resume, approval-mode enforcement, and fork/cancel edge semantics.
- Generation-scoped session store (proven 2026-09-19 against released `muse` 1.3.0): the host persists native sessions under the generation-temp `XDG_DATA_HOME`, which dispose wipes, so reopen-resume fails `sessionNotFound` and open surfaces binding-missing; `MUSE_HOME` is ignored by the host. Fix direction: instance-stable `XDG_DATA_HOME`. Until fixed, resume after reopen never restores history, and the sticky probe session dies with its inspection host (it self-heals by retiring on host-authored rejection and starting a fresh probe).
- No durable first-use claim: unlike Codex Native, the first native turn has no cross-process exactly-once binding claim; concurrent routers opening the same unbound binding can start duplicate native sessions.
- Portable history import is unsupported; cross-runtime continuation reseeds from Pibo product history only.
- Skills and context-file delivery are declared unsupported: session configuration carries only MCP servers, and the host skill listing (`skill/list`) is not consumed.
- Tool credentials expire with the bridge lifetime (30 minutes maximum); renewal extends while idle but rotation without reopening the runtime session is unsupported.
- Auth status reflects a stored credential file and is not a live validity proof; device and browser login flows must complete outside Pibo. Only `providers.meta.api_key` reports connected; `start()` preserves other providers in `auth.json`.
- Compaction admission is reported synchronously with its ack status (`accepted`, or `noop` with a reason); the asynchronous native terminal is not awaited.
- Fork candidates are tracked per process; after a resume the candidate list is empty until new turns complete.
- Pending approvals predating a resume are carried on the session opening but are not re-surfaced as Pibo approval requests unless the host re-emits them.
- Streaming redaction applies per protocol chunk; secrets split across chunk boundaries survive, and item text truncated past 64 KiB carries no truncation marker.
- Model-catalog inspection shares one sticky probe session per adapter instance; MSP offers no session delete.
- Profile validation is fail-closed and spawns a host on a cold 5-second catalog cache: when the catalog is unreachable, binding is refused, so offline hosts cannot bind. Accepted availability cost of never binding an unverified model.
- Runtime config and profile option parsers reject unknown keys (fail-closed); new options require an adapter update. Accepted explicitly to surface typos instead of silently ignoring them.

# Verification and traceability

Source symbols and named tests are bound to the traceability commit. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/muse-native-*.test.mjs`

# Related concepts

- `SPC-RUN-001` owns generic adapter contract.
- `SPC-RUN-005` owns Codex Native implementation (structural blueprint).
- `SPC-RUN-003` owns resource and tool-generation services.
