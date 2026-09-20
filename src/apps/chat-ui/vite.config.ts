import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root,
	base: "/apps/chat/",
	resolve: {
		dedupe: ["react", "react-dom", "lexical"],
		tsconfigPaths: true,
	},
	plugins: [tailwindcss(), react()],
	build: {
		outDir: "../../../dist/apps/chat-ui",
		emptyOutDir: true,
		rollupOptions: {
			preserveEntrySignatures: "strict",
			input: {
				app: resolve(root, "index.html"),
				"pibo-plugin-tool-family": resolve(root, "src/plugins/tool-family-view.tsx"),
				"pibo-plugin-web-annotations": resolve(root, "src/plugins/web-annotations-view.tsx"),
				"pibo-plugin-build-context": resolve(root, "src/plugins/build-context-view.tsx"),
				"pibo-plugin-preview": resolve(root, "src/plugins/preview-view.tsx"),
				"pibo-plugin-runtime-requests": resolve(root, "src/plugins/runtime-requests-view.tsx"),
				"pibo-plugin-workflows": resolve(root, "src/plugins/workflows-view.tsx"),
				"pibo-plugin-cron": resolve(root, "src/plugins/cron-view.tsx"),
				"pibo-plugin-loops": resolve(root, "src/plugins/loops-view.tsx"),
				"pibo-plugin-remote-agent": resolve(root, "src/plugins/remote-agent-view.tsx"),
			},
			output: {
				entryFileNames: (chunk) => chunk.name.startsWith("pibo-plugin-")
					? `assets/${chunk.name}.js`
					: "assets/[name]-[hash].js",
			},
		},
	},
	server: {
		host: "127.0.0.1",
		port: 4790,
		strictPort: false,
	},
});
