# Pibo Native Tooling

Start with `pibo debug --help`.

Use Pibo-owned operator/debug CLI capabilities before ad hoc scripts:
- `pibo debug session <ps_...>` for session metadata and event summaries.
- `pibo debug trace <ps_...> --check` for Chat Web trace reconstruction.
- `pibo debug events <ps_...>` for compact event payload inspection.
- `pibo debug signals tree <ps_...>` for live session signal state.
- `pibo debug web ...` for CDP render snapshots, diffs, watch timelines, and Chat Web render scenarios.
- `pibo debug pty ...` for real PTY-backed CLI/TUI smoke tests, scripted input, assertions, and raw/clean artifacts.

For browser access, use Browser Use leases. For render-state analysis, attach with `pibo debug web targets`.
For interactive terminal debugging, start with `pibo debug pty --help`; prefer mocked/deterministic scenarios by default and use `--real-provider` only with bounded `--max-iterations`.

Use `pibo skills --help` to manage user skills. This CLI covers user-installed skills only, not built-in or plugin-provided skills. Prefer `pibo skills list --json` when another agent will parse the result.

Keep discovery in the CLI: run each command with `--help` before using deeper options.
