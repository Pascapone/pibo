# Project Documentation

This is the starting point for the fresh Pibo project documentation.

The current system baseline after the V2 data migration:

- `pibo.sqlite` is the authoritative product data store for Chat Web data and Pibo Session records.
- Retired SQLite stores such as `web-chat.sqlite` and `pibo-sessions.sqlite` are archived legacy data, not runtime stores.
- Runtime code should use V2-native data services and query paths.
- Operational reports and implementation plans live outside this canonical section in `docs/reports/` and `docs/plans/`.

Current canonical docs:

- [Pibo Workflows](./workflows.md) — current Workflow System V1 capability contract, boundaries, persistence, inspection, and security rules.

Future canonical docs should be added here with clear ownership and current-state wording.
