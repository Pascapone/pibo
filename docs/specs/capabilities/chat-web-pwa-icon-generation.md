# Spec: Chat Web PWA Icon Generation

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Chat Web Static Shell and PWA Assets](./chat-web-static-shell-and-pwa-assets.md), [Package Build and Distribution](./package-build-and-distribution.md)

## Why

Chat Web ships as an installable browser app. Its manifest and HTML shell reference Android and iOS icons, and the public asset tree also contains Windows icon variants. These images are generated from a platform icon export and then padded so square source art remains visible inside Android circular masks.

The generation script is part of the product artifact contract even though it is not a TypeScript runtime module. Without a spec, future agents could regenerate icons with incompatible padding, add external image dependencies to the tooling path, or move files away from the paths served by the Chat Web static shell.

## Goal

Pibo MUST generate and retain Chat Web PWA icon assets in the public Chat UI asset tree with deterministic padding, dependency-free tooling, and paths that match the served manifest and HTML shell.

## Background / Current State

`scripts/pad-pwa-icons.py` reads PNG members from an `icon.zip` export, decodes them with Python standard-library code, scales each icon inside its original canvas, centers it on a transparent background, and writes PNG files under `src/apps/chat-ui/public/assets/pwa-images` by default.

`src/apps/chat-ui/public/manifest.webmanifest` references `/apps/chat/assets/pwa-images/android/launchericon-192x192.png` and `/apps/chat/assets/pwa-images/android/launchericon-512x512.png` with purpose `any maskable`. `src/apps/chat-ui/index.html` references `/apps/chat/assets/pwa-images/ios/180.png` as the Apple touch icon. The repository currently contains generated Android, iOS, and Windows PNG variants under the default public asset directory.

## Scope

### In Scope

- Icon ZIP input handling for PNG members.
- Standard-library PNG decode, padding, and RGBA PNG output behavior.
- Default and configurable output directory behavior.
- Scale validation and deterministic centered transparent padding.
- Relationship between generated file paths and Chat Web manifest / HTML shell references.

### Out of Scope

- Static serving, cache headers, and service-worker caching for generated icons — covered by Chat Web Static Shell and PWA Assets.
- Visual brand design decisions for the source logo.
- Automatic invocation during `npm run build`; the current code provides a manual script, not a build hook.
- Non-PNG source formats and interlaced PNG support; the current script rejects unsupported PNG forms.

## Requirements

### Requirement: Icon generation consumes PNG members from a ZIP export

The generation script MUST read a source ZIP file, process only file members whose names end in `.png` case-insensitively, and preserve each member's relative filename under the output directory.

#### Current

The script defaults the source path to `~/icon.zip`, accepts an optional positional `source_zip`, iterates `ZipInfo` entries, skips directories, and yields members whose filename lowercases to `.png`.

#### Target

A platform icon export can be regenerated without manually listing each icon size, and non-PNG files in the export do not produce output files.

#### Acceptance

- Running the script with no positional argument looks for `~/icon.zip`.
- Running the script with a positional ZIP path uses that path instead.
- Directory entries in the ZIP are ignored.
- Non-PNG members are ignored.
- A ZIP member such as `ios/180.png` writes to `<output-dir>/ios/180.png`.

#### Scenario: Mixed ZIP export

- GIVEN an icon export contains `android/launchericon-192x192.png`, `README.txt`, and a directory entry
- WHEN the script runs with that ZIP
- THEN it writes only the PNG member under the output directory
- AND it does not create output for `README.txt`.

### Requirement: Padding is centered, transparent, and deterministic

The script MUST scale source pixels into the same-size output canvas, center the scaled image, and leave the surrounding padding transparent.

#### Current

`padded_pixels()` computes `round(width * scale)` and `round(height * scale)`, centers the scaled region with integer offsets, fills the output with `(0, 0, 0, 0)`, and samples source pixels with deterministic nearest-neighbor lookup.

#### Target

Regenerating the same source ZIP with the same scale produces byte-stable image geometry and keeps the logo inside platform icon masks.

#### Acceptance

- The output image width and height equal the input image width and height.
- Pixels outside the centered scaled region are transparent RGBA pixels.
- The default scale is `0.72`.
- A custom `--scale` changes only the scaled region size and derived sampled pixels.
- Re-running with the same input and scale produces equivalent PNG pixel data.

#### Scenario: Default mask-safe padding

- GIVEN a `512x512` source icon
- WHEN the script runs with the default scale
- THEN the logo is scaled into a centered area of approximately `369x369` pixels
- AND the canvas remains `512x512` with transparent padding around the scaled logo.

### Requirement: Scale input is validated before writing files

The script MUST reject invalid scale values before processing the ZIP.

#### Current

The CLI accepts `--scale` as a float and calls `parser.error` unless `0 < scale <= 1`.

#### Target

Operators cannot accidentally generate empty, inverted, enlarged, or out-of-canvas icon variants.

#### Acceptance

- `--scale 0` fails.
- Negative scale values fail.
- Scale values greater than `1` fail.
- Valid values in the open-closed range `(0, 1]` continue.
- On validation failure, the command exits through argparse error handling instead of writing outputs.

#### Scenario: Enlarged scale rejected

- GIVEN an operator runs `scripts/pad-pwa-icons.py icon.zip --scale 1.25`
- WHEN argument validation runs
- THEN the command fails with a scale validation error
- AND no icon output is generated.

### Requirement: PNG support is explicit and dependency-free

The script MUST use only Python standard-library modules and MUST fail explicitly for unsupported PNG features.

#### Current

The script imports standard-library modules only. It validates the PNG signature, parses chunks, inflates IDAT data with `zlib`, reconstructs PNG filters 0 through 4, supports non-interlaced grayscale, truecolor, indexed color, grayscale-alpha, and RGBA paths within implemented bit-depth limits, and writes unfiltered 8-bit RGBA PNG output.

#### Target

Icon generation works in the repository/tooling image without installing Pillow or other image-processing packages, while unsupported inputs fail loudly.

#### Acceptance

- A non-PNG member with a `.png` suffix fails with `not a PNG file`.
- Interlaced PNGs fail with an explicit unsupported-interlace error.
- Unknown color types fail with an explicit unsupported-color error.
- Unsupported filters fail with an explicit unsupported-filter error.
- Successful outputs are valid 8-bit RGBA PNG files.

#### Scenario: Unsupported interlaced icon

- GIVEN a ZIP member is an interlaced PNG
- WHEN the script tries to decode it
- THEN the command fails explicitly
- AND it does not silently write a corrupted icon.

### Requirement: Generated assets stay aligned with Chat Web install metadata

The generated public asset tree MUST contain the icon paths referenced by the installable Chat Web shell and manifest.

#### Current

The repository contains generated files under `src/apps/chat-ui/public/assets/pwa-images`. The manifest references Android `192x192` and `512x512` launcher icons. The HTML shell references iOS `180.png` as the Apple touch icon.

#### Target

A built or served Chat Web app has valid install metadata and touch icons without hard-coded paths that do not exist in the source public tree.

#### Acceptance

- `src/apps/chat-ui/public/assets/pwa-images/android/launchericon-192x192.png` exists.
- `src/apps/chat-ui/public/assets/pwa-images/android/launchericon-512x512.png` exists.
- `src/apps/chat-ui/public/assets/pwa-images/ios/180.png` exists.
- `manifest.webmanifest` icon entries point under `/apps/chat/assets/pwa-images/`.
- `index.html` Apple touch icon points under `/apps/chat/assets/pwa-images/`.

#### Scenario: Verify install icon references

- GIVEN a source checkout after icon regeneration
- WHEN an agent compares the manifest and HTML icon URLs against the public asset tree
- THEN every currently referenced icon path resolves to an existing PNG file.

## Edge Cases

- ZIP members with nested directories are preserved under the output directory; this is required for `android/`, `ios/`, and `windows/` subtrees.
- Existing output files with matching names are overwritten by regenerated PNGs.
- If the source ZIP is missing, argparse fails before opening or writing files.
- The current script does not remove old generated files that no longer exist in the ZIP export.
- The script does not optimize PNG palette size; outputs are always RGBA PNGs.

## Constraints

- **Compatibility:** Generated public paths must remain under `src/apps/chat-ui/public/assets/pwa-images` unless the manifest, HTML shell, and static web-app serving specs change together.
- **Security / Supply Chain:** Icon generation must not require network access or third-party Python packages.
- **Performance:** Generation is an offline tooling step; runtime Chat Web startup must not depend on executing the script.
- **Maintainability:** The PNG parser should remain small and explicit; unsupported source formats should fail rather than being guessed.

## Success Criteria

- [ ] SC-001: Running `scripts/pad-pwa-icons.py <zip> --output-dir <tmp>` writes only PNG members under the matching relative paths.
- [ ] SC-002: Generated PNG pixel data keeps the input dimensions and transparent padding around the scaled logo.
- [ ] SC-003: Invalid scale values fail before output generation.
- [ ] SC-004: The script imports only Python standard-library modules.
- [ ] SC-005: Manifest and HTML icon references resolve to existing files in `src/apps/chat-ui/public/assets/pwa-images`.

## Assumptions and Open Questions

### Assumptions

- The upstream icon export keeps platform-specific subdirectories and file names stable enough for the current manifest and HTML references.
- A `0.72` scale remains the desired default for Android mask safety.

### Open Questions

- Should icon generation become an explicit npm script or remain a manual repository maintenance tool?
- Should the script delete stale output files that are absent from the source ZIP, or is preservation of extra platform assets intentional?

## Traceability

| Requirement | Scenario / Story | Code / Asset Basis | Status |
|---|---|---|---|
| REQ-001 ZIP PNG input | Mixed ZIP export | `scripts/pad-pwa-icons.py` | Draft |
| REQ-002 Deterministic padding | Default mask-safe padding | `scripts/pad-pwa-icons.py` | Draft |
| REQ-003 Scale validation | Enlarged scale rejected | `scripts/pad-pwa-icons.py` | Draft |
| REQ-004 Dependency-free PNG support | Unsupported interlaced icon | `scripts/pad-pwa-icons.py` | Draft |
| REQ-005 Install metadata alignment | Verify install icon references | `src/apps/chat-ui/public/manifest.webmanifest`, `src/apps/chat-ui/index.html`, `src/apps/chat-ui/public/assets/pwa-images/` | Draft |

## Verification Basis

This spec was derived from current workspace source and assets: `scripts/pad-pwa-icons.py`, `src/apps/chat-ui/public/manifest.webmanifest`, `src/apps/chat-ui/index.html`, and the generated files under `src/apps/chat-ui/public/assets/pwa-images/`. Existing specs under `docs/specs/` were inspected first; this spec avoids duplicating static serving and service-worker behavior already covered by Chat Web Static Shell and PWA Assets.
