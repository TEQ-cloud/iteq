// One-shot retention sweep of the PVC, run as a k8s CronJob.
// (RAM-chat data in Redis expires via TTLs; the api pods prune indexes.)
import { pstore } from './pstore.js';

await pstore.sweep(Date.now());
console.log('PVC retention sweep done');
process.exit(0);
