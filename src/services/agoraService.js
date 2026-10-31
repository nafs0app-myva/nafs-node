const { RtcTokenBuilder, RtcRole } = require('agora-token');
const env = require('../config/env');

const TOKEN_TTL_SECONDS = 2 * 60 * 60;

/** Token for [uid] on [channel], or null when Agora credentials are not configured. */
function rtcTokenFor(channel, uid) {
  const { appId, appCertificate } = env.agora;
  if (!appId || !appCertificate) return null;
  return RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channel, uid, RtcRole.PUBLISHER, TOKEN_TTL_SECONDS, TOKEN_TTL_SECONDS);
}

module.exports = { rtcTokenFor };
