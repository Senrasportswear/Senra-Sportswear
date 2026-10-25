const Stripe = require('stripe');
const { adminDb } = require('./_lib/server');
const { recordPaidSession } = require('./_lib/record-order');

// Called by the "payment successful" page. Everything is checked with Stripe
// on the server: the order is only recorded if Stripe confirms the payment
// went through, and only once per payment. (The Stripe webhook does the same
// as a back-up, in case the customer never comes back to the site.)
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
    const result = await recordPaidSession(Stripe(process.env.STRIPE_SECRET_KEY), adminDb(), sessionId);
    if (!result.ok) { res.status(result.status || 400).json({ error: result.error }); return; }
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not record order' });
  }
};
