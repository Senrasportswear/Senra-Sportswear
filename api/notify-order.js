const { notifyOwner } = require('./_lib/server');

// Sends a push notification when someone submits the "request a club shop" form.
// (Order notifications are now sent by complete-order.js on the server.)
// The message is built here from the form fields, so this can't be used to
// send arbitrary notifications to the owner's phone.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const clip = (v, n) => String(v || '').slice(0, n);
  const { name, email, phone, message } = req.body || {};
  if (!name || !message) {
    res.status(400).json({ error: 'Missing details' });
    return;
  }
  await notifyOwner(
    'New club shop request — Senra Sportswear',
    `${clip(name, 80)} wants: ${clip(message, 400)}\nContact: ${clip(email, 120)} · ${clip(phone, 40)}`
  );
  res.status(200).json({ sent: true });
};
