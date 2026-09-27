module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const userKey = process.env.PUSHOVER_USER_KEY;
    const apiToken = process.env.PUSHOVER_API_TOKEN;

    // If Pushover hasn't been set up yet, don't break checkout — just skip quietly.
    if (!userKey || !apiToken) {
      res.status(200).json({ skipped: true });
      return;
    }

    const { title, message } = req.body;

    const params = new URLSearchParams({
      token: apiToken,
      user: userKey,
      title: title || 'New order — Senra Sportswear',
      message: message || 'A new order has come in.',
      priority: '0',
      sound: 'cashregister'
    });

    const resp = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error('Pushover error:', text);
      res.status(200).json({ sent: false, error: text });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (err) {
    console.error(err);
    // Never let a notification failure block the customer's order confirmation.
    res.status(200).json({ sent: false, error: err.message });
  }
};
