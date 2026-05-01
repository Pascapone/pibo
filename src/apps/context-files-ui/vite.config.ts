import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root,
	base: "/apps/context-files/",
	plugins: [tailwindcss(), react()],
	build: {
		outDir: "../../../dist/apps/context-files-ui",
		emptyOutDir: true,
	},
	server: {
		host: "127.0.0.1",
		port: 4791,
		strictPort: false,
	},
});
