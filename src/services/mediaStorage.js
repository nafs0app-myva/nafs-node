const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MEDIA_ROOT = path.join(__dirname, '..', '..', 'storage', 'media');

const SIZE_LIMITS = {
  photo: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

function userDir(userId) {
  return path.join(MEDIA_ROOT, String(userId));
}

async function ensureUserDir(userId) {
  const dir = userDir(userId);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function filePathFor(userId, mediaId, kind = 'file') {
  const base = path.join(userDir(userId), String(mediaId));
  return kind === 'thumb' ? `${base}.thumb` : base;
}

async function saveUploadedFile(userId, mediaId, sourcePath, kind = 'file') {
  await ensureUserDir(userId);
  const dest = filePathFor(userId, mediaId, kind);
  await fsp.rename(sourcePath, dest).catch(async () => {
    await fsp.copyFile(sourcePath, dest);
    await fsp.unlink(sourcePath).catch(() => {});
  });
  return dest;
}

async function saveBuffer(userId, mediaId, buffer, kind = 'file') {
  await ensureUserDir(userId);
  const dest = filePathFor(userId, mediaId, kind);
  await fsp.writeFile(dest, buffer);
  return dest;
}

async function removeMediaFiles(userId, mediaId) {
  for (const kind of ['file', 'thumb']) {
    const p = filePathFor(userId, mediaId, kind);
    await fsp.unlink(p).catch(() => {});
  }
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start == null && end == null) return null;
  if (start == null) {
    // suffix: last N bytes
    start = Math.max(size - end, 0);
    end = size - 1;
  } else if (end == null || end >= size) {
    end = size - 1;
  }
  if (start < 0 || end < start || start >= size) return null;
  return { start, end };
}

/**
 * Stream a media file with optional HTTP Range (206) support.
 * Prefers disk path; falls back to Buffer (legacy LONGBLOB rows).
 */
function sendMediaContent(req, res, { mime, filePath, buffer }) {
  let size = 0;
  let usePath = false;
  if (filePath && fs.existsSync(filePath)) {
    size = fs.statSync(filePath).size;
    usePath = true;
  } else if (buffer && buffer.length) {
    size = buffer.length;
  } else {
    return false;
  }

  const contentType = mime || 'application/octet-stream';
  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'private, max-age=3600');

  const range = parseRange(req.headers.range, size);
  if (!range) {
    res.set('Content-Length', String(size));
    if (usePath) {
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.send(buffer);
    }
    return true;
  }

  const { start, end } = range;
  const chunkSize = end - start + 1;
  res.status(206);
  res.set({
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': String(chunkSize),
  });
  if (usePath) {
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.send(buffer.subarray(start, end + 1));
  }
  return true;
}

module.exports = {
  MEDIA_ROOT,
  SIZE_LIMITS,
  ensureUserDir,
  filePathFor,
  saveUploadedFile,
  saveBuffer,
  removeMediaFiles,
  sendMediaContent,
};
