import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("unknown receipt recovery counts cumulative failed GETs across refetch cycles", async () => {
	const script = `
		import assert from "node:assert/strict";
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.window = { addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
		globalThis.document = { visibilityState: "visible", hidden: false, addEventListener() {}, removeEventListener() {} };
		globalThis.window.document = globalThis.document;
		const React = await import("react");
		const { default: TestRenderer, act } = await import("react-test-renderer");
		const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
		const { messageReceiptRefetchInterval } = await import("./src/apps/chat-ui/src/tracing/message-receipts.ts");
		const { useMessageReceiptsQuery } = await import("./src/apps/chat-ui/src/tracing/use-message-receipts-query.ts");
		let fetchCalls = 0;
		globalThis.fetch = async () => { fetchCalls += 1; throw new TypeError("receipt endpoint unavailable"); };
		let latestResult;
		function Harness() {
			latestResult = useMessageReceiptsQuery("ps_receipt", {
				piboSessionId: "ps_receipt",
				clientTxnId: "txn-unknown",
				text: "accepted?",
				webAnnotationIds: [],
				fileAttachmentPaths: [],
				delivery: "queue",
			});
			return null;
		}
		const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
		let renderer;
		const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
		await act(async () => {
			renderer = TestRenderer.create(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Harness)));
		});
		await act(settle);
		assert.equal(fetchCalls, 1);
		assert.equal(latestResult.unknownReceiptAttempts, 1);
		for (let expected = 2; expected <= 7; expected += 1) {
			await act(async () => { await latestResult.query.refetch(); });
			await act(settle);
			assert.equal(latestResult.unknownReceiptAttempts, expected);
		}
		assert.equal(fetchCalls, 7, "each failed reconciliation GET is counted exactly once");
		assert.equal(messageReceiptRefetchInterval(undefined, {
			pendingTransaction: { piboSessionId: "ps_receipt", clientTxnId: "txn-unknown" },
			unchangedAttempts: latestResult.unknownReceiptAttempts,
			jitterKey: "tab-specific",
		}), false, "the cumulative seventh failure disarms periodic recovery");
		await act(async () => { renderer.unmount(); });
		queryClient.clear();
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});
