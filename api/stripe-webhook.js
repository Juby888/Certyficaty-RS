const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function upsertProtocolEntitlement(userId, protocolId, stripeCustomerId) {
  const { data: existing } = await supabaseAdmin
    .from('entitlements')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', 'protocol')
    .eq('protocol_id', protocolId)
    .eq('status', 'active');

  if (existing && existing.length > 0) return;

  await supabaseAdmin.from('entitlements').insert({
    user_id: userId,
    kind: 'protocol',
    protocol_id: protocolId,
    status: 'active',
    stripe_customer_id: stripeCustomerId,
    current_period_end: null
  });
}

async function upsertSubscriptionEntitlement(userId, stripeSubscriptionId, stripeCustomerId) {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

  const { data: existing } = await supabaseAdmin
    .from('entitlements')
    .select('id')
    .eq('stripe_subscription_id', stripeSubscriptionId);

  if (existing && existing.length > 0) {
    await supabaseAdmin
      .from('entitlements')
      .update({ status: 'active', current_period_end: periodEnd, stripe_customer_id: stripeCustomerId })
      .eq('stripe_subscription_id', stripeSubscriptionId);
  } else {
    await supabaseAdmin.from('entitlements').insert({
      user_id: userId,
      kind: 'subscription',
      protocol_id: null,
      status: 'active',
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      current_period_end: periodEnd
    });
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const buf = await readRawBody(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Weryfikacja podpisu webhooka nieudana:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const userId = metadata.user_id;
        const kind = metadata.kind;
        const protocolId = metadata.protocol_id;

        if (userId && kind === 'protocol' && protocolId) {
          await upsertProtocolEntitlement(userId, protocolId, session.customer);
        } else if (userId && kind === 'subscription' && session.subscription) {
          await upsertSubscriptionEntitlement(userId, session.subscription, session.customer);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        const status = (subscription.status === 'active' || subscription.status === 'trialing') ? 'active' : 'canceled';
        await supabaseAdmin
          .from('entitlements')
          .update({ status: status, current_period_end: periodEnd })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await supabaseAdmin
          .from('entitlements')
          .update({ status: 'canceled' })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Błąd obsługi webhooka Stripe:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};
