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
  dataDir: process.env.DATA_DIR || '/data',
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',

  // Storage rules
  npFileMax: Number(process.env.NP_FILE_MAX || GiB),        // 1 GiB per file in RAM chats
  npChatMax: Number(process.env.NP_CHAT_MAX || 2 * GiB),    // 2 GiB total per RAM chat
  bigFileThreshold: Number(process.env.BIG_FILE_THRESHOLD || 5 * GiB), // >5 GiB => reduced retention
  retentionMs: Number(process.env.RETENTION_DAYS || 7) * DAY,
  bigRetentionMs: Number(process.env.BIG_RETENTION_DAYS || 3) * DAY,

  chunkSize: 8 * 1024 * 1024, // 8 MiB upload chunks
  sessionTtlMs: 30 * DAY,
  maxLoginFails: 5,
  lockoutMs: 15 * 60 * 1000,
};
