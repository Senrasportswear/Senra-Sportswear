const Stripe = require('stripe');
const { adminDb } = require('./_lib/server');
const { recordPaidSession } = require('./_lib/record-order');

// Stripe calls this address directly whenever a checkout is paid — so an
// order is recorded even if the customer closes their browser before being
// sent back to the site.
//
// Security: the message from Stripe is never trusted as-is. Only its event id
// is used, and the event is then fetched straight from Stripe with the secret
// key. A fake message can't produce a real Stripe event, so it's ignored.
const HANDLED = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const eventId = body && typeof body.id === 'string' ? body.id : null;
  if (!eventId || !/^evt_/.test(eventId)) {
    res.status(400).json({ error: 'Not a Stripe event' });
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = await stripe.events.retrieve(eventId);
  } catch (e) {
    // Not a real event on this Stripe account — ignore it.
    res.status(400).json({ error: 'Unknown event' });
    return;
  }

  if (!HANDLED.includes(event.type)) {
    res.status(200).json({ received: true, ignored: event.type });
    return;
  }

  try {
    const session = event.data && event.data.object;
    if (!session || !session.id) { res.status(200).json({ received: true }); return; }
    // Card payments are 'paid' straight away. If a payment is still pending,
    // Stripe sends async_payment_succeeded later, which records it then.
    const result = await recordPaidSession(stripe, adminDb(), session.id);
    res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('Webhook failed to record order:', err);
    // A 500 makes Stripe retry automatically over the next few hours.
    res.status(500).json({ error: 'Could not record order' });
  }
};
