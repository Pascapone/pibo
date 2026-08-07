# Pibo2 server-development completion audit — 2026-08-07

## Verdict

**PASS.** The requested Pibo V2 server-development workflow is implemented and verified requirement by requirement on the dedicated host `31.70.66.85` through the public authenticated Chat Web UI.

The focused product changes remain in reviewable pull requests. No pull request was merged and no release was performed. Promotion to `main` remains an explicit maintainer decision after review; this preserves the requirement that release must follow, never precede, Production validation.

## Post-audit integration note

After this pre-merge audit passed, PRs #353–#361 were merged individually into `upstream/dev` on August 7, 2026. Their integrated development head is `6185cf97`. Statements below describing those topic PRs as still open or unmerged record the audit boundary before integration. A new immutable package from the integrated commit, real Pibo2 revalidation, and an explicit `dev` → `main` release PR remain required before release.

## Audit boundary

- Dedicated server: `31.70.66.85`
- Public UI: `https://pibo2.neuralnexus.me/apps/chat`
- Audit date: August 7, 2026
- Canonical development base: `upstream/dev` at `8e6df91f`
- Active combined candidate: `resource-health-browser-profile-exemptions/faaa86a0`
- Active service binary: `/opt/pibo-candidates/resource-health-browser-profile-exemptions/faaa86a0/runtime/node_modules/@pasko70/pibo/dist/bin/pibo.js`
- Current gateway state: reachable, Production mode, restart-safe idle
- Current browser state: non-headless Chrome on Xvfb, authenticated, CDP healthy, profile explicitly exempt from automatic reaping

## Requirement audit

### 1. Dedicated-server development replaces the old Docker validation path

**PASS**

All realistic runtime, network, authentication, browser, streaming, persistence, session-switch, pagination, and performance validation in this work used the dedicated host and public Web UI.

The active Production service is `pibo-web.service`. The old development service is inactive and disabled. Candidate builds are installed under `/opt/pibo-candidates` and activated through rollbackable systemd overrides instead of replacing global Pibo.

Eight stopped legacy Docker worker records remain visible in resource health, including two old OOM-killed records. They are not part of the current workflow and no active candidate or browser depends on them. Their reviewed dry-run selects only stopped workers while preserving three Git worktrees. Destructive container/cache cleanup was deliberately not folded into this goal.

### 2. Slim, progressively disclosed server-development skill

**PASS**

Skill:

```text
/root/.pibo/user-skills/pibo-v2-server-development/SKILL.md
125 lines
```

The main skill contains ownership, safety, validation ladder, evidence contract, current verified state, and links to five on-demand references:

```text
references/server-access.md
references/deployment-and-rollback.md
references/browser-and-cdp.md
references/performance-debugging.md
references/machine-auth.md
```

Ten reusable scripts cover status, backup, machine-auth verification, candidate installation/activation, supervised browser lifecycle, cookie installation, CDP forwarding, and browser status/stop.

A full local-to-server hash comparison passed for every skill file after correcting one stale remote copy of `pibo2-browser-auth.mjs`. The synchronized script retains the explicit machine-session expiry when setting the CDP cookie.

### 3. Secure, revocable machine access

**PASS**

PR #353 implements:

- versioned 256-bit machine keys;
- SHA-256 digest-only server records;
- atomic mode-`0600` storage;
- expiry and revocation;
- hot reload;
- identity, generate, import, list, and revoke CLI commands;
- public machine-session exchange to a short-lived signed HttpOnly/Secure/SameSite-Strict cookie.

Raw keys remain on the controller and do not enter Git, URLs, screenshots, browser bundles, server records, or reports.

Current public verification:

```text
bootstrap HTTP 200
provider: machine-key
agents: 5
rooms: 41
```

Invalid and revoked credentials were tested and rejected in the focused validation report.

### 4. Real headful Chrome, CDP, and OpenAI/ChatGPT authentication

**PASS**

Chrome 148 runs without a headless flag under unprivileged user `pibo-browser` on X display `:99`. Remote CDP is bound only to `127.0.0.1:9222` and forwarded to controller loopback `127.0.0.1:9223`.

The browser is supervised by `pibo2-headful-chrome.service` with `Restart=always`. Its persistent machine-session cookie expires with the signed session rather than at browser process exit.

A current real `pibo-agent-v2` / `openai-codex/gpt-5.6-sol` turn ran after all active candidate changes. Through the public Web UI it executed exactly:

```text
pwd
/root/projects/pibo-stream-lab

git status --short --branch
## main
```

The persisted final response reported a clean worktree and seven-second duration at stream `954799`. `pibo debug trace --check` rebuilt 63 nodes with zero issues. The browser returned to idle, removed `Working...`, emptied the composer, and retained authenticated bootstrap.

### 5. Durable, substantial test project developed through the Web UI

**PASS**

Project:

```text
/root/projects/pibo-stream-lab
```

Final five-commit history:

```text
15d8e05 feat: establish stream lab baseline
fcef04a feat: add benchmark lifecycle and findings
a11f025 feat: add scenario baselines and regression comparison
f9da734 feat: add artifact ingestion and metric derivation
8416983 docs: add artifact ingestion operator runbook
```

Current independent verification:

```text
7 test files passed
31 tests passed
typecheck passed
production build passed
npm audit --omit=dev: 0 vulnerabilities
Git status: ## main
data directory: .gitkeep only
```

Operator runbook:

```text
249 lines
SHA-256 c6f15ade7715a1197329845ef495c4dcb3644edd0df459c1f3915139e86eb364
```

Destructive and ingestion examples use temporary databases rather than `data/stream-lab.sqlite`.

### 6. Long-running, streaming, tool, session-switch, Terminal, pagination, and optimistic-send scenarios

**PASS**

The permanent project and dedicated Chat sessions exercised:

- real OpenAI streaming and reasoning;
- server tool calls and long multi-step turns;
- session switching during active output;
- Terminal View virtualization and restoration;
- near-top and exact-top infinite scrolling;
- historical trace page continuation;
- optimistic messages, Queue/Steer decisions, rejected-message rollback, and signal projection;
- live-versus-reload trace comparison;
- browser process recovery and authenticated session persistence.

Stream Lab baseline metrics include p50 260 ms, p95 390 ms, inter-chunk p95 55 ms, 92% reconnect success, and zero dropped events.

### 7. Reproducible evidence, benchmarks, traces, screenshots, and server metrics

**PASS**

Durable reports exist for machine auth, Terminal rendering, signal load, debug lifecycle, optimistic overlays, rejected messages, unread indexing, historical pagination, and browser reaper handling.

Representative local evidence includes:

- 11 machine-auth/browser artifacts totaling about 20.9 MB;
- authenticated, streaming, completed-turn, and Terminal screenshots;
- compressed Chrome performance traces;
- session-switch and optimistic-overlay watches;
- exact-top pagination before/after JSON;
- resource-reaper before/after JSON;
- bootstrap, LCP, CLS, forced-reflow, DOM-size, and Resource Timing captures.

Large binary evidence is intentionally excluded locally from Git while reviewable reports record paths, hashes, timings, and conclusions.

### 8. Identified defects and verified fixes

**PASS**

| PR | Defect | Production evidence |
|---|---|---|
| #353 | No revocable browser machine identity | Hash-only key, signed cookie, SSE/API/UI auth, revocation verified |
| #354 | Scrambled Terminal activity indicator | Stable `Working...`; 6.5-second watch with no random characters |
| #355 | 726,110-byte global signal polling every five seconds | 2.9 MB/21 s reduced to zero healthy-path status requests |
| #356 | Historical node errors incorrectly defined current trace lifecycle | Lifecycle derived from persisted events; errors reported separately |
| #357 | Optimistic overlays and delivery dialog lost/raced across session switches | Dialog closed in 17 ms; first return sample retained optimistic text and `Working...` |
| #358 | Rejected post-acceptance message left stale running signal | Optimistic row gone by 67.1 ms; final signal idle; real active turns preserved |
| #359 | Unread counts dominated authenticated bootstrap | Query 71.1 ms to 1.431 ms median; bootstrap p50 611.1 to 140.9 ms |
| #360 | Exact-top history inherited 700 ms speculative settle delay | Request start 703.5 to 3.4 ms; five unique cursors; latest row preserved |
| #361 | Resource reaper killed supervised Chrome and health called it unmanaged | Stable PID/restart count beyond grace; status now `unassigned=0`, `exempt=1` |

Additional operational fix:

- nginx now serves HTTP/2, removing a measured 25.065-second browser connection-queue wait before optimistic POST dispatch. Comparable post-fix dispatch waited about 1.4 ms.

### 9. Span ordering and live-versus-reload equivalence

**PASS**

A stable-row comparison found the final nine live and reload Terminal rows identical in content and order. Virtual list indices differed because the live view retained historical pages, which is expected and no longer treated as a content mismatch.

`pibo debug trace --check` rebuilt the 678-node Stream Lab trace with zero issues. Historical errors remain available to failure drill-down without changing a completed session lifecycle to current error.

### 10. Historical span loading and infinite scroll

**PASS**

The historical API itself returned pages in roughly 48–84 ms. The user-visible delay came from applying `OLDER_TRACE_INTENT_SETTLE_MS=700` at the exact top.

The fixed path preserves speculative near-top settling but bypasses it at the absolute edge:

```text
first request start: 703.5 ms -> 3.4 ms
scroll-height change: 793.6 ms -> 89.9 ms
five continued pages: five unique cursors
latest persisted row after returning to bottom: preserved
```

### 11. Performance and server metrics

**PASS**

Confirmed improvements:

- HTTP/2 eliminates long-lived SSE/stream connection starvation for sends.
- Event-driven global signal reconciliation removes repetitive multi-megabyte polling.
- Partial unread index improves representative query and bootstrap latency.
- Single-tab reload measured LCP 1,132 ms, CLS 0.00, forced reflow 44 ms.
- Exact-top history begins immediately.
- `pibo2-status.sh` resolves the active candidate CLI and reports deployment identity, browser state, explicit reaper exemption, resource health, host resources, and public timing.

Current resource status truthfully remains `critical` due only to historical stopped Docker OOM records and disk pressure:

```text
browser main processes: 1
unassigned browser main processes: 0
exempt browser main processes: 1
browser check: ok
stopped compute workers: 8
OOM-killed historical workers: 2
Docker reclaimable bytes: 28,030,489,500
```

### 12. Backup, immutable candidates, and rollback

**PASS**

Latest pre-mutation full backup:

```text
/root/.pibo/server-backups/31.70.66.85-pibo-20260807T064000Z.tar.zst
SHA-256 1ae6042f9ae64056495ad365f7cc4ddf024507cea20c5b07f3023dcac509ef4c
zstd test: ok
required files: ok
SQLite quick_check: 15 databases ok
```

Current package:

```text
/root/.pibo/candidate-packages/pibo-faaa86a0.tgz
SHA-256 a4a6e2bf5479bd6d08d9bdcfcef55baedd5f519e0797ab85b433e225cabc5117
```

Current activation rollback:

```text
/root/.pibo-deploy-rollbacks/20260807T072010Z-resource-health-browser-profile-exemptions
```

The browser profile exemption has its own rollback at:

```text
/root/.pibo-deploy-rollbacks/20260807T065109Z-browser-profile-reaper-exemption
```

### 13. Focused Git/GitHub flow and reviewable PRs

**PASS**

PRs #353–#361 target `upstream/dev`. For every PR:

- the GitHub pull ref SHA matches the corresponding fork branch SHA;
- a local `git merge-tree --write-tree upstream/dev <origin-topic>` completed without conflict;
- the focused worktree is clean;
- validation evidence is included in or linked by the topic branch.

Local pull-ref/merge audit:

```text
/tmp/pibo2-pr-353-361-local-completion-audit.json
SHA-256 013cc7d80ea72d2123306a91a116519251cb7e2da908855cac1723f3d52ac85c
```

GitHub exposes no check runs for these heads. Manual build, typecheck, focused tests, combined tests, candidate packaging, and real Production validation therefore remain the recorded gates.

### 14. Release safety

**PASS**

No release was performed, no topic was merged, and global Pibo was not replaced. The combined candidate demonstrates the reviewed release input without bypassing upstream review.

A future release requires:

1. maintainer review and merge of intended topic PRs into `upstream/dev`;
2. identification of the exact integrated `upstream/dev` commit;
3. rerunning the broad Production matrix against that integrated commit;
4. explicit release approval;
5. release PR from `dev` to `main`.

This is an external promotion gate, not unfinished implementation inside the requested workflow.

## Combined candidate verification

Current combined candidate validation completed with:

```text
177 focused integration/regression tests passed
0 failed
full typecheck passed
production build passed
package creation passed
```

The focused Stream Lab project separately passes 31 tests, typecheck, build, and Production dependency audit.

## Known non-blocking operational debt

1. Eight stopped legacy Docker worker records and about 28.0 GB reclaimable Docker data remain. Cleanup is destructive and intentionally awaits separate review.
2. Topic PRs remain unmerged and await maintainers. This is required review separation, not a missing deliverable.
3. Explicit browser exemptions remain outside managed browser-pool lease inventory; exact profile matching and status reporting make that choice visible.
4. GitHub API mergeability for the most recently updated PR was temporarily `unknown` during API recomputation/rate exhaustion; matching pull refs and conflict-free local merge trees prove the branch is reviewable.

## Audit evidence

```text
/tmp/pibo2-server-completion-audit.txt
/tmp/pibo-stream-lab-completion-audit.txt
/tmp/pibo2-pr-353-361-local-completion-audit.json
/tmp/pibo2-resource-health-profile-exemption-status.json
/tmp/pibo2-resource-health-profile-exemption-reap.json
/tmp/pibo2-resource-reaper-browser-baseline-2026-08-07.json
/tmp/pibo2-resource-reaper-browser-post-2026-08-07.json
/tmp/pibo2-trace-pagination-baseline-2026-08-07.json
/tmp/pibo2-trace-pagination-post-2026-08-07.json
```

## Completion decision

Every explicit implementation, workflow, authentication, real-browser, real-agent, persistent-project, debugging, evidence, documentation, candidate-validation, PR, and release-safety requirement in the objective has current supporting evidence.

The Pibo V2 server-development goal is complete. Review, merge, optional legacy-resource cleanup, and release promotion remain subsequent maintainer operations governed by the workflow established here.
