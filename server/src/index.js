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
// The api sits behind the web nginx (and usually an ingress too), so the real
// client ip comes from X-Forwarded-For. Per-ip abuse limits are keyed on it.
app.set('trust proxy', config.trustProxyHops);

// Refusing to hand out an admin account is a config problem, not a runtime one:
// say so loudly at boot instead of letting it surface as a confusing signup error.
if (config.adminUsers.length && !config.adminSetupCodeUsable) {
  console.warn(
    `WARNING: ADMIN_USERS is set (${config.adminUsers.join(', ')}) but ADMIN_SETUP_CODE is missing, ` +
    'too short (<8 chars) or a placeholder. Claiming an admin username is refused until you set a real code.'
  );
}
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

// Retention: sweep RAM data and the PVC every 10 minutes, plus inactive
// accounts (chats included). The k8s CronJob does a daily PVC sweep as well,
// in case no api pod is running.
setInterval(async () => {
  const t = Date.now();
  store.sweep(t).catch((e) => console.error('sweep(store):', e.message));
  pstore.sweep(t).catch((e) => console.error('sweep(pvc):', e.message));
  try {
    const removedChats = await store.sweepAccounts(t);
    for (const chatId of removedChats) await pstore.delChat(chatId);
    if (removedChats.length) console.log(`account sweep: removed ${removedChats.length} chat(s) of inactive accounts`);
  } catch (e) {
    console.error('sweep(accounts):', e.message);
  }
}, 10 * 60 * 1000).unref();

server.listen(config.port, () => {
  console.log(`iTEQ server listening on :${config.port} (mode=${config.mode}, data=${config.dataDir})`);
});
