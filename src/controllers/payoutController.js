const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const requestSchema = Joi.object({
  amount: Joi.number().positive().required(),
  bank_name: Joi.string().allow('', null),
  iban: Joi.string().allow('', null),
  currency: Joi.string().default('SAR'),
});

const list = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT * FROM payout_requests WHERE therapist_id = :uid ORDER BY id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { payouts: rows });
});

const create = asyncHandler(async (req, res) => {
  const p = req.body;
  const wallets = await query(`SELECT * FROM wallets WHERE user_id = :uid`, { uid: req.user.id });
  if (!wallets.length || Number(wallets[0].balance) < p.amount) {
    return fail(res, 'Insufficient wallet balance', 400);
  }
  await query(`UPDATE wallets SET balance = balance - :amount WHERE id = :id`, {
    amount: p.amount,
    id: wallets[0].id,
  });
  await query(
    `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, currency, status, description)
     VALUES (:wid, :uid, 'payout', :amount, :currency, 'pending', 'Payout request')`,
    { wid: wallets[0].id, uid: req.user.id, amount: p.amount, currency: p.currency }
  );
  const result = await query(
    `INSERT INTO payout_requests (therapist_id, amount, currency, bank_name, iban, status)
     VALUES (:uid, :amount, :currency, :bank_name, :iban, 'pending')`,
    {
      uid: req.user.id,
      amount: p.amount,
      currency: p.currency,
      bank_name: p.bank_name || null,
      iban: p.iban || null,
    }
  );
  const rows = await query(`SELECT * FROM payout_requests WHERE id = :id`, { id: result.insertId });
  return ok(res, { payout: rows[0] }, 'Payout requested', 201);
});

module.exports = { requestSchema, list, create };
