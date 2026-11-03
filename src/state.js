const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');
const { DATA_DIR, writeJsonAtomic, readJson } = require('./util');

const STATE_PATH = path.join(DATA_DIR, 'state.json');
const MAX_HISTORY = 50;
const MAX_PROCESSED_IDS = 2000;

const events = new EventEmitter();

// Timer berjalan disimpan sebagai `endAt` (timestamp), timer pause sebagai `remainingMs`.
// Dengan begitu waktu tetap akurat walau server atau OBS restart.
const state = {
  running: false,
  endAt: 0,
  remainingMs: 0,
  memberCount: 0,
  history: [],
  processedIds: [],
  ...readJson(STATE_PATH, {}),
};

function persist() {
  writeJsonAtomic(STATE_PATH, state);
}

function changed() {
  persist();
  events.emit('change', getPublic());
}

function currentRemainingMs(now = Date.now()) {
  return state.running ? Math.max(0, state.endAt - now) : Math.max(0, state.remainingMs);
}

function capMs(ms) {
  const max = config.get().maxDurationSec * 1000;
  return max > 0 ? Math.min(ms, max) : ms;
}

function setRemaining(ms) {
  const value = capMs(Math.max(0, ms));
  if (state.running) state.endAt = Date.now() + value;
  else state.remainingMs = value;
}

function computeMilestones() {
  const list = config.get().milestones;
  const count = state.memberCount;
  const next = list.find((m) => m.target > count) || null;
  const reached = list.filter((m) => m.target <= count);
  const prevTarget = reached.length ? reached[reached.length - 1].target : 0;
  const progress = next ? (count - prevTarget) / (next.target - prevTarget) : 1;
  return {
    list,
    next,
    reachedCount: reached.length,
    prevTarget,
    progress: Math.min(1, Math.max(0, progress)),
    allDone: list.length > 0 && !next,
  };
}

function getPublic() {
  return {
    running: state.running,
    endAt: state.endAt,
    remainingMs: currentRemainingMs(),
    memberCount: state.memberCount,
    milestones: computeMilestones(),
    history: state.history.slice(0, 20),
    serverNow: Date.now(),
  };
}

// --- Kontrol timer ---------------------------------------------------------

function start() {
  if (state.running) return;
  const remaining = state.remainingMs;
  if (remaining <= 0) return;
  state.running = true;
  state.endAt = Date.now() + remaining;
  changed();
}

function pause() {
  if (!state.running) return;
  state.remainingMs = currentRemainingMs();
  state.running = false;
  changed();
}

function setSeconds(seconds) {
  setRemaining(seconds * 1000);
  changed();
}

function addSeconds(seconds) {
  setRemaining(currentRemainingMs() + seconds * 1000);
  changed();
}

function resetTimer() {
  state.running = false;
  state.remainingMs = 0;
  state.endAt = 0;
  changed();
}

// Dipanggil tiap detik: hentikan timer saat habis supaya statusnya jelas "selesai".
function tick() {
  if (state.running && Date.now() >= state.endAt) {
    state.running = false;
    state.remainingMs = 0;
    changed();
    events.emit('ended');
  }
}

// --- Member ------------------------------------------------------------------

function setMemberCount(value) {
  state.memberCount = Math.max(0, Math.floor(value));
  changed();
}

function addMemberCount(delta) {
  setMemberCount(state.memberCount + delta);
}

function wasProcessed(id) {
  return state.processedIds.includes(id);
}

/**
 * Terapkan satu event membership.
 * kind: 'new' | 'upgrade' | 'gift' | 'milestone'
 */
function applyEvent({ id, kind, author, tierName, count = 1, simulated = false }) {
  if (id) {
    if (wasProcessed(id)) return null;
    state.processedIds.push(id);
    if (state.processedIds.length > MAX_PROCESSED_IDS) {
      state.processedIds.splice(0, state.processedIds.length - MAX_PROCESSED_IDS);
    }
  }

  const cfg = config.get();
  let secondsEach = config.secondsForTier(tierName);
  let memberDelta = 0;

  if (kind === 'new' || kind === 'gift') memberDelta = count;
  else if (kind === 'upgrade' && !cfg.countUpgrades) secondsEach = 0;
  else if (kind === 'milestone') secondsEach = cfg.milestoneChatSeconds;

  const seconds = secondsEach * count;
  if (seconds > 0) setRemaining(currentRemainingMs() + seconds * 1000);
  const before = state.memberCount;
  state.memberCount += memberDelta;
  const bonuses = cfg.milestones.filter((m) => m.target > before && m.target <= state.memberCount && m.bonusMinutes > 0);

  const entry = {
    id: id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    kind,
    author: author || 'Anonim',
    tier: tierName || '',
    count,
    seconds,
    simulated,
  };
  state.history.unshift(entry);

  // Bonus waktu dari milestone yang baru tercapai karena event ini.
  const bonusEntries = bonuses.map((m) => {
    setRemaining(currentRemainingMs() + m.bonusMinutes * 60_000);
    const bonus = {
      id: `${entry.id}-bonus-${m.target}`,
      at: Date.now(),
      kind: 'bonus',
      author: m.label || `${m.target} member`,
      tier: '',
      count: 1,
      seconds: m.bonusMinutes * 60,
      simulated,
    };
    state.history.unshift(bonus);
    return bonus;
  });
  state.history.length = Math.min(state.history.length, MAX_HISTORY);

  changed();
  events.emit('alert', entry);
  bonusEntries.forEach((b) => events.emit('alert', b));
  return entry;
}

// Mulai marathon baru: timer, jumlah member, dan riwayat dikosongkan.
// processedIds sengaja dipertahankan agar event lama tidak terhitung ulang.
function resetAll() {
  state.running = false;
  state.endAt = 0;
  state.remainingMs = 0;
  state.memberCount = 0;
  state.history = [];
  changed();
}

module.exports = {
  events,
  getPublic,
  start,
  pause,
  setSeconds,
  addSeconds,
  resetTimer,
  tick,
  setMemberCount,
  addMemberCount,
  applyEvent,
  resetAll,
  notifyConfigChanged: changed,
};
