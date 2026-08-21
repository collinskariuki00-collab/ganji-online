// Transactional email via SpaceMail SMTP (info@ganjionline.com) — used for
// account verification and forgot-password links. Same "throw a clear error"
// pattern as services/mpesa.js so a misconfigured .env fails loudly instead
// of silently dropping emails.
const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

const FROM_NAME    = process.env.SMTP_FROM_NAME || 'Huantam';
const FROM_ADDRESS = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'info@ganjionline.com';
const FRONTEND_URL = process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP_HOST/SMTP_USER/SMTP_PASS are not set in .env — required to send verification/reset emails');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // SpaceMail: 465 = SSL, 587 = STARTTLS
    auth: { user, pass },
  });
  return transporter;
}

async function send({ to, subject, html, text }) {
  try {
    const info = await getTransporter().sendMail({
      from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
      to,
      subject,
      html,
      text,
    });
    logger.info(`Email sent to ${to}: ${subject} (${info.messageId})`);
    return info;
  } catch (err) {
    // Common causes: wrong SMTP_HOST/PORT for SpaceMail, bad SMTP_PASS, or
    // the mailbox not yet fully provisioned on SpaceMail's side.
    logger.error(`Email send failed to ${to}: ${err.message}`);
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

function wrapper(bodyHtml) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0b0f14;padding:32px 0">
    <div style="max-width:480px;margin:0 auto;background:#151b23;border:1px solid #262f3a;border-radius:12px;padding:32px;color:#e5e7eb">
      <div style="font-size:20px;font-weight:700;margin-bottom:18px">⚡ Huantam</div>
      ${bodyHtml}
      <p style="color:#6b7280;font-size:12px;margin-top:28px">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>`;
}

async function sendVerificationEmail(toEmail, token) {
  const link = `${FRONTEND_URL}/verify-email?token=${token}`;
  await send({
    to: toEmail,
    subject: 'Verify your Huantam account',
    html: wrapper(`
      <p style="font-size:15px">Welcome to Huantam — confirm your email to activate your account.</p>
      <a href="${link}" style="display:inline-block;margin:16px 0;background:#facc15;color:#1a1400;font-weight:600;padding:11px 20px;border-radius:8px;text-decoration:none">Verify email</a>
      <p style="font-size:12px;color:#9ca3af">Or paste this link into your browser:<br>${link}</p>
      <p style="font-size:12px;color:#9ca3af">This link expires in 24 hours.</p>
    `),
    text: `Verify your Huantam account: ${link} (expires in 24 hours)`,
  });
}

async function sendPasswordResetEmail(toEmail, token) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  await send({
    to: toEmail,
    subject: 'Reset your Huantam password',
    html: wrapper(`
      <p style="font-size:15px">We received a request to reset your Huantam password.</p>
      <a href="${link}" style="display:inline-block;margin:16px 0;background:#facc15;color:#1a1400;font-weight:600;padding:11px 20px;border-radius:8px;text-decoration:none">Reset password</a>
      <p style="font-size:12px;color:#9ca3af">Or paste this link into your browser:<br>${link}</p>
      <p style="font-size:12px;color:#9ca3af">This link expires in 1 hour.</p>
    `),
    text: `Reset your Huantam password: ${link} (expires in 1 hour)`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
