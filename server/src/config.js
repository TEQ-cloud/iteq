const GiB = 1024 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

export const config = {
  mode: process.env.MODE === 'dev' ? 'dev' : 'prod',
  port: Number(process.env.PORT || 8080),
  appVersion: process.env.APP_VERSION || 'beta',
  // Usernames that are auto-approved at signup and may approve/reject others.
  // Everyone else lands in 'pending' until an admin approves them — iTEQ is a
  // closed, approval-based service on purpose.
  adminUsers: (process.env.ADMIN_USERS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // If set, claiming an ADMIN_USERS username at signup requires this code.
  // Without it, whoever registers the admin username first becomes admin —
  // fine on a LAN, a race you lose on the public internet.
  adminSetupCode: process.env.ADMIN_SETUP_CODE || '',
  dataDir: process.env.DATA_DIR || '/data',
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',

  // Web Push (VAPID). Generate a pair with `npm run vapid` and set BOTH on every
  // api pod (same values — a per-pod keypair would invalidate subscriptions).
  // Unset = push simply disabled; everything else keeps working.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',

  // Storage rules
  npFileMax: Number(process.env.NP_FILE_MAX || GiB),        // 1 GiB per file in RAM chats
  npChatMax: Number(process.env.NP_CHAT_MAX || 2 * GiB),    // 2 GiB total per RAM chat
  bigFileThreshold: Number(process.env.BIG_FILE_THRESHOLD || 5 * GiB), // >5 GiB => reduced retention
  retentionMs: Number(process.env.RETENTION_DAYS || 7) * DAY,
  bigRetentionMs: Number(process.env.BIG_RETENTION_DAYS || 3) * DAY,
  // Accounts unused for this long are deleted, chats included. Content always
  // dies within 7 days anyway; this cleans up the account + chat definitions.
  accountRetentionMs: Number(process.env.ACCOUNT_RETENTION_DAYS || 180) * DAY,

  chunkSize: 8 * 1024 * 1024, // 8 MiB upload chunks
  sessionTtlMs: 30 * DAY,
  maxLoginFails: 5,
  lockoutMs: 15 * 60 * 1000,
};
