import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transport;
const getTransport = () => {
  if (!env.SMTP_URL) return null;
  transport ||= nodemailer.createTransport(env.SMTP_URL);
  return transport;
};

// Fire-and-forget. Without SMTP_URL the email is printed instead, so the app works with zero setup.
export async function sendEmail(to, subject, text) {
  try {
    const t = getTransport();
    if (!t) {
      if (env.NODE_ENV !== 'test') console.log(`[email] to=${to} subject="${subject}"\n${text}\n`);
      return;
    }
    await t.sendMail({ from: env.MAIL_FROM, to, subject, text });
  } catch (err) {
    console.error('email failed', err.message);
  }
}
