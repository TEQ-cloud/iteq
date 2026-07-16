# Security policy

iTEQ is a small, beta, self-hosted project — but it's a *cryptographic* one,
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
- A 6-digit PIN protects the key material: an operator with server access and
  patience could brute-force it. Users are told exactly this at onboarding.
- Lost PIN = lost account. No recovery, by design.

Anything that breaks the *stated* guarantees — plaintext reaching the server,
auth bypass, cross-chat access, membership checks failing — is a real finding.
Please report it.

## Supported versions

Only the latest release is supported. Beta means beta.
