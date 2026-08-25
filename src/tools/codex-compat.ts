import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { Type } from "typebox";
import { piboStringEnum } from "./schema.js";
import { definePiboTool, type PiboToolDefinition } from "./contract.js";

export const CODEX_COMPAT_TOOL_NAMES = ["apply_patch", "view_image"] as const;

function resolveCwd(baseCwd: string, workdir: string | undefined): string {
	if (!workdir || workdir.trim().length === 0) return baseCwd;
	return isAbsolute(workdir) ? workdir : resolve(baseCwd, workdir);
}

function mimeTypeForPath(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		default:
			return "image/png";
	}
}

export function createCodexCompatToolDefinitions(): PiboToolDefinition[] {
	const applyPatch = definePiboTool({
		name: "apply_patch",
		title: "Apply Patch",
		description: "Applies a Codex-style patch to files in the workspace.",
		promptSnippet: "Use apply_patch for manual file edits by passing the complete patch text.",
		executionMode: "sequential",
		inputSchema: Type.Object({
			patch: Type.String({ description: "Patch text starting with *** Begin Patch and ending with *** End Patch." }),
			workdir: Type.Optional(Type.String({ description: "Working directory. Defaults to the runtime cwd." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const cwd = resolveCwd(ctx.cwd, params.workdir);
			const result = await new Promise<{ exitCode: number | null; output: string }>((resolveApply, reject) => {
				const child = spawn("apply_patch", [], { cwd, env: process.env, stdio: "pipe" });
				let output = "";
				const abort = () => child.kill("SIGTERM");
				signal?.addEventListener("abort", abort, { once: true });
				child.stdout.on("data", (chunk) => {
					output += String(chunk);
				});
				child.stderr.on("data", (chunk) => {
					output += String(chunk);
				});
				child.once("error", reject);
				child.once("close", (exitCode) => {
					signal?.removeEventListener("abort", abort);
					resolveApply({ exitCode, output });
				});
				child.stdin.end(params.patch);
			});

			return {
				content: [{ type: "text", text: result.output }],
				details: { exitCode: result.exitCode, cwd },
				isError: result.exitCode !== 0,
			};
		},
	});

	const viewImage = definePiboTool({
		name: "view_image",
		title: "View Image",
		description: "Reads a local image file and returns it as an inline image result.",
		promptSnippet: "Use view_image to inspect a local image path when visual details matter.",
		executionMode: "parallel",
		inputSchema: Type.Object({
			path: Type.String({ description: "Local filesystem path to an image file." }),
			detail: Type.Optional(piboStringEnum(["original"], { description: "Use original resolution when set." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const path = resolveCwd(ctx.cwd, params.path);
			const data = await readFile(path);
			return {
				content: [{ type: "image", data: data.toString("base64"), mimeType: mimeTypeForPath(path) }],
				details: { path, detail: params.detail },
			};
		},
	});

	return [
		applyPatch,
		viewImage,
	];
}
