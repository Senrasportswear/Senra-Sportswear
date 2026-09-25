const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { items, basketId } = req.body; // items: array of {name, price, size, qty}

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'No items in basket' });
      return;
    }
    if (!basketId) {
      res.status(400).json({ error: 'Missing basketId' });
      return;
    }

    const line_items = items.map(it => ({
      price_data: {
        currency: 'gbp',
        product_data: { name: `${it.name} (Size: ${it.size})` },
        unit_amount: Math.round(Number(it.price) * 100)
      },
      quantity: it.qty && it.qty > 0 ? it.qty : 1
    }));

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const successUrl = `${origin}/?checkout=success&basketId=${basketId}&sessionId={CHECKOUT_SESSION_ID}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      shipping_address_collection: { allowed_countries: ['GB'] },
      success_url: successUrl,
      cancel_url: `${origin}/?checkout=cancelled`
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
