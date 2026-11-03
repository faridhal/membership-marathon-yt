const fs = require('fs');
const path = require('path');

// Folder yang bisa ditulis: root proyek saat `npm start`, atau folder exe saat jalan dari MarathonOverlay.exe
// (isi exe read-only, jadi config.json, data/ dan credentials.json ada di samping exe).
const APP_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA_DIR = path.join(APP_DIR, 'data');

// Tulis ke file sementara lalu rename, supaya file tidak korup kalau proses mati di tengah penulisan.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = { APP_DIR, DATA_DIR, writeJsonAtomic, readJson };
