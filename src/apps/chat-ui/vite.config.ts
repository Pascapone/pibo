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
				"pibo-builtin-plugin": resolve(root, "src/plugins/builtin-browser-entry.tsx"),
			},
			output: {
				entryFileNames: (chunk) => chunk.name === "pibo-builtin-plugin"
					? "assets/pibo-builtin-plugin.js"
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
