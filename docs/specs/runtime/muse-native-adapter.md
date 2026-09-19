---
type: "Specification"
title: "Muse Native Runtime Adapter"
description: "Defines the native Muse (MSP) runtime registration, SDK-driven host lifecycle, session and turn operations, approvals, models, sandbox control, auth, and normalized events."
tags: ["runtime", "muse-native", "adapter", "msp", "sdk"]
status: "draft"
authority: "normative"
generated:
  by: "meta/muse"
  at: "2026-09-18T11:00:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "ad7d33bc4f70e6a407c93c727e4881e2f697bdec"
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
        - path: "src/agent-runtimes/muse-native/adapter.ts"
          symbol: "MuseNativeAgentRuntimeAdapter.openSession"
      tests:
        - path: "test/muse-native-resources.test.mjs"
          name: "Muse native delivers portable tools and external MCP servers through session config"
        - path: "test/muse-native-resources.test.mjs"
          name: "Muse native re-delivers fresh portable-tool credentials on resume"
        - path: "test/muse-native-resources.test.mjs"
          name: "Muse native injects selected skills and context into the first turn only"
        - path: "test/muse-native-resources.test.mjs"
          name: "Muse native skips injection on unchanged resume and re-injects on changed selection"
        - path: "test/muse-native-resources.test.mjs"
          name: "Muse native opens when skill/list verification fails"
      failures:
        - "The scoped tool credential is revoked on disposal; unresolved secrets never enter the delivered config."
        - "Reopen re-sends the fresh session MCP config on session/resume; host honor of resume config is not yet live-verified."
        - "Selected skills and context ride the first turn text once; unchanged resume skips re-injection via the persisted selection hash."
        - "skill/list verification refines delivery reports only; a failed listing never fails the session open."
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
    - id: "RUN-MUS-007"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/muse-native/adapter.ts"
          symbol: "MuseNativeSession.setSandbox"
        - path: "src/core/capabilities.ts"
          symbol: "CoreCapabilitiesPlugin.register"
      tests:
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native sandbox toggle restarts the host and preserves the session"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native session open resolves profile sandbox options above instance config"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native sandbox toggle override wins on reopen"
        - path: "test/sandbox-gateway-action.test.mjs"
          name: "sandbox gateway action toggles the runtime sandbox"
      failures:
        - "Sandbox changes are idle-only and replace the host before changing the live session reference."
        - "The same native session id and selected session MCP configuration survive the replacement host resume."
        - "The explicit toggle override persists in binding metadata and wins when the Pibo Session reopens."
      confidence: "high"
    - id: "RUN-MUS-008"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/muse-native/turn.ts"
          symbol: "MuseNativeTurnController"
        - path: "src/agent-runtimes/muse-native/sessions.ts"
          symbol: "MuseNativeConnectionPump"
      tests:
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native view-death turn recovers via page walk and settles"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native abort settles a stuck turn within the abort bound"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native turn fails fast when the native turn is over but unrecoverable"
        - path: "test/muse-native-session.test.mjs"
          name: "Muse native connection pump tracks the last live view cursor"
      failures:
        - "Silence windows reconcile via session/read before failing; running turns backfill and re-arm."
        - "Recovered terminals settle through the normal terminal path with one reconciling and one recovered notice."
        - "Unrecoverable finished turns fail fast; abort settles locally once the abort bound expires."
      confidence: "high"
---

# Scope

Own muse-native plugin/driver/profile registration, SDK-driven `muse serve` host lifecycle, session/turn operations, approvals, models, reasoning, compaction, auth status, resource delivery, binding inspection, and cleanup.

Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: The adapter spawns one `muse serve` host per runtime generation through `@muse-code/sdk` 1.3.0, completes the MSP handshake before other traffic, opens exactly one native session per host (start or resume), pumps view notifications into the SDK fold, and closes the host idempotently on dispose. The handshake requests the `sessionMcp` and `sessionListStream` capabilities; session start fails explicitly when MCP config is selected but the `sessionMcp` grant is withheld.
- State: Profile and instance are muse-native; the validated SDK/CLI pin is 1.3.0 with protocol muse-session-protocol; native session identity is persisted for resume.
- Turns: Prompts submit `turn/start` with text input and per-turn reasoning effort; deltas, items, usage, and terminals map to normalized semantic events. Steering submits on the steer lane while a turn runs; abort issues `turn/interrupt`. The turn timeout is idle-based: streamed items and deltas extend the `requestTimeoutMs` budget, and only silence trips it. Each silence window (default 60s poll, never coarser than `requestTimeoutMs`) first reconciles authoritatively via `session/read`: a still-running native turn is backfilled from `view/page` starting at the last live cursor and re-arms; a natively finished turn is recovered the same way and settles through the normal terminal path; only an unreadable host falls back to the `approval/listPending` liveness probe. A responsive host earns up to three `requestTimeoutMs` of total silence (provider retry backoff stays silent on the turn streams), while an unresponsive host fails at the first window; a natively finished turn whose terminal cannot be reconciled fails fast after one retry window. Recovery announces itself with one `reconciling` line and, on success, one `recovered` line (warning plus reasoning text), and reports per-check telemetry as a redacted `native_event`. Abort waits for native settlement only up to `abortTimeoutMs` (default 15s), then settles locally as cancelled with an honest line. The timeout message reports total silence and host responsiveness. The default `requestTimeoutMs` is 30 minutes with a 30-minute ceiling; long silent-but-healthy work such as builds and test suites is expected to fit one window.
- Approvals: Native approval requests park in the adapter until Pibo responds with a server-offered choice; disposal aborts parked approvals explicitly.
- Models: The catalog reads `model/list`; in-session switches use `session/setModel`; reasoning defaults sync with `session/setReasoningEffort` while per-turn options always carry the selected value.
- Profiles: `runtimeOptions.approvalMode` and `runtimeOptions.sandbox` (`auto`, `enabled`, or `disabled`) are exposed through the models `optionsSchema` and applied at session start. The profile thinking level seeds the initial reasoning effort (`off` maps to `none`); persisted session settings take precedence on resume. Mid-session reasoning changes accept `off` as `none`, matching the seed mapping.
- Resources: Selected Pibo tools ride the session-scoped tool MCP bridge as a `streamableHttp` session server; selected external MCP servers map to `streamableHttp`/`stdio` session servers. The host sends headers verbatim without `${VAR}` interpolation, so secret values are resolved against the scoped environment before delivery; the portable-tool credential keeps its 5-minute TTL, same-token renewal, and revocation on disposal. Reopen, same-host intake recovery, and sandbox host replacement all re-send the current session MCP config on `session/resume` so selected servers and rotated credentials reach the host (host honor of resume config is not yet live-verified). Selected skills and context ride a degraded `muse-turn-prefix`: the SKILL.md bodies and context contents render once into the first turn text while `displayText` keeps the original user message; a canonical selection hash persists in binding metadata so unchanged resume skips re-injection and changed selections re-inject as an update. `skill/list` is consumed as verification only — host-catalog matches are reported as supplementary invocability, never as a replacement for injection, and a failed listing degrades matching without failing the open.
- Intent: Tool calls move a trimmed, redacted, 512-char-bounded model-authored `description` arg (when present) into the shared `intent` slot on `tool_call` and `tool_execution_started` and strip it from the emitted args (Pi-style), so views never show it twice; the full wire args stay available in the native session log. Intent is opportunistic: only tools whose schema carries `description` (observed: shell) emit it; tools without one omit intent and are hidden in intent display modes, matching OMP. `tools.intentTracing` reports supported, non-configurable, enabled-by-default.
- Failure: Only the normalized `sessionNotFound` outcome is authoritative absence. Auth, startup, protocol, permission, and transient inspection failures remain unavailable errors and never authorize reconstruction.
- Security: The child uses a private generation home and environment allowlist; credentials and sensitive diagnostics are redacted; tool credentials are scoped and revoked on disposal.
- Sandbox: Shell sandboxing follows the persisted Session override, then profile `runtimeOptions.sandbox`, then instance config `sandbox` (`auto` by default). On Linux, `auto` starts the host with `--disable-sandbox` and a warning diagnostic when bubblewrap is missing or non-functional, or when the muse executable lives inside the session workspace (which the sandbox refuses); `enabled` forces sandboxing and `disabled` always turns it off. Other platforms keep the default host posture. The `sandbox` gateway action and `/sandbox` command are idle-only controls: they start a replacement host with the opposite effective posture, require `sessionMcp` again when selected resources need it, resume the same native session with the current MCP config, atomically adopt the replacement only after resume succeeds, persist the explicit override in binding metadata, then close the prior host. Runtimes without sandbox controls return an unsupported result without mutation.
- Auth seeding: Each generation copies the instance `auth.json` to both `$HOME/.config/muse/auth.json` and `$XDG_CONFIG_HOME/muse/auth.json`, because the host resolves its config root from `XDG_CONFIG_HOME` when the adapter sets it. `startAuth` merges `providers.meta.api_key` into the stored file and preserves subscription (device-login) bundles and other providers. Logout removes only `providers.meta.api_key` and refuses to delete an unparseable file.

# Requirements and invariants

## Requirement: RUN-MUS-001

The Muse Native plugin SHALL register driver, configured instance, and profile under muse-native without registering any alias.

## Requirement: RUN-MUS-002

The host starter SHALL complete the MSP handshake before other traffic and bound startup, request, and shutdown budgets, stderr diagnostics, crashes, and malformed frames.

## Requirement: RUN-MUS-003

Muse Native SHALL submit turns with Pibo-owned timeouts, normalize assistant, reasoning, tool, usage, and terminal outcomes, preserve restart-resumable native session identity, and support adopted forks and clones.

## Requirement: RUN-MUS-004

Muse Native resource delivery SHALL assemble selected Pibo tools and external MCP servers into session-start configuration, resolve secret references against the scoped environment before delivery, renew credentials while idle, and revoke access on disposal. It SHALL deliver selected skills and context as degraded first-turn text (`muse-turn-prefix`), persist the canonical selection hash in binding metadata, skip re-injection on unchanged resume, and treat `skill/list` as verification only.

## Requirement: RUN-MUS-005

Muse Native binding inspection SHALL re-read the bound native session through a fresh host, return missing only for the normalized session-not-found outcome, and propagate every other inspection failure without creating or selecting a replacement runtime.

## Requirement: RUN-MUS-006

Muse Native SHALL expose a model-authored tool `description` as normalized intent on `tool_call` and `tool_execution_started` events (trimmed, redacted, bounded to 512 characters), strip it from the emitted args so views never show it twice, omit intent when no description is present, and report `tools.intentTracing` as supported, non-configurable, and enabled by default.

## Requirement: RUN-MUS-007

Muse Native SHALL expose validated profile sandbox options and an idle-only runtime sandbox toggle that replaces the host without replacing the native session, retains selected session MCP delivery, persists the explicit Session override, and leaves the current host and binding untouched when replacement startup or resume fails.

## Requirement: RUN-MUS-008

Muse Native SHALL reconcile a silent turn authoritatively before failing it: check the native turn state via `session/read`, backfill missed view frames via bounded `view/page` walks from the last live cursor, fold each cursor at most once, settle a recovered terminal through the normal terminal path with one `reconciling` and one `recovered` notice, fail fast when a natively finished turn stays unrecoverable, and bound abort settlement before forcing local cancellation.

# Interfaces and ownership

Implemented public contracts:

- `MUSE_NATIVE_AGENT_RUNTIME_DRIVER`
- `MuseNativeSession`
- `MuseNativeSessionController`
- `MuseNativeTurnController`
- `MuseNativeRequestController`
- `MuseNativeResourceDelivery`
- `buildMuseNativeTurnPrefix`
- `listMuseNativeSkills`
- `matchMuseNativeSkillSelector`
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
- Sandbox replacement starts and resumes the candidate host before the live host reference changes; a failed candidate is closed, while the existing host and binding remain active.
- The child uses a private generation home and environment allowlist; credentials and sensitive diagnostics are redacted; tool credentials are scoped and revoked on disposal.

# Known limits

- Live-host verification: the core path (auth merge, provider catalog, session open, reasoning selection, one inference turn) is verified against released `muse` 1.3.0 with subscription auth (`muse-spark-1.3-contributor`, reasoning `none`). Remaining live-host gaps before production use: honoring of `config.mcpServers` on start and resume, the sandbox replacement/resume control, approval-mode enforcement, and fork/cancel edge semantics.
- Session-stable native session store (fixed 2026-09-19; previously generation-scoped, proven against released `muse` 1.3.0): the host persists native sessions under `XDG_DATA_HOME`, which now points at `<sessionRoot>/xdg-data` outside the wiped generation root, so resume survives rebind, restart, and disposal with per-Pibo-session isolation preserved; `MUSE_HOME` is ignored by the host. The sticky probe session now survives its inspection host as well (retiring on host-authored rejection remains as a self-heal).
- No durable first-use claim: unlike Codex Native, the first native turn has no cross-process exactly-once binding claim; concurrent routers opening the same unbound binding can start duplicate native sessions.
- Portable history import is unsupported; cross-runtime continuation reseeds from Pibo product history only.
- Skills and context-file delivery are degraded (`muse-turn-prefix`), not native: only SKILL.md bodies are injected (sibling skill files are reported, never delivered), there is no verified native project-context discovery to deduplicate against so everything selected is injected, and native compaction may summarize the injected text like any other history. Workspace/user-scope skill materialization behind `serve --trust-workspace` is deliberately not used: it would write foreign files into the user workspace or mutate global user scope and would load arbitrary workspace skills and rules beyond the Pibo selection.
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
