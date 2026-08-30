import { useRef } from "react";
import { Trash2 } from "lucide-react";
import { DialogShell } from "./components/DialogShell";
import type { PiboRoom, PiboWebSessionNode } from "./types";

const SESSION_DELETE_CONFIRM_TEXT = "Delete this session";

export function DeleteSessionModal({
	session,
	confirmText,
	deleting,
	onConfirmTextChange,
	onCancel,
	onDelete,
}: {
	session: PiboWebSessionNode;
	confirmText: string;
	deleting: boolean;
	onConfirmTextChange: (value: string) => void;
	onCancel: () => void;
	onDelete: () => void;
}) {
	const confirmInputRef = useRef<HTMLInputElement>(null);

	return (
		<DialogShell
			title="Delete Session"
			description={session.piboSessionId}
			onClose={onCancel}
			initialFocusRef={confirmInputRef}
			closeLabel="Cancel session deletion"
			closeDisabled={deleting}
		>
			<div className="p-4 grid gap-3">
				<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
					This permanently deletes the archived session, its child sessions, and their Chat events. This cannot be undone.
				</div>
				<div className="text-sm text-slate-300">
					Type <span className="font-mono text-red-200">{SESSION_DELETE_CONFIRM_TEXT}</span> to confirm.
				</div>
				<input
					ref={confirmInputRef}
					value={confirmText}
					onChange={(event) => onConfirmTextChange(event.target.value)}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
					placeholder={SESSION_DELETE_CONFIRM_TEXT}
				/>
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						className="h-8 inline-flex items-center border border-slate-700 rounded-sm px-3 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onDelete}
						disabled={deleting || confirmText !== SESSION_DELETE_CONFIRM_TEXT}
						className="h-8 inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50"
					>
						<Trash2 size={14} />
						Delete permanently
					</button>
				</div>
			</div>
		</DialogShell>
	);
}

export function DeleteRoomModal({
	room,
	confirmName,
	deleting,
	onConfirmNameChange,
	onCancel,
	onDelete,
}: {
	room: PiboRoom;
	confirmName: string;
	deleting: boolean;
	onConfirmNameChange: (value: string) => void;
	onCancel: () => void;
	onDelete: () => void;
}) {
	const confirmInputRef = useRef<HTMLInputElement>(null);

	return (
		<DialogShell
			title="Delete Room"
			description={room.id}
			onClose={onCancel}
			initialFocusRef={confirmInputRef}
			closeLabel="Cancel room deletion"
			closeDisabled={deleting}
		>
			<div className="p-4 grid gap-3">
				<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
					This permanently deletes the archived room, child rooms, all contained sessions, subagent sessions, and their Chat events. This cannot be undone.
				</div>
				<div className="text-sm text-slate-300">
					Type <span className="font-mono text-red-200">{room.name}</span> to confirm.
				</div>
				<input
					ref={confirmInputRef}
					value={confirmName}
					onChange={(event) => onConfirmNameChange(event.target.value)}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
					placeholder={room.name}
				/>
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						className="h-8 inline-flex items-center border border-slate-700 rounded-sm px-3 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onDelete}
						disabled={deleting || confirmName !== room.name}
						className="h-8 inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50"
					>
						<Trash2 size={14} />
						Delete permanently
					</button>
				</div>
			</div>
		</DialogShell>
	);
}
