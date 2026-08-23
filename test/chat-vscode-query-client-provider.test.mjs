import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
	resolve("src/apps/chat-vscode/extension/webview/chat-vscode-main.tsx"),
	"utf8",
);
const layoutSource = readFileSync(
	resolve("src/apps/chat-ui/src/session-trace-layout.tsx"),
	"utf8",
);

test("VS Code webview provides the query client required by SessionTracePane", () => {
	assert.match(source, /import \{ QueryClient, QueryClientProvider \} from "@tanstack\/react-query";/);
	assert.match(source, /const queryClient = new QueryClient\(/);
	assert.match(
		source,
		/<QueryClientProvider client=\{queryClient\}>[\s\S]*?<ChatTerminalApp \/>[\s\S]*?<\/QueryClientProvider>/,
	);
});

test("shared session layout fills the VS Code webview height", () => {
	assert.match(layoutSource, /className="min-h-0 h-full flex flex-col"/);
});
