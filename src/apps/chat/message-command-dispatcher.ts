import { PiboSteeringUnavailableError, type PiboOutputEvent } from "../../core/events.js";
import { randomUUID } from "node:crypto";
import type { PiboChannelContext } from "../../channels/types.js";
import type { AsyncChatStorage } from "../../data/async-chat-storage.js";
import type { MessageCommandClaim } from "../../data/message-command-store.js";

/** Owns bounded dispatches; durable claims, not this map, own accepted work. */
export class MessageCommandDispatcher {
	private readonly owner = `message-dispatch:${randomUUID()}`;
	private readonly claims = new Map<string, MessageCommandClaim>();
	private readonly lastRenewed = new Map<string,number>();
	private timer?: ReturnType<typeof setTimeout>;
	private disposed = false;
	private pumping?: Promise<void>;
	private wakePending = false;
	private lastFailureReportAt = 0;
	private readonly leaseMs = 30_000;
	constructor(private readonly storage: AsyncChatStorage, private readonly context: PiboChannelContext) { this.wake(); }
	wake(): void {
		if (this.disposed) return;
		if (this.pumping) { this.wakePending=true; return; }
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		let nextPollMs=50;
		this.pumping = this.pump().catch(error => {
			nextPollMs=1000;this.wakePending=false;
			if(Date.now()-this.lastFailureReportAt>=5000){
				this.lastFailureReportAt=Date.now();
				console.warn("[pibo] durable message dispatcher unavailable", { code: error && typeof error === "object" && "code" in error ? String(error.code) : "dispatch_failed" });
			}
		}).finally(() => {
			this.pumping = undefined;
			if (!this.disposed) {
				if(this.wakePending) { this.wakePending=false; queueMicrotask(()=>this.wake()); }
				else { this.timer = setTimeout(() => this.wake(), nextPollMs); this.timer.unref?.(); }
			}
		});
	}
	outputPersisted(event: PiboOutputEvent): void {
		if(event.type !== "message_finished" && event.type !== "session_error" && event.type !== "message_steered")return;
		if(!event.eventId)return;
		for(const [id,claim] of this.claims)if(claim.sessionId===event.piboSessionId && claim.eventId===event.eventId)this.forget(id);
		this.wake();
	}
	private forget(id: string): void {this.claims.delete(id);this.lastRenewed.delete(id);}
	private async pump(): Promise<void> {
		for (const [id, claim] of this.claims) {
			if (this.disposed) return;
			if(Date.now()-(this.lastRenewed.get(id)??0)<this.leaseMs/3)continue;
			if (!await this.storage.heartbeatCommand(id,this.owner,claim.token,this.leaseMs)) this.forget(id);
			else this.lastRenewed.set(id,Date.now());
		}
		while (!this.disposed && this.claims.size < 12) {
			const claim = await this.storage.claimCommand(this.owner,this.leaseMs);
			if (!claim) break;
			this.claims.set(claim.id,claim);
			this.lastRenewed.set(claim.id,Date.now());
			// A slow cold runtime must not serialize unrelated session admission or dispatch.
			void this.dispatch(claim);
		}
	}
	private async dispatch(claim: MessageCommandClaim): Promise<void> {
		try {
			if (this.disposed) return;
			if (!this.context.getSession(claim.sessionId)) {
				await this.storage.transitionCommand(claim.id,this.owner,claim.token,"failed","Target session no longer exists.");
				this.forget(claim.id);this.wake();return;
			}
			if (!await this.storage.transitionCommand(claim.id,this.owner,claim.token,"initializing")) {this.forget(claim.id);this.wake();return;}
			if (this.disposed) return;
			const output = await this.context.emit({ type:"message",piboSessionId:claim.sessionId,id:claim.eventId,text:claim.text,delivery:claim.delivery,source:"user" });
			if (output.type === "session_error") { await this.storage.transitionCommand(claim.id,this.owner,claim.token,"failed","Runtime rejected the accepted message.");this.forget(claim.id);this.wake(); }
			// Output ingest advances queued/running/terminal state. No late emit result may downgrade it.
		} catch (error) {
			if (!this.disposed) {
				const cancelled = Boolean(error && typeof error === "object" && "code" in error && error.code === "runtime_start_cancelled");
				const steering = error instanceof PiboSteeringUnavailableError;
				const capacity = Boolean(error && typeof error === "object" && "code" in error && error.code === "runtime_capacity_unavailable");
				try {
					await this.storage.transitionCommand(claim.id,this.owner,claim.token,cancelled || steering || capacity ? "failed" : "interrupted",
						cancelled ? "Message cancelled before runtime dispatch." : capacity ? "Runtime capacity was unavailable before dispatch; the message did not run." : steering ? "Steering is unavailable; the message was not queued as a normal turn." : "Runtime dispatch outcome is unclear; inspect the session before retrying.");
				} catch { /* Lease expiry retains the uncertain outcome. */ }
				this.forget(claim.id);this.wake();
			}
		}
	}
	async dispose(): Promise<void> {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		await this.pumping;
		this.claims.clear();
		this.lastRenewed.clear();
		// Do not release dispatched claims for replay: the router may still own side effects.
	}
}
