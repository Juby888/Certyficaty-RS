const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

  try {
    // Anuluj aktywną subskrypcję w Stripe, zanim usuniemy konto — inaczej osoba
    // mogłaby być nadal obciążana płatnościami bez możliwości zalogowania się.
    const { data: subs, error: subsError } = await supabaseAdmin
      .from('entitlements')
      .select('stripe_subscription_id')
      .eq('user_id', user.id)
      .eq('kind', 'subscription')
      .eq('status', 'active');

    if (subsError) {
      console.error('Błąd odczytu subskrypcji przed usunięciem konta:', subsError);
    } else if (subs && subs.length) {
      for (const row of subs) {
        if (!row.stripe_subscription_id) continue;
        try {
          await stripe.subscriptions.cancel(row.stripe_subscription_id);
        } catch (e) {
          console.error('Nie udało się anulować subskrypcji Stripe:', e);
        }
      }
    }

    // Usunięcie użytkownika w auth.users kaskadowo usuwa profiles i entitlements
    // (ON DELETE CASCADE w supabase-schema.sql).
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error('Błąd usuwania konta:', deleteError);
      res.status(500).json({ error: 'Nie udało się usunąć konta.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Błąd delete-account:', err);
    res.status(500).json({ error: 'Wewnętrzny błąd serwera.' });
  }
};
