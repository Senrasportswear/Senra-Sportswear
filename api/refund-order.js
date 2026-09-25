const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { sessionId } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session.payment_intent) {
      res.status(400).json({ error: 'No payment found for this order' });
      return;
    }

    const refund = await stripe.refunds.create({
      payment_intent: session.payment_intent
    });

    res.status(200).json({ ok: true, refundId: refund.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
