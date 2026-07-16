# Contributing

iTEQ is built and maintained by [TEQcloud](https://teqcloud.net) (Quinten de
Haard). It's Apache-2.0: use it, self-host it, fork it — the
[NOTICE](NOTICE) credit travels along.

## Feature requests & bugs

Open a GitHub issue. Feature requests are genuinely welcome — that's the
deal: free to use, ideas flow back here. Check the
[roadmap](README.md) first (push notifications, read receipts and group chats
are already planned).

## Pull requests

Welcome, with one ground rule: iTEQ stays **small, closed and private by
design**. Approval-gated accounts, no search, minimal metadata, hard retention
— PRs that push it toward being "a platform" (public directories, federation,
analytics, tracking) won't land, no matter how well built.

Dev setup is two commands, no database needed:

```bash
cd server && npm install && npm run dev   # in-memory API on :8080
cd web && npm install && npm run dev      # UI on :5173, proxied
```

Set `ADMIN_USERS=<you>` in the environment to test the admin flow. Keep
changes readable, match the existing style, and remember the golden rule of
this codebase: **the server must never see plaintext.**

## Releases

Images and charts are built and published only by TEQcloud — see
[RELEASING.md](RELEASING.md). Self-hosters never need to build anything.
