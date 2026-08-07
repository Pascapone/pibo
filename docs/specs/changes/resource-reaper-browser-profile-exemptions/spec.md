# Resource reaper browser profile exemptions

**Status:** Implementing

## Problem

The automatic resource reaper terminates Chromium main processes that are not associated with a managed browser-pool lease after a ten-minute grace period. A deliberately supervised browser can have a stable profile and CDP endpoint while its PID changes across process recovery. PID-only exemptions therefore cannot safely preserve that browser over time.

On Pibo2, the authenticated non-headless validation browser was terminated every second five-minute reaper cycle after reaching 600 seconds of age. systemd restored it, but CDP clients were interrupted and duplicate restored tabs accumulated.

## Requirements

1. Operators can explicitly exempt one or more absolute Chromium `--user-data-dir` values from unmanaged-browser reaping.
2. Exemption matching is exact after path normalization; exempting a parent directory does not exempt child profiles.
3. Existing PID/process-group exemptions continue to work.
4. Relative or empty CLI profile paths are rejected.
5. The automatic gateway reaper reads the stable exemption from `PIBO_RESOURCE_REAPER_EXEMPT_BROWSER_USER_DATA_DIRS`.
6. Dry-run plans expose the resolved exemptions and preserve them in the generated apply command.
7. Resource-health status reports exact exempt profiles separately instead of calling them unmanaged leaks.
8. Reap planning still includes exempt processes as explicit `skip` items so operators can audit the reason.
9. Only Chromium main processes remain eligible for this behavior; the exemption does not broaden process discovery.

## Behavior

Environment configuration:

```bash
PIBO_RESOURCE_REAPER_EXEMPT_BROWSER_USER_DATA_DIRS=/absolute/browser/profile
```

Operator dry-run:

```bash
pibo resources reap \
  --dry-run \
  --unmanaged-browser-grace-minutes 0 \
  --exempt-browser-user-data-dirs /absolute/browser/profile
```

For a Chromium main process whose parsed `--user-data-dir` exactly matches the normalized exemption, the plan reports:

```text
skip ... explicitly exempted browser user-data-dir
```

Sibling and descendant profile paths remain unmanaged unless listed separately.

## Validation

- Production build and full typecheck pass.
- Resource CLI and compute resource-policy tests pass.
- CLI help exposes the new option and rejects unsafe relative paths.
- Resource status reports the supervised profile as exempt with zero unassigned browser processes.
- A Pibo2 candidate dry-run with zero grace skips the supervised profile.
- At least three automatic reaper cycles pass without changing the Chrome MainPID or systemd restart count.
- Authenticated CDP and Chat UI access remain healthy after the endurance window.
