import type { BootstrapData, PiboRoom } from "./types";
import { updateRoomInBootstrap } from "./app-bootstrap-mutations";

export type RoomMutationInput = { name?: string; topic?: string | null; workspace?: string | null; archived?: boolean };
type Field = "name" | "topic" | "workspace" | "archivedAt";
type Values = Partial<Record<Field, string | undefined>>;
type Layer = { value: string | undefined; status: "pending" | "success" | "failure" };
type FieldState = { base: string | undefined; layers: Layer[] };
export type RoomMutation = { roomId: string; layers: Map<Field, Layer> };

function readField(room: PiboRoom, field: Field): string | undefined {
	return field === "archivedAt" ? room.metadata?.chatRoomArchivedAt as string | undefined : room[field];
}

function applyValues(room: PiboRoom, values: Values): PiboRoom {
	const next = { ...room };
	if ("name" in values) next.name = values.name!;
	if ("topic" in values) next.topic = values.topic;
	if ("workspace" in values) {
		next.workspace = values.workspace;
		next.metadata = { ...next.metadata };
		if (values.workspace === undefined) delete next.metadata.workspace;
		else next.metadata.workspace = values.workspace;
	}
	if ("archivedAt" in values) {
		next.metadata = { ...next.metadata };
		if (values.archivedAt === undefined) delete next.metadata.chatRoomArchivedAt;
		else next.metadata.chatRoomArchivedAt = values.archivedAt;
	}
	return next;
}

function resolveField(state: FieldState): string | undefined {
	for (let index = state.layers.length - 1; index >= 0; index--) {
		const layer = state.layers[index]!;
		if (layer.status !== "failure") return layer.value;
	}
	return state.base;
}

/** Tracks only in-flight edited fields, not whole bootstrap snapshots. */
export class RoomMutationTracker {
	private readonly rooms = new Map<string, Map<Field, FieldState>>();

	begin(room: PiboRoom, input: RoomMutationInput): RoomMutation {
		const values: Values = {};
		if (input.name !== undefined) values.name = input.name;
		if (input.topic !== undefined) values.topic = input.topic ?? undefined;
		if (input.workspace !== undefined) values.workspace = input.workspace ?? undefined;
		if (input.archived !== undefined) values.archivedAt = input.archived ? new Date().toISOString() : undefined;
		const fields = this.rooms.get(room.id) ?? new Map<Field, FieldState>();
		this.rooms.set(room.id, fields);
		const mutation: RoomMutation = { roomId: room.id, layers: new Map() };
		for (const field of Object.keys(values) as Field[]) {
			const state = fields.get(field) ?? { base: readField(room, field), layers: [] };
			const layer: Layer = { value: values[field], status: "pending" };
			state.layers.push(layer);
			fields.set(field, state);
			mutation.layers.set(field, layer);
		}
		return mutation;
	}

	settle(mutation: RoomMutation, response?: PiboRoom): (data: BootstrapData) => BootstrapData {
		const fields = this.rooms.get(mutation.roomId)!;
		const values: Values = {};
		for (const [field, layer] of mutation.layers) {
			layer.status = response ? "success" : "failure";
			if (response) layer.value = readField(response, field);
			const state = fields.get(field)!;
			values[field] = resolveField(state);
			if (!state.layers.some((entry) => entry.status === "pending")) fields.delete(field);
		}
		if (fields.size === 0) this.rooms.delete(mutation.roomId);
		return (data) => updateRoomInBootstrap(data, mutation.roomId, (room) => {
			const next = applyValues(room, values);
			if (response && response.updatedAt > next.updatedAt) next.updatedAt = response.updatedAt;
			return next;
		});
	}

	apply(data: BootstrapData): BootstrapData {
		let next = data;
		for (const [roomId, fields] of this.rooms) {
			const values: Values = {};
			for (const [field, state] of fields) values[field] = resolveField(state);
			next = updateRoomInBootstrap(next, roomId, (room) => applyValues(room, values));
		}
		return next;
	}
}
