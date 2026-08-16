# Pibo Documentation

This directory is the single home for project documentation, specs, plans, and reports.

## Structure

```text
docs/
  project/  Normal/current project docs and other canonical documentation
  specs/    Product, technical, and implementation specifications
  plans/    Implementation plans and design plans
  reports/  Investigation reports, validation reports, and generated report artifacts
  legacy/   Previous documentation set kept for reference
```

## Active architecture change

The multi-agent runtime adapter work is tracked in:

- [proposal](specs/changes/multi-agent-runtime-adapters/proposal.md)
- [behavioral specification](specs/changes/multi-agent-runtime-adapters/spec.md)
- [technical design](specs/changes/multi-agent-runtime-adapters/design.md)
- [task ledger](specs/changes/multi-agent-runtime-adapters/tasks.md)
- [implementation plan](plans/multi-agent-runtime-adapter-implementation-plan-2026-08-14.md)
- [architecture investigation](reports/multi-agent-runtime-adapter-architecture-investigation-2026-08-14.md)

## Rules

- Put normal/current project docs and other canonical documentation in `docs/project/`.
- Put specifications in `docs/specs/`.
- Put implementation plans in `docs/plans/`.
- Put investigation, validation, and incident reports in `docs/reports/`.
- Do not create new root-level `plans/`, `reports/`, or `specs/` directories.
- Do not delete legacy docs unless there is a separate cleanup decision.
