import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const testWorkspace = process.env.PIBO_TEST_WORKSPACE ?? process.cwd();
const canvasPath = resolve(testWorkspace, "src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx");
const keyboardModule = pathToFileURL(resolve(testWorkspace, "src/apps/chat-ui/src/workflows/workflow-context-menu-keyboard.ts")).href;

test("workflow graph context menu owns focus and keyboard events", async () => {
	const source = await readFile(canvasPath, "utf8");
	assert.match(source, /const contextMenuRef = useRef<HTMLDivElement \| null>\(null\)/);
	assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*contextMenuItems\(\)\[0\]\?\.focus\(\)/);
	assert.match(source, /onKeyDown=\{handleContextMenuKeyDown\}/);
	assert.match(source, /onKeyDownCapture=\{handleGraphContextMenuKeyDown\}/);
	assert.match(source, /role="menuitem"[\s\S]*tabIndex=\{-1\}/);
	assert.match(source, /\.react-flow__node\[data-id\], \.react-flow__edge\[data-id\]/);
});

test("workflow graph context menu key model covers navigation, dismissal, and invocation", async () => {
	const script = `
		import assert from "node:assert/strict";
		import { isWorkflowContextMenuInvocation, workflowContextMenuKeyAction } from ${JSON.stringify(keyboardModule)};

		assert.deepEqual(workflowContextMenuKeyAction("ArrowDown", 0, 3), { type: "focus", index: 1 });
		assert.deepEqual(workflowContextMenuKeyAction("ArrowDown", 2, 3), { type: "focus", index: 0 });
		assert.deepEqual(workflowContextMenuKeyAction("ArrowUp", 0, 3), { type: "focus", index: 2 });
		assert.deepEqual(workflowContextMenuKeyAction("Home", 2, 3), { type: "focus", index: 0 });
		assert.deepEqual(workflowContextMenuKeyAction("End", 0, 3), { type: "focus", index: 2 });
		assert.deepEqual(workflowContextMenuKeyAction("Tab", 1, 3), { type: "dismiss" });
		assert.deepEqual(workflowContextMenuKeyAction("Escape", 1, 3), { type: "dismiss" });
		assert.equal(workflowContextMenuKeyAction("Enter", 1, 3), undefined);
		assert.equal(workflowContextMenuKeyAction("ArrowDown", 0, 0), undefined);

		assert.equal(isWorkflowContextMenuInvocation("F10", true), true);
		assert.equal(isWorkflowContextMenuInvocation("ContextMenu", false), true);
		assert.equal(isWorkflowContextMenuInvocation("F10", false), false);
		assert.equal(isWorkflowContextMenuInvocation("Enter", false), false);
	`;
	const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: testWorkspace,
		maxBuffer: 1024 * 1024,
	});
	assert.equal(stdout, "");
	assert.equal(stderr, "");
});
