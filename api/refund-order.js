const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { sessionId, amount } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session.payment_intent) {
      res.status(400).json({ error: 'No payment found for this order' });
      return;
    }

    // A basket checkout can bundle several items into one payment. Refunding
    // the whole payment_intent would refund everything the customer bought in
    // that checkout, not just the item(s) that missed the minimum — so when we
    // know the specific amount for just those items, only that amount is refunded.
    const refundParams = { payment_intent: session.payment_intent };
    if (amount && Number.isFinite(amount) && amount > 0) {
      refundParams.amount = Math.round(amount);
    }

    const refund = await stripe.refunds.create(refundParams);

    res.status(200).json({ ok: true, refundId: refund.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
