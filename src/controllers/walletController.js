const Joi = require('joi');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const paymentMethodSchema = Joi.object({
  brand: Joi.string().required(),
  last4: Joi.string().length(4).required(),
  exp_month: Joi.number().integer().min(1).max(12).allow(null),
  exp_year: Joi.number().integer().min(2024).allow(null),
  is_default: Joi.boolean().default(false),
  provider_token: Joi.string().allow('', null),
});

async function ensureWallet(userId) {
  let rows = await query(`SELECT * FROM wallets WHERE user_id = :uid`, { uid: userId });
  if (!rows.length) {
    await query(`INSERT INTO wallets (user_id, balance, currency) VALUES (:uid, 0, 'SAR')`, {
      uid: userId,
    });
    rows = await query(`SELECT * FROM wallets WHERE user_id = :uid`, { uid: userId });
  }
  return rows[0];
}

const getWallet = asyncHandler(async (req, res) => {
  const wallet = await ensureWallet(req.user.id);
  return ok(res, { wallet });
});

const transactions = asyncHandler(async (req, res) => {
  const wallet = await ensureWallet(req.user.id);
  const rows = await query(
    `SELECT id, type, amount, currency, status, description, created_at
     FROM wallet_transactions WHERE user_id = :uid
     ORDER BY id DESC LIMIT 100`,
    { uid: req.user.id }
  );
  return ok(res, { wallet_id: wallet.id, transactions: rows });
});

const overview = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
            SUM(CASE WHEN type IN ('credit','session_fee') THEN amount ELSE 0 END) AS earned,
            SUM(CASE WHEN type IN ('debit','payout') THEN amount ELSE 0 END) AS paid_out
     FROM wallet_transactions
     WHERE user_id = :uid AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m')
     ORDER BY month ASC`,
    { uid: req.user.id }
  );
  const wallet = await ensureWallet(req.user.id);
  return ok(res, { balance: wallet.balance, currency: wallet.currency, months: rows });
});

const listPaymentMethods = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, brand, last4, exp_month, exp_year, is_default, created_at
     FROM payment_methods WHERE user_id = :uid ORDER BY is_default DESC, id DESC`,
    { uid: req.user.id }
  );
  return ok(res, { payment_methods: rows });
});

const addPaymentMethod = asyncHandler(async (req, res) => {
  const p = req.body;
  if (p.is_default) {
    await query(`UPDATE payment_methods SET is_default = 0 WHERE user_id = :uid`, {
      uid: req.user.id,
    });
  }
  const result = await query(
    `INSERT INTO payment_methods (user_id, brand, last4, exp_month, exp_year, is_default, provider_token)
     VALUES (:uid, :brand, :last4, :exp_month, :exp_year, :is_default, :provider_token)`,
    {
      uid: req.user.id,
      brand: p.brand,
      last4: p.last4,
      exp_month: p.exp_month || null,
      exp_year: p.exp_year || null,
      is_default: p.is_default ? 1 : 0,
      provider_token: p.provider_token || null,
    }
  );
  const rows = await query(`SELECT id, brand, last4, exp_month, exp_year, is_default FROM payment_methods WHERE id = :id`, {
    id: result.insertId,
  });
  return ok(res, { payment_method: rows[0] }, 'Payment method added', 201);
});

const billingHistory = asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT id, type, amount, currency, status, description, created_at
     FROM wallet_transactions
     WHERE user_id = :uid AND type IN ('payout','debit','refund','session_fee')
     ORDER BY id DESC LIMIT 100`,
    { uid: req.user.id }
  );
  return ok(res, { billing: rows });
});

const deletePaymentMethod = asyncHandler(async (req, res) => {
  const result = await query(
    `DELETE FROM payment_methods WHERE id = :id AND user_id = :uid`,
    { id: req.params.id, uid: req.user.id }
  );
  if (!result.affectedRows) return fail(res, 'Payment method not found', 404);
  return ok(res, null, 'Payment method removed');
});

const withdraw = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) return fail(res, 'Invalid amount', 422);
  const wallet = await ensureWallet(req.user.id);
  if (Number(wallet.balance) < amount) return fail(res, 'Insufficient balance', 400);
  await query(`UPDATE wallets SET balance = balance - :amount WHERE id = :id`, {
    amount,
    id: wallet.id,
  });
  const result = await query(
    `INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, currency, status, description)
     VALUES (:wid, :uid, 'payout', :amount, :currency, 'pending', 'Withdrawal request')`,
    { wid: wallet.id, uid: req.user.id, amount, currency: wallet.currency }
  );
  return ok(res, { transaction_id: result.insertId }, 'Withdrawal requested', 201);
});

module.exports = {
  paymentMethodSchema,
  getWallet,
  transactions,
  overview,
  listPaymentMethods,
  addPaymentMethod,
  deletePaymentMethod,
  billingHistory,
  withdraw,
};
