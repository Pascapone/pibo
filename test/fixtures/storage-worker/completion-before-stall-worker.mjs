import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(workerData.path);
db.exec("CREATE TABLE effects (id INTEGER PRIMARY KEY, value TEXT)");
const completion = new Int32Array(workerData.completion);

parentPort.on("message", ({ id }) => {
  db.prepare("INSERT INTO effects(id, value) VALUES (?, ?)").run(id, "committed");
  parentPort.postMessage({ id, value: "committed" });
  Atomics.store(completion, 0, 1);
  Atomics.notify(completion, 0);
});

parentPort.postMessage({ ready: true });
