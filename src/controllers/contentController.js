const { query } = require('../config/db');
const { ok } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const kind = req.query.kind;
  let rows;
  if (kind) {
    rows = await query(
      `SELECT id, kind, title, arabic_text, body, source, tags
       FROM content_items WHERE is_active = 1 AND kind = :kind ORDER BY id DESC`,
      { kind }
    );
  } else {
    rows = await query(
      `SELECT id, kind, title, arabic_text, body, source, tags
       FROM content_items WHERE is_active = 1 ORDER BY id DESC LIMIT 100`
    );
  }
  return ok(res, { items: rows });
});

const daily = asyncHandler(async (_req, res) => {
  const rows = await query(
    `SELECT id, kind, title, arabic_text, body, source
     FROM content_items WHERE is_active = 1 ORDER BY RAND() LIMIT 1`
  );
  return ok(res, { item: rows[0] || null });
});

module.exports = { list, daily };
