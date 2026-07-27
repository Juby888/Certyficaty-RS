const { createClient } = require('@supabase/supabase-js');

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
    res.status(401).json({ error: 'Nieprawidłowa lub wygasła sesja.' });
    return;
  }
  const user = userData.user;

  const body = req.body || {};
  const protocolId = body.protocol_id;
  if (!protocolId) {
    res.status(400).json({ error: 'Brak protocol_id.' });
    return;
  }

  // Tylko jednorazowe zakupy pojedynczego protokołu są jednorazowego użytku.
  // Subskrypcje (kind='subscription') nigdy nie są tym zapytaniem dotykane.
  try {
    const { error } = await supabaseAdmin
      .from('entitlements')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('kind', 'protocol')
      .eq('protocol_id', protocolId)
      .eq('status', 'active');

    if (error) {
      console.error('Błąd oznaczania entitlementu jako zużyty:', error);
      res.status(500).json({ error: 'Nie udało się zaktualizować dostępu.' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Błąd consume-entitlement:', err);
    res.status(500).json({ error: 'Wewnętrzny błąd serwera.' });
  }
};
