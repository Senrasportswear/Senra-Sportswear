const Stripe = require('stripe');
const { adminDb } = require('./_lib/server');

const ALL_SIZES = ['Y6','Y8','Y10','Y12','Y14','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL'];

// Prices are always looked up here on the server from the database. The
// browser only says WHAT is in the basket (item ids, sizes, quantities) —
// never how much it costs — so nobody can edit the page to pay less.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const db = adminDb();
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      res.status(400).json({ error: 'No items in basket' });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const basketItems = [];

    for (const raw of items) {
      const qty = parseInt(raw && raw.qty, 10);
      const size = raw && raw.size;
      if (!(qty >= 1 && qty <= 100)) { res.status(400).json({ error: 'Invalid quantity' }); return; }
      if (!ALL_SIZES.includes(size)) { res.status(400).json({ error: 'Invalid size' }); return; }

      if (raw.type === 'store') {
        const { data: p, error } = await db.from('products').select('*').eq('id', raw.productId).maybeSingle();
        if (error || !p || p.archived) { res.status(400).json({ error: 'A product in your basket is no longer available. Please remove it and try again.' }); return; }
        if (p.in_stock === false) { res.status(400).json({ error: `${p.name} is out of stock. Please remove it and try again.` }); return; }
        if (Array.isArray(p.available_sizes) && p.available_sizes.length && !p.available_sizes.includes(size)) {
          res.status(400).json({ error: `${p.name} isn't available in size ${size}.` }); return;
        }
        basketItems.push({ type: 'store', productId: p.id, name: p.name, price: Number(p.price), size, qty });
      } else if (raw.type === 'club') {
        const { data: it, error } = await db.from('club_items').select('*, clubs(*)').eq('id', raw.itemId).maybeSingle();
        const c = it && it.clubs;
        if (error || !it || it.archived || !c || c.archived || c.id !== raw.clubId) {
          res.status(400).json({ error: 'A club shop item in your basket is no longer available. Please remove it and try again.' }); return;
        }
        if (!(today >= c.open_date && today <= c.close_date)) {
          res.status(400).json({ error: `The ${c.name} shop is closed for orders.` }); return;
        }
        basketItems.push({ type: 'club', clubId: c.id, itemId: it.id, name: `${it.name} (${c.name})`, price: Number(it.price), size, qty });
      } else {
        res.status(400).json({ error: 'Unknown item in basket' }); return;
      }
    }

    if (basketItems.some(b => !(b.price > 0))) {
      res.status(400).json({ error: 'An item in your basket has no price set yet.' });
      return;
    }

    // Save exactly what is being paid for, so the order can be recorded once payment succeeds.
    const { data: basketRow, error: basketErr } = await db.from('baskets').insert({ items: basketItems }).select().single();
    if (basketErr) throw basketErr;

    const line_items = basketItems.map(it => ({
      price_data: {
        currency: 'gbp',
        product_data: { name: `${it.name} (Size: ${it.size})` },
        unit_amount: Math.round(it.price * 100)
      },
      quantity: it.qty
    }));

    const origin = req.headers.origin || `https://${req.headers.host}`;

    // Store items get posted out to the customer, so a flat delivery charge
    // applies — Club Shop items are handed out by the club itself, so no
    // delivery fee is added when a basket is only Club Shop items.
    const hasStoreItem = basketItems.some(it => it.type === 'store');
    const shipping_options = hasStoreItem ? [{
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 299, currency: 'gbp' },
        display_name: 'Delivery'
      }
    }] : [];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      shipping_address_collection: { allowed_countries: ['GB'] },
      shipping_options,
      metadata: { basketId: String(basketRow.id) },
      success_url: `${origin}/?checkout=success&sessionId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start checkout. Please try again in a moment.' });
  }
};
