import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/apps/chat-ui/src/web-annotations.tsx", "utf8");

test("Web Annotations trigger exposes controlled dialog semantics and disabled state", () => {
	assert.match(source, /const WEB_ANNOTATIONS_DIALOG_ID = "web-annotations-dialog"/);
	assert.match(source, /ariaHaspopup="dialog"/);
	assert.match(source, /ariaExpanded=\{open\}/);
	assert.match(source, /ariaControls=\{WEB_ANNOTATIONS_DIALOG_ID\}/);
	assert.match(source, /disabled=\{disabled\}/);
	assert.match(source, /setOpen\(\(current\) => !current\)/);
	assert.match(source, /\{open && !disabled \? \(/);
	assert.match(source, /id=\{WEB_ANNOTATIONS_DIALOG_ID\}[\s\S]*role="dialog"[\s\S]*aria-label="Web Annotations"/);
});

test("Web Annotations dialog manages initial focus and close recovery", () => {
	assert.match(source, /const triggerRef = useRef<HTMLButtonElement>\(null\)/);
	assert.match(source, /const initialFocusRef = useRef<HTMLButtonElement>\(null\)/);
	assert.match(source, /initialFocusRef\.current\?\.focus\(\)/);
	assert.match(source, /const handleKeyDown = \(event: KeyboardEvent\) => \{[\s\S]*event\.key !== "Escape"[\s\S]*closeDialog\(\)/);
	assert.match(source, /document\.addEventListener\("keydown", handleKeyDown\)/);
	assert.match(source, /document\.removeEventListener\("keydown", handleKeyDown\)/);
	assert.match(source, /const closeDialog = \(\) => \{[\s\S]*setOpen\(false\);[\s\S]*triggerRef\.current\?\.focus\(\)/);
	assert.match(source, /onClick=\{closeDialog\}[\s\S]*aria-label="Close Web Annotations panel"/);
	assert.match(source, /ref=\{initialFocusRef\}[\s\S]*data-pibo-debug="web-annotations-current-page"/);
});

test("Web Annotations dialog retains responsive desktop and mobile positioning", () => {
	assert.match(source, /fixed inset-x-2 bottom-3[\s\S]*sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:bottom-auto/);
});
