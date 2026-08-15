# Pibo Glossary

Shared vocabulary for Pibo architecture, implementation, and specifications. Keep this file limited to central Pibo-specific terms and distinctions that commonly cause mistakes.

## Core architecture

**Pibo** — The product and orchestration layer around agent harnesses. Pibo owns Pibo Sessions, rooms, projects, profiles, Agent Designer, plugins, routing, channels, jobs, workflows, goals, subagents, signals, reliability, product data, authentication, web apps, and operator tooling.

**Agent Harness** — An engine such as Pi Coding Agent or Codex that owns its native model loop, base system prompt, standard tools, native session/transcript, and harness-specific behavior.

**Pi Coding Agent** — The default embedded agent harness. It performs Pi-native model turns, tool execution, streaming, transcript persistence, compaction, and session operations.

**Codex App Server** — The official Codex JSON-RPC server used by Pibo's native Codex adapter. It is distinct from Pibo's Pi-backed Codex compatibility profile.

**Agent Runtime Adapter** — A Pibo-owned integration that maps one agent harness and protocol into Pibo runtime contracts, capabilities, diagnostics, semantic events, lifecycle, history, and portable-capability delivery.

**Configured Runtime Instance** — One registered adapter configuration selected by a profile or Pibo Session. Multiple instances may use the same adapter with isolated configuration and process state.

**Runtime Session** — One live adapter-owned handle bound to a Pibo Session. It accepts prompts, emits normalized semantic events, exposes capability-gated controls, and owns cleanup of its harness resources.

**Runtime Session Binding** — The persisted opaque link from one Pibo Session to a configured runtime instance and optional harness-native session id, locator, protocol metadata, and binding state.

**Runtime Capability** — A declared operation or delivery mechanism supported by an adapter or live runtime session. Generic orchestration dispatches by capability rather than hard-coded adapter name.

**Runtime Instance Inspection** — The runtime catalog view combining configured-instance metadata, enabled/available state, diagnostics, declared capabilities, protocol, model catalog, and auth status. It is safe product metadata and must not expose credentials.

**Runtime Profile Options** — Adapter-specific JSON saved on a profile alongside its configured runtime instance. Options are validated by the selected adapter and are distinct from the adapter instance's operator configuration.

**Portable Pibo Capability** — A Pibo-owned tool, skill, context file, MCP server selection, subagent, or control package delivered through adapter-specific direct, MCP, or materialization mechanisms.

**Profile** — A named runtime configuration selecting models, tools, skills, subagents, context files, MCP servers, and runtime options.

**Custom Agent** — A user-editable agent definition that Pibo registers as a profile. Not every profile is a Custom Agent.

**Plugin / Plugin Registry** — A plugin statically registers Pibo capabilities. The registry stores and resolves profiles, tools, skills, subagents, channels, web apps, and related extensions.

**App Context** — The single product data space behind web authentication. Authentication grants access; it does not create user-specific tenants or storage partitions.

## Sessions and containers

**Session Router / Routed Session** — The router owns active Pibo conversations, queues input, creates runtimes, and emits normalized output. A Routed Session is one active conversation managed by that router.

**Pibo Session** — Pibo's product-level conversation record and routing identity, identified by a `ps_…` Pibo Session ID. Product APIs, UI, events, and access checks use this identity.

**Pi Session ID** — The linked Pi identifier used for transcript persistence, cache affinity, forks, clones, and compaction. Do not use it for product routing.

**Parent Session / Origin Session** — `parentId` represents true hierarchy, normally for subagents or nested work. `originId` records derivation through fork or clone without implying hierarchy.

**Pibo Room** — A Chat Web container that groups Pibo Sessions and may define a workspace. A room is not a runtime conversation.

**Pibo Project** — A workspace-oriented Chat Web container tied to a project folder and associated Pibo Sessions. A project does not replace session identity.

**Workspace** — The filesystem directory in which a session runtime operates. Product-wide state belongs under Pibo Home, not inside the workspace unless explicitly workspace-scoped.

## Capabilities and execution

**Pibo Native Tool / Harness-Native Tool / Built-In Pi Tool / MCP Server / Curated CLI Tool** — A Pibo Native Tool is registered by a Pibo plugin, selected by profiles, and delivered directly or through an adapter bridge. A Harness-Native Tool belongs to the harness and remains under harness control. A Built-In Pi Tool is a Pi-native tool such as `read` or `bash`. An MCP Server is an external Model Context Protocol integration. A Curated CLI Tool is managed through `pibo tools` and is not a profile tool or MCP server.

**Pibo Tool Definition** — The Pibo-owned JSON-Schema tool contract used at the plugin/runtime boundary. It carries title/description, input and optional output schemas, execution mode, annotations, cancellation, progress, text/image/structured results, errors, correlation metadata, and payload references without importing a harness SDK.

**Portable Tool / Adapter-Private Tool** — A Portable Tool can run from Pibo's own execution context and may be compiled directly or exposed through the session-scoped MCP bridge. An Adapter-Private Tool depends on a harness-native execution context; compatibility wrappers may keep it working in that adapter, but it must not be advertised through portable MCP.

**Session-Scoped Tool MCP Bridge** — Pibo's loopback Streamable HTTP MCP server for exposing only one live Pibo Session generation's selected portable tools to an external harness.

**Tool Capability Credential** — A short-lived bearer capability for the tool MCP bridge. Pibo stores only its hash and binds it to one Pibo Session, runtime instance, adapter, live generation, and selected tool-name set; it is renewed or revoked without broadening scope.

**Runtime Session Generation** — A random live-lifecycle identifier distinct from persisted session and binding ids. Portable-tool credentials and generated runtime resources share this generation and become invalid or are removed when it is disposed, replaced, or otherwise inactive.

**Runtime Resource Session** — The router-owned, adapter-neutral live plan for one runtime generation's selected skills, ordered context contributions, and external MCP servers. It exposes hydrated inputs to the adapter, safe inspection metadata to product surfaces, delivery reports, diagnostics, scoped environment, and deterministic cleanup.

**Runtime Generation Directory** — A private `$PIBO_HOME/agent-runtimes/<runtime-instance>/<pibo-session>/<generation>/` tree containing only generated state for that live runtime generation, such as copied skills, context files, scoped MCP configuration, an isolated home, and protocol artifacts. It is not a user-global harness configuration directory.

**Runtime Delivery Report** — Safe inspection metadata for one portable contribution recording delivered, degraded, unsupported, or failed status; delivery mode; fidelity; target; and a redacted diagnostic when relevant.

**Scoped External MCP Configuration** — A selected-only MCP configuration generated for one runtime generation. Literal or referenced sensitive values are rebound through session-only environment variables; the generated file contains no resolved secret values and is removed with the generation.

**Code Runtime Tool** — The existing persistent Python/Node tool named `runtime`. It is a Pibo tool and is distinct from an Agent Runtime Adapter or Runtime Session.

**Skill / Context File** — A Skill is a selected `SKILL.md` instruction package. A Context File is selected Markdown loaded into runtime context; it may be plugin-provided or Pibo-managed.

**Subagent** — A profile-scoped generated tool that invokes another profile through a created or reused child Pibo Session.

**Input Event / Output Event** — Input Events carry messages or execution requests into the router. Output Events are normalized runtime results emitted by the router.

**Gateway / Channel / Transport** — A Gateway hosts routing and communication boundaries. A Channel maps a Transport into Pibo input and output events. The Transport is the underlying mechanism, such as HTTP, TCP, or an in-process adapter.

**Yielded Run** — A long-running tool invocation started through run-control tools so the agent can continue working and inspect the result later.

**Loop Job / Loop Run** — A Loop Job is a durable continuous-work definition. A Loop Run is one execution attempt. Goal mode continues turns in one Pibo Session; legacy Ralph mode creates a fresh Pibo Session for each run.

**Workflow Definition / Workflow Run** — A Workflow Definition is a versioned graph of nodes, edges, inputs, outputs, and policies. A Workflow Run is one execution of a definition or immutable snapshot.

**Active Model / Model Defaults** — The Active Model is persisted for an existing Pibo Session. Model Defaults select models for new sessions and must not silently change existing sessions.

## Data and projections

**Pibo Home** — The product state directory selected by `PIBO_HOME`, defaulting to `~/.pibo`.

**Pibo Data Store** — `pibo.sqlite`, the default current store for Pibo Session records and core Chat Web product data.

**Pibo Reliability Store** — `pibo-events.sqlite`, the separate store for reliability streams, durable jobs, replay state, and persisted yielded runs.

**Pibo Product History** — The runtime-neutral durable messages and terminal semantic events persisted by Pibo for Pibo-routed turns. It is the primary source for normal product-visible history and does not replace a harness-native transcript as resume state.

**Agent Runtime History Provider** — An adapter-owned compatibility and diagnostic interface that inspects and pages a harness's native history into Pibo-owned normalized history entries. Product code never parses a native transcript format directly.

**Pi Transcript** — Pi Coding Agent's JSONL conversation history. It remains Pi-owned resume state and is read through the Pi history provider only for legacy compatibility, import, repair, or explicit debugging.

**Chat Web Trace View / Chat Session View** — The Trace View is a bounded, read-time reconstruction of session execution from Pibo product history, normalized events, optional adapter-provided compatibility history, and live events. It is a projection, not a source of truth. A Chat Session View is a UI renderer for that projection.
