const { query } = require('../config/db');
const { ok } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const dashboard = asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const [user] = await query(`SELECT full_name, avatar_url FROM users WHERE id = :id`, { id: uid });
  const upcoming = await query(
    `SELECT s.id, s.title, s.session_type, s.status, s.starts_at, s.ends_at, s.join_url, s.fee_amount,
            c.id AS client_id, c.full_name AS client_name, c.avatar_url AS client_avatar
     FROM sessions s
     JOIN therapist_clients c ON c.id = s.client_id
     WHERE s.therapist_id = :uid AND s.status = 'scheduled' AND s.starts_at >= NOW()
     ORDER BY s.starts_at ASC LIMIT 1`,
    { uid }
  );
  const todayCount = await query(
    `SELECT COUNT(*) AS count FROM sessions
     WHERE therapist_id = :uid AND DATE(starts_at) = CURDATE()`,
    { uid }
  );
  const clientsCount = await query(
    `SELECT COUNT(*) AS count FROM therapist_clients WHERE therapist_id = :uid AND status = 'active'`,
    { uid }
  );
  const [wallet] = await query(`SELECT balance, currency FROM wallets WHERE user_id = :uid`, { uid });
  const unread = await query(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = :uid AND is_read = 0`,
    { uid }
  );
  const [app] = await query(
    `SELECT status, step FROM therapist_applications WHERE user_id = :uid`,
    { uid }
  );

  return ok(res, {
    greeting_name: user?.full_name || 'Doctor',
    application_status: app?.status || null,
    next_session: upcoming[0] || null,
    stats: {
      sessions_today: todayCount[0]?.count || 0,
      active_clients: clientsCount[0]?.count || 0,
      wallet_balance: wallet?.balance || 0,
      currency: wallet?.currency || 'SAR',
      unread_notifications: unread[0]?.count || 0,
    },
  });
});

module.exports = { dashboard };
