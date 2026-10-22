const nodemailer = require('nodemailer');
const env = require('../config/env');
const { query } = require('../config/db');

let transporter = null;

function smtpConfigured() {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

function getEmailStatus() {
  return {
    configured: smtpConfigured(),
    host: env.smtp.host || null,
    port: env.smtp.port,
    secure: env.smtp.secure,
    user: env.smtp.user || null,
    from: env.smtp.from || null,
  };
}

function buildTransport({ host, port, secure }) {
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
    requireTLS: !secure && port === 587,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

function getTransporter() {
  if (transporter !== null) return transporter;
  if (!smtpConfigured()) {
    transporter = false;
    return transporter;
  }
  transporter = buildTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
  });
  return transporter;
}

/** Hostinger often blocks outbound 465 — try 587 STARTTLS as fallback. */
function alternateSmtpConfigs() {
  const primary = {
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
  };
  const alts = [primary];
  if (env.smtp.host.includes('gmail.com') || env.smtp.host.includes('hostinger.com')) {
    if (!(primary.port === 587 && !primary.secure)) {
      alts.push({ host: env.smtp.host, port: 587, secure: false });
    }
    if (!(primary.port === 465 && primary.secure)) {
      alts.push({ host: env.smtp.host, port: 465, secure: true });
    }
  }
  return alts;
}

/** Reset cached transporter after env/config changes (mainly for tests). */
function resetTransporter() {
  transporter = null;
}

async function recordOutbox({ to, subject, body, purpose, status, error, meta }) {
  try {
    // Never persist raw OTP codes in outbox meta in production logs payload
    const safeMeta = meta ? { ...meta } : null;
    if (safeMeta && safeMeta.code && env.nodeEnv === 'production') {
      safeMeta.code = '[redacted]';
    }
    await query(
      `INSERT INTO email_outbox (to_email, subject, body, purpose, status, error_message, meta)
       VALUES (:to_email, :subject, :body, :purpose, :status, :error_message, :meta)`,
      {
        to_email: to,
        subject,
        body: env.nodeEnv === 'production' ? body.replace(/\b\d{6}\b/g, '******') : body,
        purpose: purpose || null,
        status,
        error_message: error || null,
        meta: safeMeta ? JSON.stringify(safeMeta) : null,
      }
    );
  } catch (err) {
    console.warn('[email] outbox write skipped:', err.message);
  }
}

async function sendMail({ to, subject, text, html, purpose, meta }) {
  const body = text || html || '';

  if (!smtpConfigured()) {
    console.warn(
      `[email] SMTP not configured — OTP not delivered to=${to} purpose=${purpose || 'n/a'}`
    );
    console.log(`[email:dev] to=${to} subject=${subject}\n${body}`);
    await recordOutbox({
      to,
      subject,
      body,
      purpose,
      status: 'logged',
      error: 'SMTP_HOST/SMTP_USER/SMTP_PASS not configured',
      meta,
    });
    return {
      delivered: false,
      mode: 'logged',
      message:
        'SMTP not configured on server. Set SMTP_HOST, SMTP_USER, SMTP_PASS.',
    };
  }

  const configs = alternateSmtpConfigs();
  let lastError = null;

  for (const cfg of configs) {
    try {
      const transport = buildTransport(cfg);
      const info = await transport.sendMail({
        from: env.smtp.from,
        to,
        subject,
        text,
        html: html || undefined,
      });
      // Cache working transport for subsequent sends
      transporter = transport;
      console.log(
        `[email] sent to=${to} id=${info.messageId} purpose=${purpose || 'n/a'} via ${cfg.host}:${cfg.port}`
      );
      await recordOutbox({
        to,
        subject,
        body,
        purpose,
        status: 'sent',
        meta: { ...(meta || {}), messageId: info.messageId, port: cfg.port },
      });
      return { delivered: true, mode: 'smtp', messageId: info.messageId, port: cfg.port };
    } catch (err) {
      lastError = err;
      console.error(`[email] send failed via ${cfg.host}:${cfg.port}:`, err.message);
    }
  }

  await recordOutbox({
    to,
    subject,
    body,
    purpose,
    status: 'failed',
    error: lastError?.message || 'unknown',
    meta,
  });
  return {
    delivered: false,
    mode: 'failed',
    error: lastError?.message,
    message: `SMTP send failed: ${lastError?.message || 'unknown'}`,
  };
}

async function sendOtpEmail({ email, code, purpose }) {
  const isVerify = purpose === 'verify_email';
  const subject = isVerify
    ? `${env.app.name} — verify your email`
    : `${env.app.name} — password reset code`;
  const text = isVerify
    ? `Your ${env.app.name} verification code is ${code}. It expires in 15 minutes.`
    : `Your ${env.app.name} password reset code is ${code}. It expires in 15 minutes. If you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:sans-serif;line-height:1.5">
    <p>${text}</p>
    <p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p>
    <p style="color:#666;font-size:12px">${env.app.name} · ${env.app.url}</p>
  </div>`;

  return sendMail({
    to: email,
    subject,
    text,
    html,
    purpose,
    meta: { code },
  });
}

async function recentOutbox(limit = 10) {
  try {
    return await query(
      `SELECT id, to_email, subject, purpose, status, error_message, created_at
       FROM email_outbox
       ORDER BY id DESC
       LIMIT ${Number(limit) || 10}`
    );
  } catch {
    return [];
  }
}

module.exports = {
  sendMail,
  sendOtpEmail,
  getTransporter,
  resetTransporter,
  smtpConfigured,
  getEmailStatus,
  recentOutbox,
};
