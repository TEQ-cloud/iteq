import React, { useEffect, useRef, useState } from 'react';
import { uploadFile, downloadFile, saveBlob, encryptedSizeOf, fmtBytes, GiB } from '../lib/files.js';
import { ConfirmModal, InfoModal, RenameModal, ForwardModal } from './Modals.jsx';

const AUTO_PREVIEW_MAX = 15 * 1024 * 1024; // images up to 15 MB decrypt automatically

// Inline previews for photos and videos. Everything is ciphertext on the
// server, so previewing means download + decrypt in the browser; videos and
// large images only load when asked.
function FilePreview({ chat, msg, chatKeyFor }) {
  const type = msg.fileMeta?.type || '';
  const size = msg.fileMeta?.size || 0;
  const isImage = type.startsWith('image/');
  const isVideo = type.startsWith('video/');
  const auto = isImage && size <= AUTO_PREVIEW_MAX;
  const [wanted, setWanted] = useState(auto);
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | error

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    let objUrl = null;
    (async () => {
      setState('loading');
      try {
        const key = await chatKeyFor(chat);
        const { blob } = await downloadFile(chat.id, msg.file, key);
        if (cancelled) return;
        objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    // Cleanup must only run on unmount (or if `wanted` flips) — never when
    // `url` changes, or we'd revoke the blob URL the <img>/<video> is showing.
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  if (!isImage && !isVideo) return null;
  if (!wanted) {
    return (
      <button className="preview-load" onClick={() => setWanted(true)}>
        {isVideo ? '▶' : '🖼'} Load {isVideo ? 'video' : 'image'} preview ({fmtBytes(size)})
      </button>
    );
  }
  if (state === 'loading') return <div className="preview-loading">Decrypting preview…</div>;
  if (state === 'error') return <div className="preview-loading">Preview unavailable (file expired or lost).</div>;
  if (isImage) return <img className="preview-media" src={url} alt={msg.fileMeta?.name || ''} />;
  return <video className="preview-media" src={url} controls playsInline />;
}

export function ChatView({ chat, messages, me, allChats, onBack, onSend, onDelete, onForward, onRename, chatKeyFor }) {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);   // decorated msg
  const [menuFor, setMenuFor] = useState(null);   // msgId with open menu
  const [modal, setModal] = useState(null);       // {type, ...}
  const [uploads, setUploads] = useState([]);     // {tempId, name, size, progress, state, error}
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, uploads]);

  const byId = Object.fromEntries(messages.map((m) => [m.id, m]));

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend({ text: t, replyTo: replyTo?.id || null });
      setText('');
      setReplyTo(null);
    } catch (err) {
      setModal({ type: 'info', title: 'Not sent', body: `The message could not be sent: ${err.message}` });
    } finally {
      setSending(false);
    }
  };

  // --- uploads: storage rules live here ---
  const pickFile = () => fileRef.current?.click();

  const onFilePicked = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const encSize = encryptedSizeOf(file);
    if (chat.storage === 'ram' && encSize > GiB) {
      setModal({
        type: 'info', title: 'Persistence required',
        body: `“${file.name}” is ${fmtBytes(file.size)}. Files over 1 GB require a persistent chat — this chat is non-persistent (RAM only). Start a persistent chat with @${chat.peer?.username} to send it.`,
      });
      return;
    }
    if (chat.storage === 'pvc' && encSize > 5 * GiB) {
      setModal({ type: 'bigfile', file });
      return;
    }
    startUpload(file);
  };

  const startUpload = async (file) => {
    setModal(null);
    const tempId = `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUploads((u) => [...u, { tempId, name: file.name, size: file.size, progress: 0, state: 'uploading' }]);
    const setU = (patch) => setUploads((u) => u.map((x) => (x.tempId === tempId ? { ...x, ...patch } : x)));
    try {
      const key = await chatKeyFor(chat);
      const res = await uploadFile(chat.id, file, key, (p) => setU({ progress: p }));
      setU({ state: 'finalizing', progress: 1 });
      await onSend({ text: '', fileId: res.fileId });
      setUploads((u) => u.filter((x) => x.tempId !== tempId));
    } catch (err) {
      const msg = err.message === 'needs-persistence'
        ? 'Files over 1 GB require a persistent chat.'
        : err.message === 'chat-quota'
          ? 'This RAM chat is full (2 GB max). Delete some file messages or use a persistent chat.'
          : `Upload failed: ${err.message}. Try uploading again.`;
      setU({ state: 'error', error: msg });
    }
  };

  const download = async (m) => {
    setModal({ type: 'download', name: m.fileMeta?.name || 'file', progress: 0 });
    try {
      const key = await chatKeyFor(chat);
      const { blob, meta } = await downloadFile(chat.id, m.file, key,
        (p) => setModal((cur) => (cur?.type === 'download' ? { ...cur, progress: p } : cur)));
      saveBlob(blob, meta.name);
      setModal(null);
    } catch (err) {
      setModal({ type: 'info', title: 'Download failed', body: `${err.message}. The file may have hit its retention limit or been lost with a server restart.` });
    }
  };

  const doForward = async (target, m) => {
    setModal(null);
    if (m.file) {
      setModal({ type: 'info', title: 'Files can’t be forwarded (yet)', body: 'Download the file and send it in the other chat instead — every chat has its own encryption key.' });
      return;
    }
    try {
      await onForward(target, m.dec?.text || '');
    } catch (err) {
      setModal({ type: 'info', title: 'Forward failed', body: err.message });
    }
  };

  const retentionLabel = (m) => {
    if (!m.file) return null;
    if (chat.storage === 'ram') return '✓ Uploaded · held in RAM — lost if the server restarts (max 7 days)';
    const until = new Date(m.file.retainUntil).toLocaleDateString([], { day: 'numeric', month: 'short' });
    return m.file.big
      ? `✓ Uploaded · on server (SSD) · big file: kept 3 days (until ${until})`
      : `✓ Uploaded · on server (SSD) · kept until ${until}`;
  };

  return (
    <main className="chatpane" onClick={() => setMenuFor(null)}>
      <div className="chat-head">
        <button className="btn-ghost back-btn" onClick={onBack} aria-label="Back">←</button>
        <div className="titles">
          <b>{chat.name}</b>
          <span>@{chat.peer?.username} · {chat.storage === 'ram' ? 'non-persistent (RAM)' : 'persistent (SSD)'} · 7-day retention</span>
        </div>
        <button className="btn-ghost" title="Rename chat (only for you)" onClick={() => setModal({ type: 'rename' })}>✎</button>
        <span className={`badge ${chat.storage}`}>{chat.storage === 'ram' ? 'RAM' : 'SSD'}</span>
      </div>

      <div className="msgs" ref={scrollRef}>
        {messages.length === 0 && uploads.length === 0 && (
          <div className="empty-pane" style={{ flex: 1 }}>
            <p>
              No messages {chat.storage === 'ram' ? '— or the server restarted and this non-persistent chat was cleared. ' : 'yet. '}
              Say something; messages disappear after 7 days.
            </p>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          const mine = m.senderId === me.id;
          const quoted = m.replyTo ? byId[m.replyTo] : null;
          return (
            <React.Fragment key={m.id}>
              {newDay && <div className="day-sep">{new Date(m.ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'long' })}</div>}
              <div className={`msg ${mine ? 'mine' : 'theirs'}`}>
                <div className="bubble">
                  {m.replyTo && (
                    <div className="msg-quote">
                      {quoted ? (quoted.dec?.text || (quoted.file ? `📎 ${quoted.fileMeta?.name || 'file'}` : '…')) : 'Original message is gone (deleted or expired)'}
                    </div>
                  )}
                  {m.file ? (
                    <div>
                      <FilePreview chat={chat} msg={m} chatKeyFor={chatKeyFor} />
                      <div className="file-card">
                        <span className="fi">📎</span>
                        <div className="fmeta">
                          <div className="fname">{m.fileMeta?.name || 'encrypted file'}</div>
                          <div className="fsub">{m.fileMeta ? fmtBytes(m.fileMeta.size) : ''}</div>
                          <div className="upl-state">{retentionLabel(m)}</div>
                        </div>
                        <button className="btn-ghost" title="Download" onClick={() => download(m)}>⬇</button>
                      </div>
                    </div>
                  ) : (
                    m.dec ? m.dec.text : <i style={{ opacity: 0.6 }}>could not decrypt</i>
                  )}
                  <div className="msg-time" title={new Date(m.ts).toLocaleString()}>
                    {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button className={`msg-menu-btn ${menuFor === m.id ? 'open' : ''}`} aria-label="Message actions"
                  onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }}>⋮</button>
                {menuFor === m.id && (
                  <div className="menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setReplyTo(m); setMenuFor(null); }}>↩ Reply</button>
                    <button onClick={() => { setModal({ type: 'forward', msg: m }); setMenuFor(null); }}>➦ Forward</button>
                    {!m.file && (
                      <button onClick={() => { navigator.clipboard?.writeText(m.dec?.text || ''); setMenuFor(null); }}>⧉ Copy</button>
                    )}
                    {mine && (
                      <button className="danger" onClick={() => { setModal({ type: 'delete', msg: m }); setMenuFor(null); }}>🗑 Delete</button>
                    )}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
        {uploads.map((u) => (
          <div key={u.tempId} className="msg mine">
            <div className="bubble">
              <div className="file-card">
                <span className="fi">📎</span>
                <div className="fmeta">
                  <div className="fname">{u.name}</div>
                  <div className="fsub">{fmtBytes(u.size)}</div>
                  {u.state === 'error' ? (
                    <div className="upl-state" style={{ color: '#ffd7d3' }}>✕ {u.error}</div>
                  ) : (
                    <>
                      <div className="upl-state">{u.state === 'finalizing' ? 'Finishing…' : `Encrypting & uploading… ${Math.round(u.progress * 100)}%`}</div>
                      <div className="progress"><i style={{ width: `${Math.round(u.progress * 100)}%` }} /></div>
                    </>
                  )}
                </div>
                {u.state === 'error' && (
                  <button className="btn-ghost" onClick={() => setUploads((x) => x.filter((y) => y.tempId !== u.tempId))}>✕</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        {replyTo && (
          <div className="reply-bar">
            ↩ Replying to: <span>{replyTo.dec?.text || (replyTo.file ? `📎 ${replyTo.fileMeta?.name || 'file'}` : '…')}</span>
            <button className="btn-ghost" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}
        <div className="composer-row">
          <button className="icon-btn" title="Attach a file" onClick={pickFile}>📎</button>
          <input ref={fileRef} type="file" hidden onChange={onFilePicked} />
          <textarea
            rows={1}
            placeholder="Type a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <button className="icon-btn send" title="Send" disabled={!text.trim() || sending} onClick={send}>➤</button>
        </div>
      </div>

      {modal?.type === 'info' && (
        <InfoModal title={modal.title} onClose={() => setModal(null)}><p>{modal.body}</p></InfoModal>
      )}
      {modal?.type === 'bigfile' && (
        <ConfirmModal title="Very large file" confirmLabel="Upload anyway"
          onConfirm={() => startUpload(modal.file)} onClose={() => setModal(null)}>
          <div className="warn-box">
            ⚠️ “{modal.file.name}” is {fmtBytes(modal.file.size)} — over 5 GB. Upload stability and
            success are <b>not guaranteed</b> at this size, and the file will be kept for
            <b> 3 days instead of 7</b>.
          </div>
        </ConfirmModal>
      )}
      {modal?.type === 'delete' && (
        <ConfirmModal title="Delete message?" confirmLabel="Delete" danger
          onConfirm={async () => { setModal(null); try { await onDelete(modal.msg.id); } catch { /* already gone */ } }}
          onClose={() => setModal(null)}>
          <p>This deletes the message for <b>everyone</b> in this chat — the server only keeps one (encrypted) copy.</p>
        </ConfirmModal>
      )}
      {modal?.type === 'rename' && (
        <RenameModal current={chat.name} onClose={() => setModal(null)}
          onSave={async (name) => { setModal(null); await onRename(name); }} />
      )}
      {modal?.type === 'forward' && (
        <ForwardModal chats={allChats} exceptChatId={chat.id} onClose={() => setModal(null)}
          onPick={(target) => doForward(target, modal.msg)} />
      )}
      {modal?.type === 'download' && (
        <InfoModal title={`Downloading ${modal.name}`} onClose={() => setModal(null)} closeLabel="Hide">
          <div className="progress"><i style={{ width: `${Math.round((modal.progress || 0) * 100)}%` }} /></div>
          <p style={{ fontSize: 13 }}>Decrypting in your browser… {Math.round((modal.progress || 0) * 100)}%</p>
        </InfoModal>
      )}
    </main>
  );
}
