# Private Chat Upload Storage Validation — 2026-08-20

**Status:** PASS for focused, canonical, packed-install, and authenticated Pibo2 validation.
**Branch:** `fix/private-upload-storage`
**Base:** `upstream/dev` at `a399dcd7`

## Finding

Chat Web uploads could contain credentials and private documents, but the default POSIX storage was created as a `0755` directory with `0644` files. The controller and seeded Pibo2 environment each contained uploaded RSA private keys under that boundary. An unrelated local user could traverse the directory and read those files.

The existing private-key files were immediately restricted to `0600`, and both live upload directories were restricted to `0700`. No key contents, fingerprints, account identifiers, or credentials were printed or copied.

## Remediation

- Resolve Chat uploads under `$PIBO_HOME/uploads` instead of always using the operating-system default home.
- Create and repair the POSIX upload directory as `0700` during Chat Web initialization.
- Create multipart upload files as `0600` with exclusive filename allocation.
- Preserve default compatibility at `~/.pibo/uploads` when `PIBO_HOME` is unset.
- Update CLI and browser guidance so configured Pibo homes are represented truthfully.

## Focused validation

- TypeScript typecheck: passed.
- Production build: passed.
- Focused upload, Chat Web, terminal file-drop, command-catalog, and CLI UI suite: **134/134 passed**.
- A child-process regression test proved upload storage follows an isolated `PIBO_HOME` and creates a `0700` directory on POSIX.
- The authenticated multipart API regression proved a pre-existing `0755` directory is repaired to `0700` and both uploaded files are `0600`.
- `git diff --check`: passed.
- Test execution used the repository's isolated `HOME`/`PIBO_HOME` harness.

## Canonical validation

The canonical manifest contained 310 unique test files and ran in 16 isolated serial groups. All **1,781/1,781** tests passed with zero failures, skips, or cancellations. The yielded wrapper was stopped by host memory-pressure protection only after every group had emitted a complete passing summary; the aggregate was then recomputed directly from all 16 terminal logs and asserted `tests = pass + skipped`.

## Integrated validation

The fix was merged only into the disposable integration branch at commit `100f063d47a3501e6d350babb390ce091e59913d`, together with Runtime Portability v4.1, Better Auth migration hardening, resource-reaper home scoping, and production dependency hardening.

- Integrated typecheck and production build: passed.
- Integrated focused suite: **204/204 passed**.
- Integrated canonical suite: **1,814/1,814 passed across 312 files** with zero failures, skips, or cancellations.
- Packed archive SHA-256: `3457f109ab7be9011639224ad1d18aa7abbd9d6cd8b3f5c4e4c23c14d8c608d3`.
- Packed production audit: zero advisories.
- Packed upload probe: directory `0700`, file `0600`.
- Local Chat shell and bootstrap: HTTP 200.

The checksum-verified package was activated on Pibo2 as `runtime-portability-v4-1-secure` at the exact integration commit. Gateway startup retained `/root/.pibo/uploads` as `0700`; all four detected uploaded private-key files were `0600`. An authenticated browser multipart upload returned HTTP 201, created a 25-byte probe as `0600` under the `0700` directory, and was removed after verification. Machine-authenticated bootstrap remained healthy, the browser had one Chat page, console warnings/errors were empty, and no native-provider turn was repeated.

## Security boundary

This fix prevents unrelated local users from reading Chat uploads through default POSIX permissions. It does not classify file contents, encrypt files at rest, or rewrite ACLs for arbitrary external files. Windows continues to rely on the selected user's Pibo Home/NTFS ACL boundary; direct Windows ACL validation remains separate.

No package was published, no branch was merged, and no release was created.
