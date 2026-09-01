---
type: Specification
title: Scheduled Pibo Jobs
description: Defines the implemented scheduled pibo jobs contract and its current ownership, security, compatibility, and
  verification boundaries.
tags:
- orchestration
- workflows
status: stable
authority: normative
generated:
  by: openai/codex
  at: '2026-08-30T09:44:54Z'
sources:
- resource: scope:Current implementation and tests at traceability.commit
  title: upstream/dev refresh source and test evidence for SPC-ORCH-004
implementation:
  state: current
  baseline_commit: 39090b8850758293e69380a52bb7498d7c955bc2
  package: WP-04-ORCHESTRATION
  source_evidence: performed
  focused_test_execution: performed in Docker after authoring; see implementation report
  build_and_typecheck_execution: performed in Docker after authoring; see implementation report
traceability:
  commit: 39090b8850758293e69380a52bb7498d7c955bc2
  requirements:
  - id: ORCH-CRON-001
    status: implemented
    sources:
    - path: src/cron/schedule.ts
      symbol: validateSchedule
    - path: src/cron/schedule.ts
      symbol: computeNextRunAt
    - path: src/cron/schedule.ts
      symbol: parseFriendlySchedule
    - path: src/cron/schedule.ts
      symbol: parseDurationMs
    - path: src/cron/store.ts
      symbol: PiboCronStore.createJob
      owner: PiboCronStore
      member: createJob
    - path: src/cron/store.ts
      symbol: PiboCronStore.updateJob
      owner: PiboCronStore
      member: updateJob
    tests:
    - path: test/cron-schedule.test.mjs
      name: cron expression treats weekday 7 as Sunday
    - path: test/cron-schedule.test.mjs
      name: cron expression honors the configured timezone
    - path: test/cron-schedule.test.mjs
      name: friendly schedule validation rejects invalid times and durations
    - path: test/cron-store-lifecycle.test.mjs
      name: cron store validates required job fields before persisting
    failures:
    - Invalid schedules and targets fail before persistence; room/profile checks are repeated by the Chat API.
    confidence: high
  - id: ORCH-CRON-002
    status: implemented
    sources:
    - path: src/cron/store.ts
      symbol: PiboCronStore.reserveDueRuns
      owner: PiboCronStore
      member: reserveDueRuns
    - path: src/cron/store.ts
      symbol: PiboCronStore.reserveManualRun
      owner: PiboCronStore
      member: reserveManualRun
    - path: src/cron/service.ts
      symbol: PiboCronService
    tests:
    - path: test/cron-store-lifecycle.test.mjs
      name: cron store completes recurring runs and schedules the next tick
    failures:
    - BEGIN IMMEDIATE serializes reservations; manual run on a running job errors.
    confidence: medium
  - id: ORCH-CRON-003
    status: implemented
    sources:
    - path: src/cron/service.ts
      symbol: PiboCronService.executeJob
      owner: PiboCronService
      member: executeJob
    - path: src/cron/service.ts
      symbol: PiboCronService.emitMessageAndWait
      owner: PiboCronService
      member: emitMessageAndWait
    - path: src/apps/chat/cron-api.ts
      symbol: handleChatCronApiRequest
    tests:
    - path: test/chat-cron-api.test.mjs
      name: chat cron API creates default-chat cron targets without partition payloads
    - path: test/chat-cron-api.test.mjs
      name: chat cron API requires an existing writable room before creating room cron targets
    failures:
    - Archived/missing rooms fail dispatch; API mutations require same-origin JSON; the current 30-minute waiter timeout does
      not abort the created Pibo Session.
    confidence: medium
  - id: ORCH-CRON-004
    status: implemented
    sources:
    - path: src/cron/store.ts
      symbol: PiboCronStore.completeRun
      owner: PiboCronStore
      member: completeRun
    - path: src/cron/store.ts
      symbol: PiboCronStore.recoverInterruptedRuns
      owner: PiboCronStore
      member: recoverInterruptedRuns
    tests:
    - path: test/cron-store-lifecycle.test.mjs
      name: cron store error completion increments and later success resets consecutive errors
    - path: test/cron-store-lifecycle.test.mjs
      name: cron store deleteAfterRun keeps failed one-shot jobs but deletes successful ones
    - path: test/cron-store-lifecycle.test.mjs
      name: cron store recovers interrupted runs without leaving jobs running
    failures:
    - A failed at job is retained enabled without nextRunAt; specifications must record this exact behavior instead of asserting
      that every enabled job is schedulable.
    confidence: high
---
# Spec: Scheduled Pibo Jobs


## Why

Scheduled work must reserve execution transactionally and make each execution visible as a normal Pibo Session while preserving the current one-shot and timeout edge cases.

## Goal

The Cron store, service, CLI, and Chat API define scheduling, reservation, execution-session creation, and settlement.

## Authority and ownership

- **Stable concept:** `SPC-ORCH-004`
- **Target path:** `docs/specs/orchestration/scheduled-jobs.md`
- **Authority:** upstream/dev refresh source and test evidence at `39090b8850758293e69380a52bb7498d7c955bc2`.
- **Normative owner:** This document owns the public surfaces and behavior listed below. Generic reliability schemas, product/session topology, gateway authorization, runtime adapters, resource policy, and Web rendering remain owned by their linked specifications.
- **Evidence rule:** Source and named-test locators are exact references to regular Git blobs at the upstream/dev refresh commit. They identify evidence; they do not imply that real CLI, process, provider, browser, Windows, host-pressure, restart, or Pibo2 paths were executed.

## Public surfaces

- `pibo cron`
- `/api/chat/cron/status`
- `/api/chat/cron/jobs`
- `/api/chat/cron/runs`
- `/api/chat/cron/jobs/:id`
- `/api/chat/cron/jobs/:id/run`
- `pibo_cron_jobs`
- `pibo_cron_runs`

## Current implemented contract

### Schedule

Supports at/every/five-field cron and friendly in/at/every/daily/weekly/monthly/advanced inputs. every is at least one minute; at must be future; cron weekday 7 is Sunday; timezone uses Intl; search horizon is five leap-year-sized years.

### Commands Api

CLI commands are status/list/add/edit/enable/disable/remove/runs. GET reads status/jobs/runs/job; POST/PATCH/DELETE mutations require authenticated Chat Web handling, same origin, and JSON content type. Names/descriptions/prompts are capped at 120/500/20000 characters; only known profiles and existing writable rooms/default-chat targets are accepted.

### State Timeout Recovery

Store reservation uses BEGIN IMMEDIATE and rejects already-running jobs. Service defaults to 60 s polling, concurrency 2, and 30 min wait timeout. Startup marks runs older than five minutes interrupted/error. Each execution creates a visible kind=cron Chat Web Pibo Session.

### Settlement

Successful at jobs disable; successful deleteAfterRun at jobs delete. Recurring completion computes nextRunAt; errors increment consecutiveErrors and later success resets it. A failed at job remains enabled but has no nextRunAt.

### Security

Cron data is app-global after authentication, not account-tenant partitioned. Legacy personal targets are rejected.

## Scope

### In scope

- pibo cron
- /api/chat/cron/status
- /api/chat/cron/jobs
- /api/chat/cron/runs
- /api/chat/cron/jobs/:id
- /api/chat/cron/jobs/:id/run
- pibo_cron_jobs
- pibo_cron_runs
- The current source-grounded behavior and its explicit limits.
- Cross-owner links needed to use the contract safely.

### Out of scope

- Unimplemented future workflow webhook or Cron triggers.
- A claim that manual traversal and separate dispatch primitives form a universal integrated, restart-resuming graph executor.
- Provider, browser, host, Windows, Pibo2, or real process-path guarantees not established by executed validation.

## Requirements

### Requirement: ORCH-CRON-001

Cron MUST validate and persist at/every/five-field-cron plus supported friendly forms, enforce future/minimum/timezone bounds, and compute deterministic next-run timestamps.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Invalid schedules and targets fail before persistence; room/profile checks are repeated by the Chat API.

#### Acceptance evidence

- Exact source evidence:
  - `src/cron/schedule.ts:16` — `validateSchedule` (exported_symbol)
  - `src/cron/schedule.ts:34` — `computeNextRunAt` (exported_symbol)
  - `src/cron/schedule.ts:52` — `parseFriendlySchedule` (exported_symbol)
  - `src/cron/schedule.ts:103` — `parseDurationMs` (exported_symbol)
  - `src/cron/store.ts:127` — `PiboCronStore.createJob` (method)
  - `src/cron/store.ts:165` — `PiboCronStore.updateJob` (method)
- Exact named tests:
  - `test/cron-schedule.test.mjs:14` — “cron expression treats weekday 7 as Sunday”
  - `test/cron-schedule.test.mjs:32` — “cron expression honors the configured timezone”
  - `test/cron-schedule.test.mjs:41` — “friendly schedule validation rejects invalid times and durations”
  - `test/cron-store-lifecycle.test.mjs:26` — “cron store validates required job fields before persisting”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-CRON-002

Due and manual execution reservations MUST be transactional, permit at most one running reservation per job, persist the run before dispatch, and respect service concurrency.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

BEGIN IMMEDIATE serializes reservations; manual run on a running job errors.

#### Acceptance evidence

- Exact source evidence:
  - `src/cron/store.ts:212` — `PiboCronStore.reserveDueRuns` (method)
  - `src/cron/store.ts:240` — `PiboCronStore.reserveManualRun` (method)
  - `src/cron/service.ts:42` — `PiboCronService` (type_or_class)
- Exact named tests:
  - `test/cron-store-lifecycle.test.mjs:56` — “cron store completes recurring runs and schedules the next tick”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-CRON-003

Every reserved execution MUST create a normal visible kind=cron Pibo Session in the target room/default shared chat, persist cronJobId/cronRunId metadata, emit a service message, and settle from message_finished or session_error.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Archived/missing rooms fail dispatch; API mutations require same-origin JSON; the current 30-minute waiter timeout does not abort the created Pibo Session.

#### Acceptance evidence

- Exact source evidence:
  - `src/cron/service.ts:128` — `PiboCronService.executeJob` (method)
  - `src/cron/service.ts:159` — `PiboCronService.emitMessageAndWait` (method)
  - `src/apps/chat/cron-api.ts:156` — `handleChatCronApiRequest` (exported_symbol)
- Exact named tests:
  - `test/chat-cron-api.test.mjs:78` — “chat cron API creates default-chat cron targets without partition payloads”
  - `test/chat-cron-api.test.mjs:148` — “chat cron API requires an existing writable room before creating room cron targets”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-CRON-004

Settlement MUST atomically update job/run status and error counters, disable successful one-shots, delete only successful deleteAfterRun one-shots, compute recurring nextRunAt, and mark stale running reservations interrupted on startup.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

A failed at job is retained enabled without nextRunAt; specifications must record this exact behavior instead of asserting that every enabled job is schedulable.

#### Acceptance evidence

- Exact source evidence:
  - `src/cron/store.ts:258` — `PiboCronStore.completeRun` (method)
  - `src/cron/store.ts:293` — `PiboCronStore.recoverInterruptedRuns` (method)
- Exact named tests:
  - `test/cron-store-lifecycle.test.mjs:79` — “cron store error completion increments and later success resets consecutive errors”
  - `test/cron-store-lifecycle.test.mjs:103` — “cron store deleteAfterRun keeps failed one-shot jobs but deletes successful ones”
  - `test/cron-store-lifecycle.test.mjs:126` — “cron store recovers interrupted runs without leaving jobs running”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

## Ownership links

- [`reliability.md`](/specs/data/reliability.md)
- [`sessions-and-runtime-bindings.md`](/specs/data/sessions-and-runtime-bindings.md)
- [`routing-events-and-actions.md`](/specs/gateway/routing-events-and-actions.md)
- [`web-host-and-channel.md`](/specs/gateway/web-host-and-channel.md)
- [`gateway-admission-and-restart.md`](/specs/security/gateway-admission-and-restart.md)
- Web workflow rendering is a projection and interaction surface; it does not replace this package's durable facts.

## Verification boundary

- Source/test baseline: `39090b8850758293e69380a52bb7498d7c955bc2`.
- Focused inventory: 24 files / 245 top-level declarations; `test/web-channel.test.mjs` is separate cross-boundary evidence with 113 declarations.
- Requirement traceability: 25 unique requirements across six targets, 15 high confidence and 10 medium confidence, 138 source references, 75 named-test references / 74 unique names.
- This document is stable normative documentation of current behavior, not acceptance of future implementation work.
