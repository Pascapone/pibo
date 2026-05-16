# Pibo Native Tooling

Start with `pibo debug --help`.

Use Pibo-owned operator/debug CLI capabilities before ad hoc scripts:
- `pibo debug session <ps_...>` for session metadata and event summaries.
- `pibo debug trace <ps_...> --check` for Chat Web trace reconstruction.
- `pibo debug events <ps_...>` for compact event payload inspection.
- `pibo debug signals tree <ps_...>` for live session signal state.
- `pibo debug web ...` for CDP render snapshots, diffs, watch timelines, and Chat Web render scenarios.

For browser access, use Browser Use leases. For render-state analysis, attach with `pibo debug web targets`.

Use `pibo skills --help` to manage user skills. This CLI covers user-installed skills only, not built-in or plugin-provided skills. Prefer `pibo skills list --json` when another agent will parse the result.

Keep discovery in the CLI: run each command with `--help` before using deeper options.
