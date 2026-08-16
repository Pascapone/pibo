# Native Codex Resource Delivery Validation — 2026-08-16

## Scope

This report records native Codex checkpoint 9.8 for `@pasko70/pibo@1.7.2` at final implementation commit `7b2aba90d8c02e10075fc7a56783669f0357000f`, stacked on model/options PR #495.

The checkpoint delivers through official Codex App Server v2 behavior:

- selected portable Pibo tools through the session-scoped Streamable HTTP MCP bridge;
- selected external Streamable HTTP and stdio MCP servers;
- selected built-in, plugin, and user `SKILL.md` resources through private extra roots;
- selected Pibo product and context-file contributions through `developerInstructions`;
- automatic project `AGENTS.md` discovery through native Codex behavior;
- connected MCP status and selected tool inventory verification before the runtime session is advertised as ready;
- bounded Pibo tool-credential renewal and idle App Server handoff without changing the native thread binding.

The implementation does not inject Pibo's Pi base prompt, use the Pi Codex-compatibility prompt, scrape terminal output, depend on experimental `thread/settings/update`, mutate global Codex configuration, persist raw MCP credentials, or reinterpret the Pi-backed `codex` compatibility meaning.

## Implemented contract

### Pibo-managed tools

The adapter asks the router-owned portable-tool session for the selected portable definitions, issues one generation-scoped five-minute MCP lease, and passes the bearer token only through the owned App Server process environment. The App Server receives a stable thread-scoped HTTP MCP definition containing only the loopback URL, bearer environment-variable name, selected tool names, and required/enabled flags.

Lease maintenance preserves the bridge's bounded credential policy:

- leases renew while a native turn is active;
- a new turn triggers a fresh owned App Server process when the current credential generation is five minutes old;
- an idle session hands off to a replacement process before the credential's 30-minute maximum lifetime;
- the same persisted native thread resumes with a newly issued credential;
- fresh empty threads are replaced rather than falsely resumed because Codex `0.147.0` does not persist them before a first turn;
- old credentials are revoked only after the replacement process and resource inventory are ready;
- failed handoff leaves a safe status diagnostic and bounded retry rather than silently running a closed process.

A single uninterrupted native turn remains subject to the bridge's deliberate 30-minute absolute credential maximum. The adapter renews through that boundary and reports a safe warning if a turn prevents the idle process handoff long enough to reach it; it does not weaken the credential policy or interrupt native Codex work to hide the boundary.

### External MCP

Selected external servers are prepared and protocol-verified by the runtime resource service before adapter startup. The Codex adapter then converts only those selected definitions into thread configuration and verifies them again through stable `mcpServerStatus/list` after native initialization.

Streamable HTTP delivery uses:

- literal non-sensitive URL;
- literal non-sensitive headers;
- `env_http_headers` for scoped header values;
- exact verified tool names for Codex `enabled_tools`;
- bounded configured tool timeout.

Stdio delivery uses a Pibo-owned generic Node launcher. The Codex configuration contains only the Node executable, packaged launcher location, generated environment-variable names, selected tools, and required/enabled flags. The actual command, arguments, working directory, and child environment remain only in the owned App Server process environment. Codex forwards only the four generated launcher variables; the launcher removes them before spawning the selected server, preventing another selected server's header token or Pibo MCP bearer from leaking into the stdio child.

Unsupported transports are rejected before the resource verifier starts them. Required missing, malformed, disconnected, or incomplete MCP selections fail startup with bounded diagnostics. Generated MCP CLI guidance is not injected into native Codex; its delivery report is `native-mcp-inventory` because Codex receives and inspects the servers directly.

### Skills

The resource service copies only selected skill directories into the private runtime generation. Before thread start/resume, the adapter calls stable `skills/extraRoots/set` and `skills/list`, then requires every selected materialized `SKILL.md` path to be present and enabled. Unselected skills are absent from the extra root.

The selected roots are process-scoped and reapplied after credential-driven App Server replacement or normal session restart. No user-global Codex skill directory is modified.

### Context and native prompt preservation

The adapter compiles bounded ordered explicit contributions into stable `developerInstructions`. This includes Pibo product/session context, selected managed/plugin context files, and selected Pibo tooling context. It excludes the generated MCP CLI instructions because the selected servers are native Codex MCP inventory.

Automatic project context is not copied into the Pibo developer block. Codex discovers workspace `AGENTS.md` through its native project behavior, and the delivery report records `native-project-discovery` with equivalent fidelity.

The adapter never sets `baseInstructions` and never loads `context/codex-base-prompt.md` or the Pi system prompt. Exact provider-request inspection proved the native Codex coding-agent prompt remained present while selected Pibo context, automatic project context, selected skill metadata, and selected MCP tools were additive.

### Fork, resume, and cleanup

Thread start, resume, and fork carry the same stable MCP config and explicit developer instructions. Fork/clone validates the new thread's MCP inventory before switching the session binding.

Disposal:

- settles request and turn controllers;
- stops the owned App Server and its MCP process group;
- revokes the current Pibo tool credential;
- removes disposable process-generation state;
- leaves the durable native thread and configured-instance Codex home intact;
- lets the router remove the shared runtime-resource generation.

## Security and isolation

- Raw Pibo MCP bearer tokens and external HTTP/stdio secrets exist only in memory and adapter-owned process environments.
- Generated selected-only MCP files contain environment references, not resolved values.
- Stdio command arguments and child environment are hidden behind generated launcher variables and are absent from JSON-RPC thread configuration.
- Binding metadata contains no resource path, context body, MCP definition, or credential.
- Provider requests contained no MCP bearer, external header token, stdio argument secret, or stdio environment secret.
- Selected stdio children received only the configured child environment plus Codex's safe baseline, not other selected server credentials.
- Pibo-owned resource and Codex runtime boundaries remained `0700`; generated configuration remained `0600`.
- Source MCP configuration and global Codex state were unchanged.
- App Server, stdio MCP, and bridge resources were cleaned up with zero leaked processes.

## Deterministic validation

Primary coverage:

- `test/codex-native-resources.test.mjs`;
- `test/agent-runtime-resource-service.test.mjs`;
- `test/pibo-tool-mcp-bridge.test.mjs`;
- `test/pibo-portable-tool-session.test.mjs`;
- `test/codex-native-protocol-checkpoint.test.mjs`;
- `test/codex-native-client.test.mjs`;
- `test/codex-native-process.test.mjs`;
- `test/codex-native-thread.test.mjs`;
- `test/codex-native-turn.test.mjs`;
- `test/codex-native-requests.test.mjs`;
- `test/codex-native-models.test.mjs`;
- `test/fixtures/codex-app-server-thread-fake.mjs`.

Covered scenarios include:

1. Capability advertisement for Pibo HTTP MCP, external HTTP/stdio MCP, selected skills, native project discovery, and developer context.
2. Profile validation accepts portable selected tools, skills, context, and external MCP for native Codex.
3. Selected-only skill, context, HTTP MCP, stdio MCP, and Pibo tool delivery.
4. HTTP header secret rebinding and exact verified tool filtering.
5. Stdio command/argument/environment hiding through the generic launcher.
6. Connected status and selected tool inventory verification.
7. Native MCP inventory replaces Pibo's MCP CLI instruction context.
8. Pi base-prompt absence and selected context presence.
9. Fork and restart/resume resource continuity.
10. Five-minute lease renewal during an active native turn.
11. Empty-thread and durable-thread App Server credential handoff.
12. Revocation of superseded and disposed credentials.
13. Required MCP startup failure, safe diagnostics, and process-generation cleanup.
14. Rejection of unsupported transports before verifier execution.
15. Source/global state preservation and secret-safe fixture state.

Final focused resource/Codex suite:

- 65 tests;
- 65 passed;
- 0 failed.

Final workspace validation:

- `npm run typecheck -- --pretty false` — passed;
- `npm run build` — passed;
- canonical full suite — 1,722/1,722 passed across 12 suites;
- `git diff --check` — passed.

## Exact Codex 0.147.0 validation on Pibo2

The exact committed package was checksum-installed in the Pibo2 candidate store and exercised directly through its packaged runtime modules and the official Codex App Server.

Validated artifacts:

- implementation commit: `7b2aba90d8c02e10075fc7a56783669f0357000f`;
- package SHA-256: `b357867982a236a9d81ac29ab4506c5ba34952ecd18fb8c52efb2c2fbd230548`;
- Codex CLI/App Server: `0.147.0`;
- Codex JavaScript launcher SHA-256: `134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477`;
- exact Codex native payload SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`.

The exact binary used an isolated loopback Responses-compatible provider. Authentication remained Pibo2-managed and was neither read nor copied into the validation runtime.

Exact scenarios passed:

1. One selected Pibo MCP bridge, one selected external HTTP server, and one selected external stdio server all appeared in stable native status with their exact selected tool inventories.
2. Stable `mcpServer/tool/call` invoked the Pibo tool, HTTP tool, and stdio tool through Codex; a post-rollover Pibo call also passed.
3. The stdio server received its selected argument and environment value but none of the Pibo bridge, HTTP-server, resource-session, or launcher control variables.
4. `skills/extraRoots/set` plus `skills/list` loaded the one selected user skill; the unselected skill was absent.
5. The native provider request contained the selected context, automatic workspace context, selected skill metadata, and all three MCP tools.
6. The native provider request retained Codex's native coding-agent prompt and contained neither the Pi prompt nor generated Pibo MCP CLI instructions.
7. Provider requests contained none of the generated MCP bearer/header/stdio secrets.
8. A forced short lease renewed while the exact native turn remained active without replacing the App Server or changing the native thread.
9. A forced idle renewal boundary replaced the owned App Server, issued a new scoped credential, resumed the exact durable thread, revoked the old token, and completed another model turn.
10. Full adapter disposal and a new runtime generation resumed the same native thread with all selected resources and completed a third model turn.
11. Generated files and runtime boundaries retained private permissions; source MCP configuration and global Codex state were unchanged.
12. All owned App Server and stdio MCP processes exited; the final leaked-process count was zero.

The exact run completed three model turns, initialized three MCP servers, and made four direct MCP calls. Its safe result summary reported `activeLeaseRenewal`, `credentialRollover`, `restartResume`, `selectedOnly`, `nativePromptPreserved`, `privatePermissions`, and `globalCodexUnchanged` as true.

The exact candidate was also activated briefly through `pibo-web.service`; the service reported the exact commit, public health and Chat shell returned HTTP 200, and the packaged adapter loaded as `codex-native`. The development service was then returned to the pre-existing concurrent candidate. Public native profile/browser interaction remains intentionally deferred until task 9.11 registers `codex-native` in the product catalog.

## Deliberate boundary after checkpoint 9.8

Still pending:

- explicit inventory and regression proof for Codex standard native tools (9.9);
- Pibo-managed subagents and cross-runtime child sessions (9.10);
- distinct public `codex-native` profile/instance registration and alias assertions (9.11);
- remaining malformed/crash/contract fixtures and final Codex audit (9.12–9.14);
- public service-restart, trace, Designer, and authenticated native session scenarios in Milestone 10.

## Result

Task 9.8 is complete. Native Codex now receives selected Pibo tools, external HTTP/stdio MCP, selected skills, explicit Pibo context, and native project context through stable official channels. Delivery is selected-only, connected and inventory-verified, credential-scoped, restart-safe, prompt-preserving, secret-safe, and proven against exact Codex `0.147.0` with no leaked process or global-state mutation.
