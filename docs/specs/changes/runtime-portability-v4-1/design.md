# Design: Runtime Portability v4.1

## Context

Pibo owns product session identity and durable conversation events while Pi, Codex, and OMP own different native session formats. Portability therefore cannot be implemented by copying native transcripts or pretending one harness's model/options/tools apply to another.

The design separates four concerns:

1. truthful runtime capabilities;
2. bounded Pibo-owned history extraction;
3. adapter-native import/delivery;
4. checkpointed binding state.

## Capability model

`AgentRuntimeCapabilities` gains three required contracts:

```ts
contextDiscovery: {
  supported: boolean;
  configurable: boolean;
  enabledByDefault: boolean;
  strategy?: "filesystem-ancestors" | "codex-project" | "omp-project";
  knownFileNames?: string[];
  knownUserRelativePaths?: string[];
  knownCwdRelativePaths?: string[];
  knownRelativePaths?: string[];
  knownAncestorRelativePaths?: string[];
}

nativeSubagents: {
  supported: boolean;
  configurable: boolean;
  enabledByDefault: boolean;
}

historyImport: boolean;
```

Profiles and Agent Designer use these contracts directly. A nullable `nativeSubagents` profile override is accepted only when the runtime reports `nativeSubagents.configurable: true`. Automatic-context UI may be capability-aware, but persisted custom agents retain concrete legacy `autoContextFiles` behavior.

## Portable history representation

Pibo extracts a runtime-neutral sequence from its own durable session events. Entries represent user, assistant, system, tool call, tool result, and explicit marker text. Extraction applies:

- bounded entry count;
- bounded text per entry;
- bounded aggregate serialized size;
- shared sensitive-data redaction;
- deterministic omission/truncation markers;
- normalized unmatched-tool fallbacks.

The representation intentionally excludes native thread IDs, locators, auth state, credential material, harness settings, and provider-specific protocol objects.

## Checkpoint and retry state

Runtime-binding metadata stores a bounded handoff audit record:

```text
source runtime + target runtime
checkpoint
pending | completed
entry/byte/truncation counts
created/completed timestamps
bounded redacted failure detail
```

The router persists `pending` before target creation/import and marks `completed` only after adapter-owned import succeeds. Completed imports are not replayed during restoration. Metadata with mismatched runtime IDs/checkpoints or invalid bounds fails closed.

`startFresh` bypasses extraction/import explicitly. It remains auditable as a caller decision rather than an implicit fallback.

## Rebinding transaction

For a cross-runtime change the router:

1. resolves and validates the target runtime and profile;
2. rejects native target IDs/locators supplied by the caller;
3. strips source model, runtime options, and native feature overrides;
4. validates target history support unless `startFresh`;
5. extracts and persists a pending handoff;
6. creates a fresh native target session;
7. imports history through the target adapter;
8. commits the new frozen binding and completed audit metadata.

Same-runtime repair and missing-session handling retain their existing semantics.

## Adapter mappings

### Pi

Portable user/assistant/system/tool entries are converted to Pi-compatible message objects and appended through `SessionManager.appendMessage`. Pi-only compaction and branch-summary message types are not fabricated.

### Native Codex

Portable entries are mapped to stable App Server v2 thread items and sent through `thread/inject_items`. Manual compaction uses `thread/compact/start`; Pibo balances its own semantic compaction events around the native request/event sequence.

The profile state is applied explicitly at thread start/resume so a prior disabled thread can be re-enabled. Disabling uses `features.multi_agent=false`, `features.multi_agent_v2=false`, and `agents.enabled=false` so model-catalog hints cannot re-enable either native multi-agent generation; enabling restores stable `multi_agent` plus `agents.enabled` without opting into v2.

### OMP

OMP does not expose a transcript injection API with equivalent semantics. Pibo creates a private append-only handoff section in the same session-scoped file used for selected additive system context and starts OMP with `--append-system-prompt <path>`.

The adapter reports `historyImport: true`, while its delivery report and audit metadata explicitly identify append-only prompt fidelity rather than transcript fidelity. New or unbound sessions clear stale transcript and generated prompt state.

When native subagents are disabled, generated OMP settings list discovered task agents in `task.disabledAgents` and deny the task tool. This does not change Pibo portable-tool policy.

## Context discovery

Each adapter advertises its native ancestor-boundary strategy and exact known path classes. Pibo canonicalizes selected paths and applies those declared semantics before deduplicating.

- Pi scans supported filenames through filesystem ancestors and keeps its established first-file-per-directory precedence.
- Codex accounts for `AGENTS.override.md` precedence and stops at the nearest project root; without a root marker, only the current directory is considered.
- OMP models standalone `AGENTS.md`, nearest `.omp/AGENTS.md`, cwd-only Claude/Gemini/GitHub context, and `.agent/.agents` every-supported-ancestor discovery separately.

Inspection remains adapter-owned so the core does not encode harness IDs or guess unsupported behavior.

## OMP resource delivery

A session-scoped delivery object composes bounded sections for selected context and portable history. It writes with private permissions to the runtime session directory and returns only launch arguments/status metadata to the adapter.

On later turns, absence of selected context/history removes the old file and launch argument. The workspace and global OMP configuration are never modified.

## Skill collision handling

Selected skills are resolved by normalized name plus canonical selected path. OMP custom skill directories provide explicit selected directories with native precedence. Native Codex verifies that the materialized selected path—not merely a matching name—is visible to the thread; a same-name native-only result is rejected.

## Security

Shared redaction is applied before serialization and again to bounded error/audit details. Generated files and managed runtime homes remain instance-private and owner-only. Cleanup occurs on reset/dispose. Public APIs return status/capability metadata, never generated content or native protocol state.

## Rejected alternatives

### Copy native transcripts

Rejected because formats are harness-specific and may contain credentials, hidden reasoning, unsupported message kinds, or mutable native state.

### Replay old prompts through the target model

Rejected because it spends tokens, changes side effects, and is not equivalent to importing history.

### Treat all context basenames as duplicates

Rejected because same-name files at different paths can carry intentionally different instructions.

### Add nullable `auto_context_files_override` storage

Rejected because it breaks the established concrete persistence contract and creates two sources of truth.

### Blanket-disable tools when native subagents are off

Rejected because Pibo portable tools/subagents and harness-native subagents are distinct product capabilities.
