const Stripe = require('stripe');
const { adminDb, isAdminRequest } = require('./_lib/server');

// Refunds can only be triggered by the logged-in shop owner.
// The amount is worked out here on the server from the price the customer
// actually paid (saved on the order at checkout) — never the item's current
// price — so changing a price mid-round can't under- or over-refund anyone.
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
    const { orderId, sessionId: legacySessionId, amount: legacyAmount } = req.body || {};

    let order = null;
    if (orderId) {
      const { data, error } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
      if (error || !data) { res.status(404).json({ error: 'Order not found' }); return; }
      if (data.refunded) { res.status(400).json({ error: 'This order has already been refunded' }); return; }
      order = data;
    }

    const sessionId = order ? order.stripe_session_id : legacySessionId;
    if (!sessionId) {
      res.status(400).json({ error: 'No payment found for this order' });
      return;
    }

    let paymentIntent = order && order.stripe_payment_intent;
    if (!paymentIntent) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      paymentIntent = session.payment_intent;
    }
    if (!paymentIntent) {
      res.status(400).json({ error: 'No payment found for this order' });
      return;
    }

    // A basket checkout can bundle several items into one payment, so only
    // the amount for this order line is refunded, not the whole payment.
    let pennies = null;
    if (order && Number(order.unit_price) > 0) pennies = Math.round(Number(order.unit_price) * order.qty * 100);
    else if (Number.isFinite(legacyAmount) && legacyAmount > 0) pennies = Math.round(legacyAmount);

    if (!pennies) {
      // Never fall back to refunding the whole payment — it may include other items.
      res.status(400).json({ error: 'Could not work out the refund amount for this order' });
      return;
    }
    const refundParams = { payment_intent: paymentIntent, amount: pennies };

    // The idempotency key stops the same order line being refunded twice,
    // e.g. if the button is pressed again while the first refund is going through.
    const refund = await stripe.refunds.create(refundParams,
      order ? { idempotencyKey: `refund-order-${order.id}` } : undefined);

    if (order) {
      const update = { refunded: true, refunded_amount: refund.amount / 100, refunded_at: new Date().toISOString() };
      let { error } = await db.from('orders').update(update).eq('id', order.id);
      if (error && /column/i.test(error.message || '')) ({ error } = await db.from('orders').update({ refunded: true }).eq('id', order.id));
      if (error) console.error('Refunded on Stripe but could not update order record:', error.message);
    }

    res.status(200).json({ ok: true, refundId: refund.id, amount: refund.amount / 100 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
