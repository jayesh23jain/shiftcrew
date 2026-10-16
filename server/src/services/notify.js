import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { sendEmail } from './mailer.js';
import { env } from '../config/env.js';

// Creates in-app notifications and (if the user allows) sends an email.
export async function notify(userIds, { type, title, body = '', link, email = true }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!ids.length) return;
  try {
    await Notification.insertMany(ids.map((userId) => ({ userId, type, title, body, link })));
    if (email) {
      const users = await User.find({ _id: { $in: ids }, emailNotifications: true }).select('email');
      const url = link ? `\n\n${env.CLIENT_URL}${link}` : '';
      for (const u of users) sendEmail(u.email, title, `${body}${url}`.trim());
    }
  } catch (err) {
    console.error('notify failed', err.message);
  }
}
