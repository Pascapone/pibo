import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";
import { PiboEventLogStore } from "./event-log.js";
import { MessageStore } from "./message-store.js";
import { NavigationStore } from "./navigation-store.js";
import { ObservationStore } from "./observation-store.js";
import { PayloadStore } from "./payload-store.js";
import { applyPiboDataSchema } from "./schema.js";
import { TelemetryStore } from "./telemetry.js";
import { SessionStore } from "./session-store.js";

export type PiboDataStoreOptions = {
	payloadRootDir?: string;
};

export class PiboDataStore {
	readonly path: string;
	readonly db: DatabaseSync;
	readonly payloads: PayloadStore;
	readonly eventLog: PiboEventLogStore;
	readonly messages: MessageStore;
	readonly observations: ObservationStore;
	readonly navigation: NavigationStore;
	readonly sessions: SessionStore;
	readonly telemetry: TelemetryStore;

	constructor(path = piboHomePath("pibo.sqlite"), options: PiboDataStoreOptions = {}) {
		this.path = path === ":memory:" ? path : resolve(path);
		if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true });
		this.db = new DatabaseSync(this.path);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (this.path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		applyPiboDataSchema(this.db);
		this.payloads = new PayloadStore(this.db, options.payloadRootDir ?? piboHomePath("payloads"));
		this.eventLog = new PiboEventLogStore(this.db);
		this.messages = new MessageStore(this.db);
		this.observations = new ObservationStore(this.db);
		this.navigation = new NavigationStore(this.db);
		this.sessions = new SessionStore(this.db);
		this.telemetry = new TelemetryStore(this.db);
	}

	transaction<T>(action: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = action();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	close(): void {
		this.db.close();
	}
}

export function createDefaultPiboDataStore(): PiboDataStore {
	return new PiboDataStore(piboHomePath("pibo.sqlite"));
}
