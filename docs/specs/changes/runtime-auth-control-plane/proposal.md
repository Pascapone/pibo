# Proposal: Runtime-Neutral Provider Authentication Control Plane

**Status:** Implementing
**Created:** 2026-08-16
**Requester / Source:** Active multi-agent runtime adapter goal
**Related docs:** `spec.md`, `design.md`, `tasks.md`, `../../capabilities/runtime-provider-authentication.md`, `../../../reports/runtime-auth-control-plane-validation-2026-08-16.md`

## Why

Chat Web currently intercepts provider-auth actions before runtime resolution and writes Pi `AuthStorage` directly. This makes a successful Web response mean only that Pi was configured, even when a native Codex runtime is selected. It also prevents independently configured runtime instances from using different accounts and lets missing auth metadata appear authenticated in model surfaces.

The integrated runtime-adapter work therefore has an implementation and specification gap: auth discovery exists, but mutations do not cross the adapter boundary.

## What Changes

- Add Pibo-owned runtime auth capability, status, flow, input, and result contracts.
- Dispatch status/login/API-key/cancel/logout through the selected configured runtime adapter.
- Preserve session-bound actions by targeting the active session's frozen runtime binding.
- Move Pi SDK credential operations behind the Pi adapter and preserve legacy behavior.
- Implement native Codex account operations through official App Server 0.147.0 in the instance-private `CODEX_HOME`.
- Replace Chat Web's global hard-coded provider list with a per-runtime catalog and explicit target UI.
- Make Agent Designer and model menus consume real runtime auth status.

## Capabilities

### New Capabilities

- `runtime-provider-authentication`: runtime-scoped provider discovery, login lifecycle, credential isolation, and truthful UI state.

### Modified Capabilities

- `pibo-runtime-assembly-and-inspection`: runtime inspection includes evidence-backed auth status.
- `model-provider-auth-and-session-selection`: model availability uses the selected runtime's status rather than global Pi state.
- `core-gateway-actions-and-session-controls`: legacy login actions route through the active runtime adapter.

## Impact

- **Code:** runtime SPI/registry/router, Pi and Codex adapters, Chat Web API/settings, Terminal cards, Agent Designer/model menus.
- **APIs / CLI:** adds a product-scoped provider-auth API; preserves existing `login.*` actions with safe target resolution.
- **Data:** no credential migration and no new durable secret storage.
- **Auth / Security:** credentials remain adapter-owned; Codex homes remain instance-private; no cross-home transfer.
- **Docs:** capability spec, adapter architecture/operations, authoring skill, integrated validation report, final audit, and task matrix.
