# PRD: Managed Browser Pool and CDP Reuse

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../spec.md`, `../design.md`, `../../../capabilities/browser-automation-desktop-environment.md`

## 1. Executive Summary

- **Problem Statement**: browser-use can start new Chromium processes across repeated agent sessions, and Pibo currently lacks a worker-level authority that enforces reuse or a maximum browser count.
- **Proposed Solution**: Add a worker-scoped managed browser pool that starts or reuses a bounded Chromium process, exposes a stable CDP URL, and serializes browser-use access through leases.
- **Success Criteria**:
  - SC-01: Repeated browser-use invocations in one worker reuse the same healthy CDP browser.
  - SC-02: Concurrent acquire requests never exceed the configured browser main-process limit.
  - SC-03: Pool status reports pid, CDP URL, profile path, active lease, last-used time, and health.
  - SC-04: browser-use receives a managed CDP URL instead of silently starting an unmanaged browser in compute workers.

## 2. User Experience & Functionality

- **User Personas**:
  - AI agent running browser verification.
  - Tooling engineer debugging browser-use behavior.
  - Operator inspecting process growth inside a worker.

- **User Stories**:
  - As an agent, I want to call browser-use normally so that Pibo handles reuse without extra prompt instructions.
  - As an operator, I want to see whether a worker browser pool is empty, ready, leased, stale, or dirty.
  - As a tooling engineer, I want machine-readable pool state so that tests and monitors can assert process limits.

- **Acceptance Criteria**:
  - Pool acquire creates a browser only when no healthy managed browser exists.
  - Pool acquire returns `cdpUrl`, `leaseId`, `pid`, `userDataDir`, and `expiresAt` in JSON-capable form.
  - Pool acquire uses a lock so concurrent requests do not start duplicate Chromium main processes.
  - Pool release updates active lease state and `lastUsedAt`.
  - Pool status text is compact and includes next commands for stale/dirty states.
  - Pool status JSON is stable enough for agents to decide whether to reap, wait, or recycle.

- **Non-Goals**:
  - Managing arbitrary non-Pibo browser profiles.
  - Guaranteeing parallel browser tests on small hosts.
  - Replacing browser-use APIs.

## 3. AI System Requirements

- **Tool Requirements**:
  - Browser-use wrapper integration.
  - CDP reachability probe such as `/json/version`.
  - Pool state lock and state file/store.
  - JSON output from pool status/acquire/release paths.

- **Evaluation Strategy**:
  - Unit test acquire/release state transitions.
  - Simulate concurrent acquire calls and assert one browser start.
  - Stub CDP health probes for healthy, unreachable, stale, and malformed state.
  - Integration test repeated browser-use commands in a worker and count browser main-process trees.

## 4. Technical Specifications

- **Architecture Overview**:
  - The browser pool is keyed by worker id and stores the managed browser pid, process group id, CDP port, user-data dir, active lease id, owner metadata, timestamps, and state.
  - The browser-use wrapper requests a pool lease before invoking browser-use. It exports or passes the pool CDP URL to browser-use.
  - If the current managed browser is healthy, acquire returns it. If it is stale, acquire marks stale and starts at most one replacement under lock.
  - The default policy is one browser lane per worker. Larger workers may override pool size later.

- **Integration Points**:
  - `src/tools/browser-use-wrapper.ts` for environment injection and browser start interception.
  - `src/tools/browser-use-cdp.ts` for CDP discovery and health checks.
  - `scripts/docker-entrypoint.sh` for worker environment defaults.
  - `Dockerfile` for Chromium binary path and display dependencies.

- **Security & Privacy**:
  - Pool status may show profile paths but must not print cookies or profile contents.
  - Pool state must be local to the worker or host Pibo state and not exposed over network APIs by default.
  - CDP URL remains loopback-scoped inside the worker unless compute port mapping explicitly exposes it.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: add pool state model, lock, status, and wrapper CDP injection.
  - V1: add acquire/release integration and repeated-use tests.
  - V1.1: add queue policy or multi-lane pool for larger hosts.

- **Technical Risks**:
  - CDP reuse can leave tabs from prior checks; mitigate in the cleanup PRD.
  - Pool locks can deadlock if a process dies; mitigate with lock timeouts and stale lock detection.
  - browser-use may resist external CDP injection in some modes; mitigate with a documented fallback that fails clearly rather than spawning unmanaged browsers silently.
