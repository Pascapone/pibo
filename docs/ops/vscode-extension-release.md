# Pibo VS Code Extension Release Runbook

The Pibo VS Code extension is shipped as a `.vsix` artifact. This runbook describes the end-to-end release process and the split of responsibilities between the maintainer and the `pibo` release script.

## Distribution channels

The extension is published through two channels that are intentionally separate:

| Channel | Owner | Cadence | What it carries |
|---|---|---|---|
| npm `@pasko70/pibo` | automated via `npm publish` (or the release script's `--publish-npm` flag) | every `main` commit that includes a version bump | the `pibo` CLI, the gateway, the WebView bundle at `dist/apps/chat-vscode-web/` |
| VS Code Marketplace `pibo.pibo-vscode` | **maintainer uploads the VSIX manually** via <https://marketplace.visualstudio.com/manage> | every release that needs the extension UI updated | the `.vsix` produced by `npm run vscode:package` |

The npm package and the Marketplace extension are versioned together. The release script bumps both `package.json` (npm) and `src/apps/chat-vscode/package.json` (extension) in one go so the published artifacts stay in lockstep.

`pibo vscode install` (new since the distribution rework) downloads the VSIX from the GitHub Release for the configured repo (`Pascapone/pibo` by default). When the maintainer also uploads the same VSIX to the Marketplace, both channels serve identical bytes.

## Versioning

- The root `package.json#version` is the npm version. It follows [SemVer](https://semver.org/).
- The extension's `src/apps/chat-vscode/package.json#version` is the Marketplace version. It is kept equal to the npm version (the release script enforces this).
- A SemVer **minor** bump (e.g., `1.2.0` → `1.3.0`) is appropriate when the change is additive and backward-compatible. The distribution rework itself is a minor bump: existing `pibo` users are unaffected, and the new `pibo vscode install` command is opt-in.
- A SemVer **major** bump is reserved for breaking changes to either the public CLI surface or the WebView host↔Web postMessage contract.

## Release steps

The release script does the heavy lifting. The maintainer's job is to review, commit, and push.

### 1. Pick the version

Decide on the next version. For the distribution rework that introduces `pibo vscode install`, the right bump is `1.2.0` → `1.3.0` (new CLI command, new marketplace-ready extension, no breaking changes).

### 2. Bump + build + package (local)

From the repo root:

```bash
node scripts/release.mjs --version 1.3.0
```

The script:

1. Reads the current version from both `package.json` files.
2. Writes the new version to both files.
3. Runs `npm run build` (which includes the WebView build).
4. Runs `npm run vscode:package` to produce `dist/apps/vscode-artifacts/pibo-vscode-1.3.0.vsix` and a stable `latest.vsix` copy.
5. Prints the VSIX path and size.

The script does **not** push to git or create a tag. The maintainer reviews the diff and commits it.

### 3. Commit and tag

```bash
git add package.json src/apps/chat-vscode/package.json
git commit -m "chore(release): bump @pasko70/pibo and pibo.pibo-vscode to 1.3.0"
git tag -a v1.3.0 -m "@pasko70/pibo 1.3.0"
git push origin main
git push origin v1.3.0
```

### 4. Create a GitHub Release with the VSIX attached

The maintainer's local machine has the `gh` CLI installed:

```bash
gh release create v1.3.0 \
  dist/apps/vscode-artifacts/pibo-vscode-1.3.0.vsix \
  --title "pibo 1.3.0" \
  --notes "..."
```

In environments where `gh` is not available (e.g. the pibo compute workers),
`scripts/create-github-release.mjs` performs the same action via the Pibo
GitHub App, which has been installed on `Pascapone/pibo` with the
`contents: write` scope. The script accepts the GitHub App credentials from
`PIBO_GITHUB_APP_ID` and `PIBO_GITHUB_APP_KEY` environment variables, or
from the well-known env file at
`/root/.pibo/uploads/github-app.env` (with the PEM key auto-discovered
next to it).

```bash
node scripts/create-github-release.mjs \
  --tag v1.3.0 \
  --asset dist/apps/vscode-artifacts/pibo-vscode-1.3.0.vsix
```

Both paths make the VSIX downloadable from a stable URL
(`https://github.com/Pascapone/pibo/releases/download/v1.3.0/pibo-vscode-1.3.0.vsix`).
The `pibo vscode install` command uses the GitHub Releases API to discover
this URL automatically.

The release script can also do this in one step:

```bash
node scripts/release.mjs --version 1.3.0 --create-release
```

…if the tag has already been pushed. Internally the release script calls
`scripts/create-github-release.mjs`, so it works in worker environments
without `gh`.

### 5. Publish the npm package

```bash
npm publish
```

Or, in one go with the release script:

```bash
node scripts/release.mjs --version 1.3.0 --publish-npm --create-release
```

The publish step uploads the `pibo` CLI, the gateway plugins, and the WebView bundle. The Marketplace upload is intentionally **not** automated — see step 6.

### 6. Upload the VSIX to the VS Code Marketplace (manual)

The Marketplace does not currently accept a Personal Access Token from this account (Azure-side provisioning issue). The release is therefore finished by uploading the VSIX through the Marketplace web UI:

1. Open <https://marketplace.visualstudio.com/manage>.
2. Pick the publisher `pibo` (created during the first marketplace publish).
3. Click **Upload new extension** and select `dist/apps/vscode-artifacts/pibo-vscode-1.3.0.vsix`.
4. The Marketplace validates the manifest and publishes the extension. The publisher ID is `pibo.pibo-vscode`.

After the upload, `code --install-extension pibo.pibo-vscode` works for end users.

### 7. Verify

```bash
pibo vscode install --vsix dist/apps/vscode-artifacts/pibo-vscode-1.3.0.vsix
pibo vscode status
```

Confirm that `status` reports `pibo.pibo-vscode@1.3.0` installed via the expected `code` binary, and that the WebView loads the gateway at `http://127.0.0.1:4788/apps/chat-vscode/`.

## Rollback

If a release is broken:

- **npm**: `npm unpublish @pasko70/pibo@1.3.0` works only within 72 hours of publish. After that, publish `1.3.1` with a fix.
- **VSIX via `pibo vscode install`**: delete the GitHub Release and re-create it with a fixed VSIX. Users who have already installed the extension will not auto-update until they run `pibo vscode install` again.
- **Marketplace**: the Marketplace UI supports un-publishing or un-listing. For a fast fix, upload a corrected `.vsix` with the same version (the Marketplace accepts a re-upload before processing the original).

## What ships in the `pibo` npm package

The `files` whitelist in `package.json` controls what is published:

- `dist/` — the compiled server, the gateway plugins, the WebView bundles (chat-ui, context-files-ui, chat-vscode-web).
- `context/` — the bundled agent skills.
- `skills/builtin/**` — built-in user skills.
- `docs/ops/**` — operator runbooks.
- `README.md` and `src/mcp/LICENSE.mcp-cli`.

The `.vsix` is **not** in the npm package. It lives on the GitHub Release and (after the maintainer uploads it) on the VS Code Marketplace.

## Why the WebView bundle is in the npm package

The extension's WebView loads from `http://<gateway>/apps/chat-vscode/`, not from the `.vsix`. The gateway serves the bundle out of `dist/apps/chat-vscode-web/`. If the bundle were not in the npm package, the gateway would return 404 for the WebView and the extension would be unusable.

Including the bundle in npm costs about 1 MB of disk per `pibo` install and zero runtime cost for users who never open the extension. Users who only use the `pibo` CLI never load the bundle.
