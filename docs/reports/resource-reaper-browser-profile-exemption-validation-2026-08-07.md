# Resource reaper browser profile exemption validation — 2026-08-07

## Verdict

The Pibo2 candidate preserves the intentionally supervised authenticated Chrome by exact `--user-data-dir` while continuing to classify unrelated Chromium profiles normally.

Before the fix, the automatic resource reaper terminated the browser every approximately 10 minutes. With the candidate and stable profile exemption active, a zero-grace plan explicitly skipped the profile and automatic apply cycles no longer changed the Chrome process.

No release was performed.

## Root cause

Chrome did not crash. Pibo's automatic resource reaper was configured to run every 300,000 ms and to terminate unmanaged Chromium after a 600-second grace period.

The validation browser had:

```text
systemd unit: pibo2-headful-chrome.service
profile: /dev/shm/pibo2-headful-browser/profile
CDP: 127.0.0.1:9222
managed browser-pool leases: 0
```

The reaper selected exactly one unmanaged browser at:

```text
05:53:24 UTC
06:03:29 UTC
06:13:35 UTC
06:23:41 UTC
06:33:47 UTC
06:43:54 UTC
```

Each selection was followed by a clean systemd deactivation and restart. `NRestarts` advanced to 17. The regular 10-minute-and-about-6-second cadence matched two five-minute reaper cycles plus restart time, and the gateway journal recorded `unmanagedBrowsers: 1` on each event.

Because Chrome starts with both `--restore-last-session` and the Chat URL, repeated forced recoveries accumulated nine duplicate authenticated Chat tabs. They were closed to one before post-fix validation.

## Implemented behavior

Focused branch:

```text
fix/resource-reaper-browser-profile-exemptions
```

Implementation commit:

```text
afa710b5 fix(resources): preserve explicit browser profiles
```

The resource lifecycle now accepts exact absolute profile exemptions through:

```text
PIBO_RESOURCE_REAPER_EXEMPT_BROWSER_USER_DATA_DIRS
```

and:

```text
--exempt-browser-user-data-dirs <comma-separated-absolute-paths>
```

Properties:

- paths are normalized and deduplicated;
- relative and empty CLI paths are rejected;
- matching is exact;
- exempting a parent does not exempt a child profile;
- PID/process-group exemptions remain unchanged;
- only Chromium main processes discovered by the existing resource-health path are considered;
- dry-run output preserves the exemption in the generated apply command;
- the gateway reaper resolves the environment-backed path on every plan.

## Automated validation

Focused worktree:

```bash
npm run build
node --test test/resources-cli.test.mjs test/compute-resource-policy.test.mjs
npm run typecheck
git diff --check
```

Result:

```text
33 tests passed
0 failed
```

Combined immutable candidate:

```text
validation commit: 46a22066
175 focused integration/regression tests passed
full typecheck passed
production build passed
package creation passed
```

## Backup, package, and rollback

Pre-activation full backup:

```text
/root/.pibo/server-backups/31.70.66.85-pibo-20260807T064000Z.tar.zst
SHA-256 1ae6042f9ae64056495ad365f7cc4ddf024507cea20c5b07f3023dcac509ef4c
restore quick_check: 15 SQLite databases OK
```

Package:

```text
/root/.pibo/candidate-packages/pibo-46a22066.tgz
SHA-256 3789caef1c7a2918328ce97398085e7abfc78415ac632c34640c9a3d2b9da9f6
```

Installation:

```text
/opt/pibo-candidates/resource-reaper-browser-profile-exemptions/46a22066
```

Candidate rollback:

```text
/root/.pibo-deploy-rollbacks/20260807T065110Z-resource-reaper-browser-profile-exemptions
```

Profile-exemption drop-in rollback:

```text
/root/.pibo-deploy-rollbacks/20260807T065109Z-browser-profile-reaper-exemption
```

Active service environment:

```text
PIBO_DEPLOY_CANDIDATE=resource-reaper-browser-profile-exemptions
PIBO_DEPLOY_COMMIT=46a22066
PIBO_RESOURCE_REAPER_EXEMPT_BROWSER_USER_DATA_DIRS=/dev/shm/pibo2-headful-browser/profile
```

## Zero-grace proof

The candidate CLI was run with `--unmanaged-browser-grace-minutes 0`, so age could not hide the result.

Observed plan:

```text
pid: 837315
userDataDir: /dev/shm/pibo2-headful-browser/profile
elapsedSeconds: 480
action: skip
reason: explicitly exempted browser user-data-dir
selected: 0
skipped: 1
```

Evidence:

```text
/tmp/pibo2-resource-profile-exemption-dryrun.json
SHA-256 19a8280de763be959d05dd5e660305dde6f4a9b14e18c283add671979d38af1d
```

## Automatic reaper endurance

The candidate gateway started at 06:51:43 UTC. Automatic reaper apply cycles reported:

```text
06:52:13 UTC  unmanagedBrowsers=0
06:57:16 UTC  unmanagedBrowsers=0
07:02:18 UTC  unmanagedBrowsers=0
```

The second and third cycles occurred after Chrome had exceeded the original 600-second kill threshold.

Across the endurance window:

```text
Chrome MainPID before: 837315
Chrome MainPID after:  837315
NRestarts before: 17
NRestarts after:  17
CDP health: continuously true
```

## Authenticated UI proof

After reducing the restored browser to one tab, Chrome DevTools MCP observed:

```text
bootstrap HTTP status: 200
selected session: ps_03bb744d-0cb8-43b6-9900-c3b0e110b43c
page title: Pibo Web Chat
latest Terminal row: Amended commit
Working footer: absent
```

The final Stream Lab response remained visible and the signed machine session remained valid.

## Workflow hardening

The server-development workflow now:

- documents the resource-reaper interaction and zero-grace verification command;
- reports `reaperExempt` in browser status;
- includes deployment identity, supervised-browser state, reaper-exemption state, aggregate resource health, and public timing in `pibo2-status.sh`;
- warns through metrics that eight old stopped Docker workers, two OOM-killed records, and about 28.0 GB of reclaimable Docker data remain. No destructive container or cache cleanup was performed.

## Evidence

```text
/tmp/pibo2-resource-reaper-browser-baseline-2026-08-07.json
SHA-256 417f3232db9f29c643179d82be6bb5de65637724f86c0aac9a94231f55963be8
3298 bytes

/tmp/pibo2-resource-profile-exemption-dryrun.json
SHA-256 19a8280de763be959d05dd5e660305dde6f4a9b14e18c283add671979d38af1d

/tmp/pibo2-status-after-reaper-exemption.txt
```

## Remaining limits

- Explicitly exempt profiles remain outside the managed browser-pool lease inventory; operators must keep the exemption narrow and documented.
- `pibo resources status` still describes that main process as unassigned because resource-health reporting is pool-oriented. The dry-run and browser status make the intentional exemption explicit.
- Legacy stopped Docker workers and build cache remain present pending a separately reviewed destructive cleanup decision.
