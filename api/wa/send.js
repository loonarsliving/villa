const { sendWa } = require('../_lib/supabase');

// Internal bridge endpoint: called by the Supabase edge function (villa-api), never
// directly by the browser. Authenticated with a shared secret so nobody else can spend
// the WhaCenter quota by hitting this URL directly.
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const provided = req.headers['x-internal-secret'];
  if (!process.env.INTERNAL_BRIDGE_SECRET || provided !== process.env.INTERNAL_BRIDGE_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { phone, message, booking_id, unit_id, template_type } = req.body || {};
  if (!phone || !message) { res.status(400).json({ error: 'phone dan message wajib diisi' }); return; }

  const result = await sendWa(phone, message, { booking_id: booking_id ?? null, unit_id: unit_id ?? null, template_type: template_type ?? 'manual' });
  res.status(200).json({ success: true, result });
};
