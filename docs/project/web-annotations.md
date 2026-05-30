# Web Annotations V1

Web Annotations let a user point at a live browser target and send that reference to the current Pibo Session. The first version starts in Chat Web, uses CDP to inject a runtime-only overlay, stores bounded annotation records, and exposes optional native tools to selected agents.

## User flow

1. Open Chat Web and select an active Pibo Session.
2. Use **Annotate URL** to open a target, or use **Attach Browser Target** to select an already-open CDP target.
3. Pibo stores a binding for the Pibo Session ID, optional Room ID, target URL, and CDP target ID. Legacy owner fields may exist only as migration compatibility.
4. Pibo injects the overlay only into the selected target.
5. In the target page, create an element annotation or a pin annotation and submit a note.
6. Return to Chat Web, refresh the session annotations, and attach one or more annotations to the next message.
7. The outgoing message includes a bounded attachment summary and a concise model-visible annotation block.
8. The agent can list, inspect, acknowledge, resolve, or dismiss annotations through the selected Web Annotation tools.

## Status lifecycle

Annotations start as `open`. Chat Web marks selected records `attached` after a successful message send. Agents can move records to `acknowledged`, `applying`, `needs_review`, `resolved`, `dismissed`, or `failed` through the API or tools. `resolved` and `dismissed` are terminal states.

## Agent tools

Profiles that select the `web-annotation-agent-tools` package expose these tools:

- `web_annotations_list`: list authorized annotations for the current or explicit session.
- `web_annotations_get`: fetch one authorized annotation with target metadata.
- `web_annotations_watch`: wait briefly for new annotations and return a bounded result.
- `web_annotations_acknowledge`: record that the agent saw an annotation.
- `web_annotations_resolve`: mark work complete with a summary.
- `web_annotations_dismiss`: close an irrelevant annotation with an optional reason.

Tools derive session context from runtime context. The model cannot provide an owner or session id to bypass authorization.

## Source hints

The overlay captures source hints in layers:

1. High-confidence stable attributes, such as `data-pibo-id`, `data-testid`, `data-test-id`, `data-cy`, `data-qa`, `data-locatorjs-id`, `id`, and `aria-label`.
2. LocatorJS-compatible metadata when the page exposes it.
3. React or JSX development metadata when available.
4. Low-confidence DOM fallback hints, such as selector, DOM path, text, HTML opening tag, and bounding box.

Missing source hints do not block annotation creation. The agent should treat selector, DOM path, text, and geometry as corroborating signals rather than as a single source of truth.

## Target close and reload recovery

A page reload removes the runtime overlay but keeps the binding and annotations. Use the Chat Web inject action, API reinject action, or validation helper to inject again for the same binding.

If the CDP target closes, Pibo marks the binding `closed` with a recoverable error. The store keeps annotations readable. Start a new URL binding or explicitly attach a new target to continue collecting annotations.

## Privacy behavior

Web Annotations copy only bounded fields by default. They do not send full DOM dumps, full page HTML, or inline screenshot data into model-visible context. Screenshot data, when present, must remain an artifact reference.

The server treats overlay payloads as untrusted. It derives session ID and Room ID from the authenticated request or binding token, caps text and metadata fields, redacts common secret-like values where prompt/UI/tool serializers render text, and rejects stale or unauthorized message attachments.

## Common errors

| Error | Meaning | Action |
|---|---|---|
| CDP unavailable | Pibo cannot reach the configured Chrome debugging endpoint. | Start or select the Docker worker browser and retry with its CDP URL. |
| No targets | Chrome is reachable, but no attachable page target exists. | Open a target page or use Annotate URL. |
| Target not found | The selected target closed or the ID is stale. | Refresh the target list and select the target again. |
| Injection failed | CDP could not evaluate the overlay in the selected page. | Reload the page, reinject, or bind a fresh target. |
| Cross-origin iframe unavailable | The top-level overlay cannot inspect frame contents. | Annotate the iframe element or open the framed page directly when allowed. |
| Unauthorized annotation | The session is unavailable or does not match the trusted binding. | Use the originating Chat Web session or an authorized runtime. |
| Oversized payload | A note, selector, metadata field, or attachment list exceeded limits. | Shorten the note or reduce selected attachments. |

## Out of scope for V1

V1 does not include Chrome Extension support, public sharing, automatic source edits, broad page scraping, or automatic code modification from an overlay action.
