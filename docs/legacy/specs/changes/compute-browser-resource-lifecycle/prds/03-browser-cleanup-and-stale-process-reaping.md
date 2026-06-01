# PRD: Browser Cleanup and Stale Process Reaping

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../spec.md`, `../design.md`, `../../../capabilities/browser-use-authenticated-leases.md`

## 1. Executive Summary

- **Problem Statement**: Browser processes can survive after browser-use sessions finish, and current cleanup can miss `/usr/bin/chromium` when it searches for Chrome-specific process patterns.
- **Proposed Solution**: Add reliable browser-pool release and reap behavior that closes tabs/contexts, terminates stale Pibo-managed `chrome|chromium` process trees, cleans stale CDP state, and coordinates with authenticated profile leases.
- **Success Criteria**:
  - SC-01: Stale `chromium` and `chrome` processes tied to Pibo-managed profiles are detected and terminated.
  - SC-02: Cleanup never kills unrelated host browser profiles or the auth template profile.
  - SC-03: Idle browser pools recycle after the configured idle timeout.
  - SC-04: Release/reap output reports affected leases, browsers, processes, and stale files.

## 2. User Experience & Functionality

- **User Personas**:
  - Agent that needs browser-use cleanup to happen automatically.
  - Operator running manual cleanup after resource pressure.
  - Engineer maintaining authenticated browser-use profile slots.

- **User Stories**:
  - As an agent, I want release to close my browser lease so that later sessions inherit a clean browser state.
  - As an operator, I want stale browser cleanup to match `chromium` and `chrome` safely so that leaked processes do not accumulate.
  - As an auth-template user, I want cleanup to preserve my template profile so that login state is not destroyed.

- **Acceptance Criteria**:
  - Release attempts CDP tab/context cleanup when reachable.
  - Release still updates pool/lease state when CDP cleanup fails.
  - Reap uses pid/process group metadata before command-line matching.
  - Command-line matching requires a Pibo-managed user-data directory or recorded pool/profile metadata.
  - Stale CDP pid/port files are removed after the related process is dead or killed.
  - Auth lease release coordinates with browser-pool release when an auth slot was used.
  - Reap has text and JSON output.

- **Non-Goals**:
  - Broad-killing all Chromium processes on the host.
  - Deleting auth template profiles automatically.
  - Reaping browser profiles owned by other applications.

## 3. AI System Requirements

- **Tool Requirements**:
  - Process inspection with pid, process group, command line, and liveness checks.
  - CDP tab/context listing and close/reset helper.
  - Browser-use auth lease registry integration.
  - Reap command with dry-run or report mode.

- **Evaluation Strategy**:
  - Unit tests for process matching using `chrome`, `chromium`, Pibo profile dirs, unrelated profile dirs, and template dirs.
  - Tests for stale pid files, dead processes, reachable CDP with stale pid, and unreachable CDP with live pid.
  - Auth lease tests that release a slot and verify matching browser-pool lease release.
  - Integration test that starts a managed browser, marks it idle, reaps it, and confirms the process tree exits.

## 4. Technical Specifications

- **Architecture Overview**:
  - Release is the normal path: close lease-owned tabs/contexts, update lease state, and keep or stop the browser according to idle policy.
  - Reap is the corrective path: identify stale leases, stale CDP files, dead pids, unreachable browsers, and extra browser main-process trees tied to Pibo-managed profiles.
  - Cleanup order is conservative: CDP close, pid/process group termination, profile-scoped `chrome|chromium` matching, state-file cleanup.
  - Auth profile leases remain separate from browser-pool leases but can link to a pool lease id.

- **Integration Points**:
  - `src/tools/browser-use-wrapper.ts` for process start metadata.
  - `src/tools/browser-use-leases.ts` for auth slot coordination.
  - `src/tools/browser-use-cdp.ts` for CDP reachability and target cleanup.
  - `pibo tools browser-use health` for stale-state reporting.

- **Security & Privacy**:
  - Cleanup reports profile paths and ids only; it does not read or print cookies or local storage.
  - Reapers must never infer ownership solely from process name.
  - Template profile lock files are warnings, not deletion targets.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: fix process matching to include `chromium` and scope by Pibo profile dirs.
  - V1: implement lease release/reap with pid/process group cleanup and stale file cleanup.
  - V1.1: add CDP tab/context cleanup and idle recycling automation.

- **Technical Risks**:
  - Process command lines can be truncated; mitigate by preferring pid/process group metadata.
  - CDP cleanup can hang; mitigate with short timeouts and fallback state updates.
  - Killing process groups may leave zombies if PID 1 does not reap; mitigate with Docker `--init` in worker limits PRD.
