# Spec: Browser Automation Desktop Environment

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-17  
**Owner / Source:** Current Pibo codebase; 2026-05-17 compute/browser resource incident analysis  
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/curated-cli-tools.md`, `docs/specs/capabilities/docker-compute-workers.md`, `docs/specs/changes/compute-browser-resource-lifecycle/spec.md`

## Why

Pibo agents use browser automation to inspect Chat Web, run UI checks, and attach to authenticated browser sessions. Browser automation only works reliably when the process has the correct desktop environment, Chrome profile, and CDP state.

The current code gives Pibo a thin desktop-environment contract around curated browser-use and Agent Browser tooling. It detects an available Linux desktop, exports only the needed process variables, can provision a virtual X display for root Linux installs, and reports browser health without loading large browser instructions into every runtime.

## Goal

Pibo MUST make headed browser automation discoverable and reproducible by detecting desktop display state, exporting browser process environment, provisioning a virtual display only when safe, and reporting actionable browser-use and Agent Browser health.

## Background / Current State

The current implementation is centered on `src/tools/desktop-env.ts`, `src/tools/linux-virtual-display.ts`, `src/tools/registry.ts`, browser-use helper code in `src/tools/index.ts`, `src/tools/browser-use-wrapper.ts`, and `src/tools/browser-use-cdp.ts`, plus Agent Browser support in `src/tools/agent-browser-wrapper.ts` and `src/tools/agent-browser-leases.ts`.

`pibo tools install browser-use` and `pibo tools install agent-browser` call desktop setup before installing their isolated runtimes. `pibo tools env <name>` prints shell exports for PATH, tool home, display variables, X authority, runtime dir, and DBus when detected. Browser health checks validate wrapper presence, Chrome availability, display availability, stale CDP state, and lease state where applicable.

## Scope

### In Scope

- Linux desktop display detection for X11 and Wayland.
- Browser-use environment export for detected desktop variables.
- Automatic virtual X display provisioning during browser setup when the host is Linux, headless, and running as root.
- Human-readable virtual-display hints when automatic setup is not available.
- Browser-use health reporting for wrapper, Chrome, display, stale CDP files, and expired leases.
- CDP target discovery that can find the most recent Pibo-managed Chrome port state.

### Out of Scope

- Implementing browser automation itself — that belongs to external tools such as browser-use and Agent Browser.
- Managing arbitrary desktop environments beyond the variables Pibo detects today.
- Starting host gateways, dev auth, or authenticated browser sessions — those are covered by gateway, auth, and curated-tool specs.
- Guaranteeing GUI availability on non-Linux platforms — current automatic setup is Linux-only.

## Requirements

### Requirement: Desktop detection exposes only browser-relevant process state

The system MUST detect browser-relevant desktop variables and expose them as a small process environment map.

#### Current

`detectDesktopEnv()` returns `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS` when available on Linux. Non-Linux platforms return an empty desktop record.

#### Acceptance

- When `DISPLAY` is already set, the detected desktop includes that display.
- When `WAYLAND_DISPLAY` is set or `wayland-0` exists under the runtime dir, the detected desktop includes the Wayland display.
- When an X authority file is configured or discoverable under the runtime dir, the detected desktop includes `XAUTHORITY`.
- When the runtime DBus socket exists, the detected desktop includes `DBUS_SESSION_BUS_ADDRESS`.
- Non-Linux detection does not invent desktop variables.

#### Scenario: Existing X display

- GIVEN a Linux process with `DISPLAY=:0`
- WHEN Pibo detects the desktop environment
- THEN headed browser automation is reported as available through `DISPLAY=:0`.

### Requirement: Tool environment export preserves desktop access

`pibo tools env <name>` MUST print shell exports that let the installed browser tool run with Pibo's runtime paths and the detected desktop environment.

#### Current

`printEnv()` prepends the Pibo wrapper bin and tool bin to `PATH`, exports the tool home variable, and prints detected desktop variables for non-Windows shells.

#### Acceptance

- Browser-use env output includes the Pibo wrapper directory before the raw executable directory.
- Browser-use env output includes `BROWSER_USE_HOME` when configured by the tool runtime.
- Detected `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS` are exported.
- Missing desktop values are omitted instead of exported as empty values.
- Windows output uses PowerShell syntax for PATH and home env vars and does not print Unix desktop exports.

#### Scenario: Agent prepares browser-use shell

- GIVEN browser-use is installed and a desktop display is detected
- WHEN an agent runs `eval "$(pibo tools env browser-use)"`
- THEN subsequent browser-use invocations use Pibo's wrapper, Pibo's tool home, and the detected desktop display.

### Requirement: Automatic virtual display setup is safe and bounded

Pibo MUST only provision a system virtual X display when the platform is Linux, no display is detected, and the process is running as root.

#### Current

`ensureLinuxVirtualDisplay()` exits without changes on non-Linux systems or when a desktop is already present. Without root it prints a hint and returns false. As root, it installs Xvfb packages, writes `pibo-xvfb.service`, enables the systemd service, sets `DISPLAY=:0`, and waits for `/tmp/.X11-unix/X0`.

#### Acceptance

- Existing desktop sessions are never replaced by automatic Xvfb setup.
- Non-root headless Linux hosts receive install/start instructions instead of system changes.
- Root headless Linux setup installs `xvfb`, `xauth`, and `x11-xserver-utils` before enabling `pibo-xvfb.service`.
- Setup fails with a clear error if the display socket does not become ready within the wait window.
- The systemd unit uses a fixed local display `:0` with TCP listening disabled.

#### Scenario: Headless non-root host

- GIVEN a Linux host has no X11 or Wayland display
- AND the process is not root
- WHEN browser-use setup asks Pibo to ensure a virtual display
- THEN Pibo prints the manual Xvfb hint and does not write a systemd unit.

### Requirement: Browser-use health distinguishes critical and degraded states

Browser health commands MUST report whether the wrapper, Chrome binary, display, CDP state, and relevant leases are healthy.

#### Current

`pibo tools browser-use health` checks the wrapper path, discovers a Chrome or Chromium binary, detects desktop display availability, counts stale CDP pid and port files, and counts expired leases.

#### Acceptance

- Missing wrapper or Chrome reports `overall: critical`.
- Stale CDP pid files, orphan CDP port files, or expired leases report `overall: degraded` when critical checks pass.
- A healthy wrapper, Chrome binary, and clean state report `overall: ok`.
- JSON output contains machine-readable wrapper, chrome, display, stale-state, and lease fields.
- Text output includes concrete suggestions for missing wrapper, missing Chrome, stale state, and expired leases.

#### Scenario: Stale CDP state

- GIVEN browser-use is installed and Chrome is available
- AND the browser-use home contains a dead CDP pid file
- WHEN an operator runs `pibo tools browser-use health`
- THEN the command reports degraded health and suggests reaping stale browser-use leases.

### Requirement: CDP discovery prefers live Pibo-managed Chrome state

Browser-use target discovery MUST find the most recent reachable Pibo-managed Chrome CDP URL before falling back to the default CDP URL.

#### Current

`listBrowserUseCdpTargets()` normalizes an explicit URL when supplied. Without one, it searches Pibo/browser-use CDP state directories for recent `.port` files, tests reachability with `/json/version`, and falls back to `http://127.0.0.1:56663`.

#### Acceptance

- An explicit `--cdp-url` is used after trailing slash normalization.
- Recent reachable Pibo CDP port files are preferred over older ones.
- Unreachable or malformed port files are ignored.
- The default local CDP URL is used only when no reachable state file is found.
- Target listing fails clearly when Chrome returns non-array or invalid target data.

#### Scenario: Reuse existing managed Chrome

- GIVEN browser-use wrote multiple CDP port files
- AND only the newest reachable port answers `/json/version`
- WHEN an agent lists browser-use targets without `--cdp-url`
- THEN Pibo lists targets from that reachable managed Chrome instance.

### Requirement: Browser automation is bounded by a managed pool

Browser automation inside a compute worker MUST use a Pibo-managed browser pool rather than starting unlimited unmanaged Chromium processes.

#### Current

Pibo can discover Pibo-managed CDP state, but browser-use invocations can still create new browser process trees when state is missing, stale, or not reused.

#### Target

Pibo owns the browser process lifecycle, exposes a managed CDP URL to browser-use, serializes acquire/release through pool state, and recycles idle or stale managed browsers.

#### Acceptance

- A compute-worker browser-use invocation receives a managed CDP URL when browser automation is requested.
- The pool enforces a configured maximum number of Chromium main process trees per worker.
- Reuse of a healthy CDP browser does not start another Chromium main process.
- Pool health reports pid, port, profile path, active lease, last-used time, stale state, and cleanup suggestion.
- Stale cleanup matches both `chrome` and `chromium` process names, scoped to Pibo-managed user-data directories or recorded process ids.

#### Scenario: Repeated UI checks reuse the browser

- GIVEN an agent has run one browser-use UI check inside a compute worker
- WHEN a later agent session in the same worker runs another check
- THEN Pibo reuses the managed CDP browser when it is healthy
- AND the worker does not accumulate additional Chromium main process trees.

## Resource lifecycle obligations

This capability participates in the compute/browser resource lifecycle change. It must follow the canonical model in `docs/project/compute-browser-resource-operating-model.md` and the rollout checks in `docs/project/compute-browser-resource-rollout-checklist.md`.

- Browser automation inside compute workers must acquire a managed browser-pool lease and attach to the managed CDP URL instead of starting unlimited unmanaged Chromium processes.
- Pool status and health output must expose pid, port, profile path, active lease, last-used time, stale state, and cleanup suggestions in text and JSON forms.
- Stale cleanup must match both `chrome` and `chromium`, scoped to Pibo-managed pid/process-group metadata or Pibo-managed user-data directories.
- Repeated browser-use validation must prove the worker's Chromium main-process count remains bounded.

## Edge Cases

- A runtime directory may not exist; detection MUST continue without X authority, Wayland, or DBus values.
- A display socket may appear after setup starts; virtual-display setup MUST wait briefly before failing.
- CDP state files can be stale, unreadable, malformed, or missing matching pid files.
- Browser-use can be installed while no display is available; Pibo MUST still provide hints and health output instead of hiding the problem.
- Multiple agents may use different browser-use homes; discovery MUST honor `BROWSER_USE_HOME` before default home paths.

## Constraints

- **Security:** The virtual X display systemd unit MUST use `-nolisten tcp`; Pibo MUST NOT expose the display over the network.
- **Host Safety:** Automatic package installation and systemd writes require root and happen only during explicit browser-use setup.
- **Compatibility:** Non-Linux platforms keep install/env behavior without automatic virtual-display provisioning.
- **Context Economy:** Browser tool usage details remain in `pibo tools guide`; runtime context gets only compact curated-tool hints.

## Success Criteria

- [ ] SC-001: Desktop detection tests cover environment variables, runtime-dir fallbacks, and non-Linux empty detection.
- [ ] SC-002: `pibo tools env browser-use` exports wrapper-first PATH, tool home, and only detected desktop variables.
- [ ] SC-003: Virtual-display setup tests prove no-op behavior for existing display and non-root headless hosts, and systemd provisioning for root headless hosts.
- [ ] SC-004: Browser-use health reports `ok`, `degraded`, and `critical` for the documented conditions in both text and JSON modes.
- [ ] SC-005: CDP target discovery prefers reachable recent Pibo CDP state and ignores stale or invalid files.
- [ ] SC-006: Managed browser-pool tests prove repeated browser-use checks reuse a CDP browser and stale `chrome|chromium` processes are cleaned only when tied to Pibo-managed state.

## Assumptions and Open Questions

### Assumptions

- Browser-use remains the only curated tool that needs automatic desktop display handling today.
- A fixed local virtual display `:0` is acceptable for root-managed headless Linux setup.
- CDP port files in Pibo/browser-use state are trusted local process metadata, not a remote discovery mechanism.

### Open Questions

- Should Pibo expose an explicit `pibo tools desktop ensure` command instead of running virtual-display setup only through browser-use install?
- Should health include a direct CDP reachability check for the selected browser-use session?
- Should Docker compute workers use the same virtual-display service contract or continue to prepare browser capability through worker entrypoints?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Desktop detection exposes only browser-relevant process state | Existing X display | `src/tools/desktop-env.ts` | Draft |
| REQ-002 Tool environment export preserves desktop access | Agent prepares browser-use shell | `src/tools/index.ts`, `src/tools/registry.ts` | Draft |
| REQ-003 Automatic virtual display setup is safe and bounded | Headless non-root host | `src/tools/linux-virtual-display.ts`, `src/tools/registry.ts` | Draft |
| REQ-004 Browser-use health distinguishes critical and degraded states | Stale CDP state | `src/tools/index.ts`, `src/tools/browser-use-leases.ts` | Draft |
| REQ-005 CDP discovery prefers live Pibo-managed Chrome state | Reuse existing managed Chrome | `src/tools/browser-use-cdp.ts` | Draft |
| REQ-006 Browser automation is bounded by a managed pool | Repeated UI checks reuse the browser | `src/tools/browser-use-wrapper.ts`, `src/tools/browser-use-cdp.ts` | Draft |

## Verification Basis

This spec was derived from current source code in `src/tools/desktop-env.ts`, `src/tools/linux-virtual-display.ts`, `src/tools/registry.ts`, `src/tools/index.ts`, `src/tools/browser-use-wrapper.ts`, and `src/tools/browser-use-cdp.ts`. Existing specs were checked under `docs/specs/` to avoid duplicating the broader curated CLI tools and Docker compute worker contracts.
