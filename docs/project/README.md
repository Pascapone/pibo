# Project Documentation

This is the starting point for the fresh Pibo project documentation.

The current system baseline after the V2 data migration:

- `pibo.sqlite` is the authoritative product data store for Chat Web data and Pibo Session records.
- Retired SQLite stores such as `web-chat.sqlite` and `pibo-sessions.sqlite` are archived legacy data, not runtime stores.
- Runtime code should use V2-native data services and query paths.
- Operational reports and implementation plans live outside this canonical section in `docs/reports/` and `docs/plans/`.

Current canonical docs:

- [Agent Runtime Adapter Architecture](./architecture/agent-runtime-adapters.md) — Pibo-owned runtime SPI, Pi and native Codex boundaries, bindings, portable capabilities, security, migration, and extension checklist.
- [Agent Runtime Operations](./agent-runtime-operations.md) — runtime selection, diagnostics, binding states, restart checks, rollback, cleanup, and failure triage.
- [Agent Runtime History and Debug](./agent-runtime-history-and-debug.md) — product-history ownership, adapter history providers, trace reconstruction, and safe runtime-aware inspection.
- [Chat Runtime Call Stack](./architecture/chat-runtime-call-stack.md) — Chat Web through the runtime-neutral router to Pi or native Codex and back.
- [Chat Runtime Flow Diagram](./architecture/chat-runtime-flow.mmd) — Mermaid source for the same multi-runtime flow.
- [Pibo Workflows](./workflows.md) — current Workflow System V1 capability contract, boundaries, persistence, inspection, and security rules.
- [Web Annotations V1](./web-annotations.md) — Chat Web, CDP overlay, annotation attachment, lifecycle, privacy, and troubleshooting guide.
- [Web Annotations Rollout Checklist](./web-annotations-rollout-checklist.md) — worker validation, browser checks, security gates, and deployment gates.

Future canonical docs should be added here with clear stewardship and current-state wording.
