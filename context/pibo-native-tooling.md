# Pibo Native Tooling

Start with `pibo debug --help`.

Use Pibo-owned operator/debug CLI capabilities before ad hoc scripts:
- `pibo debug session <ps_...>` for session metadata and event summaries.
- `pibo debug trace <ps_...> --check` for Chat Web trace reconstruction.
- `pibo debug events <ps_...>` for compact event payload inspection.
- `pibo debug signals tree <ps_...>` for live session signal state.
- `pibo debug web ...` for CDP render snapshots, diffs, watch timelines, and Chat Web render scenarios.
- `pibo debug pty ...` for real PTY-backed CLI/TUI smoke tests, scripted input, assertions, and raw/clean artifacts.

For fast web research and lightweight navigation, prefer `pibo tools agent-browser`. For web development and UI validation, prefer Browser Use and pair it with Chrome DevTools/CDP or `pibo debug web ...` for console, network, DOM, performance, and render-state evidence. Use a headful Browser Use target for design, layout, responsive, focus, input, and screenshot validation; headless evidence alone is not sufficient for design acceptance. Start with `pibo tools show browser-use`, `pibo tools guide browser-use browser-use`, and `npm run dev -- mcp info chrome-devtools`; use `pibo tools show agent-browser` for the fast research path.
To start and show a loopback development server without keeping the agent turn active, use `pibo preview expose <port> --session <ps_...> --command '<start-command>'`; do not keep Preview servers in yielded runs. Discover start, stop, restart, and removal with `pibo preview`.
For interactive terminal debugging, start with `pibo debug pty --help`; prefer mocked/deterministic scenarios by default and use `--real-provider` only with bounded `--max-iterations`.

Use `pibo skills --help` to manage user skills. This CLI covers user-installed skills only, not built-in or plugin-provided skills. Prefer `pibo skills list --json` when another agent will parse the result.

Keep discovery in the CLI: run each command with `--help` before using deeper options.
