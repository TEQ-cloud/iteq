import React, { useState } from 'react';

export function Modal({ children, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal">{children}</div>
    </div>
  );
}

export function InfoModal({ title, children, onClose, closeLabel = 'OK' }) {
  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      {children}
      <div className="modal-actions">
        <button className="btn-primary" onClick={onClose}>{closeLabel}</button>
      </div>
    </Modal>
  );
}

export function ConfirmModal({ title, children, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      {children}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// Step 1: recipient — with the "no search" warning.
// Step 2: "Pick a storage type" — non-persistent preselected, confirm bottom right.
export function NewChatModal({ onCreate, onClose }) {
  const [step, setStep] = useState(1);
  const [recipient, setRecipient] = useState('');
  const [storage, setStorage] = useState('ram');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await onCreate(recipient, storage);
    } catch (err) {
      if (err.message === 'not-found') {
        setStep(1);
        setError(`No user called “${recipient}” exists. Usernames must match exactly — ask your friend again, or call them to be sure.`);
      } else if (err.message === 'self-chat') {
        setStep(1);
        setError("That's you. Chatting with yourself is free — no server needed.");
      } else {
        setError(`Could not create the chat: ${err.message}`);
      }
      setBusy(false);
    }
  };

  if (step === 1) {
    return (
      <Modal onClose={onClose}>
        <h3>New chat</h3>
        <div className="notice">
          ℹ️ There is <b>no search and no directory</b> here — that's on purpose. Type the exact
          username your friend gave you, send a message, and hope you get something back. A friend
          should share their username with you directly; call them if you want to be sure.
        </div>
        <div className="field">
          <label htmlFor="rcpt">Recipient username</label>
          <input id="rcpt" autoCapitalize="none" spellCheck="false" value={recipient} autoFocus
            onChange={(e) => setRecipient(e.target.value.toLowerCase().trim())}
            onKeyDown={(e) => e.key === 'Enter' && /^[a-z0-9_-]{3,24}$/.test(recipient) && setStep(2)}
            placeholder="exact username" />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!/^[a-z0-9_-]{3,24}$/.test(recipient)} onClick={() => setStep(2)}>Next</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h3>Pick a storage type</h3>
      <label className={`storage-opt ${storage === 'ram' ? 'selected' : ''}`}>
        <input type="radio" name="storage" checked={storage === 'ram'} onChange={() => setStorage('ram')} />
        <div>
          <b>Non-persistent (default)</b>
          <p>
            Chat is stored in RAM only. It will <b>not survive</b> — and is therefore cleared on — a server
            reboot, reschedule or crash. If that happens, it's simply gone; try sending again. Attachments
            are limited to 1&nbsp;GB per file and 2&nbsp;GB totalper chat. The 7-day retention applies here too.
          </p>
        </div>
      </label>
      <label className={`storage-opt ${storage === 'pvc' ? 'selected' : ''}`}>
        <input type="radio" name="storage" checked={storage === 'pvc'} onChange={() => setStorage('pvc')} />
        <div>
          <b>Persistent</b>
          <p>
            Chat is stored on SSDs. It <b>survives reboots and reschedules</b> and stays on the server for
            7 days — anything older is removed automatically. <b>Required for uploads over 1&nbsp;GB.</b>{' '}
            Files over 5&nbsp;GB are kept for 3 days instead, and their upload isn't guaranteed to succeed.
          </p>
        </div>
      </label>
      <div className="retention-note">
        <b>Retention, in short:</b> everything is deleted after 7 days, whichever mode you pick.
        Non-persistent chats <i>could</i> be lost earlier (reboot, reschedule, crash). When you send a
        file you'll see an <b>“uploaded” indicator</b> — that's when your file (in a persistent chat)
        would survive a restart.
        <br /><br />
        <b>Good to know:</b> this choice only applies to chat <i>content</i> (messages and files).
        The chat itself — who it's with, the name you give it, its keys — is saved like your account
        and survives restarts either way. You never have to re-add anyone.
      </div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={() => setStep(1)}>Back</button>
        <button className="btn-primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Confirm'}</button>
      </div>
    </Modal>
  );
}

export function RenameModal({ current, onSave, onClose }) {
  const [name, setName] = useState(current || '');
  return (
    <Modal onClose={onClose}>
      <h3>Rename chat</h3>
      <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
        This name is only for you (and it's encrypted — the server can't read it). The other person
        keeps whatever name they gave this chat.
      </p>
      <div className="field">
        <input value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
          placeholder="Friendly name" />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</button>
      </div>
    </Modal>
  );
}

// Short "how it works" tour, shown once after first login and via the ？ button.
export function TourModal({ onClose }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <Modal onClose={onClose}>
      <h3>How iTEQ works</h3>
      <ol className="tour-list">
        <li><b>Your username is your identity.</b> There's no search and no directory — share your
          username with friends yourself (call them to be sure). It can't be changed later.</li>
        <li><b>Start a chat</b> with “＋ New chat”: type the exact username, then pick a storage type —
          <i> non-persistent</i> (RAM, gone on a server restart) or <i>persistent</i> (SSD, survives
          restarts). Content is deleted after 7 days either way; your contacts and chat names are
          saved and always survive.</li>
        <li><b>Everything is end-to-end encrypted</b> in your browser. The server only ever stores
          ciphertext — it can't read your messages, files or chat names.</li>
        <li><b>Files:</b> over 1 GB needs a persistent chat; over 5 GB is kept only 3 days. Watch for
          the “✓ Uploaded” indicator — that's when your file is safely on the server.</li>
      </ol>
      <h3 style={{ marginTop: 18 }}>Install as an app</h3>
      <p style={{ fontSize: 14 }}>
        <b>iPhone / iPad:</b> open this site in Safari → tap the <b>Share</b> button →
        <b> “Add to Home Screen”</b>. iTEQ then opens full-screen, like a normal app.<br />
        <b>Android / desktop:</b> browser menu → <b>“Install app”</b> (or “Add to Home screen”).
      </p>
      <p style={{ fontSize: 14 }}>
        <b>Notifications:</b> tap 🔔 in the header to get alerted about new messages, even when
        iTEQ is closed. On iPhone and iPad this only works <b>after</b> you've added it to the
        Home Screen — that's Apple's rule, not ours. The alert never contains your message text:
        the server can't read it.
      </p>
      {imgOk
        ? <img className="tour-img" src="/tour-ios.png" alt="Adding iTEQ to the iOS home screen" onError={() => setImgOk(false)} />
        : <p className="hint" style={{ fontSize: 12.5, color: 'var(--muted)' }}>(iOS screenshot coming during the beta.)</p>}
      <div className="modal-actions">
        <button className="btn-primary" onClick={onClose}>Got it</button>
      </div>
    </Modal>
  );
}

// Operator-only: approve or reject pending accounts (closed service).
export function AdminModal({ pending, onApprove, onReject, onRefresh, onClose }) {
  return (
    <Modal onClose={onClose}>
      <h3>Pending accounts</h3>
      <p style={{ fontSize: 13.5 }}>
        iTEQ is approval-based: nobody can chat until you let them in. Only approve people you
        actually know.
      </p>
      {pending.length === 0 && <p>Nobody is waiting right now.</p>}
      {pending.map((u) => (
        <div key={u.id} className="pending-row">
          <div className="pmeta">
            <b>@{u.username}</b>
            <span>{new Date(u.createdAt).toLocaleString()}</span>
          </div>
          <button className="btn" onClick={() => onReject(u)}>Reject</button>
          <button className="btn-primary" onClick={() => onApprove(u)}>Approve</button>
        </div>
      ))}
      <div className="modal-actions">
        <button className="btn" onClick={onRefresh}>Refresh</button>
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

export function ForwardModal({ chats, exceptChatId, onPick, onClose }) {
  const targets = chats.filter((c) => c.id !== exceptChatId);
  return (
    <Modal onClose={onClose}>
      <h3>Forward to…</h3>
      {targets.length === 0 && <p>No other chats yet.</p>}
      <div className="chat-picker">
        {targets.map((c) => (
          <button key={c.id} onClick={() => onPick(c)}>
            <b>{c.name}</b>{' '}
            <span className={`badge ${c.storage}`}>{c.storage === 'ram' ? 'RAM' : 'SSD'}</span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}
