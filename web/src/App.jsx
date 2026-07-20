import React, { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { idbGet, idbSet, idbClear } from './lib/idb.js';
import { deriveFromPin, generateIdentity, wrapPrivateKey, unwrapPrivateKey } from './lib/crypto.js';
import { ChatApp } from './chat/ChatApp.jsx';

const PIN_LEN = 6;

export function App() {
  const [view, setView] = useState('boot'); // boot | landing | disclaimer | auth | pending | app
  const [ident, setIdent] = useState(null); // { user:{id,username,status,admin}, privateKey, pubJwk }
  const [authMode, setAuthMode] = useState('login'); // which tab the auth screen opens on

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem('iteq.token');
      const stored = await idbGet('ident').catch(() => null);
      if (token && stored?.privateKey) {
        try {
          const { user } = await api.me(); // validates the session, refreshes status
          const identity = { ...stored, user };
          setIdent(identity);
          setView(user.status === 'active' ? 'app' : 'pending');
          return;
        } catch { localStorage.removeItem('iteq.token'); }
      }
      setView('landing');
    })();
  }, []);

  const logout = async () => {
    try { await api.logout(); } catch { /* session may already be gone */ }
    localStorage.removeItem('iteq.token');
    await idbClear().catch(() => {});
    setIdent(null);
    setView('landing');
  };

  const onAuthed = async (identity) => {
    await idbSet('ident', identity);
    setIdent(identity);
    setView(identity.user.status === 'active' ? 'app' : 'pending');
  };

  const startAuth = (mode) => {
    setAuthMode(mode);
    setView(localStorage.getItem('iteq.disclaimer') ? 'auth' : 'disclaimer');
  };

  if (view === 'boot') return <div className="center-wrap"><p>Loading…</p></div>;
  if (view === 'landing') return <Landing onLogin={() => startAuth('login')} onCreate={() => startAuth('create')} />;
  if (view === 'disclaimer') return <Disclaimer onAccept={() => { localStorage.setItem('iteq.disclaimer', '1'); setView('auth'); }} />;
  if (view === 'auth') return <Auth initialMode={authMode} onAuthed={onAuthed} />;
  if (view === 'pending') {
    return <Pending username={ident.user.username} onLogout={logout}
      onApproved={(user) => { setIdent((i) => ({ ...i, user })); setView('app'); }} />;
  }
  return <ChatApp ident={ident} onLogout={logout} />;
}

// Closed service: new accounts wait here until the operator approves them.
function Pending({ username, onLogout, onApproved }) {
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const { user } = await api.me();
        if (user.status === 'active') onApproved(user);
      } catch { /* keep waiting; network blips are fine */ }
    }, 5000);
    return () => clearInterval(t);
  }, [onApproved]);

  return (
    <div className="center-wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <img src="/logo.svg" alt="" width="56" height="56" />
        <h2>Waiting for approval</h2>
        <p>
          Your account <b>@{username}</b> has been created, but iTEQ is a closed, private service:
          the operator personally approves every new account. Give them a nudge through another
          channel if you're expecting access.
        </p>
        <p style={{ fontSize: 13 }}>This page checks automatically — leave it open or come back later.</p>
        <button className="btn" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}

// Project homepage (roadmap, docs, self-hosting) and source repo.
const PROJECT_URL = 'https://i.teqcloud.net';
const REPO_URL = 'https://github.com/TEQ-cloud/iteq';

function Landing({ onLogin, onCreate }) {
  return (
    <div className="landing">
      <div className="landing-hero">
        <img src="/logo.svg" alt="iTEQ logo" />
        <h1>iTEQ <span className="beta-chip">beta</span></h1>
        <p className="slogan">Stay interconnected.</p>
        <p className="tag">
          The <b>i</b> stands for <i>interconnected</i> — private chat for the people you trust.
          Self-hosted, end-to-end encrypted, and nobody else's business.
        </p>
        <div className="hero-actions">
          <button className="btn-primary" onClick={onLogin}>Log in</button>
          <button className="btn" onClick={onCreate}>Create account</button>
          <a className="btn" href={PROJECT_URL} target="_blank" rel="noreferrer">Host yourself ↗</a>
        </div>
        <p className="instance-note">
          This is a <b>private, invitation-only instance</b> — every new account needs the
          operator's personal approval. It's not a public demo: if you don't know the person
          running it, visit the <a href={PROJECT_URL} target="_blank" rel="noreferrer">iTEQ project page</a> and
          host your own.
        </p>
      </div>
      <div className="landing-features">
        <div className="feature"><h3>🔒 End-to-end encrypted</h3><p>Messages and files are encrypted in your browser before they leave your device. The server stores ciphertext, not conversations.</p></div>
        <div className="feature"><h3>🏠 Self-hosted</h3><p>Runs on private hardware — no big-tech cloud, no ads, no AI scanning, no data mining.</p></div>
        <div className="feature"><h3>🧹 Nothing is kept</h3><p>Every chat is wiped after 7 days at most. No history hoarding, minimal metadata: a made-up username, a UUID and timestamps.</p></div>
        <div className="feature"><h3>📱 Works everywhere</h3><p>Any modern browser on iOS, Android, PC or Mac. On your phone, use “Add to Home Screen” to install it like an app.</p></div>
      </div>
      <div className="landing-honesty">
        <strong>Honesty first:</strong> this is a private hobby server, not a company — built on
        <b> trust, not promises</b>. There is no uptime guarantee and no support desk, and every new
        account is personally approved by the operator. You'll get the full disclaimer before
        creating an account.
      </div>
      <div className="roadmap">
        <h2>Roadmap</h2>
        <div className="roadmap-item">
          <div className="rv">v1.0.0</div>
          <div className="rd">Stability polish, full documentation at docs.teqcloud.net.</div>
        </div>
        <div className="roadmap-item">
          <div className="rv">v0.4.0</div>
          <div className="rd">Group chats.</div>
        </div>
        <div className="roadmap-item current">
          <div className="rv">v0.3.2 <span style={{ fontSize: 11 }}>BETA</span></div>
          <div className="rd">
            <b>Now live.</b> Security hardening across the board, from a full audit — stricter
            access checks, rate limiting, a locked-down Redis, a strict content policy and
            container images that scan clean. Nothing changes in how you chat.
          </div>
        </div>
        <div className="roadmap-item done">
          <div className="rv">v0.2.0</div>
          <div className="rd">
            Push notifications while the app is closed (including the iOS home-screen app) —
            with no message content in the payload, because the server can't read it.
          </div>
        </div>
        <div className="roadmap-item done">
          <div className="rv">v0.1.0</div>
          <div className="rd">
            End-to-end encrypted 1-on-1 chat · RAM or SSD storage per chat · 7-day retention ·
            file transfer with image &amp; video previews · reply, forward, copy, delete ·
            installable PWA · approval-gated accounts · public release: Docker images,
            Helm chart &amp; compose example.
          </div>
        </div>
        <p className="roadmap-note">Detailed changelogs and bugfixes live on <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>.</p>
      </div>
    </div>
  );
}

function Disclaimer({ onAccept }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="center-wrap">
      <div className="card">
        <h2>Before you continue</h2>
        <p>
          Even with all the safety in the world, everything you send goes <b>over and through this
          server</b>. Keep that in mind.
        </p>
        <p>
          Messages and files are end-to-end encrypted in your browser — the server only ever stores
          ciphertext, your made-up username, a random account ID and timestamps. But the person running
          this server <b>technically</b> has access to the machine itself. This platform is built on
          trust that they won't look, not on a promise that they can't, but actually could. If server access is ever needed
          for troubleshooting, affected users will be contacted first.
        </p>
        <p>
          This is a <b>closed, private, non-commercial service</b> for friends and family, built on trust,
          not a promise. There is <b>no uptime guarantee</b>, no support desk, and every new account
          must be personally approved by the operator before it works.
        </p>
        <p>
          <b>What's kept and what isn't:</b> your account and your chat definitions (who a chat is
          with, its encrypted name, its keys) are stored like account data and survive restarts —
          you never have to re-add anyone. Chat <b>content</b> follows the storage mode you pick per
          chat, and is deleted after <b>7 days at most</b> either way. Accounts that go unused for
          <b> 6 months</b> are removed automatically, chats included.
        </p>
        <div className="check-row">
          <input id="understand" type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <label htmlFor="understand"><b>I understand</b> — my messages pass through a privately run server that I choose to trust, and I use this service at my own risk, with no promises made to me.</label>
        </div>
        <button className="btn-primary" disabled={!checked} onClick={onAccept} style={{ width: '100%' }}>Continue</button>
      </div>
    </div>
  );
}

function Auth({ initialMode = 'login', onAuthed }) {
  const [mode, setMode] = useState(initialMode); // login | create
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [needCode, setNeedCode] = useState(false); // admin username + server requires a setup code
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const validName = /^[a-z0-9_-]{3,24}$/.test(username);
  const validPin = new RegExp(`^\\d{${PIN_LEN}}$`).test(pin);
  const canSubmit = validName && validPin && (mode === 'login' || pin === pin2) && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const { authKey, wrapKey } = await deriveFromPin(username, pin);
      let res, privateKey, pubJwk;
      if (mode === 'create') {
        const id = await generateIdentity();
        privateKey = id.privateKey;
        pubJwk = id.pubJwk;
        const encPriv = await wrapPrivateKey(privateKey, wrapKey);
        res = await api.signup({ username, authKey, pubJwk, encPriv, ...(setupCode ? { setupCode } : {}) });
        // Re-import as non-extractable for storage.
        privateKey = await unwrapPrivateKey(encPriv, wrapKey);
      } else {
        res = await api.login({ username, authKey });
        pubJwk = res.pubJwk;
        privateKey = await unwrapPrivateKey(res.encPriv, wrapKey);
      }
      localStorage.setItem('iteq.token', res.token);
      await onAuthed({ user: res.user, privateKey, pubJwk });
    } catch (err) {
      if (err.message === 'admin-code-required') { setNeedCode(true); setError('This username is reserved for an admin. Enter the admin setup code from the server configuration.'); }
      else if (err.message === 'bad-admin-code') { setNeedCode(true); setError('Wrong admin setup code.'); }
      else if (err.message === 'admin-code-not-configured') setError('This username is reserved for an admin, but the server has no admin setup code set. Set ADMIN_SETUP_CODE (at least 8 characters) on the api and try again.');
      else if (err.message === 'signups-full') setError('The server is not accepting new accounts right now — too many are already waiting for approval. Try again later.');
      else if (err.message === 'rate-limited') setError('Too many attempts from your connection. Wait a bit and try again.');
      else if (err.message === 'username-taken') setError('That username already exists. Plum out of luck — pick another one.');
      else if (err.message === 'bad-credentials') setError('Wrong username or PIN.');
      else if (err.message === 'locked' || err.body?.locked) setError(`Too many attempts. Locked for a while — try again later.`);
      else if (err.name === 'OperationError') setError('Wrong PIN (could not unlock your keys).');
      else setError(`Something went wrong: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-wrap">
      <form className="card" onSubmit={submit}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <img src="/logo.svg" alt="" width="52" height="52" />
        </div>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
          <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setError(''); }}>Create account</button>
        </div>
        <div className="field">
          <label htmlFor="u">Username</label>
          <input id="u" autoComplete="username" autoCapitalize="none" spellCheck="false"
            value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().trim())}
            placeholder="e.g. plumsauce_7" />
          {mode === 'create' && <div className="hint">3–24 characters: a–z, 0–9, - and _. Make something up — it's the only identity the server knows, and it <b>cannot be changed later</b>.</div>}
        </div>
        <div className="field pin">
          <label htmlFor="p">{PIN_LEN}-digit PIN</label>
          <input id="p" type="password" inputMode="numeric" autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            maxLength={PIN_LEN} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
        </div>
        {mode === 'create' && (
          <>
            <div className="field pin">
              <label htmlFor="p2">Repeat PIN</label>
              <input id="p2" type="password" inputMode="numeric" autoComplete="new-password"
                maxLength={PIN_LEN} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
              {pin2 && pin !== pin2 && <div className="hint" style={{ color: 'var(--danger)' }}>PINs don't match.</div>}
            </div>
            <div className="notice">
              ⚠️ Your PIN protects your encryption keys. Because everything is end-to-end encrypted,
              there is <b>no PIN recovery</b> — a lost PIN means a lost account and lost messages.
              Also: iTEQ is a closed service, so new accounts <b>wait for the operator's approval</b> before they can chat.
              Accounts that go unused for <b>6 months</b> are removed automatically, chats included.
            </div>
          </>
        )}
        {mode === 'create' && needCode && (
          <div className="field">
            <label htmlFor="sc">Admin setup code</label>
            <input id="sc" type="password" autoComplete="off" value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)} placeholder="from the server config" />
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" disabled={!canSubmit} style={{ width: '100%' }}>
          {busy ? 'Working… (deriving keys)' : mode === 'create' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
