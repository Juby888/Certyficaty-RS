const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRICES = {
  elektryka: {
    subscription: 'price_1TwI2qQfn56rPw2gIbo6GqDT',
    'certyfikat-1': 'price_1TwI2pQfn56rPw2gGUGfgfdA',
    'certyfikat-2': 'price_1TwI2pQfn56rPw2gSWF1Elnx',
    'certyfikat-3': 'price_1TwI2oQfn56rPw2g8HxYmMoW',
    'certyfikat-4': 'price_1TwI2pQfn56rPw2gNfoaUeNu',
    'certyfikat-5': 'price_1TwI2pQfn56rPw2gvu2Ik0pv',
    'certyfikat-6': 'price_1TwI2lQfn56rPw2g8m8yTw3y'
  },
  gaz: {
    subscription: 'TODO_GAZ_SUBSCRIPTION_PRICE_ID',
    'gaz-1': 'TODO_GAZ_1_PRICE_ID',
    'gaz-2': 'TODO_GAZ_2_PRICE_ID',
    'gaz-3': 'TODO_GAZ_3_PRICE_ID',
    'gaz-4': 'TODO_GAZ_4_PRICE_ID',
    'gaz-5': 'TODO_GAZ_5_PRICE_ID'
  }
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

  var category = kind === 'protocol'
    ? (protocolId && protocolId.indexOf('gaz-') === 0 ? 'gaz' : 'elektryka')
    : body.category;

  if (category !== 'elektryka' && category !== 'gaz') {
    res.status(400).json({ error: 'Nieprawidłowa kategoria.' });
    return;
  }

  const priceId = kind === 'subscription' ? PRICES[category].subscription : PRICES[category][protocolId];
  if (!priceId || priceId.indexOf('TODO_') === 0) {
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
        category: category,
        protocol_id: kind === 'protocol' ? protocolId : ''
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Błąd tworzenia sesji Stripe Checkout:', err);
    res.status(500).json({ error: 'Nie udało się utworzyć sesji płatności.' });
  }
};
