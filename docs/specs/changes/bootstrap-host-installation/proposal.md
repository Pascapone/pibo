# Proposal: Bootstrap Host Installation

**Status:** Draft
**Created:** 2026-05-18
**Owner / Source:** Server migration and Pibo restore work

## Why

Pibo's first-run experience is too easy to derail. Normal users should not need to understand Docker compute workers, GitHub App secrets, branch worktrees, systemd port separation, or Caddy routing before they can try the product.

At the same time, core developers need a richer host layout: production must stay stable while the dev branch deploys to a separate gateway, and Docker compute workers must let multiple agents restart their own isolated gateways without interrupting each other.

## Goal

Provide two explicit, testable setup paths: a small user-host install and an upgradeable developer-host install.

## Scope

### In Scope

- A normal user setup path with one gateway and one `PIBO_HOME`.
- A developer setup path with production and dev gateways, separate ports, separate `PIBO_HOME` directories, Docker compute worker expectations, and explicit Git remotes.
- CLI planning output that can render systemd and Caddy artifacts without mutating the host.
- Operator documentation for user install, developer install, and user-to-developer upgrade.

### Out of Scope

- Publishing the v2 npm package.
- Fully automated root-level package installation through the Node CLI.
- Secret provisioning automation for OAuth or GitHub App private keys.
- Managed multi-instance Organizer hosting.

## Success Criteria

- [ ] A new user can identify the simple install path without reading developer docs.
- [ ] A developer can see the expected production/dev service split before editing system files.
- [ ] The CLI can render setup plans in JSON for tests and automation.
- [ ] The generated developer plan keeps production and dev gateway ports separate.
- [ ] Docker is documented as developer-host infrastructure, not as a normal-user prerequisite.
