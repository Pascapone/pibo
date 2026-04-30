# Web Auth Example

This example starts pibo with Better Auth, the same-origin web host, and the chat web app.

Set the required values in `.pibo/config.json` through the CLI:

```bash
npm run dev -- config set auth.baseURL http://localhost:4788
npm run dev -- config set auth.secret <32+ character secret>
npm run dev -- config set auth.googleClientId <google oauth client id>
npm run dev -- config set auth.googleClientSecret <google oauth client secret>
npm run dev -- config set auth.allowedEmails you@example.com
```

`config get` and `config show` redact secret values in terminal output. Auth config is config-only; environment variables are not read for Better Auth.

In Google Cloud Console, configure this exact OAuth redirect URI:

```text
http://localhost:4788/api/auth/callback/google
```

For a server deployment, use the public HTTPS origin instead:

```text
https://pibo.example.com/api/auth/callback/google
```

For LAN testing through the local sslip.io nginx proxy, use the generated public origin:

```bash
npm run dev -- config set auth.baseURL http://4788.192.168.0.204.sslip.io
npm run dev -- config set auth.trustedOrigins http://4788.192.168.0.204.sslip.io
```

Register the exact matching Google OAuth redirect URI:

```text
http://4788.192.168.0.204.sslip.io/api/auth/callback/google
```

The nginx proxy must forward the browser origin to Pibo:

```nginx
proxy_set_header Host 127.0.0.1:$target_port;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_pass http://127.0.0.1:$target_port;
```

If nginx restricts LAN access, allow the client subnet, for example:

```nginx
allow 192.168.0.0/24;
deny all;
```

Google does not support a wildcard redirect URI for this web-server OAuth flow. Every self-hosted instance needs its own Google OAuth client or an explicitly registered redirect URI.

Then start:

```bash
npm run gateway:web
```

Open:

```text
http://localhost:4788/apps/chat
```

Expected behavior:

- startup fails if `auth.secret` is shorter than 32 characters
- startup fails if `auth.allowedEmails` is missing or empty
- unauthenticated chat API requests return `401`, including localhost
- authenticated users outside `auth.allowedEmails` return `403`
- mutation requests whose `Origin` does not match the public request origin return `403`
- Google sign-in creates a Better Auth session
- sign-out clears the Better Auth session and the next sign-in shows Google's account chooser
- the chat app creates or selects a persistent Pibo Session with `channel: pibo.chat-web`
- messages from the web app route into the selected Pibo Session for that user
