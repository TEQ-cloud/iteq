# Security policy

iTEQ is a small, self-hosted project — but it's a *cryptographic* one,
so security reports are taken seriously.

## Reporting a vulnerability

Email **quinten.dehaard@teqcloud.net** (or use GitHub's private vulnerability
reporting on this repo). Please don't open public issues for exploitable bugs.
You'll get a human reply; there is no bug bounty, only gratitude and credit.

## Scope & known design limits

The threat model and its deliberate trade-offs are documented in the
[README](README.md#encryption-what-the-server-can-and-cannot-see). In short,
these are **known and accepted**, not vulnerabilities:

- No forward secrecy (one static key per chat, matching the 7-day retention).
- Lost PIN = lost account. No recovery, by design.

Anything that breaks the *stated* guarantees — plaintext reaching the server,
auth bypass, cross-chat access, membership checks failing — is a real finding.
Please report it.

## What a malicious server operator can actually do

The disclaimer users accept says the operator "technically could" get at
things. Being precise about what that means, because two of these are cheaper
than the wording suggests:

**1. Recover your private key by brute-forcing the PIN — hours, not years.**
The database holds your PIN-encrypted private key, and the PBKDF2 salt is
derived from your username, so it is not secret. A 6-digit PIN is a ~20-bit
space (1,000,000 candidates); testing all of them against the stored blob is
roughly 10¹² SHA-256 operations, which a single GPU chews through in minutes to
hours. With the private key, every chat key unwraps and every message and file
still on the server decrypts.

PBKDF2 at 600k iterations raises the cost linearly but cannot fix ~20 bits of
entropy — no key-derivation function can. Closing this properly needs a larger
secret (longer PIN or a passphrase) plus a versioned re-wrap migration for
existing accounts. It is on the roadmap and is **not** fixed in 0.3.1-beta.

**2. Read new conversations by substituting a public key.** When you start a
chat, your client asks the server for the other person's public key and wraps
the chat key to whatever it gets back. A malicious server can hand you its own
key instead, hold a separate key with each side, and relay re-encrypted
messages — a classic MITM. There is currently no fingerprint or safety-number
UI, so there is no way to detect it. Verifiable key fingerprints are the fix
and are on the roadmap.

**3. Change the code.** The server also ships the JavaScript that does the
encrypting. This one is inherent to any browser-delivered E2EE app: a hostile
operator can always serve modified code. Self-hosting is the answer the project
offers — run it yourself and the operator is you.

None of this is reachable by *other users* of an instance; it requires control
of the server. The point of listing it is that "the operator could look" should
mean something concrete.

## Hardening in 0.3.1-beta

Redis (sessions + RAM-chat ciphertext) requires a password and is restricted to
the api pods by NetworkPolicy; the web app ships a strict Content-Security-Policy;
signup and login are rate-limited per ip; claiming an admin username fails
closed without a real setup code; and containers run non-root with a read-only
root filesystem and no capabilities. See the CHANGELOG for the full list.

## Supported versions

Only the latest release is supported. Beta means beta.
