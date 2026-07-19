import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { connectWs } from '../lib/ws.js';
import { generateChatKey, wrapChatKey, unwrapChatKey, encryptJson, decryptJson } from '../lib/crypto.js';
import { ChatView } from './ChatView.jsx';
import { NewChatModal, TourModal, AdminModal, InfoModal } from './Modals.jsx';
import { showLocal, enableNotifications, permission, notificationsSupported, isIOS, isStandalone } from '../lib/push.js';

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
  const [notifPerm, setNotifPerm] = useState(permission());
  const [notifInfo, setNotifInfo] = useState(null); // explains iOS/denied cases
  const keysRef = useRef(new Map()); // chatId -> CryptoKey
  const chatsRef = useRef([]);
  const activeIdRef = useRef(null);
  chatsRef.current = chats;
  activeIdRef.current = activeId;

  // Notifications while the app is open. Routed through the service worker,
  // because iOS has no Notification constructor — that's why nothing ever
  // appeared on iPhone before. Background pushes are handled inside sw.js.
  const maybeNotify = useCallback((chat, dm) => {
    if (notifPerm !== 'granted' || dm.senderId === ident.user.id) return;
    if (!document.hidden && activeIdRef.current === chat.id) return;
    const body = dm.dec?.text || (dm.file ? `📎 ${dm.fileMeta?.name || 'file'}` : 'New message');
    showLocal({ title: chat.name, body, chatId: chat.id });
  }, [notifPerm, ident.user.id]);
  const openChatRef = useRef(null);

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

  // Tapping a notification (foreground or background) opens that chat.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e) => {
      if (e.data?.type !== 'open-chat' || !e.data.chatId) return;
      const chat = chatsRef.current.find((c) => c.id === e.data.chatId);
      if (chat) openChatRef.current?.(chat);
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);

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
        maybeNotify(chat, dm);
      } else if (event.type === 'message.deleted') {
        setMsgsByChat((prev) => {
          const list = prev[event.chatId];
          if (!list) return prev;
          return { ...prev, [event.chatId]: list.filter((m) => m.id !== event.msgId) };
        });
      }
    }, setWsOn);
    return stop;
  }, [keyFor, decorateMsg, loadChats, maybeNotify]);

  // --- actions ---
  const openChat = async (chat) => {
    setActiveId(chat.id);
    const key = await keyFor(chat);
    const { messages } = await api.messages(chat.id);
    const decorated = await Promise.all(messages.map((m) => decorateMsg(m, key)));
    setMsgsByChat((prev) => ({ ...prev, [chat.id]: decorated }));
  };
  openChatRef.current = openChat;

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
          {notificationsSupported() && notifPerm !== 'granted' && (
            <button className="btn-ghost" title="Enable notifications" onClick={async () => {
              const r = await enableNotifications();
              setNotifPerm(permission());
              if (r === 'needs-install') {
                setNotifInfo({
                  title: 'Add iTEQ to your Home Screen first',
                  body: 'On iPhone and iPad, notifications only work once the app is installed: open this page in Safari, tap the Share button, then “Add to Home Screen”. Open iTEQ from that icon and tap 🔔 again.',
                });
              } else if (r === 'denied') {
                setNotifInfo({
                  title: 'Notifications are blocked',
                  body: 'Your browser denied notifications for this site. Re-allow them in the browser or system settings for this site, then tap 🔔 again.',
                });
              } else if (r === 'granted-local') {
                setNotifInfo({
                  title: 'Notifications enabled (app open only)',
                  body: 'You will get alerts while iTEQ is open. Background notifications are not configured on this server, so nothing arrives while the app is fully closed.',
                });
              }
            }}>🔔</button>
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

      {notifInfo && (
        <InfoModal title={notifInfo.title} onClose={() => setNotifInfo(null)}>
          <p>{notifInfo.body}</p>
        </InfoModal>
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
