import { redactTerminalSecret } from "./statusViewModel.js";

export type RoomPickerInput = {
	id: string;
	title?: string;
	description?: string;
	isDefault?: boolean;
	archived?: boolean;
	disabled?: boolean;
};

export type SessionPickerInput = {
	id: string;
	title?: string;
	description?: string;
	profile?: string;
	status?: string;
	roomId?: string;
	updatedAt?: string;
	archived?: boolean;
	disabled?: boolean;
};

export type PickerItemDescriptor = {
	id: string;
	kind: "room" | "session" | "create-session" | "back";
	label: string;
	description?: string;
	roomId?: string;
	sessionId?: string;
	active?: boolean;
	current?: boolean;
	default?: boolean;
	archived?: boolean;
	disabled?: boolean;
	markers: string[];
};

export type RoomPickerDescriptor = {
	kind: "room";
	title: string;
	items: PickerItemDescriptor[];
	selectedIndex: number;
	emptyMessage: string;
};

export type SessionPickerDescriptor = {
	kind: "session";
	title: string;
	items: PickerItemDescriptor[];
	selectedIndex: number;
	emptyMessage: string;
	roomId?: string;
};

export function buildRoomPickerDescriptor(input: {
	rooms: readonly RoomPickerInput[];
	activeRoomId?: string;
	defaultRoomId?: string;
	title?: string;
}): RoomPickerDescriptor {
	const items = input.rooms.map((room) => roomPickerItem(room, room.id === input.activeRoomId, room.id === input.defaultRoomId || room.isDefault === true));
	const activeIndex = items.findIndex((item) => item.active);
	const defaultIndex = items.findIndex((item) => item.default);
	const selectedIndex = Math.max(0, activeIndex >= 0 ? activeIndex : defaultIndex);
	return {
		kind: "room",
		title: input.title ?? "Select room",
		items,
		selectedIndex,
		emptyMessage: "No rooms are available.",
	};
}

export function buildSessionPickerDescriptor(input: {
	sessions: readonly SessionPickerInput[];
	room: { id: string; title?: string };
	activeSessionId?: string;
	includeCreateAction?: boolean;
	includeBackAction?: boolean;
	title?: string;
}): SessionPickerDescriptor {
	const roomTitle = redactTerminalSecret(input.room.title ?? input.room.id);
	const backItem: PickerItemDescriptor[] = input.includeBackAction ? [{ id: "back", kind: "back", label: "← Back to rooms", markers: [] }] : [];
	const sessionItems = input.sessions.map((session) => sessionPickerItem(session, session.id === input.activeSessionId));
	const createItem: PickerItemDescriptor[] = input.includeCreateAction === false ? [] : [{
		id: `create:${input.room.id}`,
		kind: "create-session",
		label: `+ New session in ${roomTitle}`,
		description: "Create and open a new CLI session in this room",
		roomId: input.room.id,
		markers: ["new"],
	}];
	const items = [...backItem, ...sessionItems, ...createItem];
	const selectedIndex = Math.max(0, items.findIndex((item) => item.current || item.kind === "create-session"));
	return {
		kind: "session",
		title: input.title ?? `Select session in ${roomTitle}`,
		items,
		selectedIndex,
		emptyMessage: `No sessions in ${roomTitle}. Create a new session to start chatting.`,
		roomId: input.room.id,
	};
}

function roomPickerItem(room: RoomPickerInput, active: boolean, isDefault: boolean): PickerItemDescriptor {
	const markers = [active ? "active" : undefined, isDefault ? "default" : undefined, room.archived ? "archived" : undefined]
		.filter((marker): marker is string => Boolean(marker));
	return {
		id: room.id,
		kind: "room",
		label: redactTerminalSecret(room.title ?? room.id),
		description: redactTerminalSecret([room.description, markers.join(", ")].filter(Boolean).join(" | ")) || undefined,
		roomId: room.id,
		active,
		default: isDefault,
		archived: room.archived,
		disabled: room.disabled,
		markers,
	};
}

function sessionPickerItem(session: SessionPickerInput, current: boolean): PickerItemDescriptor {
	const markers = [current ? "current" : undefined, session.status, session.archived ? "archived" : undefined]
		.filter((marker): marker is string => Boolean(marker));
	return {
		id: session.id,
		kind: "session",
		label: redactTerminalSecret(session.title ?? session.id),
		description: redactTerminalSecret([session.profile, session.description, session.updatedAt, markers.join(", ")].filter(Boolean).join(" | ")) || undefined,
		roomId: session.roomId,
		sessionId: session.id,
		current,
		archived: session.archived,
		disabled: session.disabled,
		markers,
	};
}
