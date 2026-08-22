# Embedded VS Code Web

Pibo Chat can expose a `VS Code` main-navigation area that embeds a separately running VS Code browser server. The tab is enabled only when the gateway has `PIBO_VSCODE_WEB_URL` configured.

## Gateway configuration

```bash
PIBO_VSCODE_WEB_URL=/apps/vscode/
PIBO_VSCODE_WEB_WORKSPACE_ROOT=/path/to/workspaces
```

- `PIBO_VSCODE_WEB_URL` may be a same-origin absolute path or an `http(s)` URL.
- `PIBO_VSCODE_WEB_WORKSPACE_ROOT` is optional. When set, it becomes the initial folder offered by the embedded IDE.
- Pibo project folders are listed in the tab and opened through VS Code's `folder` URL parameter.

The integration metadata is returned only in authenticated Chat bootstrap responses. When no URL is configured, the navigation item is hidden and a direct `/apps/chat/vscode` visit shows a configuration notice.

## Recommended deployment topology

Run code-server on a loopback-only port and expose it through the same HTTPS origin as Pibo:

```text
Browser
  -> HTTPS reverse proxy
      -> /apps/chat/*     -> Pibo gateway
      -> /apps/vscode/*  -> code-server on 127.0.0.1
```

The reverse proxy should authorize every VS Code request through Pibo's lightweight authenticated endpoint:

```text
GET /api/chat/auth-check
```

That endpoint returns `204` for an authenticated Pibo session and `401` otherwise.

Example nginx locations:

```nginx
location = /_pibo_vscode_auth {
    internal;
    proxy_pass http://127.0.0.1:4788/api/chat/auth-check;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host 127.0.0.1:4788;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /apps/vscode/ {
    auth_request /_pibo_vscode_auth;

    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_pass http://127.0.0.1:4790/;

    # The IDE is intentionally embedded only by the same Pibo origin.
    proxy_hide_header X-Frame-Options;
    add_header Content-Security-Policy "frame-ancestors 'self'" always;
}
```

Run code-server without its own login only when both conditions hold:

1. it listens exclusively on loopback; and
2. every public reverse-proxy request is protected by the Pibo auth check.

Example process arguments:

```bash
code-server \
  --bind-addr 127.0.0.1:4790 \
  --auth none \
  --disable-telemetry \
  /path/to/workspaces
```

## Default theme

Provision the code-server user settings with VS Code's current dark default rather than relying on the browser or operating-system color scheme:

```json
{
  "window.autoDetectColorScheme": false,
  "workbench.colorTheme": "Default Dark Modern"
}
```

For the service layout above, store this as `<user-data-dir>/User/settings.json` before starting code-server.

## Large workspace roots

VS Code recursively watches an opened workspace. Hosts with many repositories or dependency trees may need higher Linux inotify limits. Configure these through a normal sysctl drop-in rather than changing them only for the current shell.

## Security boundary

The embedded IDE has the filesystem and terminal permissions of its server process. Treat access to the VS Code tab as equivalent to shell access for that operating-system account. Scope the process user and accessible workspace roots accordingly; do not expose an unauthenticated code-server port publicly.
