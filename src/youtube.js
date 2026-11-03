const { EventEmitter } = require('events');
const { google } = require('googleapis');
const config = require('./config');

// Perkiraan biaya kuota satu panggilan liveChatMessages.list (kuota default: 10.000 unit/hari).
const UNITS_PER_POLL = 5;
const RETRY_DELAY_MS = 30_000;

/**
 * Ubah satu item liveChatMessages (format respons YouTube API) menjadi event membership.
 * Mengembalikan null untuk pesan yang bukan event membership.
 */
function parseMessage(msg) {
  const s = msg.snippet || {};
  const author = (msg.authorDetails && msg.authorDetails.displayName) || 'Anonim';
  const base = { id: msg.id, author };

  switch (s.type) {
    case 'newSponsorEvent': {
      const d = s.newSponsorDetails || {};
      return { ...base, kind: d.isUpgrade ? 'upgrade' : 'new', tierName: d.memberLevelName, count: 1 };
    }
    case 'membershipGiftingEvent': {
      const d = s.membershipGiftingDetails || {};
      return { ...base, kind: 'gift', tierName: d.giftMembershipsLevelName, count: Number(d.giftMembershipsCount) || 1 };
    }
    case 'memberMilestoneChatEvent': {
      const d = s.memberMilestoneChatDetails || {};
      return { ...base, kind: 'milestone', tierName: d.memberLevelName, count: 1 };
    }
    // giftMembershipReceivedEvent sengaja diabaikan: sudah dihitung lewat membershipGiftingEvent.
    default:
      return null;
  }
}

class YouTubeChat extends EventEmitter {
  constructor() {
    super();
    this.auth = null;
    this.timer = null;
    this.pageToken = null;
    this.status = {
      connected: false,
      liveChatId: null,
      title: null,
      lastPollAt: null,
      lastError: null,
      pollsToday: 0,
      pollsDate: new Date().toDateString(),
    };
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.getStatus());
  }

  getStatus() {
    const intervalSec = config.get().pollIntervalSec;
    return {
      ...this.status,
      unitsToday: this.status.pollsToday * UNITS_PER_POLL,
      unitsPerHour: Math.round((3600 / intervalSec) * UNITS_PER_POLL),
      hoursUntilDefaultQuota: Math.round((10_000 / ((3600 / intervalSec) * UNITS_PER_POLL)) * 10) / 10,
    };
  }

  async findLiveChat(youtube, videoId) {
    if (videoId) {
      const res = await youtube.videos.list({ part: ['snippet', 'liveStreamingDetails'], id: [videoId] });
      const video = res.data.items && res.data.items[0];
      const chatId = video && video.liveStreamingDetails && video.liveStreamingDetails.activeLiveChatId;
      if (!chatId) throw new Error('Video tidak ditemukan atau tidak sedang live (tidak ada live chat aktif).');
      return { liveChatId: chatId, title: video.snippet.title };
    }

    const res = await youtube.liveBroadcasts.list({
      part: ['snippet'],
      broadcastStatus: 'active',
      broadcastType: 'all',
    });
    const broadcast = res.data.items && res.data.items[0];
    if (!broadcast) throw new Error('Tidak ada siaran live aktif di channel ini. Mulai live dulu atau isi Video ID.');
    return { liveChatId: broadcast.snippet.liveChatId, title: broadcast.snippet.title };
  }

  async connect(auth, videoId) {
    this.disconnect();
    this.auth = auth;
    const youtube = google.youtube({ version: 'v3', auth });
    this.youtube = youtube;

    const { liveChatId, title } = await this.findLiveChat(youtube, videoId);
    this.setStatus({ connected: true, liveChatId, title, lastError: null });

    // Poll pertama hanya untuk mengambil pageToken: pesan lama (sebelum connect) tidak dihitung.
    const res = await this.list();
    this.pageToken = res.data.nextPageToken;
    this.schedule(res.data.pollingIntervalMillis);
  }

  disconnect() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pageToken = null;
    if (this.status.connected) this.setStatus({ connected: false, liveChatId: null, title: null });
  }

  async list() {
    const today = new Date().toDateString();
    if (today !== this.status.pollsDate) {
      this.status.pollsDate = today;
      this.status.pollsToday = 0;
    }
    this.status.pollsToday += 1;

    const res = await this.youtube.liveChatMessages.list({
      liveChatId: this.status.liveChatId,
      part: ['snippet', 'authorDetails'],
      pageToken: this.pageToken || undefined,
      maxResults: 2000,
    });
    this.setStatus({ lastPollAt: Date.now(), lastError: null });
    return res;
  }

  schedule(apiIntervalMs) {
    const minMs = config.get().pollIntervalSec * 1000;
    const delay = Math.max(minMs, Number(apiIntervalMs) || 0);
    this.timer = setTimeout(() => this.poll(), delay);
  }

  async poll() {
    if (!this.status.connected) return;
    try {
      const res = await this.list();
      this.pageToken = res.data.nextPageToken;
      for (const msg of res.data.items || []) {
        const event = parseMessage(msg);
        if (event) this.emit('member', event);
      }
      if (res.data.offlineAt) {
        this.setStatus({ lastError: 'Live chat sudah berakhir.' });
        this.disconnect();
        return;
      }
      this.schedule(res.data.pollingIntervalMillis);
    } catch (err) {
      const reason = err.errors && err.errors[0] && err.errors[0].reason;
      const message = `${reason || 'error'}: ${err.message}`;
      console.error('[youtube]', message);
      if (reason === 'liveChatEnded' || reason === 'liveChatNotFound' || reason === 'quotaExceeded') {
        this.setStatus({ lastError: message });
        this.disconnect();
        return;
      }
      this.setStatus({ lastError: `${message} (coba lagi 30 detik)` });
      this.timer = setTimeout(() => this.poll(), RETRY_DELAY_MS);
    }
  }
}

module.exports = { YouTubeChat, parseMessage };
