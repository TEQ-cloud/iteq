import React, { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { idbGet, idbSet, idbClear } from './lib/idb.js';
import { deriveFromPin, generateIdentity, wrapPrivateKey, unwrapPrivateKey } from './lib/crypto.js';
import { ChatApp } from './chat/ChatApp.jsx';

const PIN_LEN = 6;

export function App() {
  const [view, setView] = useState('boot'); // boot | landing | disclaimer | auth | pending | app
  const [ident, setIdent] = useState(null); // { user:{id,username,status,admin}, privateKey, pubJwk }

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

  if (view === 'boot') return <div className="center-wrap"><p>Loading…</p></div>;
  if (view === 'landing') return <Landing onStart={() => setView(localStorage.getItem('iteq.disclaimer') ? 'auth' : 'disclaimer')} />;
  if (view === 'disclaimer') return <Disclaimer onAccept={() => { localStorage.setItem('iteq.disclaimer', '1'); setView('auth'); }} />;
  if (view === 'auth') return <Auth onAuthed={onAuthed} />;
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

function Landing({ onStart }) {
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
        <button className="btn-primary" onClick={onStart}>Get started</button>
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
          chat, and is deleted after <b>7 days at most</b> either way.
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

function Auth({ onAuthed }) {
  const [mode, setMode] = useState('create'); // create | login
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
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
        res = await api.signup({ username, authKey, pubJwk, encPriv });
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
      if (err.message === 'username-taken') setError('That username already exists. Plum out of luck — pick another one.');
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
          <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => { setMode('create'); setError(''); }}>Create account</button>
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
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
            </div>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" disabled={!canSubmit} style={{ width: '100%' }}>
          {busy ? 'Working… (deriving keys)' : mode === 'create' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
