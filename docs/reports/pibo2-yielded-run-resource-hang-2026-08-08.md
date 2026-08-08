# Pibo2 yielded-run resource hang — 2026-08-08

## Summary

Pibo2 became unreachable after a review session started three full Production builds concurrently through `pibo_run_start` on an 8 GiB host with no swap. The host entered sustained memory reclaim and storage-read thrashing rather than recording a conventional kernel OOM kill. A manual host restart restored service at `2026-08-08T21:33:55Z`.

The incident also exposed a durable-run recovery defect: all three runs retained an unexpired 24-hour job claim and remained `running` after the gateway and host restarted, even though their processes no longer existed and their configured deadlines had elapsed.

## Environment

- Host: Pibo2, `31.70.66.85`
- Production deployment label: `integrated-pr365-pr393-sidebar-current-navigation`
- Production commit: `a4857e1203bfd9b5dc7a8f37f1d393fc7488507d`
- Memory: 7.7 GiB
- Swap: none
- Root filesystem before and after restart: 99% used, about 2.7 GiB free after restart
- Review Pibo Session: `ps_590a572f-6b73-419e-9abc-cdb369b13f82`
- Room: `room_209cf2ff-6b46-4705-a216-a6d2138604bd`

## Timeline

- `2026-08-08T19:57:52.177Z` — build run `run_d87bbdd4-3317-462f-a41e-ca34e77333fc` started.
- `2026-08-08T19:57:52.181Z` — build run `run_335ce6b1-acf1-4693-821b-54824d58cd43` started.
- `2026-08-08T19:57:52.182Z` — build run `run_6bf18760-6507-43c4-a7c2-e7e35a0233f9` started.
- `2026-08-08T20:17:13Z` — systemd-resolved first reported memory pressure.
- `2026-08-08T20:27:52Z` — all three configured 30-minute run deadlines elapsed without terminal run state.
- `2026-08-08T20:28:09Z` — systemd-journald began repeatedly reporting memory pressure.
- `2026-08-08T21:31:15Z` — sysstat recorded the terminal resource state: load `39.64/48.59/60.81`, 41 blocked tasks, 79.44% CPU I/O wait, 132,396 KiB free memory, 417,160 KiB available memory, and about 437,123 KiB/s page-in reads.
- `2026-08-08T21:33:55Z` — manual host restart began recovery.
- `2026-08-08T21:34:03Z` — Production service became active again.
- `2026-08-08T21:48:30Z` — host was healthy again with about 6.8 GiB available memory, but all three runs still reported `running`.

## Root cause

### Primary cause

Three full TypeScript/Vite Production builds were admitted at nearly the same instant and ran concurrently on a 4-CPU, 8-GiB host without swap. Their combined anonymous memory, page cache, and source/dependency reads pushed the host into a sustained reclaim loop and extreme I/O wait. System services, networking, SSH, Docker, and the Pibo gateway became unable to make timely progress.

The resource pattern is a memory/page-cache thrash rather than a proven ENOSPC, filesystem, hardware-I/O, or kernel OOM event:

- no kernel OOM kill was recorded;
- no EXT4 or block-device hardware error was found;
- no `ENOSPC` trigger was found;
- the previous boot ended without a clean shutdown sequence;
- the strongest terminal evidence was high blocked-task count, high I/O wait, aggressive page-in reads, and very low available memory.

### Failed safeguard

The gateway resource guard was ineffective for this incident:

- its default policy was `warn`, so critical checks did not reject work;
- it checked current resource state only before each start;
- it did not reserve capacity for admitted work;
- it did not limit concurrent yielded runs;
- the three starts occurred within five milliseconds, before any one build had materially changed the observed memory state.

This is a follow-up gap to closed issue #174 and PR #213.

### Durable recovery defect

Each yielded run created a durable job claim with a 24-hour visibility timeout. Startup recovery skipped every `running` run whose claim had not expired, without checking whether the claim belonged to the current gateway runtime. After a host restart, the old process could not still own the work, but its durable claims remained valid until the next day.

The runs therefore remained falsely `running` after restart and after their own `timeoutAt` deadlines.

## Contributing factors

- No swap was configured, so memory pressure immediately translated into reclaim and page-cache churn.
- The root filesystem was 99% used. This increased operational risk and reduced cleanup headroom, although no ENOSPC trigger was proven.
- The Bash timeout depended on the gateway process and event loop making progress. Under severe host thrashing, the 30-minute timeout did not settle the runs before the manual restart.

## Corrective change

The focused fix does the following:

1. Makes the gateway resource guard fail closed by default.
2. Reserves 2 GiB of host memory before admitting a yielded run, while preserving the configured free-memory reserve.
3. Allows one active yielded run by default; higher concurrency requires an explicit environment override.
4. Holds admission until the underlying tool execution actually settles, including after registry cancellation.
5. Gives each run registry runtime a unique durable worker identity.
6. Recovers unexpired claims owned by a previous runtime immediately on startup.
7. Classifies an interrupted run with an already elapsed deadline as `timed_out` instead of leaving it `running`.

Configurable overrides:

- `PIBO_GATEWAY_RESOURCE_GUARD=block|warn|off`
- `PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS=<count>`
- `PIBO_GATEWAY_YIELDED_RUN_MEMORY_RESERVATION_BYTES=<bytes>`

## Evidence

Read-only forensic artifacts are preserved outside the repository under:

```text
/tmp/pibo2-hang-investigation-2026-08-08/
```

Key files include `sar-incident.txt`, `pressure-timeline.txt`, `host-timeline.txt`, `reviewer-runs.jsonl`, `run-start-tool-details.txt`, `current-resource-guards.txt`, and `kernel-signals.txt`.

## Remaining operational risks

- Pibo2 still has no swap.
- The root filesystem remains 99% used.
- `pibo debug resources` invoked as a standalone CLI currently labels the short-lived CLI process as the gateway PID instead of inspecting the active systemd gateway; this diagnostic defect is tracked separately.
- The admission controller protects yielded runs. Other independently parallelized host processes still require operator discipline or a broader host-level workload/cgroup policy.
