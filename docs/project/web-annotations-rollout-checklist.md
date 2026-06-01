# Web Annotations Rollout Checklist

Use this checklist before enabling Web Annotations outside the dedicated Docker worker.

## Worker validation

- [ ] Make code changes in a Pibo Docker compute worker worktree.
- [ ] Run root typecheck: `docker exec pibo-dev-web-annotations-plugin bash -lc 'cd /workspace && npm run typecheck'`.
- [ ] Run focused tests for store, API, tools, attachment rendering, payload validation, redaction, and plugin registration.
- [ ] Build before browser validation: `docker exec pibo-dev-web-annotations-plugin bash -lc 'cd /workspace && npm run build'`.
- [ ] Run browser fixture validation: `docker exec pibo-dev-web-annotations-plugin bash -lc 'cd /workspace && node scripts/validate-web-annotations-browser.mjs'`.
- [ ] Validate Chat Web in the Docker worker with the worker web, gateway, and CDP ports.

## Browser coverage

- [ ] Annotate a URL on the static fixture.
- [ ] Attach an existing target on the React-like fixture or Chat Web Vite app.
- [ ] Inject the overlay only into the selected target.
- [ ] Create an element annotation and a pin annotation.
- [ ] Reload and re-inject for the same binding.
- [ ] Attach an annotation to a message and verify bounded model-visible context.
- [ ] Resolve an annotation through the API or native tool path.
- [ ] Verify closed targets keep historical annotations readable.

## Security and privacy gates

- [ ] Verify app-space and Pibo Session isolation for API and tool reads and writes.
- [ ] Verify stale or unauthorized composer attachment IDs are rejected.
- [ ] Verify payload bounds for notes, selectors, DOM paths, text snippets, HTML hints, class summaries, accessibility hints, source raw metadata, thread messages, and attachment counts.
- [ ] Verify prompt/UI/tool rendering redacts secret-like text and omits inline base64 screenshot data.
- [ ] Verify cross-origin iframe contents are represented as unavailable, not scraped.

## Deployment gates

- [ ] Deploy host-level web changes to dev first with `./scripts/deploy-web-dev.sh` after worker validation succeeds.
- [ ] Validate the dev gateway with real Better Auth and an authenticated Chat Web session.
- [ ] Ask for explicit user approval before production deployment.
- [ ] Deploy production only after approval with `./scripts/deploy-web.sh`.
- [ ] Do not ship Chrome Extension support, public sharing, or automatic source edits as part of V1.
