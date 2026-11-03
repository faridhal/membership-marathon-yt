const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./util');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  title: 'MARATHON',
  language: 'en',
  source: 'scraper',
  channel: '',
  giftTier: '',
  tiers: [{ name: 'Member', seconds: 300 }],
  defaultSeconds: 300,
  countUpgrades: true,
  milestoneChatSeconds: 0,
  pollIntervalSec: 20,
  maxDurationSec: 0,
  milestones: [],
};

let config = load();

function load() {
  try {
    return normalize(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (err) {
    console.warn('[config] gagal membaca config.json, pakai default:', err.message);
    return normalize({});
  }
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Rapikan input dari file / control panel supaya tipe datanya selalu benar.
function normalize(raw) {
  const c = { ...DEFAULTS, ...raw };
  return {
    title: String(c.title ?? '').trim(),
    // Bahasa teks di overlay: 'en' atau 'id'.
    language: c.language === 'id' ? 'id' : 'en',
    // 'scraper' = baca live chat langsung (tanpa kuota), 'api' = YouTube Data API resmi.
    source: c.source === 'api' ? 'api' : 'scraper',
    channel: String(c.channel || '').trim(),
    giftTier: String(c.giftTier || '').trim(),
    tiers: (Array.isArray(c.tiers) ? c.tiers : [])
      .map((t) => ({ name: String(t.name || '').trim(), seconds: toNumber(t.seconds, 0) }))
      .filter((t) => t.name),
    defaultSeconds: toNumber(c.defaultSeconds, DEFAULTS.defaultSeconds),
    countUpgrades: Boolean(c.countUpgrades),
    milestoneChatSeconds: toNumber(c.milestoneChatSeconds, 0),
    pollIntervalSec: Math.max(5, toNumber(c.pollIntervalSec, DEFAULTS.pollIntervalSec)),
    maxDurationSec: toNumber(c.maxDurationSec, 0),
    milestones: (Array.isArray(c.milestones) ? c.milestones : [])
      .map((m) => ({
        target: Math.floor(toNumber(m.target, 0)),
        label: String(m.label || '').trim(),
        bonusMinutes: toNumber(m.bonusMinutes, 0),
      }))
      .filter((m) => m.target > 0)
      .sort((a, b) => a.target - b.target),
  };
}

function get() {
  return config;
}

function save(raw) {
  config = normalize(raw);
  writeJsonAtomic(CONFIG_PATH, config);
  return config;
}

// Cari durasi tier berdasarkan nama level membership dari YouTube (tidak peka huruf besar/kecil).
function secondsForTier(tierName) {
  const key = String(tierName || '').trim().toLowerCase();
  const tier = config.tiers.find((t) => t.name.toLowerCase() === key);
  return tier ? tier.seconds : config.defaultSeconds;
}

module.exports = { get, save, secondsForTier };
