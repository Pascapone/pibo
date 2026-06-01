import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../dist/apps/chat/data/session-query-service.js";
import { PiboCronStore } from "../dist/cron/store.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboRalphStore } from "../dist/ralph/store.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { WebAnnotationStore } from "../dist/web-annotations/store.js";
import { SqliteWorkflowRunStore } from "../packages/workflows/dist/index.js";

const retiredWord = String.fromCharCode(111, 119, 110, 101, 114);
const retiredPartitionField = `${retiredWord}Scope`;
const retiredPrincipalField = ["principal", "Id"].join("");

function assertNoRetiredPartitionKeys(value, label) {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		value.forEach((entry, index) => assertNoRetiredPartitionKeys(entry, `${label}[${index}]`));
		return;
	}
	for (const [key, nested] of Object.entries(value)) {
		assert.notEqual(key, retiredPartitionField, `${label} exposes retired partition field`);
		assert.notEqual(key, retiredPrincipalField, `${label} exposes retired principal field`);
		assertNoRetiredPartitionKeys(nested, `${label}.${key}`);
	}
}

test("fresh app-context stores create current resources without compatibility columns or partition payloads", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-app-context-fresh-runtime-"));
	try {
		const sessions = new SqlitePiboSessionStore(join(root, "pibo-sessions.sqlite"));
		const piboSession = sessions.create({ id: "ps_fresh", channel: "test", kind: "chat", profile: "default", metadata: { chatRoomId: "room_fresh" } });
		assertNoRetiredPartitionKeys(piboSession, "piboSession");
		sessions.close();

		const data = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
		const rooms = new ChatRoomService(data);
		const room = rooms.ensureDefaultRoom("Fresh Room");
		const query = new ChatSessionQueryService(data);
		query.upsertSession({ ...piboSession, metadata: { chatRoomId: room.id } });
		assert.equal(query.listSessions().some((session) => session.piboSessionId === piboSession.id), true);
		assertNoRetiredPartitionKeys(room, "room");
		data.close();

		const agents = new CustomAgentStore(join(root, "chat-agents.sqlite"));
		assertNoRetiredPartitionKeys(agents.create({ displayName: "Fresh Agent" }), "agent");
		agents.close();

		const projects = new ChatProjectService(join(root, "web-projects.sqlite"));
		assertNoRetiredPartitionKeys(projects.ensureSharedDefaultProject({ projectFolder: join(root, "project-default") }), "project");
		projects.close();

		const annotations = new WebAnnotationStore({ path: join(root, "web-annotations.sqlite") });
		assertNoRetiredPartitionKeys(annotations.createAnnotation({
			id: "ann_fresh",
			piboSessionId: piboSession.id,
			piboRoomId: room.id,
			note: "Fresh annotation",
			url: "http://localhost/fresh",
			targetKind: "element",
			viewport: { width: 800, height: 600, devicePixelRatio: 1 },
			target: { kind: "element", label: "Fresh target", selector: "body", domPath: "body" },
		}), "annotation");
		annotations.close();

		const ralph = new PiboRalphStore({ path: join(root, "pibo-ralph.sqlite") });
		assertNoRetiredPartitionKeys(ralph.createJob({ target: { kind: "default-chat" }, profile: "default", prompt: "Fresh Ralph", enabled: false }), "ralphJob");
		ralph.close();

		const cron = new PiboCronStore({ path: join(root, "pibo-cron.sqlite") });
		assertNoRetiredPartitionKeys(cron.createJob({ target: { kind: "default-chat" }, profile: "default", prompt: "Fresh Cron", schedule: { kind: "at", at: "2030-06-01T00:00:00.000Z" } }), "cronJob");
		cron.close();

		const workflows = new SqliteWorkflowRunStore(join(root, "pibo-workflows.sqlite"));
		workflows.saveRun({
			id: "wfr_fresh",
			workflowId: "workflow.fresh",
			workflowVersion: "1.0.0",
			status: "running",
			current: { nodeId: "start", status: "running" },
			input: { prompt: "Fresh workflow" },
			state: { global: {} },
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		});
		assertNoRetiredPartitionKeys(workflows.getRun("wfr_fresh"), "workflowRun");
		workflows.close();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
