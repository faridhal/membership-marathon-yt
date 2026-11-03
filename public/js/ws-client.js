// Koneksi WebSocket bersama untuk overlay & control panel, dengan reconnect otomatis.
(function () {
  let clockOffset = 0; // selisih jam server - jam lokal

  function connect(handlers) {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);

    ws.onopen = () => handlers.open && handlers.open();
    ws.onmessage = (e) => {
      const { type, data } = JSON.parse(e.data);
      if (type === 'state') clockOffset = data.serverNow - Date.now();
      if (handlers[type]) handlers[type](data);
    };
    ws.onclose = () => {
      handlers.close && handlers.close();
      setTimeout(() => connect(handlers), 2000);
    };
  }

  function serverNow() {
    return Date.now() + clockOffset;
  }

  function remainingMs(s) {
    return s.running ? Math.max(0, s.endAt - serverNow()) : s.remainingMs;
  }

  // ['57', '29', '59'] — jam bisa lebih dari 2 digit untuk marathon panjang.
  function splitTime(ms) {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    return [h, m, sec].map((v) => String(v).padStart(2, '0'));
  }

  function formatTime(ms) {
    return splitTime(ms).join(':');
  }

  // "+5:00", "+1:30:00"
  function formatAdded(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (v) => String(v).padStart(2, '0');
    return h ? `+${h}:${pad(m)}:${pad(s)}` : `+${m}:${pad(s)}`;
  }

  // Kustomisasi tampilan overlay lewat URL, contoh: overlay-timer.html?color=%23fff&accent=%23ff4d6d&size=96
  function applyQueryStyle() {
    const q = new URLSearchParams(location.search);
    const root = document.documentElement.style;
    if (q.get('color')) root.setProperty('--text', q.get('color'));
    if (q.get('accent')) root.setProperty('--accent', q.get('accent'));
    if (q.get('bg')) root.setProperty('--panel', q.get('bg'));
    if (q.get('font')) root.setProperty('--font', `'${q.get('font')}', sans-serif`);
    if (q.get('size')) root.setProperty('--size', `${Number(q.get('size'))}px`);
    if (q.get('width')) root.setProperty('--width', `${Number(q.get('width'))}px`);
    return q;
  }

  window.Marathon = { connect, serverNow, remainingMs, splitTime, formatTime, formatAdded, applyQueryStyle };
})();
