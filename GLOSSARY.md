# Pibo Glossary

Shared vocabulary for Pibo architecture, implementation, and specifications. Keep this file limited to central Pibo-specific terms and distinctions that commonly cause mistakes.

## Core architecture

**Pibo** — The TypeScript product boundary around Pi Coding Agent. Pibo owns profiles, plugins, routing, channels, product data, authentication, web apps, and operator tooling.

**Pi Coding Agent** — The embedded engine that performs model turns, tool execution, streaming, transcript persistence, and compaction.

**Runtime** — A configured Pi Coding Agent environment created by Pibo for a session.

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

**Native Tool / Built-In Pi Tool / MCP Server / Curated CLI Tool** — A Native Tool is registered by a Pibo plugin, selected by profiles, and may use a local definition or provider adapter. A Built-In Pi Tool comes from Pi, such as `read` or `bash`. An MCP Server is an external Model Context Protocol integration. A Curated CLI Tool is managed through `pibo tools` and is not a profile tool or MCP server.

**Skill / Context File** — A Skill is a selected `SKILL.md` instruction package. A Context File is selected Markdown loaded into runtime context; it may be plugin-provided or Pibo-managed.

**Subagent** — A profile-scoped generated tool that invokes another profile through a created or reused child Pibo Session.

**Input Event / Output Event** — Input Events carry messages or execution requests into the router. Output Events are normalized runtime results emitted by the router.

**Gateway / Channel / Transport** — A Gateway hosts routing and communication boundaries. A Channel maps a Transport into Pibo input and output events. The Transport is the underlying mechanism, such as HTTP, TCP, or an in-process adapter.

**Yielded Run** — A long-running tool invocation started through run-control tools so the agent can continue working and inspect the result later.

**Ralph Job / Ralph Run** — A Ralph Job is a durable continuous-work definition. A Ralph Run is one execution attempt of that job.

**Workflow Definition / Workflow Run** — A Workflow Definition is a versioned graph of nodes, edges, inputs, outputs, and policies. A Workflow Run is one execution of a definition or immutable snapshot.

**Active Model / Model Defaults** — The Active Model is persisted for an existing Pibo Session. Model Defaults select models for new sessions and must not silently change existing sessions.

## Data and projections

**Pibo Home** — The product state directory selected by `PIBO_HOME`, defaulting to `~/.pibo`.

**Pibo Data Store** — `pibo.sqlite`, the default current store for Pibo Session records and core Chat Web product data.

**Pibo Reliability Store** — `pibo-events.sqlite`, the separate store for reliability streams, durable jobs, replay state, and persisted yielded runs.

**Pi Transcript** — Pi Coding Agent's JSONL conversation history. It remains distinct from Pibo product records and UI projections.

**Chat Web Trace View / Chat Session View** — The Trace View is a bounded, read-time reconstruction of session execution from Pibo data, Pi transcripts, and live events. It is a projection, not a source of truth. A Chat Session View is a UI renderer for that projection.
