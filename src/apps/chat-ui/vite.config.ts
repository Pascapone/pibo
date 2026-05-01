import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root,
	base: "/apps/chat/",
	resolve: {
		preserveSymlinks: true,
		tsconfigPaths: true,
	},
	plugins: [tailwindcss(), react()],
	build: {
		outDir: "../../../dist/apps/chat-ui",
		emptyOutDir: true,
	},
	server: {
		host: "127.0.0.1",
		port: 4790,
		strictPort: false,
	},
});
