// Cek apakah server ini (mis. VM di cloud) bisa membaca live chat YouTube.
// Pakai: npm run check-youtube -- @channel   (tanpa argumen: YT_CHANNEL, lalu @LofiGirl yang hampir selalu live)
const { YouTubeScraper } = require('../src/scraper');

const input = process.argv[2] || process.env.YT_CHANNEL || '@LofiGirl';

async function main() {
  console.log(`Mengecek akses YouTube untuk ${input} …`);

  const res = await fetch('https://www.youtube.com/?hl=en', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36' },
  });
  console.log(`- youtube.com: HTTP ${res.status}`);
  if (!res.ok) throw new Error('YouTube menolak IP server ini. Scraper kemungkinan tidak akan jalan di sini.');

  const scraper = new YouTubeScraper();
  try {
    await scraper.connect(input);
  } catch (err) {
    if (/tidak live/.test(err.message)) {
      console.log(`- ${input} sedang tidak live. Ulangi saat live, atau tes dengan channel lain: npm run check-youtube -- @LofiGirl`);
      return;
    }
    throw err;
  }
  const s = scraper.getStatus();
  scraper.disconnect();
  console.log(`- Live chat terbaca: ${s.title || s.videoId}`);
  console.log('OK: scraper bisa jalan dari server ini.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`GAGAL: ${err.message}`);
    process.exit(1);
  }
);
