const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');
const { DATA_DIR } = require('./util');

// Membaca live chat lewat endpoint internal YouTube (InnerTube) yang juga dipakai halaman chat di browser.
// Tidak butuh API key/OAuth dan tidak memakai kuota, tapi tidak resmi: kalau YouTube mengubah format,
// parser di bawah perlu disesuaikan (lihat data/raw-events.log).

const BASE = 'https://www.youtube.com';
const MIN_POLL_MS = 3000;
const RETRY_DELAY_MS = 10_000;
const RAW_LOG_PATH = path.join(DATA_DIR, 'raw-events.log');
const RAW_LOG_MAX = 200;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // Lewati halaman persetujuan cookie (terutama di Eropa).
  Cookie: 'CONSENT=YES+1; SOCS=CAI',
};

function text(t) {
  if (!t) return '';
  if (t.simpleText) return t.simpleText;
  return (t.runs || []).map((r) => r.text || (r.emoji && r.emoji.shortcuts && r.emoji.shortcuts[0]) || '').join('');
}

function giftTierName() {
  const cfg = config.get();
  return cfg.giftTier || (cfg.tiers[0] && cfg.tiers[0].name) || '';
}

/**
 * Ubah satu action dari get_live_chat menjadi event membership (bentuk sama dengan parseMessage di youtube.js).
 * Mengembalikan null untuk action yang bukan event membership.
 */
function parseAction(action) {
  const item = action.addChatItemAction && action.addChatItemAction.item;
  if (!item) return null;

  const member = item.liveChatMembershipItemRenderer;
  if (member) {
    const base = { id: member.id, author: text(member.authorName) || 'Anonim', count: 1 };
    const sub = text(member.headerSubtext).trim();

    // Perpanjang member: "Member for 11 months" + nama tier di headerSubtext.
    if (member.headerPrimaryText || 'empty' in member || 'message' in member) {
      return { ...base, kind: 'milestone', tierName: sub };
    }
    const upgrade = sub.match(/^Upgraded membership to (.+?)!?$/i);
    if (upgrade) return { ...base, kind: 'upgrade', tierName: upgrade[1] };

    // "Welcome to <tier>!" untuk channel dengan beberapa tier, "New member" kalau hanya satu tier.
    const welcome = sub.match(/^Welcome to (.+?)!?$/i);
    const runs = (member.headerSubtext && member.headerSubtext.runs) || [];
    const tierName = welcome ? welcome[1] : runs.length > 1 ? runs[1].text : '';
    return { ...base, kind: 'new', tierName };
  }

  const gift = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
  if (gift) {
    const header = (gift.header && gift.header.liveChatSponsorshipsHeaderRenderer) || {};
    const primary = text(header.primaryText);
    const runs = (header.primaryText && header.primaryText.runs) || [];
    const count = parseInt(runs[1] && runs[1].text, 10) || parseInt((primary.match(/\d+/) || [])[0], 10) || 1;
    // Format chat tidak menyebut tier yang di-gift, jadi pakai setting giftTier.
    return { id: gift.id, author: text(header.authorName) || 'Anonim', kind: 'gift', tierName: giftTierName(), count };
  }

  // liveChatSponsorshipsGiftRedemptionAnnouncementRenderer (penerima gift) sengaja diabaikan:
  // sudah dihitung lewat event gift purchase.
  return null;
}

// Terima Video ID, URL video, atau channel (@handle / URL channel).
function parseTarget(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  if (/^[\w-]{11}$/.test(value)) return { videoId: value };

  const video = value.match(/(?:[?&]v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/);
  if (video) return { videoId: video[1] };

  const handle = value.match(/(?:^|\/)(@[\w.-]+)/);
  if (handle) return { channelPath: `/${handle[1]}` };
  const channel = value.match(/\/(channel\/UC[\w-]+|c\/[\w.-]+|user\/[\w.-]+)/);
  if (channel) return { channelPath: `/${channel[1]}` };
  if (/^UC[\w-]{22}$/.test(value)) return { channelPath: `/channel/${value}` };

  throw new Error('Format tidak dikenali. Isi Video ID, URL video, atau @channel.');
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function metaTitle(html) {
  const m = html.match(/<meta name="title" content="([^"]*)"/);
  return m ? decodeHtml(m[1]) : null;
}

async function getHtml(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} saat membuka ${url}`);
  return res.text();
}

class YouTubeScraper extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.session = 0; // naik setiap connect/disconnect supaya poll lama berhenti
    this.continuation = null;
    this.apiKey = null;
    this.clientVersion = null;
    this.rawLog = [];
    this.status = {
      connected: false,
      videoId: null,
      title: null,
      lastPollAt: null,
      lastError: null,
    };
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.getStatus());
  }

  getStatus() {
    return { ...this.status };
  }

  async resolveVideo(input) {
    const target = parseTarget(input);
    if (!target) throw new Error('Isi Video ID / URL / @channel, atau atur Channel di Pengaturan.');

    if (target.videoId) {
      let title = null;
      try {
        title = metaTitle(await getHtml(`${BASE}/watch?v=${target.videoId}&hl=en`));
      } catch {
        // judul hanya untuk info, abaikan kalau gagal
      }
      return { videoId: target.videoId, title };
    }

    const html = await getHtml(`${BASE}${target.channelPath}/live?hl=en`);
    const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    if (!canonical) throw new Error('Channel ini sedang tidak live (atau channel tidak ditemukan).');
    return { videoId: canonical[1], title: metaTitle(html) };
  }

  async connect(input) {
    this.disconnect();
    const session = ++this.session;

    const { videoId, title } = await this.resolveVideo(input);
    const html = await getHtml(`${BASE}/live_chat?v=${videoId}&is_popout=1&hl=en`);

    const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const version = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
    const data = html.match(/(?:window\["ytInitialData"\]|var ytInitialData)\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!key || !version || !data) throw new Error('Live chat tidak ditemukan. Pastikan video sedang live dan chat aktif.');

    const renderer = JSON.parse(data[1]).contents?.liveChatRenderer;
    if (!renderer) throw new Error('Live chat tidak tersedia untuk video ini (chat mati / bukan live).');

    if (session !== this.session) return; // ada connect/disconnect lain selama menunggu
    this.apiKey = key[1];
    this.clientVersion = version[1];
    // Pilih tampilan "Live chat" (semua pesan) bila tersedia; fallback ke continuation bawaan.
    // Pesan yang sudah ada di halaman awal (sebelum connect) tidak diproses.
    const items = renderer.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems || [];
    const liveChatToken = items.length ? items[items.length - 1].continuation?.reloadContinuationData?.continuation : null;
    const first = renderer.continuations && Object.values(renderer.continuations[0] || {})[0];
    this.continuation = liveChatToken || (first && first.continuation);
    if (!this.continuation) throw new Error('Token live chat tidak ditemukan.');

    this.setStatus({ connected: true, videoId, title, lastError: null });
    // Panggilan pertama hanya untuk menyusul ke posisi chat terbaru (backlog diabaikan).
    await this.poll(session, true);
  }

  disconnect() {
    this.session += 1;
    clearTimeout(this.timer);
    this.timer = null;
    this.continuation = null;
    if (this.status.connected) this.setStatus({ connected: false, videoId: null, title: null });
  }

  schedule(session, delayMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(session), Math.max(MIN_POLL_MS, Number(delayMs) || 0));
  }

  async poll(session, skipActions = false) {
    if (session !== this.session) return;
    try {
      const res = await fetch(`${BASE}/youtubei/v1/live_chat/get_live_chat?key=${this.apiKey}&prettyPrint=false`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: this.clientVersion, hl: 'en', gl: 'US' } },
          continuation: this.continuation,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (session !== this.session) return;

      const chat = json.continuationContents && json.continuationContents.liveChatContinuation;
      if (!chat) {
        this.setStatus({ lastError: 'Live chat sudah berakhir.' });
        this.disconnect();
        return;
      }

      if (!skipActions) {
        for (const action of chat.actions || []) {
          this.logRaw(action);
          const event = parseAction(action);
          if (event) this.emit('member', event);
        }
      }

      const next = chat.continuations && Object.values(chat.continuations[0] || {})[0];
      if (!next || !next.continuation) {
        this.setStatus({ lastError: 'Live chat sudah berakhir.' });
        this.disconnect();
        return;
      }
      this.continuation = next.continuation;
      this.setStatus({ lastPollAt: Date.now(), lastError: null });
      this.schedule(session, next.timeoutMs);
    } catch (err) {
      if (session !== this.session) return;
      console.error('[scraper]', err.message);
      this.setStatus({ lastError: `${err.message} (coba lagi 10 detik)` });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.poll(session), RETRY_DELAY_MS);
    }
  }

  // Simpan payload mentah event membership/gift untuk memperbaiki parser kalau format YouTube berubah.
  logRaw(action) {
    const item = action.addChatItemAction && action.addChatItemAction.item;
    const name = item && Object.keys(item)[0];
    if (!name || !/Membership|Sponsorship/.test(name)) return;
    this.rawLog.push(JSON.stringify({ at: new Date().toISOString(), item }));
    if (this.rawLog.length > RAW_LOG_MAX) this.rawLog.shift();
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(RAW_LOG_PATH, `${this.rawLog.join('\n')}\n`);
    } catch (err) {
      console.warn('[scraper] gagal menulis raw-events.log:', err.message);
    }
  }
}

module.exports = { YouTubeScraper, parseAction, parseTarget };
