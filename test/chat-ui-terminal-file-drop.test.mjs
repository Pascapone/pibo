import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runTerminalFileDropScenario() {
  const script = `
    import assert from "node:assert/strict";
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import {
      TerminalFileDropOverlay,
      droppedFiles,
      hasDraggedFiles,
    } from "./src/apps/chat-ui/src/terminal-file-drop-target.tsx";

    globalThis.React = React;

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const fileTransfer = {
      types: ["Files"],
      items: [{ kind: "file", type: file.type, getAsFile: () => file }],
      files: [file],
    };

    assert.equal(hasDraggedFiles(fileTransfer), true);
    assert.deepEqual(droppedFiles(fileTransfer), [file]);
    assert.equal(hasDraggedFiles({ types: ["text/plain"], items: [], files: [] }), false);

    const dragMarkup = renderToStaticMarkup(React.createElement(TerminalFileDropOverlay, {
      uploadingFileCount: 0,
    }));
    assert.match(dragMarkup, /data-pibo-debug="terminal-file-drop-overlay"/);
    assert.match(dragMarkup, /data-pibo-state="drag-active"/);
    assert.match(dragMarkup, /Drop files to upload/);
    assert.match(dragMarkup, /Images and other files will be attached to your next message/);

    const uploadingMarkup = renderToStaticMarkup(React.createElement(TerminalFileDropOverlay, {
      uploadingFileCount: 2,
    }));
    assert.match(uploadingMarkup, /data-pibo-state="uploading"/);
    assert.match(uploadingMarkup, /Uploading 2 files/);
    assert.ok(uploadingMarkup.includes("Saving to the Pibo uploads directory"));
  `;
  await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("Terminal file drop helpers accept general files and render upload feedback", async () => {
  await assert.doesNotReject(runTerminalFileDropScenario());
});

test("Terminal view wires drag events into the existing chat upload attachment pipeline", () => {
  const targetSource = fs.readFileSync("src/apps/chat-ui/src/terminal-file-drop-target.tsx", "utf8");
  const paneSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
  const layoutSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");

  assert.match(targetSource, /onDragEnter=\{handleDragEnter\}/);
  assert.match(targetSource, /onDragOver=\{handleDragOver\}/);
  assert.match(targetSource, /onDragLeave=\{handleDragLeave\}/);
  assert.match(targetSource, /onDrop=\{handleDrop\}/);
  assert.match(targetSource, /event\.preventDefault\(\);[\s\S]*event\.dataTransfer\.dropEffect/);
  assert.match(targetSource, /await onFilesDropped\(files\)/);
  assert.match(paneSource, /currentSessionView\.id === "terminal"/);
  assert.match(paneSource, /const result = await uploadChatFiles\(files\);\s*attachUploadedFiles\(result\.files\);/);
  assert.match(layoutSource, /<TerminalFileDropTarget[\s\S]*enabled=\{terminalFileDropEnabled\}[\s\S]*onFilesDropped=\{onTerminalFilesDropped\}/);
});
