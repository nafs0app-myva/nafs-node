const multer = require('multer');
const { query } = require('../config/db');
const { ok, fail } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const { enforceChildCertification } = require('../utils/scope');

const TYPES = {
  licenses: { table: 'therapist_licenses', owner: 'license' },
  degrees: { table: 'therapist_degrees', owner: 'degree' },
};
const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(MIMES.has(file.mimetype) ? null : new Error('INVALID_DOCUMENT'), MIMES.has(file.mimetype)),
}).single('document');

/** Resolves `:type/:id` to a license/degree owned by the signed-in therapist. */
async function ownedItem(req) {
  const cfg = TYPES[req.params.type];
  if (!cfg) return null;
  const [row] = await query(`SELECT id FROM ${cfg.table} WHERE id = :id AND therapist_id = :uid`, {
    id: req.params.id,
    uid: req.user.id,
  });
  return row ? { ...cfg, id: row.id } : null;
}

// POST /credentials/:type/:id/document  (multipart field `document`; PDF/JPG/PNG/WebP, 5 MB)
const uploadDocument = (req, res, next) =>
  upload(req, res, async (err) => {
    if (err) {
      if (err.message === 'INVALID_DOCUMENT') return fail(res, 'Document must be a PDF, JPG, PNG or WebP file', 422);
      if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 'Document must be 5 MB or smaller', 422);
      return next(err);
    }
    try {
      if (!req.file) return fail(res, 'Attach the file as the "document" field', 422);
      const item = await ownedItem(req);
      if (!item) return fail(res, 'Credential not found', 404);
      await query(
        `INSERT INTO credential_documents (therapist_id, owner_type, owner_id, filename, mime, data)
         VALUES (:uid, :owner, :id, :filename, :mime, :data)
         ON DUPLICATE KEY UPDATE filename = VALUES(filename), mime = VALUES(mime), data = VALUES(data)`,
        { uid: req.user.id, owner: item.owner, id: item.id, filename: req.file.originalname.slice(0, 190), mime: req.file.mimetype, data: req.file.buffer }
      );
      const [doc] = await query(`SELECT id FROM credential_documents WHERE owner_type = :o AND owner_id = :id`, { o: item.owner, id: item.id });
      const url = `${env.app.url}/api/v1/credentials/documents/${doc.id}`;
      await query(`UPDATE ${item.table} SET document_url = :url WHERE id = :id`, { url, id: item.id });
      return ok(res, { document_url: url, filename: req.file.originalname, mime: req.file.mimetype }, 'Document uploaded', 201);
    } catch (e) {
      return next(e);
    }
  });

// DELETE /credentials/:type/:id/document
const removeDocument = asyncHandler(async (req, res) => {
  const item = await ownedItem(req);
  if (!item) return fail(res, 'Credential not found', 404);
  await query(`DELETE FROM credential_documents WHERE owner_type = :o AND owner_id = :id`, { o: item.owner, id: item.id });
  await query(`UPDATE ${item.table} SET document_url = NULL WHERE id = :id`, { id: item.id });
  if (item.owner === 'degree') await enforceChildCertification(req.user.id);
  return ok(res, null, 'Document removed');
});

// GET /credentials/:type/:id/document — the file attached to one of the signed-in
// therapist's own licenses / degrees.
const getOwnDocument = asyncHandler(async (req, res) => {
  const item = await ownedItem(req);
  if (!item) return fail(res, 'Credential not found', 404);
  const [doc] = await query(
    `SELECT filename, mime, data FROM credential_documents WHERE owner_type = :o AND owner_id = :id`,
    { o: item.owner, id: item.id }
  );
  if (!doc) return fail(res, 'No document attached', 404);
  res.set('Content-Type', doc.mime);
  res.set('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
  res.set('Cache-Control', 'private, max-age=0');
  return res.send(doc.data);
});

// GET /credentials/documents/:docId — the owner or an admin only.
const getDocument = asyncHandler(async (req, res) => {
  const [doc] = await query(`SELECT therapist_id, filename, mime, data FROM credential_documents WHERE id = :id`, {
    id: req.params.docId,
  });
  if (!doc || (doc.therapist_id !== req.user.id && req.user.role !== 'admin')) return fail(res, 'Document not found', 404);
  res.set('Content-Type', doc.mime);
  res.set('Content-Disposition', `inline; filename="${doc.filename.replace(/"/g, '')}"`);
  res.set('Cache-Control', 'private, max-age=0');
  return res.send(doc.data);
});

module.exports = { uploadDocument, removeDocument, getDocument, getOwnDocument };
