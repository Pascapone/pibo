import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root,
	base: "/apps/chat-vscode/",
	resolve: {
		dedupe: ["react", "react-dom", "lexical"],
		tsconfigPaths: true,
	},
	plugins: [tailwindcss(), react()],
	build: {
		outDir: "../../../../../dist/apps/chat-vscode-web",
		emptyOutDir: true,
	},
});
