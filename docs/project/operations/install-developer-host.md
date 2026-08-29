# Install Pibo as a Developer Host

Use this path when the host is used to develop Pibo itself.

## Philosophy

Production must stay stable while development moves quickly. The dev gateway can restart, fail, or deploy the `dev` branch without interrupting the main production gateway.

Docker compute workers are part of the developer setup. Each agent should get its own isolated container and gateway so agent restarts do not disturb other agents or the host gateways.

## Target layout

```text
/root/code/pibo                  main / production
/root/code/pibo/.worktrees/dev   dev / development

/root/.pibo                      production data
/root/.pibo-dev                  development data

pibo-web.service                 prod web 4788, gateway 4789
pibo-web-dev.service             dev web 4808, gateway 4809
```

## Remotes

Each developer host should use its own fork as `origin` and the canonical repo as `upstream`:

```text
origin    git@github.com:<server-or-user-fork>/pibo.git
upstream  git@github.com:Pascapone/pibo.git
```

## Plan the setup

```bash
pibo setup developer-host \
  --origin git@github.com:<server-or-user-fork>/pibo.git \
  --upstream git@github.com:Pascapone/pibo.git \
  --prod-domain pibo.example.com \
  --dev-domain dev.pibo.example.com \
  --print-files
```

Review the generated systemd units, dev start wrapper, environment template, and Caddyfile. Stage files before applying when testing a fresh host:

```bash
pibo setup developer-host \
  --origin git@github.com:<server-or-user-fork>/pibo.git \
  --prod-domain pibo.example.com \
  --dev-domain dev.pibo.example.com \
  --write-to /tmp/pibo-setup
```

Apply after review:

```bash
pibo setup developer-host \
  --origin git@github.com:<server-or-user-fork>/pibo.git \
  --prod-domain pibo.example.com \
  --dev-domain dev.pibo.example.com \
  --apply --yes
systemctl daemon-reload
```

## Important detail: service pinning

Do not globally install the dev worktree over the production install. `npm install -g .` from a local checkout creates a global symlink to that checkout; running it again from the dev worktree can accidentally move `/usr/bin/pibo` to dev.

The generated developer services avoid this by pinning production to:

```text
/usr/bin/node /root/code/pibo/dist/bin/pibo.js
```

and dev to the wrapper in `/usr/local/bin/pibo-web-dev-start.mjs`, which imports the dev worktree directly.

Run this in each checkout/worktree instead:

```bash
npm ci
npm run build
```

## Important detail: dev internal gateway port

Do not start dev only with:

```bash
pibo gateway:web --web-port 4808
```

That changes the web port but leaves the internal gateway at the default `4789`, which collides with production. The generated developer setup uses a wrapper that calls `runWebGatewayServer` with:

```text
web port:      4808
internal port: 4809
```

## Validate

```bash
systemctl is-active pibo-web
systemctl is-active pibo-web-dev
pibo gateway web status
PIBO_GATEWAY_DEV_PORT=4808 pibo gateway dev status
pibo setup doctor --domain pibo.example.com --dev-domain dev.pibo.example.com --expected-ip <server-ip> --require-docker --min-swap-gb 8
pibo compute spawn --help
```

DNS must point to the host before Caddy can issue public certificates.

Docker and swap are developer-host prerequisites only. User-host installs can ignore Docker and swap. The setup command does not create swap automatically; provision it at the OS level, then verify it with `pibo setup doctor --min-swap-gb 8`.
