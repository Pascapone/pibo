export function roomSummaryStreamUrl(input: {
	area: string;
	activeRoomId: string | null | undefined;
	bootstrapSelectedRoomId: string | null | undefined;
	latestRoomStreamId: number | undefined;
}): string | null {
	if (input.area !== "sessions" || !input.activeRoomId) return null;
	if (input.bootstrapSelectedRoomId !== input.activeRoomId) return null;
	if (typeof input.latestRoomStreamId !== "number" || !Number.isFinite(input.latestRoomStreamId) || input.latestRoomStreamId <= 0) return null;
	const params = new URLSearchParams({ roomId: input.activeRoomId });
	params.set("mode", "summary");
	params.set("since", `${input.latestRoomStreamId}:999999`);
	return `/api/chat/events?${params.toString()}`;
}
