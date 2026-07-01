# Implementation Plan: Codex/ChatGPT Image Generation Native Tool

**Status:** Implementing
**Created:** 2026-06-30
**Requester / Source:** User request in Pibo session `ps_d08e3ef8-6dd7-4956-a34b-a51ddad09fce`
**Primary constraint:** Use only the Codex/ChatGPT backend API and ChatGPT/Codex OAuth entitlement. Do not use the public OpenAI Images API.

## Why

The user has a paid ChatGPT/Codex plan with bundled Codex image-generation quota. Calling the public OpenAI Images API would bill separately and would not satisfy the product requirement. Pibo should expose image generation and image editing through the same Codex/ChatGPT backend family used by the Codex CLI provider path.

Pibo already has Codex-compatible local tools (`apply_patch`, `view_image`) and a provider-backed `web_search` adapter. Image generation should follow the Pibo native-tool model, not a provider-only Responses tool injection, because the installed Pi provider stack does not currently surface `image_generation_call` events as usable Pibo image outputs.

## Goal

Add a selectable Pibo native tool that generates and edits images through the Codex/ChatGPT backend API, returns image content to the agent, saves artifacts in Pibo-owned locations, and never calls the public OpenAI Images API.

## Current State

### Pibo

- `src/tools/web-search.ts` injects provider-backed OpenAI Responses web search tools.
- `src/tools/codex-compat.ts` defines local Codex-compatible tools:
  - `apply_patch`
  - `view_image`
- `src/plugins/codex-compat.ts` registers Codex-compatible native tools for the capability catalog.
- `view_image` already returns Pi image content as `{ type: "image", data, mimeType }`.
- Chat/terminal rendering already recognizes image-like tool output payloads.

### Codex reference implementation

The cloned Codex repo contains the standalone image-generation extension under:

- `/root/code/codex/codex-rs/ext/image-generation/`

Relevant behavior:

- Tool namespace/name: `image_gen.imagegen`
- Model: `gpt-image-2`
- Supports generation when no images are supplied.
- Supports edits when `referenced_image_paths` or recent conversation images are supplied.
- Allows up to 5 edit images.
- Calls Codex image endpoints through the active OpenAI/Codex provider backend:
  - `images/generations`
  - `images/edits`
- Returns base64 image data and saves the result to a host-owned artifact path.

### Pi provider stack

`@mariozechner/pi-ai` uses Codex Responses at default base URL:

```text
https://chatgpt.com/backend-api
```

Responses are sent to:

```text
/codex/responses
```

The image tool should derive Codex image URLs by appending:

```text
/codex/images/generations
/codex/images/edits
```

when the base URL is the default backend root.

## Scope

### In Scope

- Register a new Pibo native tool for Codex/ChatGPT image generation.
- Use ChatGPT/Codex OAuth credentials for provider `openai-codex`.
- Reject or fail closed when ChatGPT/Codex OAuth is unavailable.
- Generate images from a text prompt.
- Edit images using local referenced image paths.
- Edit recently generated Pibo images by session-local artifact reference/count.
- Save generated output as Pibo artifacts.
- Return generated images as Pi image tool output.
- Add tests with mocked Codex image endpoints.
- Add real-path validation instructions for a dev session with ChatGPT/Codex login.
- Document security, privacy, and billing constraints in the implementation.

### Out of Scope

- Public OpenAI Images API (`https://api.openai.com/v1/images/...`) — explicitly forbidden by product requirement.
- Provider-only Responses `image_generation` tool injection — blocked until Pi surfaces `image_generation_call` correctly.
- Full Codex Code Mode parity (`tools.image_gen__imagegen(...)` and `generatedImage(result)`) — Pibo does not currently expose Codex Code Mode as a JS orchestration runtime.
- DALL·E models — not used by the Codex reference tool.
- Mask/inpainting support — not present in the current Codex standalone extension request shape; add later only if the Codex backend supports it and the product wants it.

## Proposed User-Facing Tool

Name options:

1. `image_generation` — consistent with provider naming and user intent.
2. `imagegen` — closer to Codex `image_gen.imagegen`.
3. `codex_image_generation` — clearest that this uses Codex/ChatGPT quota only.

Recommended name: `codex_image_generation`.

Reason: the name encodes the billing/auth boundary and avoids confusion with public OpenAI image generation.

### Tool parameters

```ts
type CodexImageGenerationArgs = {
  prompt: string;
  referenced_image_paths?: string[];
  num_last_images_to_include?: number;
};
```

Rules:

- `prompt` is required.
- `referenced_image_paths` and `num_last_images_to_include` are mutually exclusive.
- Edit mode starts when either image-reference option is supplied.
- Generate mode starts when neither image-reference option is supplied.
- At most 5 edit images are sent, matching Codex extension behavior.
- Referenced paths resolve relative to the runtime cwd.
- Local image reads must remain inside the tool's existing file-access boundary.

### Tool output

Return content:

```ts
{
  content: [
    { type: "image", data: "<base64>", mimeType: "image/png" },
    { type: "text", text: "Generated image saved to <path>" }
  ],
  details: {
    provider: "openai-codex",
    api: "codex-chatgpt-images",
    operation: "generate" | "edit",
    model: "gpt-image-2",
    savedPath: "<absolute path>",
    artifactId: "<stable artifact id>",
    referencedImageCount: number
  }
}
```

The text item should be short. The image item carries the actual image data for model-visible and UI-visible follow-up.

## Architecture

### New files

- `src/tools/codex-image-generation.ts`
  - Tool definition and execution flow.
  - Argument validation.
  - Local image loading and base64 data URL conversion.
  - Output saving.

- `test/codex-image-generation.test.mjs`
  - Unit and mocked HTTP integration coverage.

Optional if the implementation grows:

- `src/tools/codex-image-client.ts`
  - Codex backend URL resolution.
  - Request/response types.
  - Auth header creation.

- `src/tools/image-artifacts.ts`
  - Artifact path helpers and generated-image history lookup.

### Existing files to change

- `src/core/profiles.ts`
  - No provider-backed union change is needed if this is a local tool.

- `src/plugins/codex-compat.ts`
  - Register `codex_image_generation` in the Codex compatibility plugin, or register it in `pibo.core` if we want it available outside Codex compat.

- `src/apps/chat-ui/src/agents/agent-designer-model.ts`
  - Add `codex_image_generation` to Codex Compat grouping if needed.

- `test/plugin-registry.test.mjs`
  - Assert the catalog exposes the new tool.

- `test/codex-compat.test.mjs`
  - Assert the tool appears under the intended plugin and is selectable.

## Codex Backend Client

### URL resolution

Implement URL resolution equivalent to Pi's Codex Responses resolver, but for image endpoints:

```text
raw base:     https://chatgpt.com/backend-api
normalized:  https://chatgpt.com/backend-api
images root: https://chatgpt.com/backend-api/codex/images

generate:    https://chatgpt.com/backend-api/codex/images/generations
edit:        https://chatgpt.com/backend-api/codex/images/edits
```

Support configured base URLs only if Pibo/Pi already routes `openai-codex` through a base override. The resolver should handle these cases:

- `<base>/codex/responses` -> `<base>/codex/images/...`
- `<base>/codex` -> `<base>/codex/images/...`
- `<base>` -> `<base>/codex/images/...`

### Auth

Use `AuthStorage.create()` and read provider `openai-codex`.

Requirements:

- The credential must be OAuth-backed ChatGPT/Codex auth.
- The access token must be present and refreshable through existing AuthStorage behavior.
- Extract `chatgpt_account_id` from the JWT claim path:

```text
https://api.openai.com/auth.chatgpt_account_id
```

Use the same header shape as the installed Pi Codex provider where practical:

```text
Authorization: Bearer <token>
chatgpt-account-id: <account id>
originator: pi
User-Agent: pibo (<platform info>)
Content-Type: application/json
Accept: application/json
```

If auth is missing, expired, or not OAuth, return a tool error that tells the user to run/login through the existing `openai-codex` login path. Do not suggest `OPENAI_API_KEY`.

### Request bodies

Generation:

```json
{
  "prompt": "...",
  "background": "auto",
  "model": "gpt-image-2",
  "quality": "auto",
  "size": "auto"
}
```

Edit:

```json
{
  "images": [{ "image_url": "data:image/png;base64,..." }],
  "prompt": "...",
  "background": "auto",
  "model": "gpt-image-2",
  "quality": "auto",
  "size": "auto"
}
```

Response:

```ts
type CodexImageResponse = {
  created: number;
  data: Array<{ b64_json: string }>;
  background?: "transparent" | "opaque" | "auto";
  quality?: "low" | "medium" | "high" | "auto";
  size?: string;
};
```

Reject responses with no `data[0].b64_json`.

## Artifact Storage

Use a Pibo-owned artifact location, not Codex's exact path.

Recommended path:

```text
<pibo-home>/generated_images/<pibo-session-id>/<safe-tool-call-id>.png
```

Fallback when no Pibo session id exists:

```text
<pibo-home>/generated_images/local/<safe-tool-call-id>.png
```

Rules:

- Sanitize session ids and tool-call ids for filenames.
- Create directories recursively.
- Write decoded base64 bytes.
- Do not write user-provided filenames directly.
- Keep original generated artifacts unless the user explicitly deletes them.

### Recent image support

To match Codex's `num_last_images_to_include`, Pibo needs a session-local source of recent image artifacts.

Implementation approach:

- Read the current Pi/Pibo session branch through the tool execution context.
- Walk session entries from newest to oldest.
- Collect image content from normal message entries and custom message entries.
- Reverse the selected window before sending it, so edit inputs are oldest-to-newest like Codex.
- This covers prior `codex_image_generation` outputs, `view_image` outputs, and user/session image content that is present in the active branch.

Follow-up if needed:

- Add a dedicated artifact metadata index only if users need image lookup outside the active session branch.

## Runtime Behavior

### Generate path

- Agent calls `codex_image_generation` with only `prompt`.
- Tool validates auth.
- Tool POSTs to Codex generations endpoint.
- Tool saves `b64_json` as PNG.
- Tool returns image content and saved-path details.

### Edit by local paths

- Agent calls with `referenced_image_paths`.
- Tool reads each file.
- Tool converts each image to a data URL with a correct mime type.
- Tool POSTs to Codex edits endpoint.
- Tool saves and returns the result.

### Edit by recent images

- Agent calls with `num_last_images_to_include`.
- Tool selects the most recent generated image artifacts in the current Pibo session.
- Tool reads them from disk, converts them to data URLs, and calls the edit endpoint.
- If too few recent images exist, the tool returns a model-facing error with the available count.

## Security and Billing Constraints

- The tool MUST NOT call `api.openai.com/v1/images/*`.
- The tool MUST NOT use `OPENAI_API_KEY` fallback.
- The tool MUST require `openai-codex` OAuth credentials.
- The tool MUST avoid logging access tokens, request bodies with embedded image base64, and response base64.
- Telemetry/details may log counts, operation, endpoint kind, and saved path, but not image payload bytes.
- Tool errors should be useful but should not include credential material or raw large payloads.

## Implementation Phases

### Phase 1: Client and Tool Skeleton

Tasks:

- Add Codex image client URL resolver.
- Add OAuth credential loader for `openai-codex`.
- Add request/response type guards.
- Add `codex_image_generation` tool definition.
- Register the tool in Codex Compat.

Verification:

- Unit tests for URL resolution.
- Unit tests for missing auth and non-OAuth auth failures.
- Catalog test shows `codex_image_generation` under `pibo.codex-compat`.

### Phase 2: Generate Support

Tasks:

- Implement generations POST.
- Decode and save returned base64.
- Return Pi image content plus saved path.
- Redact base64 from logging/details where needed.

Verification:

- Mock endpoint receives `/codex/images/generations`.
- Mock endpoint sees `model: "gpt-image-2"`.
- Tool output contains one image item and saved-path details.
- Saved file bytes match mocked base64.
- No public OpenAI endpoint is called.

### Phase 3: Edit Support with Local Images

Tasks:

- Validate `referenced_image_paths` count and path values.
- Read local images relative to runtime cwd.
- Convert PNG/JPEG/WebP/GIF to data URLs.
- Implement edits POST.
- Save and return edited result.

Verification:

- Mock edit endpoint receives `/codex/images/edits`.
- Request contains `images` with data URLs.
- Invalid/missing image paths return model-facing errors.
- More than 5 images fails before network call.
- `referenced_image_paths` plus `num_last_images_to_include` fails before network call.

### Phase 4: Recent Generated Image Editing

Tasks:

- Track generated image artifacts per Pibo session.
- Implement `num_last_images_to_include` selection.
- Reuse saved generated images as edit inputs.
- Return clear errors when recent images are unavailable.

Verification:

- Generate two images, then edit with `num_last_images_to_include: 2`.
- Edit request includes both generated images in oldest-to-newest order, matching Codex behavior.
- Request with count greater than available fails with a clear message.

### Phase 5: Chat/UI/Trace Validation

Tasks:

- Ensure Chat Web renders image tool output acceptably with existing image-output handling.
- Ensure terminal/session rows summarize image output without embedding base64.
- Add trace/debug inspection coverage if provider/tool payload redaction needs adjustment.

Verification:

- Focused Chat/terminal row tests pass for generated image output.
- Telemetry/tool details do not expose base64 payloads.
- Manual dev validation confirms image appears in Chat Web and saved path exists.

### Phase 6: Real Codex Backend Smoke

Tasks:

- Use an authenticated dev session with `openai-codex` OAuth.
- Generate a small image.
- Edit that generated image.
- Edit a local referenced image.

Verification:

- Calls use `chatgpt.com/backend-api/codex/images/...` or a configured Codex backend override.
- No request goes to `api.openai.com/v1/images`.
- Generated files exist under Pibo artifact storage.
- Agent can reuse saved paths in follow-up edits.

## Test Plan

Focused tests:

```bash
npm run build
node --test test/codex-image-generation.test.mjs test/codex-compat.test.mjs test/plugin-registry.test.mjs
```

Broader safety checks:

```bash
npm run typecheck
npm test
```

Manual validation:

1. Start dev gateway through the Pibo CLI.
2. Log in with `openai-codex` OAuth.
3. Use an agent profile that selects `codex_image_generation`.
4. Ask for a generated image.
5. Ask to edit the generated image.
6. Ask to edit a local image path.
7. Confirm saved artifacts and Chat Web image display.

## Acceptance Criteria

- [ ] AC-001: `codex_image_generation` appears in the native tool catalog.
- [ ] AC-002: The tool is selectable in custom agents.
- [ ] AC-003: Generate mode calls only the Codex/ChatGPT backend generations endpoint.
- [ ] AC-004: Edit mode calls only the Codex/ChatGPT backend edits endpoint.
- [ ] AC-005: Missing ChatGPT/Codex OAuth fails with a clear login instruction.
- [ ] AC-006: Public OpenAI Images API is never used.
- [ ] AC-007: Generated images are saved under Pibo-owned artifact paths.
- [ ] AC-008: Tool output includes an image content item usable by the agent and UI.
- [ ] AC-009: Local image edit supports up to 5 referenced images.
- [ ] AC-010: Recent generated images can be reused for edits during the session.
- [ ] AC-011: Base64 image payloads are not written to normal logs or telemetry previews.
- [ ] AC-012: Mocked tests cover generate, edit, auth failure, invalid args, and storage.
- [ ] AC-013: A real dev smoke validates generate and edit using `openai-codex` OAuth.

## Risks and Mitigations

### Risk: Codex backend image API is not public and may change

Mitigation:

- Keep the client isolated in one module.
- Mirror the current Codex extension request/response shape.
- Add mock tests that make the expected contract explicit.
- Make endpoint failures model-facing and actionable.

### Risk: OAuth refresh behavior differs from provider request path

Mitigation:

- Use the same AuthStorage path as Pibo/Pi provider auth.
- Reuse account-id extraction logic from existing OpenAI Codex usage/auth code.
- Fail closed when a token is unavailable.

### Risk: Large base64 payloads leak into logs

Mitigation:

- Return image content through Pi tool output, but keep log previews compact.
- Store only saved paths/counts in details where possible.
- Add redaction tests for tool details and telemetry previews if new telemetry is added.

### Risk: Recent image history is unavailable after restart

Mitigation:

- Implement current-session history first.
- Prefer persisted artifact metadata if it can be added without large data-store changes.
- Always support explicit `referenced_image_paths` as the stable fallback.

## Open Questions

1. Should the tool name be `codex_image_generation` or should we match Codex more closely with `imagegen`?
2. Should generated image metadata be persisted in the Pibo data store in the first implementation, or is current-session history enough for v1?
3. Should the tool be registered only by `pibo.codex-compat`, or also exposed by `pibo.core` because it is broadly useful?
4. Should the model parameter remain fixed to `gpt-image-2`, matching Codex, or be configurable behind a hidden advanced option if the Codex backend later supports more models?

## Recommended First Implementation Decision

Use these defaults unless the requester overrides them:

- Tool name: `codex_image_generation`
- Plugin: `pibo.codex-compat`
- Auth: `openai-codex` OAuth only
- Model: fixed `gpt-image-2`
- Max edit images: 5
- Artifact storage: `<pibo-home>/generated_images/<pibo-session-id>/<tool-call-id>.png`
- Recent image support: active session-branch image content, with explicit path fallback

## Source References

- Pibo Codex-compatible tools: `src/tools/codex-compat.ts`
- Pibo Web Search provider adapter: `src/tools/web-search.ts`
- Pibo Codex compatibility plugin: `src/plugins/codex-compat.ts`
- Pi Codex Responses provider: `node_modules/@mariozechner/pi-ai/dist/providers/openai-codex-responses.js`
- Codex image extension: `/root/code/codex/codex-rs/ext/image-generation/`
- Official OpenAI image generation docs, for contrast only: https://platform.openai.com/docs/guides/image-generation
