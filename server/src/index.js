import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { createApi } from './api.js';
import { attachWs } from './ws.js';
import { pstore } from './pstore.js';

const store = config.mode === 'dev'
  ? (await import('./store-memory.js')).createMemoryStore()
  : (await import('./store-prod.js')).createProdStore();

if (config.mode === 'dev' && !process.env.DATA_DIR) {
  config.dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
}
fs.mkdirSync(config.dataDir, { recursive: true });
await store.init();

const app = express();
app.disable('x-powered-by');
const health = (_req, res) => res.json({ ok: true, version: config.appVersion });
app.get('/healthz', health);       // probes (direct to the pod)
app.get('/api/healthz', health);   // reachable through the ingress
app.use('/api', createApi(store, store));

// Serve the built web app if present (single-container / local usage).
// In the k8s setup, the ingress routes static traffic to the nginx web pods instead.
const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const server = http.createServer(app);
attachWs(server, store);

// Retention: sweep RAM data and the PVC every 10 minutes. The k8s CronJob does
// a daily PVC sweep as well, in case no api pod is running.
setInterval(() => {
  const t = Date.now();
  store.sweep(t).catch((e) => console.error('sweep(store):', e.message));
  pstore.sweep(t).catch((e) => console.error('sweep(pvc):', e.message));
}, 10 * 60 * 1000).unref();

server.listen(config.port, () => {
  console.log(`iTEQ server listening on :${config.port} (mode=${config.mode}, data=${config.dataDir})`);
});
