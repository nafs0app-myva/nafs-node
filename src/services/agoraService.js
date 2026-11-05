const { RtcTokenBuilder, RtcRole } = require('agora-token');
const env = require('../config/env');
const { query } = require('../config/db');

const TOKEN_TTL_SECONDS = 2 * 60 * 60;

/** Credentials loaded from MySQL app_secrets (survives Hostinger redeploys). */
let dbCreds = null; // { appId, appCertificate } | null

function envCreds() {
  const appId = (env.agora.appId || '').trim();
  const appCertificate = (env.agora.appCertificate || '').trim();
  if (!appId || !appCertificate) return null;
  return { appId, appCertificate };
}

function activeCreds() {
  return envCreds() || dbCreds;
}

function agoraConfigured() {
  return !!activeCreds();
}

function agoraStatus() {
  const c = activeCreds();
  return {
    configured: !!c,
    source: envCreds() ? 'env' : dbCreds ? 'app_secrets' : null,
    app_id: c?.appId || null,
    app_id_prefix: c?.appId ? `${c.appId.slice(0, 6)}…` : null,
    token_ttl_seconds: TOKEN_TTL_SECONDS,
  };
}

/** Load Agora App ID + certificate from app_secrets into memory. */
async function warmAgoraFromDb() {
  try {
    const rows = await query(
      `SELECT secret_key, value_text FROM app_secrets
       WHERE secret_key IN ('agora_app_id', 'agora_app_certificate')`
    );
    const map = Object.fromEntries(rows.map((r) => [r.secret_key, (r.value_text || '').trim()]));
    const appId = map.agora_app_id || '';
    const appCertificate = map.agora_app_certificate || '';
    dbCreds = appId && appCertificate ? { appId, appCertificate } : null;
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      console.warn('[agora] warmAgoraFromDb:', err.message);
    }
    dbCreds = null;
  }
  return agoraConfigured();
}

/**
 * Persist Agora credentials in DB so Hostinger does not need panel env vars.
 * Returns the updated status.
 */
async function saveAgoraAccount({ appId, appCertificate }) {
  const id = String(appId || '').trim();
  const cert = String(appCertificate || '').trim();
  if (!id || id.length < 8) throw new Error('Invalid AGORA_APP_ID');
  if (!cert || cert.length < 8) throw new Error('Invalid AGORA_APP_CERTIFICATE');

  await query(
    `INSERT INTO app_secrets (secret_key, value_text)
     VALUES ('agora_app_id', :value)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), updated_at = CURRENT_TIMESTAMP`,
    { value: id }
  );
  await query(
    `INSERT INTO app_secrets (secret_key, value_text)
     VALUES ('agora_app_certificate', :value)
     ON DUPLICATE KEY UPDATE value_text = VALUES(value_text), updated_at = CURRENT_TIMESTAMP`,
    { value: cert }
  );
  dbCreds = { appId: id, appCertificate: cert };
  return agoraStatus();
}

/**
 * Mint an RTC publisher token for [uid] on [channel].
 * Returns null when Agora credentials are not configured.
 */
function rtcTokenFor(channel, uid) {
  const creds = activeCreds();
  if (!creds) return null;
  const channelName = String(channel || '').trim();
  const numericUid = Number(uid);
  if (!channelName || !Number.isFinite(numericUid) || numericUid < 0) {
    throw new Error('channel and uid are required to mint an RTC token');
  }
  // agora-token v2: tokenExpire / privilegeExpire are TTL seconds from now.
  return RtcTokenBuilder.buildTokenWithUid(
    creds.appId,
    creds.appCertificate,
    channelName,
    numericUid,
    RtcRole.PUBLISHER,
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS
  );
}

/** Payload helpers for join / call responses. */
function rtcJoinPayload(channel, uid) {
  const creds = activeCreds();
  const token = rtcTokenFor(channel, uid);
  return {
    channel,
    uid: Number(uid),
    app_id: creds?.appId || null,
    rtc_token: token,
    token_ttl_seconds: token ? TOKEN_TTL_SECONDS : null,
    agora_configured: !!creds,
  };
}

module.exports = {
  TOKEN_TTL_SECONDS,
  agoraConfigured,
  agoraStatus,
  warmAgoraFromDb,
  saveAgoraAccount,
  rtcTokenFor,
  rtcJoinPayload,
};
