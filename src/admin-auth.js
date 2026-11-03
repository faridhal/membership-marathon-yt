const crypto = require('crypto');

// Login control panel dengan satu password dari env ADMIN_PASSWORD (untuk deploy di cloud).
// Kalau kosong, login dimatikan dan semuanya terbuka seperti saat jalan di PC sendiri.
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const ENABLED = Boolean(PASSWORD);
// Ganti password = semua sesi lama otomatis tidak berlaku.
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`marathon-session:${PASSWORD}`).digest('hex');
const COOKIE = 'mo_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map(); // ip -> { count, resetAt }

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

function passwordMatches(input) {
  return crypto.timingSafeEqual(sha256(input), sha256(PASSWORD));
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function isLoggedIn(req) {
  if (!ENABLED) return true;
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const [expiry, mac] = token.split('.');
  if (!expiry || !mac || Number(expiry) < Date.now()) return false;
  const expected = sign(expiry);
  return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

function setCookie(req, res, value, maxAgeMs) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Batasi tebakan password: maksimal MAX_ATTEMPTS gagal per IP tiap 15 menit.
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  else entry.count += 1;
}

function login(req, res) {
  if (!ENABLED) return res.json({ ok: true });
  if (tooManyAttempts(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
  }
  if (!passwordMatches((req.body && req.body.password) || '')) {
    recordFailure(req.ip);
    return res.status(401).json({ ok: false, error: 'Password salah.' });
  }
  attempts.delete(req.ip);
  const expiry = String(Date.now() + SESSION_MS);
  setCookie(req, res, `${expiry}.${sign(expiry)}`, SESSION_MS);
  res.json({ ok: true });
}

function logout(req, res) {
  setCookie(req, res, '', 0);
  res.json({ ok: true });
}

// Yang tetap publik (read-only, dipakai OBS): overlay, file statis, GET /api/state & /api/config, WebSocket.
// Yang dikunci: control panel, semua perubahan lewat API, status YouTube, dan login OAuth YouTube.
function needsLogin(req) {
  const p = req.path;
  if (p === '/control.html' || p === '/auth' || p === '/oauth2callback') return true;
  if (p.startsWith('/api/youtube')) return true;
  return p.startsWith('/api/') && req.method !== 'GET';
}

function protect(req, res, next) {
  if (!ENABLED || !needsLogin(req) || isLoggedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Belum login.' });
  res.redirect('/login.html');
}

function status(req) {
  return { enabled: ENABLED, loggedIn: isLoggedIn(req) };
}

module.exports = { ENABLED, protect, login, logout, status };
