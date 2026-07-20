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
  // Passed separately rather than embedded in REDIS_URL so a generated password
  // never has to survive URL-encoding.
  redisPassword: process.env.REDIS_PASSWORD || '',
  // Number of reverse proxies in front of the api (web nginx, ingress, tunnel).
  // Express counts back this many hops in X-Forwarded-For to find the real
  // client ip, which is what the per-ip limits below are keyed on. Too high and
  // a client could spoof its own ip; 0 disables proxy trust entirely.
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1),

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

  // Abuse limits. Deliberately generous: a family instance must never hit
  // these, while a script hammering signup does. All are per client ip.
  signupsPerIpPerHour: Number(process.env.SIGNUPS_PER_IP_PER_HOUR || 5),
  loginsPerIpPerHour: Number(process.env.LOGINS_PER_IP_PER_HOUR || 60),
  // Ceiling on accounts sitting in 'pending'. Stops an unauthenticated flood
  // from burying the admin's approval panel. Approve or reject to make room.
  maxPendingAccounts: Number(process.env.MAX_PENDING_ACCOUNTS || 50),
  maxPushSubsPerUser: Number(process.env.MAX_PUSH_SUBS_PER_USER || 10),

  // Web push endpoints are attacker-supplied URLs that the server then makes
  // requests to, so they are restricted to the real push services. Set
  // PUSH_ENDPOINT_HOSTS to a comma-separated suffix list to extend it, or
  // PUSH_ALLOW_ANY_ENDPOINT=1 to turn the check off.
  pushAllowAnyEndpoint: process.env.PUSH_ALLOW_ANY_ENDPOINT === '1',
  pushEndpointHosts: (process.env.PUSH_ENDPOINT_HOSTS
    || 'fcm.googleapis.com,updates.push.services.mozilla.com,push.services.mozilla.com,notify.windows.com,push.apple.com,web.push.apple.com'
  ).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
};

// An admin username is only handed out at signup when a real setup code is
// configured. Left unset (or left at a shipped placeholder) the first person to
// register the name would become admin, so treat those as "no code".
const PLACEHOLDER_CODES = new Set(['change-me', 'changeme', 'change_me', 'placeholder', 'secret', 'password']);
config.adminSetupCodeUsable = config.adminSetupCode.length >= 8
  && !PLACEHOLDER_CODES.has(config.adminSetupCode.toLowerCase());
