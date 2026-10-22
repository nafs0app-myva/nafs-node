const nodemailer = require('nodemailer');
const env = require('../config/env');
const { query } = require('../config/db');

let transporter = null;

function getTransporter() {
  if (transporter !== null) return transporter;
  if (!env.smtp.host || !env.smtp.user) {
    transporter = false;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
  });
  return transporter;
}

async function recordOutbox({ to, subject, body, purpose, status, error, meta }) {
  try {
    await query(
      `INSERT INTO email_outbox (to_email, subject, body, purpose, status, error_message, meta)
       VALUES (:to_email, :subject, :body, :purpose, :status, :error_message, :meta)`,
      {
        to_email: to,
        subject,
        body,
        purpose: purpose || null,
        status,
        error_message: error || null,
        meta: meta ? JSON.stringify(meta) : null,
      }
    );
  } catch (err) {
    // Outbox table may not exist yet on very old deploys; never break auth flow.
    console.warn('[email] outbox write skipped:', err.message);
  }
}

async function sendMail({ to, subject, text, html, purpose, meta }) {
  const body = text || html || '';
  const transport = getTransporter();

  if (!transport) {
    console.log(`[email:dev] to=${to} subject=${subject}\n${body}`);
    await recordOutbox({
      to,
      subject,
      body,
      purpose,
      status: 'logged',
      meta,
    });
    return {
      delivered: false,
      mode: 'logged',
      message: 'SMTP not configured; email logged to server/outbox',
    };
  }

  try {
    const info = await transport.sendMail({
      from: env.smtp.from,
      to,
      subject,
      text,
      html: html || undefined,
    });
    await recordOutbox({
      to,
      subject,
      body,
      purpose,
      status: 'sent',
      meta: { ...(meta || {}), messageId: info.messageId },
    });
    return { delivered: true, mode: 'smtp', messageId: info.messageId };
  } catch (err) {
    console.error('[email] send failed:', err.message);
    await recordOutbox({
      to,
      subject,
      body,
      purpose,
      status: 'failed',
      error: err.message,
      meta,
    });
    return { delivered: false, mode: 'failed', error: err.message };
  }
}

async function sendOtpEmail({ email, code, purpose }) {
  const isVerify = purpose === 'verify_email';
  const subject = isVerify
    ? `${env.app.name} — verify your email`
    : `${env.app.name} — password reset code`;
  const text = isVerify
    ? `Your ${env.app.name} verification code is ${code}. It expires in 15 minutes.`
    : `Your ${env.app.name} password reset code is ${code}. It expires in 15 minutes.`;
  const html = `<p>${text}</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p>`;

  return sendMail({
    to: email,
    subject,
    text,
    html,
    purpose,
    meta: { code },
  });
}

module.exports = { sendMail, sendOtpEmail, getTransporter };
