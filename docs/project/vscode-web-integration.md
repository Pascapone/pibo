---
type: "Reference"
title: "VS Code Web Workspace Plugin"
description: "Explains the current packaged VS Code Web plugin, deployment topology, configuration, and security boundary."
tags: ["integration", "vscode", "web", "plugins"]
status: "stable"
authority: "informative"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T21:05:00Z"
---

# VS Code Web Workspace Plugin

Pibo Standard includes `pibo.vscode-web`, an ordinary Session workspace plugin. Users open it from the generic New Tab menu. It does not add a Core route or main-navigation area.

## Configuration

The plugin reads two optional environment values through its authenticated metadata endpoint:

```bash
PIBO_VSCODE_WEB_URL=/apps/vscode/
PIBO_VSCODE_WEB_WORKSPACE_ROOT=/path/to/workspaces
```

- `PIBO_VSCODE_WEB_URL` must resolve under the current Chat Web origin. Cross-origin, protocol-relative, credential-bearing, malformed, and path-escaping values are rejected.
- `PIBO_VSCODE_WEB_WORKSPACE_ROOT` is optional. When present, it becomes the encoded initial `folder` query value.
- With no valid URL, the workspace tab shows a bounded unavailable state and retry action.

The initial folder is a convenience, not a filesystem sandbox. The VS Code Web process account and operating-system permissions remain authoritative.

## Recommended topology

Run code-server or another compatible VS Code Web service on loopback and expose it below the same authenticated HTTPS origin as Pibo:

```text
Browser
  -> HTTPS reverse proxy
      -> /apps/chat/*     -> Pibo gateway
      -> /apps/vscode/*   -> VS Code Web on loopback
```

Protect every proxied IDE request through the Pibo authentication boundary. Do not publish an unauthenticated VS Code Web listener.

The iframe must remain same-origin because the plugin verifies the loaded document. It declares only clipboard read/write permissions and remains hidden and non-tabbable until the document exposes a genuine Monaco workbench shell.

## Readiness and recovery

An iframe load event alone is insufficient. The plugin checks for the standard workbench container and editor/theme signals. Load, probe, document-access, and timeout failures produce an explicit alert. Retry restarts the metadata and iframe readiness sequence.

A live deployment should validate:

1. the authenticated metadata endpoint;
2. same-origin proxy and websocket behavior;
3. loading, ready, error, and retry states;
4. clipboard behavior;
5. tab persistence and close behavior;
6. desktop and mobile layout; and
7. the VS Code service account's filesystem boundary.

## Security boundary

Access to the embedded IDE is equivalent to shell and filesystem access available to its service account. Treat the proxied service and installed extensions as trusted same-origin code, keep them patched, and scope their operating-system permissions. The Pibo plugin does not define an extension bridge, sidecar protocol, or additional authentication mechanism.

The normative contract is [VS Code Web Workspace Plugin](/specs/web/embedded-vscode-area.md).
