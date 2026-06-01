# Web Compact Terminal Difference Matrix

**Date:** 2026-05-17  
**Source of truth:** `web-terminal-reference-audit.md` and `TERMINAL_DESIGN.md`  
**Purpose:** Track every known Web-vs-Ink terminal parity gap, the fixture that exposes it, and the PRD/story that owns validation.

## Fixture keys

- `canonical-terminal`: `buildCanonicalTerminalRows()` in `test/fixtures/terminal-parity-fixtures.mjs`.
- `web-derived-long-output`: `buildWebDerivedLongOutputRows()`; includes 12-line outputs for generic tool calls, tool-result-like rows, async agents, yielded runs, shell-command tools, and execution commands.
- `web-derived-json-markdown`: `nestedJsonSyntaxFixture()` and `markdownSyntaxFixture()`; includes nested collections, a >140-character string, JSON-looking text, headings, lists, quotes, fenced code, tables, and bash syntax.
- `web-derived-room-session-slash`: `roomSessionNamingFixture()` and `slashCommandBehaviorFixture()`; includes named/default/archived/missing rooms, session labels, CLI-only commands, Web-parity commands, deferred/browser-only commands, and dynamic gateway commands. The durable command behavior table lives in `slash-command-behavior-matrix.md` and is backed by `buildSlashCommandBehaviorMatrix()`.

## Matrix

| Area | Web law | Current/known Ink gap | Target behavior | Fixture | Owner | Validation gate |
|---|---|---|---|---|---|---|
| Header chrome | Header is compact external chrome with profile/model/error/breadcrumb context. | TUI header can dominate transcript and may show long ids first. | Prefer user-facing names; keep ids secondary; keep header outside transcript. | `canonical-terminal`, `web-derived-room-session-slash` | PRD10 US-004, PRD12 US-002/003 | Ink header snapshots, PTY room/session flow. |
| Row grammar | Normal events are row-first, not cards; cards are exceptions. | Some Ink normal rows still render `▣` card headers. | `tool.call`, exploring, async/delegation, yielded, command, compaction, and error rows use prefix glyph grammar. | `canonical-terminal`, `web-derived-long-output` | PRD10 US-001/002 | Ink renderer snapshots reject `▣` for normal rows. |
| Spacing rhythm | Rows use dense `py-2` rhythm with no decorative blank gaps. | Card-like rendering adds vertical weight. | One row maps to one compact row block; details sit directly below parent. | `canonical-terminal` | PRD10 US-003/005 | Spacing snapshots and PTY dense transcript artifact. |
| Collapsed output previews | Tool/command/yielded/async/execution previews show first five output lines. | Ink must preserve line-bound disclosure while avoiding character truncation. | Five visible preview lines plus explicit omitted-line affordance. | `web-derived-long-output` | PRD09 US-001/002/005 | Shared row tests, Ink/Web tests, PTY detail flow. |
| Exploration groups | Collapsed exploration groups show at most six child summaries. | Grouped exploring rows can grow with every child summary. | Six summaries plus omitted/detail affordance, full details preserved. | `canonical-terminal` plus PRD09 extension | PRD09 US-001/002 | Shared row tests and Ink expansion tests. |
| Details | Details are row-owned inline panels with Input/Output/Error and linked session controls. | Ink needs selection and expanded row state. | Keyboard focus toggles details below parent row; full payload available and redacted. | `buildExpandableDetailFixtureRow()`, `web-derived-long-output` | PRD09 US-003/004/005 | Controller/render tests and PTY open-details flow. |
| Inline JSON | Web renders `name(<json>)` with token roles and nested disclosure. | Ink JSON is mostly plain text. | Terminal-native token roles for name, keys, strings, literals, punctuation, and nested markers. | `web-derived-json-markdown` | PRD11 US-001 | Color and `NO_COLOR` snapshots. |
| Detail JSON wells | Web parses object/array or JSON-looking text into compact wells with bounded depth. | Ink details need a well-like JSON renderer. | Bounded detail JSON renderer with full-value access and redaction before tokenization. | `web-derived-json-markdown`, `buildExpandableDetailFixtureRow()` | PRD11 US-002 | Detail renderer tests and PTY JSON detail artifact. |
| Markdown/code | Web preserves markdown structure and syntax tones. | Ink can flatten prose and code. | Preserve headings, lists, quotes, inline/fenced code, tables, and reasoning tone; color syntax where feasible. | `web-derived-json-markdown` | PRD11 US-003/004/005 | Ink markdown/code snapshots and PTY artifact. |
| Status compactness | Status is a structured exception but compact: badges, remaining quota, folded tools. | Ink status can become dump-like. | Compact fields, meaningful badges only, remaining-based progress, tools summarized/folded. | `canonical-terminal`, status payload fixtures | PRD10 US-004 | Status snapshots, `NO_COLOR`, narrow tests. |
| Streaming/footer | Web uses stable running rows and a compact working footer. | Ink running affordances need consistent compact semantics. | Running rows use cyan bullets and avoid large spinners/cards in transcript. | `buildStreamingTerminalRows()` | PRD10 US-001, PRD13 US-002 | Streaming row snapshots and PTY final flows. |
| Slash commands | Every command has documented palette, enter, result, picker, unsupported, and error behavior. | Some TUI command behavior is implicit or generic. | Complete matrix for CLI-only, Web-parity, deferred/browser-only, and dynamic gateway commands. | `web-derived-room-session-slash` | PRD12 US-001/005 | Command matrix tests and slash PTY checks. |
| Pickers/overlays | Owner/room/session/model/login/thinking pickers are compact overlays. | Labels and room context must be consistently resolved. | Primary labels first, secondary ids only when useful, compact keyboard hints. | `web-derived-room-session-slash` | PRD12 US-002/003/004 | Controller tests and PTY picker flows. |
| Room/session naming | Web shows room titles/session titles when available; raw IDs are fallback metadata. | TUI may show `room_xxx` as primary even when title exists. | `CliRoomSummary.title` and session title are primary; ids are secondary/fallback. | `web-derived-room-session-slash` | PRD12 US-002/003/005 | View-model tests and default-path room/session PTY. |
| No-color/narrow | Web semantics must survive without color and in constrained width. | Ink needs explicit ASCII/text fallbacks. | Markers, bars, wrapping, and labels remain meaningful with `NO_COLOR=1` and narrow columns. | `canonical-terminal`, `web-derived-json-markdown` | PRD10, PRD11, PRD13 | NO_COLOR/narrow snapshots and PTY variant. |
| Redaction | Secrets never appear in previews, details, logs, screenshots, snapshots, or reports. | Every new fixture/evidence path must preserve redaction. | Redact before shared descriptors and renderer output; grep artifacts. | All fixtures | PRD08-13 | Unit tests, artifact grep, final report. |

## Web UI preservation gate mapping

- `src/session-ui/**` changes are Web-impacting and require Web Compact Terminal regression evidence.
- Direct Web Compact Terminal changes are limited to tests or semantic hooks unless the user approves a Web behavior change.
- The PRD08 batch only adds documentation and renderer-neutral tests/fixtures. It does not alter Web render behavior.
- Later PRDs must record Web preservation evidence before marking stories complete when shared model or Web-hook files change.
