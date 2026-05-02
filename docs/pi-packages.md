# Pi Packages

`pibo pi-packages` registers Pi Coding Agent packages for opt-in use by Pibo profiles and custom agents.

Pi Packages can provide Pi-owned extensions, skills, prompt templates, and themes. Pibo keeps package registration separate from activation: a package is stored in `.pibo/pi-packages.json`, but it affects a runtime only after an agent/profile selects it.

## Commands

```bash
npm run dev -- pi-packages list
npm run dev -- pi-packages add https://pi.dev/packages/pi-web-access
npm run dev -- pi-packages add https://pi.dev/packages/@ollama/pi-web-search
npm run dev -- pi-packages add ./local-pi-package
npm run dev -- pi-packages inspect pi-web-access
npm run dev -- pi-packages remove pi-web-access
npm run dev -- pi-packages doctor
```

`add` accepts:

- `https://pi.dev/packages/<name>` package detail URLs.
- local file or directory paths, relative to the current workspace or absolute.

Other web URLs are rejected. Local paths must exist.

## Runtime Boundary

Pibo does not mirror global Pi settings into every profile. At runtime, Pibo resolves the selected `piPackages` from the Pibo store and passes only those package install specs to Pi's package loader.

Pi package resources remain Pi resources. Extensions execute inside the Pi runtime, skills are loaded as Pi skills, and prompt/theme resources stay in Pi's resource system. Pibo's native MCP servers, subagents, provider-backed tools, and `pibo-run-control` package remain separate product capabilities.

## Agent Designer

The Chat Web Agent Designer shows registered packages in the `Pi Packages` section. Users can add a package by pasting a `https://pi.dev/packages/...` URL. Browser-origin adds intentionally reject local paths; local path registration stays CLI-only.

Registered packages can be enabled, disabled, or unregistered from the Agent Designer. This global registration state is separate from per-agent selection. A disabled package remains visible, but Pibo will not load it into any runtime even if an older custom agent still has the package selected.

Package rows show resource types, version/install status, source, install spec, repository link when available, discovered extensions/skills/prompts/themes/tools, and diagnostics. Selecting a package saves its id on the custom agent. New sessions for that custom agent load only packages that are both selected and globally enabled; other profiles do not inherit them.
