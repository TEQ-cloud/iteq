// WebSocket with token auth (sent as first message) and auto-reconnect.
export function connectWs(onEvent, onStatus) {
  let ws = null;
  let closed = false;
  let retry = 0;
  let pinger = null;

  const connect = () => {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: localStorage.getItem('iteq.token') }));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'ready') {
        retry = 0;
        onStatus?.(true);
        clearInterval(pinger);
        pinger = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 25_000);
      } else if (msg.type !== 'pong') {
        onEvent(msg);
      }
    };
    ws.onclose = () => {
      onStatus?.(false);
      clearInterval(pinger);
      if (!closed) setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++));
    };
    ws.onerror = () => ws.close();
  };

  connect();
  return () => {
    closed = true;
    clearInterval(pinger);
    ws?.close();
  };
}
