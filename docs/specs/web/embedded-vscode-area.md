---
type: "Specification"
title: "VS Code Web Workspace Plugin"
description: "Defines the current packaged VS Code Web workspace plugin, same-origin integration metadata, readiness checks, and bounded fallback behavior."
tags: ["web", "chat-web", "plugins", "vscode"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T21:05:00Z"
sources:
  - id: "integrated-source-and-tests"
    resource: "scope:Integrated implementation and focused tests at traceability.commit"
    title: "VS Code Web plugin source, package, and browser evidence"
implementation:
  state: "current"
  source_commit: "c6e3943096bd45158393d59519b525b4365679c7"
  source_evidence: "performed"
  test_execution: "Focused Preview and VS Code plugin tests passed in the isolated Docker worker; Pibo 4 package and cutover tests passed with 21 plugin packages and 24 total Candidate tarballs."
  build_execution: "Root build, root typecheck, workflow build, Chat UI production build, and Pibo 4 artifact generation passed in the isolated Docker worker."
  browser_execution: "Authenticated headful desktop and mobile flows opened VS Code as an ordinary workspace tab and confirmed the unconfigured fallback, tab switching, reload persistence, and persisted close behavior."
  evidence_limits: "No real code-server or VS Code Web binary was available in the worker. The configured-ready path is covered deterministically by source tests; the live browser run covers the unavailable path. No Pibo2 deployment, production gateway change, publication, push, PR, or release is claimed."
traceability:
  commit: "c6e3943096bd45158393d59519b525b4365679c7"
  requirements:
    - id: "WEB-VSCODE-PLUGIN-001"
      status: "implemented"
      sources:
        - path: "src/plugins/packaged-vscode-web.ts"
          symbol: "createPackagedVscodeWebPlugin"
        - path: "src/plugins/default-packages.ts"
          symbol: "createDefaultPluginPackages"
        - path: "src/apps/chat-ui/src/plugins/vscode-view.tsx"
          symbol: "VscodeWebPluginView"
      tests:
        - path: "test/plugin-system-preview-vscode-tabs.test.mjs"
          name: "VS Code is packaged as an ordinary workspace plugin with same-origin integration metadata"
        - path: "test/plugin-system-preview-vscode-tabs.test.mjs"
          name: "Preview and VS Code workspace views are ordinary tab entries without Chat routes"
      public:
        - "pibo.vscode-web"
        - "pibo.vscode-web/vscode"
        - "/api/chat/vscode-web"
        - "Chat Web New Tab menu"
      failures:
        - "Missing or disabled package contributions remove the workspace view instead of synthesizing a Core route."
        - "An unconfigured integration renders a bounded unavailable state and retry action without claiming IDE readiness."
      confidence: "high"
    - id: "WEB-VSCODE-ORIGIN-002"
      status: "implemented"
      sources:
        - path: "src/plugins/packaged-vscode-web.ts"
          symbol: "resolveVscodeWebIntegration"
        - path: "src/plugins/packaged-vscode-web.ts"
          symbol: "resolveVscodeWebRoute"
        - path: "src/apps/chat-ui/src/plugins/vscode-view.tsx"
          symbol: "resolveVscodeWebUrl"
      tests:
        - path: "test/plugin-system-preview-vscode-tabs.test.mjs"
          name: "VS Code integration rejects cross-origin URLs and preserves the workspace folder"
      public:
        - "PIBO_VSCODE_WEB_URL"
        - "PIBO_VSCODE_WEB_WORKSPACE_ROOT"
        - "/api/chat/vscode-web"
      failures:
        - "Malformed, cross-origin, protocol-relative, credential-bearing, or out-of-base URLs fail closed."
        - "The workspace folder is encoded as a query value and does not expand the approved URL origin or base path."
      confidence: "high"
    - id: "WEB-VSCODE-READINESS-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/plugins/vscode-view.tsx"
          symbol: "vscodeWorkbenchReady"
        - path: "src/apps/chat-ui/src/plugins/vscode-view.tsx"
          symbol: "VscodeWebPluginView"
      tests:
        - path: "test/plugin-system-preview-vscode-tabs.test.mjs"
          name: "VS Code readiness requires a genuine Monaco workbench shell"
      public:
        - "VS Code workspace tab loading, ready, unavailable, and retry states"
      failures:
        - "Load, probe, document access, or readiness timeout failures produce an alert and retry control; the iframe remains hidden and non-tabbable until ready."
        - "Iframe permissions are limited to clipboard read and write; iframe presence grants no extension or sidecar protocol."
      confidence: "high"
---

# Scope

This specification owns the current VS Code Web integration as an ordinary packaged Chat Web workspace plugin. It owns package identity, contribution discovery, integration metadata, same-origin URL construction, iframe readiness, and bounded unavailable/error behavior.

Gateway proxy deployment, code-server lifecycle, operating-system permissions, VS Code extensions, sidecars, and extension webview protocols remain outside this contract.

## Requirement: WEB-VSCODE-PLUGIN-001 VS Code is an ordinary packaged workspace view

Standard includes `pibo.vscode-web` as an independent plugin package. When its workspace contribution is installed and enabled, the generic New Tab catalog exposes `VS Code`; it does not require a Core-owned Chat route or main-navigation area. Opening, switching, reload restoration, and closing use the same Session-owned tabset lifecycle as other plugin views.

The view requests authenticated integration metadata from `/api/chat/vscode-web`. An absent configuration is a valid bounded state: the tab remains usable, explains that VS Code Web is unavailable, and offers retry without pretending that an IDE loaded.

## Requirement: WEB-VSCODE-ORIGIN-002 Integration URLs fail closed to the current origin

`PIBO_VSCODE_WEB_URL` must resolve to the current Chat Web origin and an approved base path. Cross-origin, protocol-relative, credential-bearing, malformed, and path-escaping values are rejected. When `PIBO_VSCODE_WEB_WORKSPACE_ROOT` is configured, the plugin appends it as an encoded `folder` query value without changing origin authority.

The integration metadata endpoint returns only the bounded URL and optional workspace folder needed by the browser view. It does not expose filesystem credentials or grant access beyond the separately deployed VS Code Web service.

## Requirement: WEB-VSCODE-READINESS-003 Ready means a genuine accessible Monaco workbench

The iframe is not considered ready merely because its load event fired. The plugin must be able to inspect the same-origin document and find the standard Monaco workbench shell and editor/theme signals. Before that point, the iframe remains hidden and excluded from tab order. Probe, load, document-access, or timeout failures expose a visible alert and retry action.

The iframe title is stable, and its declared permissions are limited to clipboard read and write. The integration defines no extension bridge, sidecar transport, or extension-internal authentication.

# Security and deployment boundary

Treat a same-origin VS Code Web service as trusted shell-level access for its operating-system account. A deployment must keep the service behind the authenticated Pibo origin and separately control its filesystem and terminal permissions. This implementation does not start, configure, or proxy code-server by itself.

# Evidence boundary

The source commit, focused tests, package/Candidate checks, root build and typecheck, and authenticated headful unavailable-state flows support the implemented claims. The worker did not contain a real VS Code Web server, so a live genuine-workbench ready transition remains deployment acceptance work. No Pibo2 deployment or runtime mutation was performed.
