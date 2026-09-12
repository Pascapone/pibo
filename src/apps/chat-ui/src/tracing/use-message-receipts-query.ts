import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PendingTransaction } from "../composer-send";
import { createClientTxnId } from "../app-session-model";
import { getMessageReceipts } from "../api-chat-sessions";
import { matchingMessageReceipt, messageReceiptRefetchInterval } from "./message-receipts";

export function useMessageReceiptsQuery(
	piboSessionId: string | null,
	pendingTransaction: PendingTransaction | null,
) {
	const receiptFingerprintRef = useRef<string | undefined>(undefined);
	const receiptPollJitterSeedRef = useRef(createClientTxnId());
	const lastReceiptDataUpdateRef = useRef(0);
	const lastReceiptErrorUpdateRef = useRef(0);
	const [unknownReceiptAttempts, setUnknownReceiptAttempts] = useState(0);
	const [unchangedReceiptPolls, setUnchangedReceiptPolls] = useState(0);
	const selectedPendingTransaction = pendingTransaction?.piboSessionId === piboSessionId ? pendingTransaction : null;
	const pendingTransactionIdRef = useRef(selectedPendingTransaction?.clientTxnId);
	const query = useQuery({
		queryKey: ["chat", "message-receipts", piboSessionId],
		queryFn: () => getMessageReceipts(piboSessionId!),
		enabled: Boolean(piboSessionId),
		refetchInterval: (currentQuery) => {
			const receipts = currentQuery.state.data?.receipts;
			const pendingReceiptMissing = Boolean(selectedPendingTransaction
				&& !matchingMessageReceipt(receipts ?? [], selectedPendingTransaction));
			return messageReceiptRefetchInterval(receipts, {
				pendingTransaction: selectedPendingTransaction,
				unchangedAttempts: pendingReceiptMissing ? unknownReceiptAttempts : unchangedReceiptPolls,
				jitterKey: `${piboSessionId ?? "message-receipts"}:${receiptPollJitterSeedRef.current}`,
			});
		},
		refetchIntervalInBackground: false,
		refetchOnReconnect: "always",
		retry: false,
	});

	useEffect(() => {
		if (pendingTransactionIdRef.current === selectedPendingTransaction?.clientTxnId) return;
		pendingTransactionIdRef.current = selectedPendingTransaction?.clientTxnId;
		lastReceiptDataUpdateRef.current = query.dataUpdatedAt;
		lastReceiptErrorUpdateRef.current = query.errorUpdatedAt;
		setUnknownReceiptAttempts(0);
		setUnchangedReceiptPolls(0);
		receiptFingerprintRef.current = undefined;
	}, [query.dataUpdatedAt, query.errorUpdatedAt, selectedPendingTransaction?.clientTxnId]);

	useEffect(() => {
		const receipts = query.data?.receipts;
		const updatedAt = query.dataUpdatedAt;
		if (!receipts || updatedAt === 0 || updatedAt <= lastReceiptDataUpdateRef.current) return;
		lastReceiptDataUpdateRef.current = updatedAt;
		if (selectedPendingTransaction && !matchingMessageReceipt(receipts, selectedPendingTransaction)) {
			setUnknownReceiptAttempts((current) => current + 1);
			return;
		}
		setUnknownReceiptAttempts(0);
		const fingerprint = receipts.map((receipt) => `${receipt.id}:${receipt.state}:${receipt.updatedAt}`).join("|");
		setUnchangedReceiptPolls((current) => receiptFingerprintRef.current === fingerprint ? current + 1 : 0);
		receiptFingerprintRef.current = fingerprint;
	}, [query.data, query.dataUpdatedAt, selectedPendingTransaction]);

	useEffect(() => {
		const errorUpdatedAt = query.errorUpdatedAt;
		if (errorUpdatedAt === 0 || errorUpdatedAt <= lastReceiptErrorUpdateRef.current) return;
		lastReceiptErrorUpdateRef.current = errorUpdatedAt;
		if (selectedPendingTransaction) setUnknownReceiptAttempts((current) => current + 1);
	}, [query.errorUpdatedAt, selectedPendingTransaction]);

	return { query, unknownReceiptAttempts };
}
