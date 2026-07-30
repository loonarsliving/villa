const { createClient } = require('@supabase/supabase-js');

let client;
function getSupabase() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return client;
}

function normalizePhone(p) {
  let d = (p || '').replace(/[^0-9]/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  if (!d.startsWith('62')) d = '62' + d;
  return d;
}

// Sends a WhatsApp message via WhaCenter using credentials from Vercel env vars,
// and always logs the attempt to wa_messages_log regardless of outcome.
async function sendWa(phone, message, meta) {
  const supabase = getSupabase();
  if (!phone) {
    await supabase.from('wa_messages_log').insert({ ...meta, phone: null, message, status: 'skipped_no_phone' });
    return { skipped: true, reason: 'no_phone' };
  }
  const apiKey = process.env.WHACENTER_API_KEY;
  const deviceId = process.env.WHACENTER_DEVICE_ID;
  if (!apiKey || !deviceId) {
    await supabase.from('wa_messages_log').insert({ ...meta, phone, message, status: 'skipped_not_configured' });
    return { skipped: true, reason: 'not_configured' };
  }
  const base = process.env.WHACENTER_BASE_URL || 'https://api.whacenter.com/api/send';
  try {
    const body = new URLSearchParams({ device_id: deviceId, api_key: apiKey, number: normalizePhone(phone), message });
    const res = await fetch(base, { method: 'POST', body });
    const text = await res.text();
    let respJson; try { respJson = JSON.parse(text); } catch { respJson = { raw: text }; }
    await supabase.from('wa_messages_log').insert({ ...meta, phone, message, status: res.ok ? 'sent' : 'failed', response: respJson });
    return { ok: res.ok, response: respJson };
  } catch (e) {
    await supabase.from('wa_messages_log').insert({ ...meta, phone, message, status: 'error', response: { error: String(e) } });
    return { ok: false, error: String(e) };
  }
}

module.exports = { getSupabase, sendWa, normalizePhone };
