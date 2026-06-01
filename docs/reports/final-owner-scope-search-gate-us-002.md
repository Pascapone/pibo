# Report: US-002 Owner Scope Search Gate

**Created:** 2026-06-01  
**Story:** US-002 Add strict owner-scope search gates with temporary allowlist

## Gate command

Run from the repository root, inside the Docker worker for this Ralph loop:

```bash
npm run check:product-vocab
```

Useful variants:

```bash
npm run check:product-vocab -- --json
npm run check:product-vocab -- --show-allowed
npm run check:product-vocab -- --list-terms
```

The command exits non-zero when active product roots contain disallowed legacy product ownership vocabulary.

## Default scan roots

```text
src
packages
scripts
skills
test
docs/project
docs/specs
docs/plans
```

## Required term coverage

The gate covers the US-002 required terms:

```text
ownerScope
owner_scope
OwnerScope
owner-scope
shared:app
principalId
principal_id
room_members
listOwned
getOwned
requireOwned
```

It also covers the broader final-removal terms from the plan and insights, including shared-app legacy helper names, `PIBO_OWNER_SCOPE`, `OwnedSession`, `OwnedProject`, owner-selection wording, personal-target wording, and auth-user-id-as-owner wording.

## Temporary allowlist policy

The built-in allowlist is intentionally narrow:

- `docs/legacy/**` for historical documents only.
- `src/data/final-app-space-cutover-migration.ts` and `src/data/final-app-space-cutover-migration/**` for the isolated final cutover migrator only.

Current product code, current docs, tests, scripts, and skills are not allowlisted. During the early removal stories the gate is expected to fail on the current branch because active Owner Scope artifacts still exist. Later stories should remove those artifacts until the command passes.

## Shrinking the allowlist after cutover

After the approved production cutover and removal of any temporary migration module, shrink the allowlist to zero by removing the `FINAL_ALLOWED_PATHS` entries in `scripts/legacy-product-vocabulary-gate.mjs`. Then run:

```bash
npm run check:product-vocab
npm run typecheck
npm test
```

The final post-cutover target is no active product matches and no allowlisted matches.

## Focused test coverage

`test/legacy-product-vocabulary-gate.test.mjs` covers:

- required term generation;
- passing clean active files;
- failing active files;
- reporting multiple required spellings;
- allowing historical docs;
- rejecting current docs;
- allowing only the isolated cutover migration path.
