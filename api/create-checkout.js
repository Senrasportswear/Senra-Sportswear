const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { name, price, size, qty, type, productId, clubId, itemId } = req.body;
    const quantity = qty && qty > 0 ? qty : 1;

    const params = new URLSearchParams({
      checkout: 'success',
      type,
      size,
      qty: String(quantity)
    });
    if (productId) params.set('productId', productId);
    if (clubId) params.set('clubId', clubId);
    if (itemId) params.set('itemId', itemId);

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const successUrl = `${origin}/?${params.toString()}&sessionId={CHECKOUT_SESSION_ID}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: { name: `${name} (Size: ${size})` },
          unit_amount: Math.round(Number(price) * 100)
        },
        quantity
      }],
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
