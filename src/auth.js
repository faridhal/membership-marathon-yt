const fs = require('fs');
const path = require('path');
// Hanya klien YouTube (bukan seluruh googleapis) supaya exe tetap kecil.
const google = require('@googleapis/youtube');
const { APP_DIR, DATA_DIR, writeJsonAtomic, readJson } = require('./util');

const CREDENTIALS_PATH = path.join(APP_DIR, 'credentials.json');
const TOKEN_PATH = path.join(DATA_DIR, 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

let client = null;

function hasCredentials() {
  return fs.existsSync(CREDENTIALS_PATH);
}

// Buat OAuth2 client dari credentials.json (tipe "Web application" atau "Desktop app").
function getClient(redirectUri) {
  if (client) return client;
  if (!hasCredentials()) return null;

  const raw = readJson(CREDENTIALS_PATH, {});
  const creds = raw.web || raw.installed;
  if (!creds) throw new Error('credentials.json tidak valid (tidak ada "web" atau "installed")');

  client = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);

  const token = readJson(TOKEN_PATH, null);
  if (token) client.setCredentials(token);

  // Google mengirim access token baru secara berkala; gabungkan supaya refresh_token tidak hilang.
  client.on('tokens', (tokens) => {
    const merged = { ...readJson(TOKEN_PATH, {}), ...tokens };
    writeJsonAtomic(TOKEN_PATH, merged);
  });

  return client;
}

function isAuthorized() {
  return Boolean(client && client.credentials && client.credentials.refresh_token);
}

function getAuthUrl() {
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

async function handleCallback(code) {
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  writeJsonAtomic(TOKEN_PATH, tokens);
}

function logout() {
  if (client) client.setCredentials({});
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

module.exports = { hasCredentials, getClient, isAuthorized, getAuthUrl, handleCallback, logout };
