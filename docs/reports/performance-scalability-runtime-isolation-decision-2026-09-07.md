---
type: "Validation Report"
title: "Runtime-host isolation decision: measured capacity proof suffices (package H)"
description: "Records the package-H measurement decision after packages B through G: the measured gateway event-loop, fairness, memory and recovery evidence stays inside PERF-LOOP-001 and the plan's runtime ramp gate, so a documented capacity proof suffices and Pibo-managed runtime-host isolation is not required now, with explicit revisit triggers."
tags: ["performance", "capacity", "runtime-isolation", "decision"]
status: "stable"
authority: "evidentiary"
generated: { by: "qwen/qwen3.8-max", at: "2026-09-07T21:55:00Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/reports/performance-scalability-fgh-handoff-2026-09-07.md"
  - resource: "/reports/performance-scalability-capacity-2026-09-07.md"
  - resource: "/reports/performance-scalability-reads-2026-09-07.md"
  - resource: "/reports/performance-scalability-maintenance-2026-09-07.md"
---

# Decision

Package H asked, after storage isolation (package B), whether runtime and plugin callbacks still violate the gateway budgets and therefore require moving the affected adapters into Pibo-managed runtime-host processes, or whether a measured capacity proof suffices. **Decision: the measured capacity proof suffices; Pibo-managed runtime-host isolation is not introduced now.** The decision is bounded to the measured scope and carries explicit revisit triggers below.

# Budget and gate

The governing budget is PERF-LOOP-001: gateway event-loop delay in a sliding one-minute window p99 ≤ 50 ms, with no stall above 250 ms caused by Pibo's own synchronous work. The plan's runtime-isolation gate requires ramps 1 → 2 → 5 → 10 → 20 sessions with mixed room sizes and one over-active participant, released only with fairness, a memory plateau, early overload responses and recovery demonstrated.

# Evidence assembled from packages B–G

- **Runtime activation and eviction (package D):** a real-Pi-SDK benchmark (200 activations over ten cycles, pool limit eight, empty native histories, no model requests) kept the active pool within eight and disposed all runtimes; cycle-end RSS plateaued at 310.50–312.25 MiB over the last four cycles; caller event-loop p99 30.10 ms / maximum 36.60 ms — inside PERF-LOOP-001 with no >250 ms stall. Cold-start ramps through 20 sessions, idle generation eviction, room rotation fairness, byte/age rejection, steering reserve and fenced cancellation are regression-covered; early overload answers and the six real-process crash/recovery boundaries passed.
- **Storage and admission (packages B, D):** durable admission and fenced completion on the isolated storage worker met the admission SLOs at one million events / 10,000 attempts with caller-loop, memory and IPC pressure reported; no unbounded gateway synchronous SQL.
- **Reads at scale (package F):** at ten million events the caller event-loop was p99 17.4 ms / maximum 30.1 ms while reads and durable admissions ran concurrently; single-page read budgets hold at ten times production history.
- **Write amplification (package E):** telemetry and output writes are batched and checkpoint-reduced, removing a synchronous write storm from the gateway loop.
- **Maintenance (package G):** cleanup, backup and capture work is bounded and resumable, so maintenance cannot stall the loop with unbounded synchronous passes.

Taken together, the remaining gateway synchronous work in the measured profiles (storage admission, reads, telemetry writes, maintenance, runtime activation/eviction) stays inside PERF-LOOP-001 and the ramp gate. The specific hazard the plan names for isolation — CPU-heavy plugin callbacks, tokenization, trace conversion or SDK callbacks violating the loop budget — was not observed in the measured runtime-activation profile (p99 30.1 ms / max 36.6 ms).

# Scope and revisit triggers

This decision covers the measured adapters and profiles above. It is not a claim about arbitrary future plugins or unmeasured CPU-heavy adapters. Revisit runtime-host isolation, per the plan, when any of the following is observed in profiling or production telemetry:

- A runtime or plugin adapter's synchronous callbacks push gateway event-loop delay past PERF-LOOP-001 (p99 > 50 ms or any >250 ms stall attributable to Pibo synchronous work) in a representative profile.
- Tokenization, trace conversion or SDK callback CPU time becomes a dominant share of gateway loop time under the ramp gate.
- The activation/eviction memory plateau breaks (monotonic RSS growth across cycles) at the configured pool limit.

If triggered, move only the affected adapters into a bounded, resource-limited Pibo-managed runtime-host pool that preserves Portable Tools, MCP, files, runtime generation, cancellation and bindings, with Linux/cgroups and Windows behavior evidenced separately; Pibo remains the authority for product data and routing.

# Artifacts

No code changes accompany this decision; it synthesizes the measurements recorded in the package B–G reports and their artifacts, in particular `artifacts/performance-scalability-capacity-20260907/` (runtime capacity and storage ramps) and `artifacts/performance-scalability-reads-20260907/` (ten-million-event load).
