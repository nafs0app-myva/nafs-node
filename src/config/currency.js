const Joi = require('joi');

/** Platform currency policy (Option A): SAR only. */
const DEFAULT = 'SAR';
const ALLOWED = Object.freeze([DEFAULT]);

function joiCurrency({ required = false } = {}) {
  let schema = Joi.string()
    .uppercase()
    .valid(...ALLOWED)
    .messages({
      'any.only': `Only ${DEFAULT} is supported`,
    });
  if (required) schema = schema.required();
  else schema = schema.default(DEFAULT);
  return schema;
}

function assertAllowed(currency) {
  const cur = String(currency || DEFAULT).toUpperCase();
  if (!ALLOWED.includes(cur)) {
    const err = new Error(`Only ${DEFAULT} is supported`);
    err.status = 422;
    throw err;
  }
  return cur;
}

module.exports = {
  DEFAULT,
  ALLOWED,
  joiCurrency,
  assertAllowed,
};
