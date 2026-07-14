import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { connectWs } from '../lib/ws.js';
import { generateChatKey, wrapChatKey, unwrapChatKey, encryptJson, decryptJson } from '../lib/crypto.js';
import { ChatView } from './ChatView.jsx';
import { NewChatModal, TourModal, AdminModal } from './Modals.jsx';

export function ChatApp({ ident, onLogout }) {
  const [chats, setChats] = useState([]); // decorated: {..., key, name}
  const [activeId, setActiveId] = useState(null);
  const [msgsByChat, setMsgsByChat] = useState({}); // chatId -> decorated msgs
  const [wsOn, setWsOn] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showTour, setShowTour] = useState(() => !localStorage.getItem('iteq.tourDone'));
  const [showAdmin, setShowAdmin] = useState(false);
  const [pending, setPending] = useState([]);
  const keysRef = useRef(new Map()); // chatId -> CryptoKey
  const chatsRef = useRef([]);
  chatsRef.current = chats;

  const keyFor = useCallback(async (chat) => {
    if (keysRef.current.has(chat.id)) return keysRef.current.get(chat.id);
    if (!chat.peer) return null;
    const key = await unwrapChatKey(chat.wrappedKey, ident.privateKey, chat.peer.pubJwk);
    keysRef.current.set(chat.id, key);
    return key;
  }, [ident]);

  const decorateMsg = useCallback(async (msg, key) => {
    try {
      const dec = await decryptJson(key, msg.payload);
      let fileMeta = null;
      if (msg.file) fileMeta = await decryptJson(key, msg.file.encMeta);
      return { ...msg, dec, fileMeta };
    } catch {
      return { ...msg, dec: null, fileMeta: null };
    }
  }, []);

  const loadChats = useCallback(async () => {
    const { chats: raw } = await api.myChats();
    const decorated = await Promise.all(raw.map(async (c) => {
      let key = null, name = c.peer?.username || 'unknown';
      try {
        key = await keyFor(c);
        if (c.encName && key) name = (await decryptJson(key, c.encName)).name || name;
      } catch { /* undecryptable chat: show username */ }
      return { ...c, key, name };
    }));
    setChats(decorated);
    return decorated;
  }, [keyFor]);

  useEffect(() => { loadChats(); }, [loadChats]);

  const loadPending = useCallback(async () => {
    if (!ident.user.admin) return;
    try { setPending((await api.adminPending()).pending); } catch { /* not fatal */ }
  }, [ident.user.admin]);

  useEffect(() => { loadPending(); }, [loadPending]);

  // --- realtime ---
  useEffect(() => {
    const stop = connectWs(async (event) => {
      if (event.type === 'chat.new') {
        loadChats();
      } else if (event.type === 'message.new') {
        const chat = chatsRef.current.find((c) => c.id === event.chatId);
        const key = chat ? await keyFor(chat) : null;
        if (!key) { loadChats(); return; }
        const dm = await decorateMsg(event.msg, key);
        setMsgsByChat((prev) => {
          const list = prev[event.chatId];
          if (!list || list.some((m) => m.id === dm.id)) return prev; // not loaded yet, or dup
          return { ...prev, [event.chatId]: [...list, dm] };
        });
        setChats((prev) => prev
          .map((c) => (c.id === event.chatId ? { ...c, lastTs: event.msg.ts } : c))
          .sort((a, b) => b.lastTs - a.lastTs));
      } else if (event.type === 'message.deleted') {
        setMsgsByChat((prev) => {
          const list = prev[event.chatId];
          if (!list) return prev;
          return { ...prev, [event.chatId]: list.filter((m) => m.id !== event.msgId) };
        });
      }
    }, setWsOn);
    return stop;
  }, [keyFor, decorateMsg, loadChats]);

  // --- actions ---
  const openChat = async (chat) => {
    setActiveId(chat.id);
    if (!msgsByChat[chat.id]) {
      const key = await keyFor(chat);
      const { messages } = await api.messages(chat.id);
      const decorated = await Promise.all(messages.map((m) => decorateMsg(m, key)));
      setMsgsByChat((prev) => ({ ...prev, [chat.id]: decorated }));
    }
  };

  const createChat = async (peerUsername, storage) => {
    const peer = await api.lookupUser(peerUsername);
    const chatKey = await generateChatKey();
    const wrappedKeyMe = await wrapChatKey(chatKey, ident.privateKey, peer.pubJwk);
    const wrappedKeyPeer = await wrapChatKey(chatKey, ident.privateKey, peer.pubJwk);
    const { chatId } = await api.createChat({ peerUsername, storage, wrappedKeyMe, wrappedKeyPeer });
    keysRef.current.set(chatId, chatKey);
    setShowNew(false);
    const list = await loadChats();
    const chat = list.find((c) => c.id === chatId);
    if (chat) openChat(chat);
  };

  const renameChat = async (chat, name) => {
    const key = await keyFor(chat);
    const encName = await encryptJson(key, { name });
    await api.renameChat(chat.id, encName);
    setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, name, encName } : c)));
  };

  const appendLocal = (chatId, dm) => {
    setMsgsByChat((prev) => {
      const list = prev[chatId] || [];
      if (list.some((m) => m.id === dm.id)) return prev;
      return { ...prev, [chatId]: [...list, dm] };
    });
    setChats((prev) => prev
      .map((c) => (c.id === chatId ? { ...c, lastTs: dm.ts } : c))
      .sort((a, b) => b.lastTs - a.lastTs));
  };

  const sendMessage = async (chat, { text, replyTo = null, fileId = null }) => {
    const key = await keyFor(chat);
    const payload = await encryptJson(key, { text });
    const { message } = await api.sendMessage(chat.id, { payload, replyTo, fileId });
    appendLocal(chat.id, await decorateMsg(message, key));
  };

  const deleteMessage = async (chat, msgId) => {
    await api.deleteMessage(chat.id, msgId);
    setMsgsByChat((prev) => ({ ...prev, [chat.id]: (prev[chat.id] || []).filter((m) => m.id !== msgId) }));
  };

  const forwardMessage = async (targetChat, text) => {
    await sendMessage(targetChat, { text });
    openChat(targetChat);
  };

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(ident.user.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  };

  const active = chats.find((c) => c.id === activeId) || null;

  return (
    <div className={`app ${active ? 'viewing-chat' : ''}`}>
      <aside className="sidebar">
        <div className="side-head">
          <img src="/logo.svg" alt="" />
          <b>iTEQ <span className="beta-chip">beta</span></b>
          {ident.user.admin && (
            <button className="btn-ghost admin-btn" title="Pending account approvals"
              onClick={() => { loadPending(); setShowAdmin(true); }}>
              👥{pending.length > 0 && <span className="count-badge">{pending.length}</span>}
            </button>
          )}
          <button className="btn-ghost" title="How iTEQ works" onClick={() => setShowTour(true)}>？</button>
          <span className={`conn-dot ${wsOn ? 'on' : ''}`} title={wsOn ? 'Connected' : 'Reconnecting…'} />
        </div>
        <button className="btn-primary btn-new" onClick={() => setShowNew(true)}>＋ New chat</button>
        <div className="chat-list">
          {chats.length === 0 && (
            <p style={{ padding: '10px 14px', color: 'var(--muted)', fontSize: 13.5 }}>
              No chats yet. Share your username with a friend, then hit “New chat”.
            </p>
          )}
          {chats.map((c) => (
            <button key={c.id} className={`chat-item ${c.id === activeId ? 'active' : ''}`} onClick={() => openChat(c)}>
              <span className="chat-item-name">
                {c.name}
                <time>{fmtListTime(c.lastTs)}</time>
              </span>
              <span className="chat-item-sub">
                <span className={`badge ${c.storage}`}>{c.storage === 'ram' ? 'RAM' : 'SSD'}</span>
                @{c.peer?.username}
              </span>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <div className="me">
            <b>@{ident.user.username}</b>
            <span>share this so friends can reach you</span>
          </div>
          <button className="btn-ghost" onClick={copyUsername} title="Copy username">{copied ? '✓' : '⧉'}</button>
          <button className="btn-ghost" onClick={onLogout} title="Log out">⎋</button>
        </div>
      </aside>

      {active ? (
        <ChatView
          key={active.id}
          chat={active}
          messages={msgsByChat[active.id] || []}
          me={ident.user}
          allChats={chats}
          onBack={() => setActiveId(null)}
          onSend={(opts) => sendMessage(active, opts)}
          onDelete={(msgId) => deleteMessage(active, msgId)}
          onForward={forwardMessage}
          onRename={(name) => renameChat(active, name)}
          chatKeyFor={keyFor}
        />
      ) : (
        <main className="chatpane">
          <div className="empty-pane">
            <img src="/logo.svg" alt="" />
            <p><b>Pick a chat</b> or start a new one.<br />Messages are end-to-end encrypted and gone after 7 days.</p>
          </div>
        </main>
      )}

      {showNew && <NewChatModal onCreate={createChat} onClose={() => setShowNew(false)} />}
      {showTour && <TourModal onClose={() => { localStorage.setItem('iteq.tourDone', '1'); setShowTour(false); }} />}
      {showAdmin && (
        <AdminModal pending={pending} onRefresh={loadPending} onClose={() => setShowAdmin(false)}
          onApprove={async (u) => { await api.adminApprove(u.id); loadPending(); }}
          onReject={async (u) => { await api.adminReject(u.id); loadPending(); }} />
      )}
    </div>
  );
}

function fmtListTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
