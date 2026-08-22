# Session Live Previews

Session Live Previews expose an explicitly selected loopback development port through an isolated, authenticated browser origin and attach it to the Pibo Session doing the work.

## Operator setup

Configure a base hostname dedicated to previews:

```bash
pibo config set preview.baseURL https://preview.example.com
```

For a preview id such as `pv-abcd`, Pibo serves `https://pv-abcd.preview.example.com/`. The deployment therefore needs:

1. wildcard DNS for `*.preview.example.com` pointing to the Pibo Web host;
2. TLS valid for `*.preview.example.com`;
3. the wildcard virtual host reverse-proxied to the same Pibo Web Gateway as Chat Web;
4. HTTP upgrade forwarding for development-server WebSockets.

Example reverse-proxy behavior, expressed without host-specific paths:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name *.preview.example.com;

    # Configure the wildcard certificate and key for this hostname.

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:4788;
    }
}
```

Do not proxy preview hostnames directly to development ports. Pibo must remain in the request path so preview authentication, expiration, target validation, and credential stripping are enforced.

## Agent and operator workflow

Start the application in the Pibo Session workspace, then expose its port:

```bash
pibo preview expose 5173 --session ps_... --name "Website"
```

Discover and manage previews incrementally:

```bash
pibo preview
pibo preview list
pibo preview show pv-...
pibo preview doctor pv-...
pibo preview close pv-...
```

The Chat Web Session and Project session surfaces show a Preview tab while an active exposure exists.

## Access model

Any account accepted by the Pibo instance may open any active preview. Preview visibility is not partitioned by login identity.

The canonical Pibo auth cookie is never forwarded to the development application. Chat Web creates a one-time ticket, the preview hostname exchanges it for a preview-only cookie, and that cookie grants access only to the selected preview until the preview or browser session expires.

## Security boundary

- Targets are loopback-only and created only through the local CLI.
- Privileged and known sensitive service ports are rejected.
- Exposures require an existing Pibo Session and expire automatically.
- On Linux, Pibo pins an exposure to the original listening process and rejects a replacement process that later occupies the same port.
- Preview JavaScript runs on a different origin from Chat Web.
- Pibo, Better Auth, machine-session, and preview-auth cookies are stripped before upstream proxying.
- Pibo handles HTTP, streaming responses, SSE, and WebSocket upgrades without giving the application Pibo credentials.
