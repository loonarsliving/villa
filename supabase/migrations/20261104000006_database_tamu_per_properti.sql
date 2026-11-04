-- Multi-properti: database tamu dipisah per properti (owner 2026-11-04:
-- "database tamu pisahkan").
--
-- villa_guest_directory kini SATU BARIS PER TAMU PER PROPERTI: jumlah
-- menginap, tanggal, total belanja, dan sumber pertama dihitung dari
-- booking properti itu saja. Tamu yang pernah menginap di PL dan EL muncul
-- di kedua daftar. Tamu tanpa booking tetap di PL (perilaku lama).
-- Kolom property_kode ditambahkan di AKHIR (syarat CREATE OR REPLACE VIEW);
-- villa-api menyaring view ini lewat klienProperti.
-- Untuk Private Living hasilnya sama dengan sebelumnya: semua booking saat
-- ini berproperti PL, kecuali booking EL yang baru (dihitung di daftar EL).
-- Status berhenti-langganan (villa_guest_marketing) tetap per tamu.

create or replace view public.villa_guest_directory as
select g.id as guest_id,
    g.nama,
    g.hp,
    g.email,
    count(b.id) filter (where b.status = any (array['terjadwal'::text, 'checkin'::text, 'checkout'::text])) as jumlah_menginap,
    min(b.tgl_checkin) filter (where b.status = any (array['terjadwal'::text, 'checkin'::text, 'checkout'::text])) as pertama_menginap,
    max(b.tgl_checkin) filter (where b.status = any (array['terjadwal'::text, 'checkin'::text, 'checkout'::text])) as terakhir_menginap,
    coalesce(sum(coalesce(b.total_bayar, b.tarif, 0::numeric)) filter (where b.status = any (array['terjadwal'::text, 'checkin'::text, 'checkout'::text])), 0::numeric) as total_belanja,
    (array_agg(b.sumber order by b.created_at))[1] as sumber_pertama,
    coalesce(m.wa_opt_out, false) as wa_opt_out,
    coalesce(m.email_opt_out, false) as email_opt_out,
    m.terakhir_dikirimi_promo,
    m.catatan,
    coalesce(b.property_kode, 'PL'::text) as property_kode
   from guests g
     left join bookings b on b.guest_id = g.id
     left join villa_guest_marketing m on m.guest_id = g.id
  group by g.id, g.nama, g.hp, g.email, m.wa_opt_out, m.email_opt_out, m.terakhir_dikirimi_promo, m.catatan, coalesce(b.property_kode, 'PL'::text);
