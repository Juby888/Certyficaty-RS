const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRICES = {
  subscription: 'price_1TvFOTQek1YQfrapGhDS8kl7',
  'certyfikat-1': 'price_1TvFURQek1YQfrapuX9xvTTK',
  'certyfikat-2': 'price_1TvFUuQek1YQfrapsmCQPH8m',
  'certyfikat-3': 'price_1TvFVHQek1YQfrapT5hK1dD9',
  'certyfikat-4': 'price_1TvFVdQek1YQfraps0DbR0KH',
  'certyfikat-5': 'price_1TvFW1Qek1YQfrapkt2oTa07',
  'certyfikat-6': 'price_1TvFWTQek1YQfraplJON3XI2'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Brak tokenu autoryzacji.' });
    return;
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    res.status(401).json({ error: 'Nieprawidłowa lub wygasła sesja. Zaloguj się ponownie.' });
    return;
  }
  const user = userData.user;

  const body = req.body || {};
  const kind = body.kind;
  const protocolId = body.protocol_id;

  if (kind !== 'subscription' && kind !== 'protocol') {
    res.status(400).json({ error: 'Nieprawidłowy typ zakupu.' });
    return;
  }

  const priceId = kind === 'subscription' ? PRICES.subscription : PRICES[protocolId];
  if (!priceId) {
    res.status(400).json({ error: 'Nieznany protokół.' });
    return;
  }

  const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: kind === 'subscription' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      success_url: `${siteUrl}/index.html?checkout=success`,
      cancel_url: `${siteUrl}/pricing.html?checkout=cancel`,
      metadata: {
        user_id: user.id,
        kind: kind,
        protocol_id: kind === 'protocol' ? protocolId : ''
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Błąd tworzenia sesji Stripe Checkout:', err);
    res.status(500).json({ error: 'Nie udało się utworzyć sesji płatności.' });
  }
};
