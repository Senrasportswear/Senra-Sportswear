const Stripe = require('stripe');
const { adminDb, isAdminRequest, paymentFee, splitFee } = require('./_lib/server');

// Admin only. Fills in the Stripe fee (and payment reference) on orders that
// don't have it yet — e.g. orders placed before money tracking was added, or
// where Stripe hadn't settled the fee at the moment of checkout.
// Called automatically when the Money tab opens. Does a batch at a time.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    if (!(await isAdminRequest(req))) {
      res.status(401).json({ error: 'Not logged in as admin. Log in again and retry.' });
      return;
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const db = adminDb();

    const { data: missing, error } = await db.from('orders')
      .select('stripe_session_id').is('stripe_fee', null).not('stripe_session_id', 'is', null).limit(300);
    if (error) { res.status(200).json({ ok: false, updated: 0, error: error.message }); return; }

    const sessions = [...new Set((missing || []).map(r => r.stripe_session_id))].slice(0, 15);
    let updated = 0;

    for (const sessionId of sessions) {
      const { data: rows } = await db.from('orders').select('id, unit_price, qty, stripe_payment_intent').eq('stripe_session_id', sessionId);
      if (!rows || !rows.length) continue;
      let pi = rows.find(r => r.stripe_payment_intent) && rows.find(r => r.stripe_payment_intent).stripe_payment_intent;
      let fee = null;
      try {
        if (!pi) {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          pi = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id);
        }
        fee = await paymentFee(stripe, pi);
      } catch (e) {
        // Payment doesn't exist on this Stripe account (e.g. an old test-mode
        // order) — record no fee so it isn't looked up again every time.
        if (e && e.code === 'resource_missing') fee = 0;
        else { console.error('Fee lookup failed for', sessionId, e.message); continue; }
      }
      if (fee == null) continue; // not settled yet — try again next time
      const parts = splitFee(fee, rows);
      for (let i = 0; i < rows.length; i++) {
        const { error: upErr } = await db.from('orders')
          .update({ stripe_fee: parts[i], stripe_payment_intent: pi || null }).eq('id', rows[i].id);
        if (!upErr) updated++;
      }
    }

    res.status(200).json({ ok: true, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
