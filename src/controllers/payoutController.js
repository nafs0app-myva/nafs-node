const Joi = require('joi');
const { query, withTransaction } = require('../config/db');
const { MIN_PAYOUT } = require('../config/payout');
const { maskIban } = require('../utils/iban');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { notify } = require('../utils/notify');

const requestSchema = Joi.object({
  amount: Joi.number().positive().required(),
  bank_name: Joi.string().allow('', null),
  iban: Joi.string().allow('', null),
  currency: Joi.string().default('SAR'),
});

/** Five working days from today (Sunday-Thursday week), as YYYY-MM-DD. */
function expectedBy() {
  const d = new Date();
  let added = 0;
  while (added < 5) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![5, 6].includes(d.getUTCDay())) added += 1; // skip Friday and Saturday
  }
  return d.toISOString().slice(0, 10);
}

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM payout_requests WHERE therapist_id = :uid ORDER BY id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { payouts: rows.map((r) => ({ ...r, iban: maskIban(r.iban) })) });
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  if (p.amount < MIN_PAYOUT) return fail(res, `Minimum payout amount is ${MIN_PAYOUT}`, 422);
  // Payouts go to the bank account saved on the therapist's profile.
  const [bank] = await query(`SELECT bank_name, bank_account_holder, iban FROM therapist_profiles WHERE user_id = :uid`, { uid: req.user.id });
  if (!bank?.iban) return fail(res, 'Add your bank details before requesting a payout.', 422);
  // One transaction so the balance deduction, ledger row and request stay consistent.
  const payoutId = await withTransaction(async (conn) => {
    const [[wallet]] = await conn.execute(`SELECT id FROM wallets WHERE user_id = :uid FOR UPDATE`, {
      uid: req.user.id,
    });
    if (!wallet) return null;
    const [upd] = await conn.execute(
      `UPDATE wallets SET balance = balance - :amount WHERE id = :id AND balance >= :amount`,
      { amount: p.amount, id: wallet.id }
    );
    if (!upd.affectedRows) return null;
    const [result] = await conn.execute(
      `INSERT INTO payout_requests (therapist_id, amount, currency, bank_name, iban, status)
       VALUES (:uid, :amount, :currency, :bank_name, :iban, 'pending')`,
      {
        uid: req.user.id,
        amount: p.amount,
        currency: p.currency,
        bank_name: bank.bank_name || null,
        iban: bank.iban,
      }
    );
    await conn.execute(
      `INSERT INTO wallet_transactions
         (wallet_id, user_id, type, amount, currency, status, description, reference_type, reference_id)
       VALUES (:wid, :uid, 'payout', :amount, :currency, 'pending', 'Payout request', 'payout', :pid)`,
      { wid: wallet.id, uid: req.user.id, amount: p.amount, currency: p.currency, pid: result.insertId }
    );
    return result.insertId;
  });
  if (!payoutId) return fail(res, 'Insufficient wallet balance', 400);
  const rows = await query(`SELECT * FROM payout_requests WHERE id = :id`, { id: payoutId });
  return ok(res, { payout: { ...rows[0], iban: maskIban(rows[0].iban), expected_by: expectedBy() } }, 'Payout requested', 201);
});

const statusSchema = Joi.object({
  status: Joi.string().valid('processing', 'paid', 'rejected').required(),
});

// Admin: move a payout through processing -> paid, or reject it. Rejecting
// refunds the held amount to the therapist's wallet exactly once.
const updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  let notice = null; // sent after the transaction commits, so a rollback never notifies
  const outcome = await withTransaction(async (conn) => {
    const [[payout]] = await conn.execute(
      `SELECT * FROM payout_requests WHERE id = :id FOR UPDATE`,
      { id: req.params.id }
    );
    if (!payout) return { code: 404, message: 'Payout not found' };
    if (['paid', 'rejected'].includes(payout.status)) {
      return { code: 400, message: `Payout is already ${payout.status}` };
    }
    if (status === payout.status) return { code: 400, message: `Payout is already ${status}` };

    if (status === 'processing') {
      await conn.execute(`UPDATE payout_requests SET status = 'processing' WHERE id = :id`, { id: payout.id });
    } else if (status === 'paid') {
      await conn.execute(
        `UPDATE payout_requests SET status = 'paid', processed_at = UTC_TIMESTAMP() WHERE id = :id`,
        { id: payout.id }
      );
      await conn.execute(
        `UPDATE wallet_transactions SET status = 'completed'
         WHERE reference_type = 'payout' AND reference_id = :id AND type = 'payout'`,
        { id: payout.id }
      );
      notice = { userId: payout.therapist_id, title: 'Payout sent', body: `Your payout of ${payout.amount} ${payout.currency} was paid.` };
    } else {
      const [[wallet]] = await conn.execute(`SELECT id FROM wallets WHERE user_id = :uid FOR UPDATE`, {
        uid: payout.therapist_id,
      });
      await conn.execute(`UPDATE wallets SET balance = balance + :amount WHERE id = :id`, {
        amount: payout.amount,
        id: wallet.id,
      });
      await conn.execute(
        `UPDATE wallet_transactions SET status = 'failed'
         WHERE reference_type = 'payout' AND reference_id = :id AND type = 'payout'`,
        { id: payout.id }
      );
      await conn.execute(
        `INSERT INTO wallet_transactions
           (wallet_id, user_id, type, amount, currency, status, description, reference_type, reference_id)
         VALUES (:wid, :uid, 'refund', :amount, :cur, 'completed', 'Payout rejected - refunded', 'payout', :pid)`,
        { wid: wallet.id, uid: payout.therapist_id, amount: payout.amount, cur: payout.currency, pid: payout.id }
      );
      await conn.execute(
        `UPDATE payout_requests SET status = 'rejected', processed_at = UTC_TIMESTAMP() WHERE id = :id`,
        { id: payout.id }
      );
      notice = {
        userId: payout.therapist_id,
        title: 'Payout rejected',
        body: 'Your payout request was rejected and the amount was returned to your wallet.',
      };
    }
    return { code: 200 };
  });
  if (outcome.code !== 200) return fail(res, outcome.message, outcome.code);
  if (notice) {
    await notify(notice.userId, { title: notice.title, body: notice.body, type: 'payout', category: 'financial' });
  }
  const rows = await query(`SELECT * FROM payout_requests WHERE id = :id`, { id: req.params.id });
  return ok(res, { payout: rows[0] }, 'Payout updated');
});

module.exports = { requestSchema, statusSchema, list, create, updateStatus };
