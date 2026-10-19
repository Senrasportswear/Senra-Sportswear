const Stripe = require('stripe');
const { adminDb, notifyOwner, paymentFee, splitFee } = require('./_lib/server');

// Called by the "payment successful" page. Everything is checked with Stripe
// here on the server: the order is only recorded if Stripe confirms the
// payment went through, and only once per payment.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { sessionId } = req.body || {};
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const db = adminDb();

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      res.status(400).json({ error: 'Payment has not completed' });
      return;
    }
    const basketId = session.metadata && session.metadata.basketId;
    if (!basketId) {
      res.status(400).json({ error: 'No basket linked to this payment' });
      return;
    }

    // Already recorded (e.g. the customer refreshed the page)? Then nothing to do.
    const { data: existing } = await db.from('orders').select('id').eq('stripe_session_id', sessionId).limit(1);
    if (existing && existing.length) {
      res.status(200).json({ ok: true, alreadyRecorded: true });
      return;
    }

    // Claim the basket so two requests at the same moment can't both record it.
    const claim = await db.from('baskets').update({ recorded: true }).eq('id', basketId).eq('recorded', false).select();
    const claimSupported = !claim.error;
    if (claimSupported && (!claim.data || !claim.data.length)) {
      res.status(200).json({ ok: true, alreadyRecorded: true });
      return;
    }

    const { data: basketRow, error: basketErr } = await db.from('baskets').select('*').eq('id', basketId).single();
    if (basketErr || !basketRow) throw basketErr || new Error('Basket not found');

    const cd = session.customer_details || {};
    const shipping = session.shipping_details || session.shipping
      || (session.collected_information && session.collected_information.shipping_details)
      || null;
    const addr = (shipping && shipping.address) || cd.address || null;
    const address = addr ? [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country].filter(Boolean).join(', ') : null;
    const name = (shipping && shipping.name) || cd.name || null;
    const email = cd.email || null;
    const phone = cd.phone || null;

    const items = Array.isArray(basketRow.items) ? basketRow.items : [];
    const paymentIntent = typeof session.payment_intent === 'string'
      ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null;
    // unit_price is the price the customer actually paid (fixed at checkout),
    // so later price changes never alter this order, its totals or its refund.
    const rows = items.map(b => b.type === 'club'
      ? { club_id: b.clubId, item_id: b.itemId, size: b.size, qty: b.qty, stripe_session_id: sessionId,
          customer_name: name, customer_email: email, customer_phone: phone,
          unit_price: Number(b.price), stripe_payment_intent: paymentIntent }
      : { product_id: b.productId, size: b.size, qty: b.qty, stripe_session_id: sessionId,
          customer_name: name, customer_email: email, customer_phone: phone, shipping_address: address,
          unit_price: Number(b.price), stripe_payment_intent: paymentIntent });

    // Stripe's fee for this payment, shared across the lines. If Stripe hasn't
    // settled it yet, it's left blank and the admin Money tab fills it in later.
    let fee = null;
    try { fee = await paymentFee(stripe, paymentIntent); } catch (e) { console.error('Fee lookup failed:', e.message); }
    splitFee(fee, rows).forEach((f, i) => { rows[i].stripe_fee = f; });

    let { error: insertErr } = await db.from('orders').insert(rows);
    if (insertErr && /column/i.test(insertErr.message || '')) {
      // Database not updated yet (supabase/money.sql not run) — still record the order.
      console.error('Money columns missing, saving order without them:', insertErr.message);
      const basic = rows.map(({ unit_price, stripe_payment_intent, stripe_fee, ...rest }) => rest);
      ({ error: insertErr } = await db.from('orders').insert(basic));
    }
    if (insertErr) {
      if (claimSupported) await db.from('baskets').update({ recorded: false }).eq('id', basketId);
      throw insertErr;
    }

    const summary = items.map(b => `${b.qty || 1}x ${b.name} (${b.size})`).join(', ');
    await notifyOwner('New order — Senra Sportswear', summary + (name ? `\nFrom: ${name}` : ''));

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not record order' });
  }
};
