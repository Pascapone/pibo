---
type: "Research"
title: "Baseline recount at 84101adc (remote integration addendum)"
description: "Same-method recount of source inventory at the merged baseline; the original baseline review stays historical and unchanged."
tags: ["beta-4", "baseline", "remote-agent", "addendum"]
status: "draft"
authority: "informative"
generated:
  by: "muse-code/a1-session"
  at: "2026-09-20T16:40:10Z"
sources:
  - id: "baseline-review"
    resource: "scope:archived concept docs/reports/beta4-phase2/beta4-baseline-legacy-review.md at ece5f18c"
    title: "Original counts; this addendum only appends new numbers"
  - id: "recount"
    resource: "scope:git ls-files plus byte line counts at 84101adc with .tmp/beta4-source-inventory.py"
    title: "Same method, rerun on the merged tree"
---

# Baseline recount at 84101adc

Addendum to the [baseline review](beta4-baseline-legacy-review.md), whose
`ece5f18c` numbers stay historical and unchanged. Same method
(`git ls-files`, source extensions, byte lines), rerun at merge `84101adc`:

| Bereich | Dateien | Zeilen | Delta zu ece5f18c |
|---|---:|---:|---|
| `src/remote-agent` | 15 | 3617 | +215 Zeilen, gleiche Dateizahl |
| Gesamt `src`+`packages` | 844 | 232093 | +215 Zeilen |
| Netto ohne colocated Tests | 819 | 224884 | +215 Zeilen |

The +215 lines are exactly the merged observe delta (`175afcfa`); no other
source area changed. Independent B review findings F1–F6 and the intended
API breaks (F4) are recorded in the
[remote agent plugin contract](/specs/resources/remote-agent-plugin-contract.md).
