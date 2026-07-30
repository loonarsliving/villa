const { getSupabase, sendWa } = require('../_lib/supabase');

// Cloudbeds reservation webhook. Register this exact URL (with the secret query param,
// or send it as an x-cloudbeds-secret header if Cloudbeds supports custom headers) in the
// Cloudbeds dashboard: https://<this-domain>/api/webhooks/cloudbeds?secret=<CLOUDBEDS_WEBHOOK_SECRET>
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const providedSecret = req.headers['x-cloudbeds-secret'] || req.query.secret;
  if (!process.env.CLOUDBEDS_WEBHOOK_SECRET || providedSecret !== process.env.CLOUDBEDS_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized webhook' });
    return;
  }

  const supabase = getSupabase();
  const payload = req.body || {};
  const reservationId = payload.reservationID ?? payload.reservation_id ?? payload.id ?? null;
  const roomId = payload.roomTypeID ?? payload.room_id ?? payload.roomID ?? null;
  const eventType = payload.event ?? payload.eventType ?? 'unknown';

  let mapping = null;
  if (roomId) {
    const { data } = await supabase.from('cloudbeds_room_mapping').select('unit_id,cloudbeds_room_name').eq('cloudbeds_room_id', String(roomId)).maybeSingle();
    mapping = data;
  }

  const { data: logRow } = await supabase.from('cloudbeds_events_log').insert({
    reservation_id: reservationId, event_type: eventType, payload, matched: !!mapping,
  }).select().single();

  if (!mapping) {
    res.status(200).json({ received: true, matched: false, note: 'Room Cloudbeds belum dipetakan ke unit villa. Petakan di panel admin > Cloudbeds (OTA).' });
    return;
  }

  const guestNama = payload.guestName ?? payload.guest_name ?? 'Tamu Cloudbeds';
  const guestHp = payload.guestPhone ?? payload.guest_phone ?? null;
  const checkin = payload.startDate ?? payload.checkin ?? null;
  const checkout = payload.endDate ?? payload.checkout ?? null;
  const tarif = Number(payload.total ?? payload.amount ?? 0);

  const { data: g } = await supabase.from('guests').insert({ nama: guestNama, hp: guestHp }).select('id').single();
  const guest_id = g?.id ?? null;

  const { data: booking, error: bkErr } = await supabase.from('bookings').insert({
    unit_id: mapping.unit_id, unit_nomor: mapping.cloudbeds_room_name ?? '', guest_id, guest_nama: guestNama,
    tipe: 'harian', sumber: 'cloudbeds', tgl_checkin: checkin, tgl_checkout: checkout,
    tarif, total_bayar: tarif, status: 'terjadwal', cloudbeds_reservation_id: reservationId,
  }).select().single();

  if (bkErr) {
    if (logRow?.id) await supabase.from('cloudbeds_events_log').update({ error: bkErr.message }).eq('id', logRow.id);
    res.status(500).json({ error: bkErr.message });
    return;
  }
  if (logRow?.id) await supabase.from('cloudbeds_events_log').update({ booking_id: booking.id }).eq('id', logRow.id);

  await supabase.from('notifications').insert({
    unit_id: mapping.unit_id, target_role: 'all', tipe: 'booking',
    judul: 'Booking OTA masuk', pesan: `${guestNama} via Cloudbeds — Unit ${mapping.cloudbeds_room_name ?? ''}`, ref_id: booking.id,
  });

  await sendWa(guestHp, `Halo ${guestNama}, booking Anda di Loonars Private Living sudah kami terima. Sampai jumpa!`, {
    booking_id: booking.id, unit_id: mapping.unit_id, template_type: 'booking_confirm',
  });

  res.status(200).json({ received: true, matched: true, booking_id: booking.id });
};
