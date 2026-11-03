const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const config = require('./src/config');
const state = require('./src/state');
const auth = require('./src/auth');
const { YouTubeChat, parseMessage } = require('./src/youtube');
const { YouTubeScraper } = require('./src/scraper');

const PORT = Number(process.env.PORT) || 3000;
// Default hanya bisa diakses dari PC ini. Set HOST=0.0.0.0 kalau OBS ada di PC lain.
const HOST = process.env.HOST || '127.0.0.1';
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const yt = new YouTubeChat();
const scraper = new YouTubeScraper();

// Sumber event member yang dipilih di Pengaturan.
function activeSource() {
  return config.get().source === 'api' ? yt : scraper;
}

// --- WebSocket broadcast -----------------------------------------------------

function send(ws, type, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, data }));
}

function broadcast(type, data) {
  for (const ws of wss.clients) send(ws, type, data);
}

function youtubeStatus() {
  const source = config.get().source;
  if (source === 'scraper') return { ...scraper.getStatus(), source };
  return { ...yt.getStatus(), source, hasCredentials: auth.hasCredentials(), authorized: auth.isAuthorized() };
}

wss.on('connection', (ws) => {
  send(ws, 'state', state.getPublic());
  send(ws, 'config', config.get());
  send(ws, 'youtube', youtubeStatus());
});

state.events.on('change', (s) => broadcast('state', s));
state.events.on('alert', (entry) => broadcast('alert', entry));
function onMember(event) {
  const entry = state.applyEvent(event);
  if (entry) console.log(`[member] ${entry.kind} ${entry.author} (${entry.tier}) x${entry.count} +${entry.seconds}s`);
}

for (const source of [yt, scraper]) {
  source.on('status', () => broadcast('youtube', youtubeStatus()));
  source.on('member', onMember);
}

setInterval(() => state.tick(), 1000);

// --- REST API untuk control panel --------------------------------------------

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req.body || {}, req);
      res.json({ ok: true, state: state.getPublic() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  };
}

function num(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} harus angka`);
  return n;
}

app.get('/api/state', (req, res) => res.json(state.getPublic()));

app.post('/api/timer/start', route(() => state.start()));
app.post('/api/timer/pause', route(() => state.pause()));
app.post('/api/timer/reset', route(() => state.resetTimer()));
app.post('/api/timer/set', route((b) => state.setSeconds(num(b.seconds, 'seconds'))));
app.post('/api/timer/add', route((b) => state.addSeconds(num(b.seconds, 'seconds'))));

app.post('/api/count', route((b) => {
  if (b.set !== undefined) state.setMemberCount(num(b.set, 'set'));
  else state.addMemberCount(num(b.delta, 'delta'));
}));

app.post('/api/reset-all', route(() => state.resetAll()));

// Simulasi memakai bentuk payload yang sama dengan respons YouTube API,
// jadi jalur parsing yang dites sama persis dengan saat live.
app.post('/api/simulate', route((b) => {
  const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const authorDetails = { displayName: b.author || 'Penonton Tes' };
  const tier = b.tier || '';
  const snippets = {
    new: { type: 'newSponsorEvent', newSponsorDetails: { memberLevelName: tier, isUpgrade: false } },
    upgrade: { type: 'newSponsorEvent', newSponsorDetails: { memberLevelName: tier, isUpgrade: true } },
    gift: {
      type: 'membershipGiftingEvent',
      membershipGiftingDetails: { giftMembershipsCount: Math.max(1, Number(b.count) || 1), giftMembershipsLevelName: tier },
    },
    milestone: { type: 'memberMilestoneChatEvent', memberMilestoneChatDetails: { memberLevelName: tier, memberMonth: 3 } },
  };
  const snippet = snippets[b.kind];
  if (!snippet) throw new Error('kind harus new, upgrade, gift, atau milestone');
  const event = parseMessage({ id, snippet, authorDetails });
  state.applyEvent({ ...event, simulated: true });
}));

app.get('/api/config', (req, res) => res.json(config.get()));
app.post('/api/config', (req, res) => {
  try {
    const previousSource = activeSource();
    const saved = config.save(req.body || {});
    if (activeSource() !== previousSource) previousSource.disconnect();
    broadcast('config', saved);
    state.notifyConfigChanged();
    broadcast('youtube', youtubeStatus());
    res.json({ ok: true, config: saved });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- YouTube -------------------------------------------------------------------

app.get('/api/youtube', (req, res) => res.json(youtubeStatus()));

app.post('/api/youtube/connect', async (req, res) => {
  const source = activeSource();
  try {
    const input = String((req.body && req.body.videoId) || '').trim();
    if (source === scraper) {
      // Kosong = pakai channel dari Pengaturan untuk mencari live yang sedang berjalan.
      await scraper.connect(input || config.get().channel);
    } else {
      const client = auth.getClient(REDIRECT_URI);
      if (!client) throw new Error('credentials.json belum ada. Lihat README untuk cara membuatnya.');
      if (!auth.isAuthorized()) throw new Error('Belum login. Klik "Login YouTube" dulu.');
      await yt.connect(client, input || null);
    }
    res.json({ ok: true, youtube: youtubeStatus() });
  } catch (err) {
    source.setStatus({ lastError: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/youtube/disconnect', (req, res) => {
  activeSource().disconnect();
  res.json({ ok: true, youtube: youtubeStatus() });
});

app.post('/api/youtube/logout', (req, res) => {
  yt.disconnect();
  auth.logout();
  broadcast('youtube', youtubeStatus());
  res.json({ ok: true, youtube: youtubeStatus() });
});

app.get('/auth', (req, res) => {
  try {
    const client = auth.getClient(REDIRECT_URI);
    if (!client) return res.status(400).send('credentials.json belum ada. Lihat README.');
    res.redirect(auth.getAuthUrl());
  } catch (err) {
    res.status(400).send(err.message);
  }
});

app.get('/oauth2callback', async (req, res) => {
  try {
    if (req.query.error) throw new Error(req.query.error);
    await auth.handleCallback(req.query.code);
    broadcast('youtube', youtubeStatus());
    res.redirect('/control.html');
  } catch (err) {
    res.status(400).send(`Login gagal: ${err.message}`);
  }
});

// Muat token yang tersimpan saat start supaya tidak perlu login ulang.
try {
  auth.getClient(REDIRECT_URI);
} catch (err) {
  console.warn('[auth]', err.message);
}

server.listen(PORT, HOST, () => {
  const base = `http://localhost:${PORT}`;
  console.log('Marathon overlay berjalan:');
  console.log(`  Control panel     : ${base}/control.html`);
  console.log(`  Overlay timer     : ${base}/overlay-timer.html`);
  console.log(`  Overlay milestone : ${base}/overlay-milestone.html`);
});
