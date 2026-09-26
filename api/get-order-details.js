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
    const cd = session.customer_details || {};
    const shipping = session.shipping_details || session.shipping
      || (session.collected_information && session.collected_information.shipping_details)
      || null;
    const addr = (shipping && shipping.address) || cd.address || null;

    const addressLines = addr ? [
      addr.line1,
      addr.line2,
      addr.city,
      addr.state,
      addr.postal_code,
      addr.country
    ].filter(Boolean).join(', ') : null;

    res.status(200).json({
      name: (shipping && shipping.name) || cd.name || null,
      email: cd.email || null,
      phone: cd.phone || null,
      address: addressLines
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
