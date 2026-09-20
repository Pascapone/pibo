---
type: "Historical Record"
title: "Beta 4.0 phase-2 review draft r1 (historical)"
description: "Honest record of the unapproved r1 acceptance draft with its file and hash inventory; full bytes live in the checkpoint ZIP."
tags: ["beta-4", "phase-2", "review", "historical"]
status: "deprecated"
authority: "historical"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T15:54:34Z"
sources:
  - id: "host-original"
    resource: "scope:beta4-phase2 host planning archive at commit time"
    title: "Draft directory .pibo/planning/beta4-phase2-20260920/review-r1, preserved byte-identical in the checkpoint ZIP"
---

# Beta 4.0 phase-2 review draft r1 (historical)

`review-r1/` is our own earlier acceptance draft from 20 September 2026 — it was
never foreign work. (The joint review's phrase "fremder Entwurfsordner" is wrong
and is corrected by the
[research acceptance](/reports/beta4-phase2/beta4-phase2-research-acceptance-2026-09-20.md);
the archived review body itself is kept byte-identical.)

Honest approval state from `approval.json`: `status: awaiting_user_review`,
`approved: false`, `dispatchAllowed: false`, `i0Passed: false`,
`g1Passed: false`, all four sessions `null`. The release was pending at the
time. This record does NOT grant retroactive approval; the documentation
checkpoint is a new permission limited to securing research and plans.

The four parallel analyses were erroneously started before the then-required
acceptance. That remains visible in the provenance; see the acceptance record.

## Inventory (SHA-256, full bytes in the checkpoint ZIP)

| File in `review-r1/` | SHA-256 |
|---|---|
| `00-abnahme.md` | `eeab4fae24de0092e56ebd8fc693e6e8235f208ec1265b929ff7e220ed46f7d7` |
| `01-gemeinsame-regeln.md` | `4144d88f5b9900102e9d842c79821c416c7fe54d058c7d895ad11a982f970aeb` |
| `02-ergebnisvorlage.md` | `b0232626ea077c7c9759c29a91c19d510243477fac6d5ce56f1dbdf73f15335a` |
| `03-startnachrichten.md` | `523c65611b4cc21e728200f1da439c4b0de617894dc1037130197c9a00b668bd` |
| `approval.json` | `b7ed259b5a6800fb966788c0777bfb1cb747b1d45744321326b01f409961511c` |
| `assignments/A1.md` | `64daf8abf2ee1dbca058ca43ee67ed1ce92d19e7b3925b0741ca74ce291c3f2d` |
| `assignments/B1.md` | `5958de5480b11b3433ced0195acac4caacc6565208a192ac1a8a227e532fe6b8` |
| `assignments/C1.md` | `40efa4c993be7d3b769b76dcbf97c262d57992f24e25a443880833eea54813da` |
| `assignments/D1.md` | `f2e3459523b8466c5dc9185733345bcef6686343e510954b0bb7e0447eb268fd` |
| `inputs/pibo-beta4-arbeitsplan-v3.md` | `1d8f923b09b241a88ae0449d81a4cc204c485c7ac0522f87c66de6daa1633d18` |
| `inputs/codebase-design/SKILL.md` | `2c20617f87ec8af6a434859f381b2f061a69b530444e74eb39e78bb016a6d1e2` |
| `inputs/codebase-design/DEEPENING.md` | `f3dd099ce99289bd213914d8ee3e2429b78309c3957ca4583f7659551b1d53c1` |
| `inputs/codebase-design/DESIGN-IT-TWICE.md` | `8e740bf98446dbd4dfdc132ac4346d9a7eedaf93de6a495889171cf7f99f16bd` |

All four draft assignments differ byte-wise from the final dispatched
assignments. The draft V3 Markdown and the skill trio are byte-identical to the
final inputs; the draft inputs contain no HTML rendering and no sources record.
ZIP path prefix: `review-r1/`.
