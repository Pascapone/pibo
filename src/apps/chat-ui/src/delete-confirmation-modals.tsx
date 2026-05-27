import { Trash2, X } from "lucide-react";
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
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
			<div className="w-full max-w-lg border border-red-500/70 bg-[#1a262b] rounded-sm shadow-xl">
				<div className="px-4 py-3 border-b border-red-500/50 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-bold uppercase tracking-wider text-red-200">Delete Session</h2>
						<div className="font-mono text-[11px] text-slate-500 truncate">{session.piboSessionId}</div>
					</div>
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						title="Cancel"
						aria-label="Cancel"
						className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						<X size={14} />
					</button>
				</div>
				<div className="p-4 grid gap-3">
					<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
						This permanently deletes the archived session, its child sessions, and their Chat events. This cannot be undone.
					</div>
					<div className="text-sm text-slate-300">
						Type <span className="font-mono text-red-200">{SESSION_DELETE_CONFIRM_TEXT}</span> to confirm.
					</div>
					<input
						value={confirmText}
						onChange={(event) => onConfirmTextChange(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
						placeholder={SESSION_DELETE_CONFIRM_TEXT}
						autoFocus
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
			</div>
		</div>
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
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
			<div className="w-full max-w-lg border border-red-500/70 bg-[#1a262b] rounded-sm shadow-xl">
				<div className="px-4 py-3 border-b border-red-500/50 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-bold uppercase tracking-wider text-red-200">Delete Room</h2>
						<div className="font-mono text-[11px] text-slate-500 truncate">{room.id}</div>
					</div>
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						title="Cancel"
						aria-label="Cancel"
						className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						<X size={14} />
					</button>
				</div>
				<div className="p-4 grid gap-3">
					<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
						This permanently deletes the archived room, child rooms, all contained sessions, subagent sessions, and their Chat events. This cannot be undone.
					</div>
					<div className="text-sm text-slate-300">
						Type <span className="font-mono text-red-200">{room.name}</span> to confirm.
					</div>
					<input
						value={confirmName}
						onChange={(event) => onConfirmNameChange(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
						placeholder={room.name}
						autoFocus
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
			</div>
		</div>
	);
}
