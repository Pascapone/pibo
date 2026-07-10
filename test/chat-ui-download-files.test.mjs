import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runDownloadProgressScenario() {
	const script = `
		import assert from "node:assert/strict";
		const { downloadChatFile } = await import("./src/apps/chat-ui/src/api-chat-files.ts");

		const originalFetch = globalThis.fetch;
		const originalDocument = globalThis.document;
		const originalCreateObjectURL = URL.createObjectURL;
		const originalRevokeObjectURL = URL.revokeObjectURL;
		const anchors = [];
		globalThis.document = {
			body: { append(anchor) { anchors.push(anchor); } },
			createElement(tag) {
				assert.equal(tag, "a");
				return {
					href: "",
					download: "",
					clicked: false,
					removed: false,
					click() { this.clicked = true; },
					remove() { this.removed = true; },
				};
			},
		};
		URL.createObjectURL = (blob) => {
			assert.equal(blob.size, 5);
			return "blob:download-test";
		};
		URL.revokeObjectURL = (href) => { assert.equal(href, "blob:download-test"); };

		try {
			let requestedUrl = "";
			globalThis.fetch = async (url) => {
				requestedUrl = String(url);
				const stream = new ReadableStream({
					start(controller) {
						setTimeout(() => controller.enqueue(new Uint8Array([1, 2])), 0);
						setTimeout(() => {
							controller.enqueue(new Uint8Array([3, 4, 5]));
							controller.close();
						}, 5);
					},
				});
				return new Response(stream, {
					headers: {
						"content-length": "5",
						"content-type": "application/zip",
						"content-disposition": "attachment; filename*=UTF-8''large.zip",
					},
				});
			};

			const starts = [];
			const progress = [];
			const result = await downloadChatFile("/tmp/large.zip", {
				piboSessionId: "ps_test",
				roomId: "room_test",
				onStart: (event) => starts.push(event),
				onProgress: (event) => progress.push(event),
			});

			assert.equal(requestedUrl.startsWith("/api/chat/download?"), true);
			assert.equal(requestedUrl.includes("path=%2Ftmp%2Flarge.zip"), true);
			assert.equal(requestedUrl.includes("piboSessionId=ps_test"), true);
			assert.equal(requestedUrl.includes("roomId=room_test"), true);
			assert.deepEqual(starts, [{ path: "/tmp/large.zip", filename: "large.zip", receivedBytes: 0, totalBytes: 5 }]);
			assert.deepEqual(progress.map((event) => event.receivedBytes), [2, 5]);
			assert.deepEqual(progress.map((event) => event.totalBytes), [5, 5]);
			assert.deepEqual(result, { path: "/tmp/large.zip", filename: "large.zip", receivedBytes: 5, totalBytes: 5 });
			assert.equal(anchors.length, 1);
			assert.equal(anchors[0].download, "large.zip");
			assert.equal(anchors[0].href, "blob:download-test");
			assert.equal(anchors[0].clicked, true);
			assert.equal(anchors[0].removed, true);
		} finally {
			globalThis.fetch = originalFetch;
			globalThis.document = originalDocument;
			URL.createObjectURL = originalCreateObjectURL;
			URL.revokeObjectURL = originalRevokeObjectURL;
		}
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("downloadChatFile reports delayed download progress before triggering the browser download", async () => {
	await assert.doesNotReject(runDownloadProgressScenario());
});
