import { parentPort } from 'node:worker_threads';
parentPort.on('message', request => {
  if (request.command.type === 'crash') process.exit(7);
  const start = performance.now();
  while (performance.now() - start < (request.command.blockMs ?? 0)) { /* isolated fault */ }
  parentPort.postMessage({ id: request.id, value: request.command.value });
});
parentPort.postMessage({ ready: true });
