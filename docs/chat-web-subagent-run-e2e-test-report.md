# Chat Web Subagent Run E2E Test Report

Date: 2026-05-01

## Scope

Manual end-to-end browser test of Chat Web with:

- one direct subagent call
- one async subagent call via `pibo_run_start`
- trace rendering
- durable run/job state
- debug CLI consistency checks

## Setup

- App: `http://4788.192.168.0.204.sslip.io/apps/chat`
- Browser automation: `browser-use --session pibo-auth`
- Gateway: `npm run gateway:web`
- Profile used: `main-agent`
- Subagent profile observed: `sub-agent`

Prompt:

```text
Ich möchte, dass du einen Subagent beauftragst, sich seinen Workspace anzuschauen und dir einen Überblick über das Projekt zu geben. Gebe mir dann davon das TLDR. Starte den ersten Agent direkt und dann im Anschluss einen über `pibo_start_run`.
```

The model correctly treated `pibo_start_run` as `pibo_run_start`.

## Test IDs

- Parent session: `ps_8c16dba0-cff9-4761-8716-da32067072d8`
- Direct subagent session: `ps_3d2e4311-dec4-498c-b301-7842d575b1ae`
- Async subagent session: `ps_8ebd3cb3-a15d-4cfd-9b5d-53f92db81a97`
- Async run: `run_37eca340-ab5c-4de4-9c2a-a22b52df9c3e`

## Results

Passed:

- Chat Web created and opened the new `main-agent` session.
- Prompt submission worked.
- Direct subagent rendered as `Agent Delegation` and linked to the correct child session.
- Async subagent rendered as `Async Agent`.
- `pibo_run_start`, `pibo_run_wait`, and `pibo_run_read` all appeared in the parent trace.
- Final assistant response produced a project TLDR.
- Debug trace checks for parent and async child returned `checks.status: "ok"`.
- Durable run finished as `completed` and `consumed: true`.
- Live `runs` queue and dead jobs were empty after completion.

## Timings And Metrics

Observed trace timings:

- Direct subagent delegation: about `9.0s`
- Async agent span: about `152.6s`
- `pibo_run_wait`: about `145.9s`
- Final page load metric from browser navigation: about `75ms`
- JS heap after test: about `8.9 MB` used / `10.0 MB` total

Reliability event volume for this run:

- Parent: about `1.1k` `live_delta` rows
- Direct child: about `1.4k` `live_delta` rows
- Async child: about `3.0k` `live_delta` rows

## Issues Found

1. Debug CLI lock during active writes  
   During the active run, `pibo debug trace` and `pibo debug events` transiently failed with `database is locked`. After the run completed, the same commands succeeded.

2. Stale/misleading child trace active status  
   The async child debug trace was `done`, and Chat Web store status was `idle`, but the child UI header still showed `1 ACTIVE` / `Active main-agent`, even after reload.

3. Trace panel horizontal overflow  
   Parent and child trace screenshots showed a horizontal scrollbar and clipped long summary lines at an `880x847` viewport.

4. High live-delta volume  
   Mirroring every output delta into `pibo.output` works, but needs an operational retention/pruning path for `live_delta` rows.

## Artifacts

Screenshots:

- `.pibo/test-trace-parent.png`
- `.pibo/test-trace-child.png`

Follow-up implementation plan:

- `plans/harden-chat-web-subagent-run-e2e.md`
