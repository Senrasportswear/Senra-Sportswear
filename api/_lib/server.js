// Shared helpers for the server functions in /api.
// Files in folders starting with "_" are not turned into public endpoints by Vercel.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lrcewcftludgshzeosbi.supabase.co';
const ADMIN_EMAIL = 'info@senrasportswear.co.uk';

// Server-only database client. Uses the SECRET key (set in Vercel as
// SUPABASE_SECRET_KEY), which can read and write everything — it must never
// appear in index.html or anywhere a visitor can see it.
function adminDb() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set in Vercel');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

// Checks the logged-in admin's session token sent from the browser.
// Returns true only for the shop owner's account.
async function isAdminRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return false;
  const { data, error } = await adminDb().auth.getUser(token);
  if (error || !data || !data.user) return false;
  return (data.user.email || '').toLowerCase() === ADMIN_EMAIL;
}

// Sends a push notification to the owner's phone via Pushover.
// Never throws — a failed notification must not break an order.
async function notifyOwner(title, message) {
  try {
    const userKey = process.env.PUSHOVER_USER_KEY;
    const apiToken = process.env.PUSHOVER_API_TOKEN;
    if (!userKey || !apiToken) return;
    await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: apiToken, user: userKey, title, message: String(message).slice(0, 1000),
        priority: '0', sound: 'cashregister'
      }).toString()
    });
  } catch (e) {
    console.error('Pushover error:', e);
  }
}

module.exports = { SUPABASE_URL, ADMIN_EMAIL, adminDb, isAdminRequest, notifyOwner };
