import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { timingSafeEqual } from 'node:crypto';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// npm:imapflow (dipakai oleh scanPaymentInbox, lihat komentar di sana) punya
// race condition di librarynya sendiri: greeting handler-nya (beginSession)
// memanggil startSession()/authenticate() lewat then().catch() yang "keluar
// dari thread parsing saat ini" tanpa di-await, dan di Supabase Edge Runtime
// continuation itu kadang baru resume SETELAH client sudah ditutup (state
// LOGOUT) -- baik oleh kode kita sendiri maupun oleh isolate yang dibekukan
// lalu dipakai ulang untuk request lain. Hasilnya "Already logged out"
// muncul sebagai unhandled rejection di luar try/catch manapun di kode kita,
// dan Deno menjatuhkan RESPONS REQUEST LAIN yang kebetulan sedang berjalan
// di isolate yang sama dengan 503 -- padahal request itu sendiri tidak
// salah apa-apa. client.close() + client.on('error') (lihat scanPaymentInbox)
// mengurangi kemungkinannya tapi terbukti dari log production TIDAK
// menghilangkannya sepenuhnya. Ini jaring pengaman terakhir: menelan HANYA
// unhandled rejection dengan pesan persis ini, supaya request lain yang
// tidak berhubungan tidak ikut ditumbangkan olehnya. Error asli lain di
// aplikasi ini TETAP muncul sebagai unhandled rejection seperti biasa.
globalThis.addEventListener('unhandledrejection', (event)=>{
  const msg = String(event.reason?.message ?? event.reason ?? '');
  if(msg.includes('Already logged out')){
    event.preventDefault();
  }
});

const SESSION_SECRET = Deno.env.get('VILLA_SESSION_SECRET') ?? '';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const CLOUDBEDS_API_BASE = 'https://api.cloudbeds.com/api/v1.2';
function cloudbedsApiKey(){ return (Deno.env.get('CLOUDBEDS_API_KEY') ?? '').trim(); }

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-villa-token,x-cloudbeds-secret,x-cron-secret,x-internal-secret','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS' };

function json(d, s=200){ return new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}}); }
function err(m, s=400){ return json({error:m},s); }

function b64url(bytes){
  let s=''; for(const b of bytes) s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlToBytes(str){
  const s = str.replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
async function hmac(data){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SESSION_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function makeToken(payload){
  const full = {...payload, iat: Date.now(), exp: Date.now()+SESSION_TTL_MS};
  const body = b64url(new TextEncoder().encode(JSON.stringify(full)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}

async function verifyToken(token){
  const parts = token.split('.');
  if(parts.length!==2) return null;
  const [body,sig] = parts;
  const expected = await hmac(body);
  const expectedBytes = new TextEncoder().encode(expected);
  const sigBytes = new TextEncoder().encode(sig);
  if(expectedBytes.length !== sigBytes.length) return null;
  if(!timingSafeEqual(expectedBytes, sigBytes)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if(!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

async function requireAuth(req){
  const token = req.headers.get('x-villa-token');
  if(!token) return null;
  const payload = await verifyToken(token);
  if(!payload) return null;
  const {data:u} = await supabase.from('villa_users')
    .select('role,is_active,unit_id,unit_nomor')
    .eq('id', payload.uid)
    .maybeSingle();
  if(!u || !u.is_active) return null;
  return {...payload, role:u.role, unit_id:u.unit_id, unit_nomor:u.unit_nomor};
}
function forbidden(){ return err('Forbidden untuk role ini',403); }

async function sha256hex(s){
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function secretsMatch(provided, expected){
  if(!provided || !expected) return false;
  return (await sha256hex(provided.trim())) === (await sha256hex(expected.trim()));
}

async function getSetting(key){
  const {data} = await supabase.from('integration_settings').select('value').eq('key',key).maybeSingle();
  return (data?.value) ?? {};
}
function redact(value){
  const out = {...value};
  for(const k of Object.keys(out)){
    if(/key|secret|token/i.test(k) && typeof out[k]==='string' && out[k].length>4){
      out[k] = out[k].slice(0,2)+'••••'+out[k].slice(-2);
    }
  }
  return out;
}

// Kode konfirmasi pembayaran yang dibalas owner lewat WhatsApp
// (permintaan owner 2026-09-12: tamu tidak perlu upload bukti transfer lagi
// -- owner yang melihat notifikasi QRIS masuk di HP-nya, lalu membalas WA,
// dan sistem yang mengunci unitnya).
//
// Diturunkan dari booking_id, BUKAN disimpan di kolom baru: tidak perlu
// perubahan skema, dan kodenya selalu bisa dihitung ulang dari booking mana
// pun. Diambil dari EKOR uuid supaya tidak bentrok dengan voucher tamu di
// situs publik, yang memakai 6 karakter pertama.
//
// Balasan bebas seperti "sudah masuk" sengaja TIDAK didukung: kalau ada dua
// tamu menunggu pembayaran bersamaan -- hal biasa di akhir pekan -- sistem
// tidak punya cara tahu yang mana, dan salah tebak berarti mengunci unit
// yang salah sekaligus menandai tamu yang salah sudah lunas.
function paymentCode(bookingId){
  return bookingId.replace(/-/g,'').slice(-6).toUpperCase();
}

/**
 * Kode unik pembayaran: angka 3 digit (100-999) yang ditambahkan ke total
 * tagihan booking website, supaya nominalnya tidak pernah sama persis
 * dengan booking lain yang juga sedang menunggu pembayaran. QRIS BTN yang
 * dipakai statis -- tidak ada ID transaksi per pemesanan di notifikasi
 * emailnya -- jadi nominal itu SATU-SATUNYA hal yang bisa dipakai
 * /cron/check-payment-email untuk mencocokkan email masuk ke booking yang
 * benar. Diperiksa dulu ke seluruh booking 'menunggu_pembayaran' yang
 * masih hidup supaya tidak bentrok; kalau 20x coba masih bentrok (praktis
 * mustahil untuk villa sekecil ini), tetap dipakai apa adanya daripada
 * menggagalkan booking -- kalau sampai bentrok, cron akan menemukan lebih
 * dari satu kandidat dan membiarkan owner mengonfirmasi manual lewat
 * WhatsApp seperti biasa, bukan mengonfirmasi booking yang salah.
 */
async function generateKodeUnikPembayaran(){
  const {data:pending} = await supabase.from('bookings')
    .select('total_bayar').eq('sumber','website').eq('status','menunggu_pembayaran');
  const dipakai = new Set((pending??[]).map(b=>Number(b.total_bayar)%1000));
  for(let coba=0; coba<20; coba++){
    const kandidat = 100 + Math.floor(Math.random()*900);
    if(!dipakai.has(kandidat)) return kandidat;
  }
  return 100 + Math.floor(Math.random()*900);
}

/**
 * Mencocokkan satu nominal (dibaca dari email notifikasi BTN QRIS) ke
 * booking website yang sedang menunggu pembayaran, dan mengunci booking itu
 * kalau cocok. Dipakai oleh scanPaymentInbox untuk dua mode:
 * - onlyBookingId kosong (cron latar belakang): mencocokkan ke SEMUA
 *   booking pending -- kalau nominalnya cocok ke lebih dari satu sekaligus,
 *   tidak ada yang dikonfirmasi (lihat komentar ambigu di bawah).
 * - onlyBookingId diisi (dipicu tamu dari halaman booking): dibatasi ke
 *   booking itu saja, jadi tidak pernah ambigu.
 */
async function tryConfirmBookingByNominal(nominal, onlyBookingId){
  let q = supabase.from('bookings')
    // Kolom sama persis dengan SELECT_COLS di /bridge/confirm-payment --
    // cloudbeds_reservation_id WAJIB ikut supaya pushBookingToCloudbeds di
    // bawah tahu booking ini sudah pernah didorong (kalau ada) dan tidak
    // membuat reservasi Cloudbeds kedua untuk booking yang sama.
    .select('id,unit_id,unit_nomor,guest_id,guest_nama,tgl_checkin,tgl_checkout,total_bayar,created_at,invoice_no,cloudbeds_reservation_id,adults,children')
    .eq('sumber','website').eq('status','menunggu_pembayaran').eq('total_bayar', nominal);
  if(onlyBookingId) q = q.eq('id', onlyBookingId);
  const {data:pendingSama} = await q;
  if(!pendingSama?.length) return {matched:false};

  if(!onlyBookingId && pendingSama.length > 1){
    await notif(null, 'all', 'transfer', 'Email pembayaran ambigu -- perlu konfirmasi manual',
      `Email BTN QRIS Rp ${Math.round(nominal).toLocaleString('id-ID')} cocok dengan ${pendingSama.length} booking yang menunggu pembayaran sekaligus -- sistem tidak mengonfirmasi otomatis supaya tidak salah kunci unit. Mohon cek dan balas LUNAS <kode> secara manual untuk booking yang benar.`, null);
    return {ambigu:true, nominal, jumlah_booking: pendingSama.length};
  }

  const booking = pendingSama[0];
  const invoice_no = booking.invoice_no ?? invoiceNoFor(booking);
  const {error:lockErr} = await supabase.from('bookings')
    .update({status:'terjadwal', bukti_pembayaran_at:new Date().toISOString(), invoice_no})
    .eq('id', booking.id).eq('status','menunggu_pembayaran');

  if(lockErr){
    if(lockErr.code !== '23P01') return {matched:false};
    // Unit keburu dikunci booking lain untuk tanggal yang sama. Tamu sudah
    // membayar, jadi pembayarannya tetap dicatat dan invoice tetap terbit
    // -- yang tidak dilakukan hanyalah memaksa unitnya masuk kalender.
    await supabase.from('bookings').update({bukti_pembayaran_at:new Date().toISOString(), invoice_no}).eq('id', booking.id);
    await notif(null, 'all', 'transfer', 'KONFLIK UNIT -- Booking Website perlu dijadwalkan ulang',
      `Booking ${String(booking.id).slice(0,8)} (Unit ${booking.unit_nomor}, ${booking.tgl_checkin} s/d ${booking.tgl_checkout}) terkonfirmasi lunas otomatis via email tapi unit sudah terisi booking lain -- mohon segera hubungi tamu untuk reschedule/unit pengganti.`, booking.id);
    return {matched:false};
  }

  await notif(null, 'all', 'transfer', `Pembayaran dikonfirmasi otomatis -- Unit ${booking.unit_nomor} terkunci`,
    `Booking ${String(booking.id).slice(0,8)} (${booking.tgl_checkin} s/d ${booking.tgl_checkout}) dikonfirmasi lunas otomatis dari email BTN QRIS (Rp ${Math.round(nominal).toLocaleString('id-ID')}), unit sudah masuk kalender.`, booking.id);
  await pushBookingToCloudbeds({...booking, status:'terjadwal'});
  return {matched:true, booking_id:booking.id, unit_nomor:booking.unit_nomor, nominal};
}

/**
 * Login IMAP sekali dan memeriksa email BTN QRIS yang belum dibaca.
 * onlyBookingId (opsional) membatasi pencocokan ke satu booking saja --
 * dipakai oleh pemicu dari halaman tamu (POST /public/bookings/check-payment)
 * supaya satu tamu tidak bisa memicu konfirmasi booking orang lain, dan
 * supaya email yang TIDAK cocok ke booking itu sengaja TIDAK ditandai
 * dibaca (dibiarkan untuk cron latar belakang atau tamu lain yang nominalnya
 * kebetulan sama).
 */
async function scanPaymentInbox(cfg, {onlyBookingId} = {}){
  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = await import('npm:imapflow@^1.0.0'));
    ({ simpleParser } = await import('npm:mailparser@^3.6.0'));
  } catch(e){
    return {diperiksa:0, dikonfirmasi:[], ambigu:[], gagal:`Gagal memuat library IMAP: ${String(e?.message ?? e)}`};
  }

  const client = new ImapFlow({
    host: cfg.host, port: Number(cfg.port ?? 993), secure: cfg.secure !== false,
    auth: { user: cfg.user, pass: cfg.password }, logger: false,
  });
  // Supabase Edge Runtime bisa membekukan lalu memakai ulang isolate yang
  // sama untuk request lain (terlihat dari "booted"/"shutdown" yang
  // berselang-seling di log). Kalau ImapFlow masih punya timer latar
  // belakang (keepalive/IDLE) yang menyala saat isolate itu dibekukan,
  // timer itu bisa menembak ULANG setelah dibangunkan untuk request LAIN
  // yang tidak ada hubungannya -- muncul sebagai "event loop error: Error:
  // Already logged out" yang bikin request itu gagal dengan 503, padahal
  // request itu sendiri tidak melakukan apa-apa yang salah. Listener ini
  // menelan error semacam itu supaya tidak merembet ke request lain.
  client.on('error', ()=>{});

  let diperiksa = 0;
  const dikonfirmasi = [];
  const ambigu = [];
  let gagal = null;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const subjectFilter = cfg.subject_contains ?? 'Payment Merchant Success';
      const uids = await client.search({seen:false, subject:subjectFilter}, {uid:true});
      for(const uid of (uids ?? [])){
        diperiksa++;
        const msg = await client.fetchOne(uid, {source:true}, {uid:true});
        if(!msg?.source) continue;
        let bodyText = '';
        try {
          const parsed = await simpleParser(msg.source);
          bodyText = parsed.text ?? parsed.html ?? '';
        } catch { continue; }

        const cocok = bodyText.match(/Total\s*:?\s*Rp\.?\s*([\d.,]+)/i);
        if(!cocok){
          // Format tidak dikenali -- tandai dibaca supaya tidak diulang
          // terus, baik oleh cron penuh maupun pengecekan per-booking.
          await client.messageFlagsAdd(uid, ['\\Seen'], {uid:true});
          continue;
        }
        const nominal = Number(cocok[1].replace(/[.,]/g,''));
        if(!Number.isFinite(nominal) || nominal<=0){
          await client.messageFlagsAdd(uid, ['\\Seen'], {uid:true});
          continue;
        }

        const hasil = await tryConfirmBookingByNominal(nominal, onlyBookingId);
        if(onlyBookingId){
          // Hanya tandai dibaca kalau memang cocok ke booking ini -- kalau
          // tidak, jangan disentuh (lihat komentar di atas fungsi ini).
          if(hasil.matched) await client.messageFlagsAdd(uid, ['\\Seen'], {uid:true});
        } else {
          await client.messageFlagsAdd(uid, ['\\Seen'], {uid:true});
        }
        if(hasil.ambigu) ambigu.push(hasil);
        else if(hasil.matched) dikonfirmasi.push(hasil);
      }
    } finally {
      lock.release();
    }
  } catch(e){
    // e.reason (kalau ada) adalah BYE reason dari server IMAP -- misalnya
    // "Too many connections" -- yang jauh lebih berguna untuk diagnosis
    // daripada pesan generik "Unexpected close" saja.
    const detail = [e?.code, e?.reason].filter(Boolean).join(': ');
    gagal = detail ? `${String(e?.message ?? e)} (${detail})` : String(e?.message ?? e);
  } finally {
    // client.close() (bukan logout()) supaya socket-nya langsung
    // dihancurkan alih-alih menunggu handshake LOGOUT -- itulah yang
    // meninggalkan timer latar belakang menyala setelah fungsi ini selesai
    // (lihat komentar di atas client.on('error', ...)).
    try { client.close(); } catch {}
  }

  return {diperiksa, dikonfirmasi, ambigu, gagal};
}

/**
 * Berapa lama sebuah booking website yang belum dibayar boleh ditahan
 * (instruksi owner 2026-09-12: "harusnya stlah 1 jam pesanan langsung
 * dibatalkan").
 *
 * Sebelum ini angka 60 menit hanya ada sebagai aturan TAMPILAN di kalender
 * front-desk: booking yang lewat 1 jam berhenti digambar, tapi barisnya
 * tetap 'menunggu_pembayaran' selamanya dan halaman tamu tetap menampilkan
 * QRIS seolah unitnya masih ditahan. Sekarang pembatalannya nyata.
 */
const PENDING_PAYMENT_HOLD_MINUTES = 60;

/**
 * Penanda di kolom catatan untuk booking yang dibatalkan oleh mesin, bukan
 * oleh manusia. Dipakai dua arah: supaya staf tahu kenapa sebuah booking
 * jadi 'batal', dan supaya konfirmasi "LUNAS" yang datang terlambat masih
 * bisa menghidupkannya kembali -- tanpa penanda ini, pembatalan otomatis
 * akan menelan pembayaran tamu yang sudah masuk tepat sebelum batas waktu.
 */
const EXPIRED_HOLD_MARK = '[Kedaluwarsa otomatis]';

/**
 * Tanggal dan bulan BISNIS villa selalu mengikuti kalender WIB
 * (Asia/Jakarta), bukan UTC.
 *
 * Edge Function ini berjalan di UTC, jadi `new Date().toISOString()` menjawab
 * tanggal/bulan KEMARIN selama pukul 00:00-07:00 WIB. Yang terkena bukan hal
 * sepele: default periode `/report` dan `/admin/overview` (laporan bagi hasil
 * investor), `/summary` dan `/housekeeping` (tugas "hari ini" resepsionis),
 * masa berlaku voucher menginap investor, dan tanggal berlakunya promo.
 *
 * en-CA dipakai karena satu-satunya locale umum yang memformat tanggal persis
 * sebagai YYYY-MM-DD, sehingga hasilnya bisa langsung dibandingkan sebagai
 * string dengan kolom tanggal di database.
 *
 * Ini HANYA untuk "hari ini"/"bulan ini". Kolom timestamptz (paid_at,
 * sent_at, dsb.) tetap ditulis sebagai new Date().toISOString() -- menyimpan
 * titik waktu absolut memang benar, dan frontend sudah menampilkannya dalam
 * WIB.
 */
const WIB_TZ = 'Asia/Jakarta';
function todayWIB(d = new Date()){ return d.toLocaleDateString('en-CA', {timeZone: WIB_TZ}); }
function monthWIB(d = new Date()){ return todayWIB(d).slice(0,7); }
function prevMonthWIB(d = new Date()){
  const [y, mo] = monthWIB(d).split('-').map(Number);
  const total = y*12 + (mo-1) - 1;
  return `${Math.floor(total/12)}-${String((total%12)+1).padStart(2,'0')}`;
}

// Nomor invoice dihitung sekali lalu DISIMPAN di bookings.invoice_no, jadi
// memindahkan turunannya ke WIB tidak pernah menomori ulang invoice yang
// sudah terbit -- hanya yang baru.
function invoiceNoFor(booking){
  const ymd = todayWIB(new Date(booking.created_at)).replace(/-/g,'');
  return `INV-LV-${ymd}-${String(booking.id).slice(0,8).toUpperCase()}`;
}

async function notif(unit_id, role, tipe, judul, pesan, ref_id){
  await supabase.from('notifications').insert({unit_id:unit_id??null,target_role:role,tipe,judul,pesan,ref_id:ref_id??null});
}

async function getVercelBridge(){
  return await getSetting('vercel_bridge');
}

async function pushBookingToCloudbeds(booking){
  const apiKey = cloudbedsApiKey();
  if(!apiKey) return;

  // Never push the same booking twice. postReservation is not idempotent:
  // a second call creates a SECOND reservation in Cloudbeds for the same
  // stay, which then blocks the room twice and shows up as a phantom
  // guest. Any booking that already carries a cloudbeds_reservation_id
  // either came FROM Cloudbeds or has already been pushed, so both cases
  // stop here. This is what makes the retry sweep below safe to run every
  // ten minutes.
  if(booking.cloudbeds_reservation_id) return;

  const logOutbound = async (matched, extra) => {
    await supabase.from('cloudbeds_events_log').insert({
      reservation_id: booking.cloudbeds_reservation_id ?? null,
      event_type: 'outbound.reservation.created',
      payload: {booking_id: booking.id, unit_id: booking.unit_id, ...extra},
      matched,
      error: extra?.error ?? null,
    });
  };

  try {
    const {data: mapping} = await supabase.from('cloudbeds_room_mapping')
      .select('cloudbeds_room_id').eq('unit_id', booking.unit_id).maybeSingle();
    if(!mapping?.cloudbeds_room_id){
      await logOutbound(false, {error: 'no_cloudbeds_mapping_for_unit'});
      return;
    }

    const roomsRes = await fetch(`${CLOUDBEDS_API_BASE}/getRooms`, {headers: {'x-api-key': apiKey}});
    const roomsBody = await roomsRes.json().catch(()=>null);
    if(!roomsRes.ok || roomsBody?.success === false){
      await logOutbound(false, {error: `getRooms_failed: ${roomsBody?.message ?? roomsRes.status}`});
      return;
    }
    let roomTypeID = null;
    for(const entry of (roomsBody?.data ?? [])){
      const candidates = Array.isArray(entry.rooms) ? entry.rooms : [entry];
      for(const r of candidates){
        if(String(r.roomID) === String(mapping.cloudbeds_room_id)){ roomTypeID = entry.roomTypeID ?? r.roomTypeID ?? null; break; }
      }
      if(roomTypeID) break;
    }
    if(!roomTypeID){
      await logOutbound(false, {error: 'cloudbeds_room_id_not_found_in_live_getRooms'});
      return;
    }

    let sourceSetting = await getSetting('cloudbeds_outbound');
    let sourceID = sourceSetting?.source_id ?? null;
    let sourceNames = null; // raw getSources diagnostics, only read on failure
    if(!sourceID){
      // The OpenAPI spec calls isThirdParty and status booleans, but this
      // API is known to send booleans and numbers as STRINGS -- that exact
      // assumption silently emptied the whole rate mirror once already
      // ("rate":"650000.00" failing a typeof === 'number' check). A strict
      // `=== false` here matches nothing when Cloudbeds sends "0", and the
      // push then fails with a message blaming missing configuration.
      const falsy = v => v === false || v === 0 || v === '0' || v === 'false';
      const truthy = v => v === true || v === 1 || v === '1' || v === 'true';

      const sourcesUrl = new URL(`${CLOUDBEDS_API_BASE}/getSources`);
      const propertyId = (Deno.env.get('CLOUDBEDS_PROPERTY_ID') ?? '').trim();
      if(propertyId) sourcesUrl.searchParams.set('propertyID', propertyId);
      const sourcesRes = await fetch(sourcesUrl, {headers: {'x-api-key': apiKey}});
      const sourcesBody = await sourcesRes.json().catch(()=>null);
      let rows = Array.isArray(sourcesBody?.data) ? sourcesBody.data : (sourcesBody?.data ? [sourcesBody.data] : []);
      // getSources nests one level: data is [[source, source, ...]], one
      // inner array per property -- the same per-property nesting getRooms
      // uses above. Without flattening, that single inner ARRAY is treated
      // as one source, isThirdParty reads undefined on it, nothing matches,
      // and the push fails claiming no direct source is configured. Proven
      // from the logged raw response, which begins "[[{" with row_count 1.
      if(rows.length && Array.isArray(rows[0])) rows = rows.flat();

      // Preferred: an active, non-third-party source -- that is the
      // property's own direct/website booking source. Then progressively
      // looser fallbacks, so a bookable source is found even if Cloudbeds
      // words these fields differently than expected.
      // "Website/Booking Engine" is the property's own direct channel and
      // the right home for a loonars.id booking: naming it keeps these
      // reservations distinguishable from Walk-In and Phone in Cloudbeds'
      // own source reporting, instead of taking whichever happens to come
      // first.
      const direct = rows.find(x => /website|booking\s*engine/i.test(String(x.sourceName ?? '')) && falsy(x.isThirdParty) && truthy(x.status))
        ?? rows.find(x => falsy(x.isThirdParty) && truthy(x.status))
        ?? rows.find(x => falsy(x.isThirdParty))
        ?? rows.find(x => truthy(x.status) && /website|direct|walk|phone|front\s*desk/i.test(String(x.sourceName ?? '')));
      sourceID = direct?.sourceID ?? null;

      // Log the RAW response, not a projection of it. The first version
      // mapped each row to {id, name, isThirdParty, status}; when those
      // keys were absent every row serialised to a bare {} and the log
      // could not distinguish "Cloudbeds returned nothing" from
      // "Cloudbeds returned rows whose fields are named differently" --
      // which were exactly the two possibilities worth telling apart.
      sourceNames = {
        http_status: sourcesRes.status,
        success: sourcesBody?.success ?? null,
        message: sourcesBody?.message ?? null,
        body_keys: sourcesBody && typeof sourcesBody === 'object' ? Object.keys(sourcesBody) : null,
        data_type: Array.isArray(sourcesBody?.data) ? 'array' : typeof sourcesBody?.data,
        row_count: rows.length,
        raw_rows: JSON.stringify(rows).slice(0, 1500),
      };
    }
    if(!sourceID){
      await logOutbound(false, {
        error: 'no_direct_source_id_resolved -- set integration_settings.cloudbeds_outbound.source_id manually',
        getsources_raw: sourceNames,
      });
      return;
    }

    // Cloudbeds mewajibkan guestEmail. Sejak 2026-09-12 form loonars.id
    // menanyakannya, jadi yang dikirim adalah alamat tamu yang sebenarnya.
    //
    // Alamat sintetis tetap disimpan sebagai CADANGAN, bukan warisan yang
    // lupa dibuang: booking yang dibuat staf di front desk dan reservasi
    // lama dari sebelum form ini tidak punya email, dan tanpa cadangan itu
    // Cloudbeds akan menolak seluruh push dengan "Invalid Parameters" yang
    // tidak menyebut field-nya. Ia tidak pernah dikirimi surat --
    // sendEmailConfirmation 'false' di bawah -- dan berada di subdomain
    // milik owner sendiri, bukan alamat yang bisa sampai ke orang asing.
    let guestHp = null;
    let guestEmailReal = null;
    if(booking.guest_id){
      const {data:g} = await supabase.from('guests').select('hp,email').eq('id', booking.guest_id).maybeSingle();
      guestHp = g?.hp ?? null;
      guestEmailReal = String(g?.email ?? '').trim() || null;
    }
    const guestEmail = guestEmailReal ?? `booking-${String(booking.id).slice(0,8)}@guest.loonars.id`;

    // Jumlah tamu diambil dari booking-nya, bukan dipatok 1/0 seperti
    // sebelumnya. Kolom adults/children punya default 1/0 di database, jadi
    // baris lama dan booking staf tetap berperilaku seperti dulu.
    const adultsQty = Math.max(1, Math.trunc(Number(booking.adults ?? 1)) || 1);
    const childrenQty = Math.max(0, Math.trunc(Number(booking.children ?? 0)) || 0);

    const nama = (booking.guest_nama ?? 'Tamu Villa').trim();
    const spaceIdx = nama.indexOf(' ');
    const guestFirstName = spaceIdx === -1 ? nama : nama.slice(0, spaceIdx);
    const guestLastName = spaceIdx === -1 ? nama : nama.slice(spaceIdx + 1);
    const guestCountry = sourceSetting?.guest_country_default ?? 'ID';

    // "Invalid Parameters" names no field, so guessing one change per
    // deploy is the slow way to find it. Instead: build the base payload,
    // then try a short ordered list of variants in ONE call, logging what
    // Cloudbeds says to each and stopping at the first that works. Same
    // approach that settled putRate's undocumented interval contract.
    //
    // Only one reservation can ever be created, because the loop breaks on
    // the first success.
    const baseForm = () => {
      const f = new URLSearchParams();
      f.set('sourceID', sourceID);
      f.set('startDate', booking.tgl_checkin);
      f.set('endDate', booking.tgl_checkout ?? booking.tgl_checkin);
      f.set('guestFirstName', guestFirstName);
      f.set('guestLastName', guestLastName || guestFirstName);
      f.set('guestCountry', guestCountry);
      f.set('guestZip', String(sourceSetting?.guest_zip_default ?? '55581'));
      f.set('guestEmail', guestEmail);
      if(guestHp) f.set('guestPhone', guestHp);
      f.set('rooms[0][roomTypeID]', String(roomTypeID));
      f.set('rooms[0][quantity]', '1');
      f.set('adults[0][roomTypeID]', String(roomTypeID));
      f.set('adults[0][quantity]', String(adultsQty));
      f.set('children[0][roomTypeID]', String(roomTypeID));
      f.set('children[0][quantity]', String(childrenQty));
      f.set('paymentMethod', 'cash');
      f.set('sendEmailConfirmation', 'false');
      return f;
    };

    // Order settled by the 2026-09-12 probe against this property, logged
    // in cloudbeds_events_log: roomID was rejected with "Invalid
    // Parameters" both with and without thirdPartyIdentifier, and room
    // type alone was accepted (reservation 5TY684XCEB). Pinning an
    // individual room needs that feature enabled in MyBookings settings;
    // without it Cloudbeds rejects the parameter rather than ignoring it.
    //
    // The known-good shape therefore goes FIRST, so an ordinary push costs
    // one API call rather than three failures and a success. The rejected
    // shapes stay as fallbacks: if MyBookings is switched on later, the
    // first variant starts working and the reservation lands on the exact
    // room instead of one Cloudbeds picks within the type.
    const variants = [
      {name: 'room_type_only', build: () => baseForm()},
      // Retried only if the above ever fails. Both were rejected in the
      // probe; kept because the reason is a property setting, not the
      // payload, and that setting can change.
      {name: 'with_roomID_only', build: () => {
        const f = baseForm();
        f.set('rooms[0][roomID]', String(mapping.cloudbeds_room_id));
        return f;
      }},
      {name: 'with_roomID_and_thirdPartyIdentifier', build: () => {
        const f = baseForm();
        f.set('rooms[0][roomID]', String(mapping.cloudbeds_room_id));
        f.set('thirdPartyIdentifier', String(booking.id));
        return f;
      }},
      // Last resort: some deployments reject a zero-quantity children row.
      {name: 'room_type_only_no_children_row', build: () => {
        const f = baseForm();
        f.delete('children[0][roomTypeID]');
        f.delete('children[0][quantity]');
        f.set('children', '');
        return f;
      }},
      // Jaring terakhir untuk risiko yang dibawa oleh pengiriman jumlah tamu
      // yang sebenarnya (2026-09-12). Sebelumnya angkanya selalu 1 dewasa 0
      // anak, jadi selalu diterima; sekarang tamu bisa memilih 8 dewasa,
      // dan kalau itu melebihi kapasitas tipe kamar di Cloudbeds,
      // "Invalid Parameters" akan membuat SELURUH push gagal -- kamarnya
      // tidak terblokir dan tetap dijual di semua OTA. Itu kerugian yang
      // jauh lebih besar daripada jumlah tamu yang kurang tepat, jadi
      // percobaan pamungkas ini mundur ke 1/0 supaya kamarnya tetap
      // terblokir. Tercatat di cloudbeds_events_log sebagai varian yang
      // dipakai, jadi selisihnya bisa dilihat, bukan disembunyikan.
      {name: 'room_type_only_occupancy_fallback_1_0', build: () => {
        const f = baseForm();
        f.set('adults[0][quantity]', '1');
        f.set('children[0][quantity]', '0');
        return f;
      }},
    ];

    let body = null;
    const attempts = [];
    for(const variant of variants){
      const res = await fetch(`${CLOUDBEDS_API_BASE}/postReservation`, {
        method: 'POST',
        headers: {'x-api-key': apiKey, 'Content-Type': 'application/x-www-form-urlencoded'},
        body: variant.build().toString(),
      });
      const attemptBody = await res.json().catch(()=>null);
      attempts.push({variant: variant.name, http: res.status, success: attemptBody?.success ?? null, message: attemptBody?.message ?? null});
      if(res.ok && attemptBody?.success !== false && attemptBody?.reservationID){
        body = attemptBody;
        break;
      }
    }

    if(!body){
      await logOutbound(false, {error: 'postReservation_failed_all_variants', attempts});
      return;
    }
    // Recorded on success too: knowing WHICH shape Cloudbeds accepts is
    // the whole point of having probed, and it is the first thing anyone
    // debugging this next will want.
    await logOutbound(true, {accepted_variant: attempts[attempts.length - 1]?.variant, attempts});

    await supabase.from('bookings').update({cloudbeds_reservation_id: body.reservationID}).eq('id', booking.id);
    await logOutbound(true, {cloudbeds_reservation_id: body.reservationID});
  } catch(e) {
    await logOutbound(false, {error: e instanceof Error ? e.message : String(e)});
  }
}

/**
 * Mengirim WhatsApp lewat jembatan Mkhsistem, dan MELAPORKAN hasilnya.
 *
 * Dulu fungsi ini tidak mengembalikan apa pun, sehingga pemanggilnya tidak
 * punya cara membedakan pesan yang terkirim dari yang gagal -- dan pada
 * 2026-09-12 itu membuat villa_promo_sends mencatat 'terkirim' untuk pesan
 * yang belum tentu sampai. Sekarang ia mengembalikan true hanya kalau
 * jembatan benar-benar menjawab sukses.
 *
 * meta disaring ke kolom yang memang ada di wa_messages_log. Ini bukan
 * kerapian: satu kunci asing di objek meta membuat SELURUH insert log gagal
 * diam-diam (PostgREST menolak kolom yang tidak dikenal), dan pesan yang
 * tidak tercatat tidak bisa dibedakan dari pesan yang tidak pernah dikirim.
 * Persis itu yang terjadi saat 'promo_batch_id' ikut dikirim ke sini.
 */
async function sendWa(phone, message, meta){
  const KOLOM_LOG = ['booking_id','unit_id','template_type'];
  const metaAman = {};
  for(const k of KOLOM_LOG){ if(meta && meta[k] !== undefined) metaAman[k] = meta[k]; }

  const catat = async (row) => {
    const {error} = await supabase.from('wa_messages_log').insert(row);
    if(error) console.error('[sendWa] gagal mencatat log WA', error.message);
  };

  if(!phone){
    await catat({...metaAman, phone:null, message, status:'skipped_no_phone'});
    return false;
  }
  const bridge = await getVercelBridge();
  if(!bridge.base_url || !bridge.secret){
    await catat({...metaAman, phone, message, status:'skipped_not_configured'});
    return false;
  }
  try {
    const r = await fetch(`${bridge.base_url.replace(/\/+$/,'')}/api/wa/send`, {
      method:'POST',
      headers:{'Content-Type':'application/json','x-internal-secret':bridge.secret},
      body: JSON.stringify({phone, message, ...metaAman}),
    });
    const result = await r.json().catch(()=>null);
    const berhasil = r.ok && result?.success === true;
    await catat({
      ...metaAman, phone, message,
      status: berhasil ? 'sent' : 'failed',
      response: result ?? {http_status:r.status},
    });
    return berhasil;
  } catch(e){
    await catat({...metaAman, phone, message, status:'error', response:{error:String(e)}});
    return false;
  }
}

function datesOverlap(in1, out1, in2, out2){
  const start1 = new Date(in1), end1 = out1 ? new Date(out1) : null;
  const start2 = new Date(in2), end2 = out2 ? new Date(out2) : null;
  const start1BeforeEnd2 = !end2 || start1 < end2;
  const start2BeforeEnd1 = !end1 || start2 < end1;
  return start1BeforeEnd2 && start2BeforeEnd1;
}
function findConflicts(bookings, checkin, checkout){
  const map = new Map();
  for(const bk of bookings){
    if(bk.unit_id && !map.has(bk.unit_id) && datesOverlap(bk.tgl_checkin, bk.tgl_checkout, checkin, checkout)){
      map.set(bk.unit_id, bk.guest_nama);
    }
  }
  return map;
}

function isValidDateStr(s){
  if(typeof s !== 'string') return false;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

// Shared pricing logic for a 'harian' stay: per-night villa_rates override
// when planned, falling back to the unit's flat tarif_harian otherwise. Used
// by both the actual booking commit (POST /public/bookings) and the public
// price preview (GET /public/availability), so the quote a guest sees before
// booking always matches what they'll actually be charged.
/**
 * Voucher menginap gratis investor -- satu tempat, satu jawaban.
 *
 * Semua aturannya diperiksa DI SINI supaya pratinjau di form loonars.id dan
 * pembuatan booking sungguhan tidak pernah bisa berbeda pendapat. Kalau
 * pemeriksaannya disalin ke dua tempat, yang satu pasti akan tertinggal saat
 * aturannya berubah, dan tamu akan melihat "kode berlaku" lalu ditolak
 * setelah menekan pesan.
 *
 * Aturan owner (12 Sep 2026):
 *  - satu kode = satu bulan kalender tertentu, hangus kalau bulannya lewat;
 *  - tidak berlaku Jumat/Sabtu/Minggu;
 *  - tidak berlaku di high season -- larangan TERPISAH dari weekend;
 *  - satu kode sekali pakai.
 *
 * Yang TIDAK diperiksa di sini: apakah kodenya sudah terpakai oleh booking
 * lain. Itu dijaga unique index pada bookings.voucher_id, karena pemeriksaan
 * di aplikasi selalu bisa kalah balapan dengan permintaan kembar. Di sini
 * hanya dibaca untuk pesan yang ramah; keputusan akhirnya ada di database.
 */
async function periksaVoucherInvestor(kode, tgl_checkin, tgl_checkout){
  const bersih = String(kode ?? '').trim().toUpperCase();
  if(!/^[A-Z0-9]{8}$/.test(bersih)) return {ok:false, alasan:'Format kode tidak dikenali.'};

  const {data:v} = await supabase.from('villa_investor_vouchers')
    .select('id,user_id,kode,periode').eq('kode', bersih).maybeSingle();
  if(!v) return {ok:false, alasan:'Kode tidak ditemukan.'};

  const {data:pemilik} = await supabase.from('villa_users')
    .select('id,nama,is_active,role').eq('id', v.user_id).maybeSingle();
  if(!pemilik || pemilik.is_active !== true || pemilik.role !== 'owner'){
    return {ok:false, alasan:'Kode ini sudah tidak berlaku.'};
  }

  const {data:dipakai} = await supabase.from('bookings')
    .select('id,tgl_checkin,status').eq('voucher_id', v.id).maybeSingle();
  if(dipakai && dipakai.status !== 'batal'){
    return {ok:false, alasan:`Kode ini sudah dipakai untuk menginap ${dipakai.tgl_checkin}.`};
  }

  if(!isValidDateStr(tgl_checkin)) return {ok:false, alasan:'Tanggal checkin tidak valid.'};
  if(!isValidDateStr(tgl_checkout)) return {ok:false, alasan:'Tanggal checkout tidak valid.'};

  // Satu poin = satu malam, tapi menginapnya boleh lebih lama (keputusan
  // owner 13 Sep 2026): "boleh 2 malam tp vouchernya hanya berlaku semalam,
  // malam kedua otomatis harus bayar". Yang digratiskan selalu MALAM
  // PERTAMA, dan semua larangan di bawah diperiksa terhadap malam itu --
  // bukan terhadap seluruh menginapnya. Menginap Kamis-Sabtu tetap boleh:
  // yang gratis malam Kamis, malam Jumat dibayar penuh.
  const malam = Math.round((new Date(tgl_checkout).getTime() - new Date(tgl_checkin).getTime())/86400000);
  if(malam < 1) return {ok:false, alasan:'Tanggal menginap tidak valid.'};

  // Bulan kode, bukan bulan hari ini: kode Oktober yang belum dipakai tetap
  // hanya bisa dipakai untuk menginap DI Oktober.
  const bulanKode = String(v.periode).slice(0,7);
  if(tgl_checkin.slice(0,7) !== bulanKode){
    // "Sudah lewat" ditentukan oleh bulan HARI INI, bukan oleh tanggal yang
    // diminta. Membandingkannya dengan tanggal menginap membuat permintaan
    // untuk November dijawab "bulan Oktober sudah lewat" -- padahal Oktober
    // belum mulai, dan kodenya masih utuh.
    const bulanIni = monthWIB();
    return {ok:false, alasan: bulanKode < bulanIni
      ? `Kode ini berlaku untuk bulan ${bulanKode}, dan bulan itu sudah lewat sehingga kodenya hangus.`
      : `Kode ini hanya berlaku untuk menginap di bulan ${bulanKode}.`};
  }

  // Jumat, Sabtu, Minggu -- diperiksa pada MALAM PERTAMA, yaitu malam yang
  // digratiskan. getUTCDay(): 0=Minggu, 5=Jumat, 6=Sabtu.
  const hari = new Date(tgl_checkin + 'T00:00:00Z').getUTCDay();
  if(hari === 5 || hari === 6 || hari === 0){
    return {ok:false, alasan:'Malam gratis tidak berlaku Jumat, Sabtu, atau Minggu. Silakan mulai menginap di hari lain.'};
  }

  // High season SAJA -- bukan baris musim sepi. villa_high_season_periods
  // dipakai bersama oleh dua hal yang berlawanan: periode ramai (persen
  // positif) dan palung permintaan buatan AI (persen negatif,
  // created_by='ai_low_season'). Menyaring seluruh tabel akan membuat kode
  // ini ikut ditolak justru di bulan-bulan sepi -- kebalikan dari maksudnya.
  const {data:musim} = await supabase.from('villa_high_season_periods')
    .select('label,start_date,end_date,suggested_adjustment_pct,active')
    .eq('active', true)
    .lte('start_date', tgl_checkin)
    .gte('end_date', tgl_checkin);
  const ramai = (musim ?? []).find(r => Number(r.suggested_adjustment_pct ?? 0) > 0);
  if(ramai) return {ok:false, alasan:`Malam gratis tidak berlaku di periode ramai (${ramai.label}).`};

  return {ok:true, voucher:v, pemilik, malam};
}

async function computeStayTarif(unit, tgl_checkin, nights){
  const flatTarif = Number(unit.tarif_harian ?? 0);
  let computedTarif = flatTarif * nights;
  if(unit.room_type_id){
    const nightDates=[];
    for(let i=0;i<nights;i++){
      const d=new Date(`${tgl_checkin}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+i);
      nightDates.push(d.toISOString().slice(0,10));
    }
    const {data:plannedRates} = await supabase.from('villa_rates').select('date,rate')
      .eq('room_type_id',unit.room_type_id).in('date',nightDates);
    const plannedByDate = new Map((plannedRates??[]).map(r=>[r.date, Number(r.rate)]));
    if(plannedByDate.size>0){
      computedTarif = 0;
      for(let i=0;i<nights;i++){
        const d=new Date(`${tgl_checkin}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+i);
        const dateStr=d.toISOString().slice(0,10);
        computedTarif += plannedByDate.has(dateStr) ? plannedByDate.get(dateStr) : flatTarif;
      }
    }
  }
  return computedTarif;
}

/**
 * Harga sebuah promo untuk satu masa menginap, atau alasan kenapa promo itu
 * tidak berlaku.
 *
 * Prinsip yang menentukan bentuk fungsi ini (instruksi owner 2026-09-12:
 * "kt kan punya harga batas bawah ... ai akn akan memakai harga paling bawah
 * kita, nah bisa pakai seolah2 sedang ada promo untuk mngaktifkan harga bawah
 * itu"): promo TIDAK menciptakan wewenang harga baru. Ia hanya memanggil
 * batas bawah yang sudah ditetapkan di villa_room_types.min_rate.
 *
 * Karena itu harga promo SELALU dijepit tidak boleh di bawah min_rate --
 * termasuk untuk mode 'harga_tetap'. Admin yang salah mengetik satu nol
 * akan mendapat harga di lantai, bukan villa yang terjual seharga sepatu.
 * Lantai harga itu juga yang menjaga mesin harga AI selama ini; promo tidak
 * boleh jadi pintu belakang yang melewatinya.
 *
 * Promo juga tidak pernah MENAIKKAN harga: kalau harga normal ternyata sudah
 * lebih murah (low season yang sudah ditekan mesin harga), tamu membayar
 * harga normal dan promonya tidak dipakai.
 */
async function hitungHargaPromo(promo, roomTypeId, tgl_checkin, tgl_checkout, nights, hargaNormal){
  const today = todayWIB();

  if(!promo) return {ok:false, alasan:'Kode promo tidak ditemukan'};
  if(promo.aktif !== true) return {ok:false, alasan:'Promo sudah tidak aktif'};
  if(promo.pesan_dari && today < promo.pesan_dari) return {ok:false, alasan:'Promo belum dimulai'};
  if(promo.pesan_sampai && today > promo.pesan_sampai) return {ok:false, alasan:'Promo sudah berakhir'};
  if(promo.menginap_dari && tgl_checkin < promo.menginap_dari) return {ok:false, alasan:`Promo hanya untuk menginap mulai ${promo.menginap_dari}`};
  if(promo.menginap_sampai && tgl_checkout > promo.menginap_sampai) return {ok:false, alasan:`Promo hanya untuk menginap sampai ${promo.menginap_sampai}`};
  if(nights < Number(promo.min_malam ?? 1)) return {ok:false, alasan:`Promo ini minimal ${promo.min_malam} malam`};
  if(promo.kuota != null && Number(promo.terpakai ?? 0) >= Number(promo.kuota)) return {ok:false, alasan:'Kuota promo sudah habis'};
  if(promo.room_type_id && roomTypeId && String(promo.room_type_id) !== String(roomTypeId)){
    return {ok:false, alasan:'Promo tidak berlaku untuk tipe unit ini'};
  }
  if(!roomTypeId) return {ok:false, alasan:'Unit ini belum punya tipe kamar, promo tidak bisa dihitung'};

  const {data:rt} = await supabase.from('villa_room_types').select('min_rate,name').eq('id', roomTypeId).maybeSingle();
  const minRate = Number(rt?.min_rate ?? 0);
  if(!(minRate > 0)) return {ok:false, alasan:'Batas bawah harga tipe kamar belum diatur'};

  const diminta = promo.mode_harga === 'harga_tetap' ? Number(promo.harga_per_malam ?? 0) : minRate;
  const perMalam = Math.max(minRate, diminta);
  const total = perMalam * nights;

  if(!(hargaNormal > 0)) return {ok:false, alasan:'Harga normal belum bisa dihitung'};
  if(total >= hargaNormal){
    return {ok:false, alasan:'Harga normal sudah lebih murah dari promo ini', tidak_menguntungkan:true};
  }

  return {
    ok:true,
    harga_per_malam: perMalam,
    total,
    harga_normal: hargaNormal,
    hemat: hargaNormal - total,
    dijepit_ke_batas_bawah: perMalam > diminta,
  };
}

async function computeWalkinIncome(periode){
  const [y,mo] = periode.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo-1, 1)).toISOString();
  const end = new Date(Date.UTC(y, mo, 1)).toISOString();
  const {data:rows} = await supabase.from('walkin_payments').select('kategori,jumlah')
    .eq('status','lunas').gte('paid_at',start).lt('paid_at',end);
  const sum = (kat) => (rows||[]).filter(r=>r.kategori===kat).reduce((s,r)=>s+Number(r.jumlah),0);
  const cafe = sum('cafe'), spa = sum('spa'), lainnya = sum('lainnya');
  return { cafe, spa, lainnya, total: cafe+spa+lainnya };
}

/**
 * Pembagi dividen: JUMLAH UNIT, bukan jumlah akun.
 *
 * Dulu ini menghitung akun investor aktif, dan selama satu akun = satu unit
 * keduanya memberi angka yang sama. Begitu Bu Mega menggabungkan A4 dan A5
 * jadi satu akun (13 Sep 2026), keduanya berpisah: akun turun jadi 12
 * sementara unit tetap 13 -- dan pembagi yang mengecil akan MENAIKKAN
 * dividen sebelas investor lain tanpa ada seorang pun yang mengubah formula.
 *
 * Yang sebenarnya dibagi memang selalu unit, bukan akun. Kepemilikan akun
 * bisa digabung, dipisah, atau dinonaktifkan; jumlah unit yang menghasilkan
 * uang tidak ikut berubah karenanya. Owner menegaskan ini 13 Sep 2026:
 * "pembagi ttp 13, mmg ada 1 investor yg belum masuk" -- unit yang belum ada
 * pemiliknya pun tetap satu bagian.
 *
 * Hari ini hasilnya identik dengan sebelumnya: 13.
 */
async function countActiveInvestors(){
  const {count} = await supabase.from('units').select('id',{count:'exact',head:true});
  return count ?? 0;
}

async function computeReport(unit_id, periode){
  let q=supabase.from('transactions').select('tipe,jumlah').eq('periode_bulan',periode).eq('tipe','income');
  if(unit_id) q=q.eq('unit_id',unit_id);
  const {data:txs}=await q;
  const gross=(txs||[]).reduce((s,t)=>s+Number(t.jumlah),0);

  const finance = await getSetting('finance');
  const marketing_pct = typeof finance.marketing_pct === 'number' ? finance.marketing_pct : 0.275;
  const opex_pct = typeof finance.opex_pct === 'number' ? finance.opex_pct : 0.25;
  const marketing_amount = gross * marketing_pct;
  const opex_per_unit = gross * opex_pct;

  const net = gross - opex_per_unit - marketing_amount;
  const owner_amount = net * 0.70;
  const pengelola_amount = net * 0.30;

  const walkin_income = await computeWalkinIncome(periode);

  const investor_count = await countActiveInvestors();
  const per_investor_amount = investor_count > 0 ? owner_amount / investor_count : 0;
  const jaminan_aktif = per_investor_amount < 5000000;
  const jaminan_topup = jaminan_aktif ? 5000000 - per_investor_amount : 0;

  return {
    periode, gross_revenue:gross, opex_per_unit, opex_pct, marketing_pct, marketing_amount,
    gross_profit: net, net,
    owner_amount, loonars_amount: pengelola_amount, pengelola_amount,
    jaminan_aktif, jaminan_topup,
    walkin_income,
    investor_count, per_investor_amount,
  };
}

/**
 * Live per-channel OTA commission %, from Cloudbeds' own getSources --
 * shared by computeOtaBreakdown() (investor-facing estimate) and the
 * Survival Control Center engine below, so the two never quietly
 * disagree about what an OTA's commission is. Empty map (0% everywhere)
 * if the API key is missing or the call fails -- never invents a number.
 */
async function getOtaCommissionPctMap(){
  const commissionPctBySumber = new Map();
  const apiKey = cloudbedsApiKey();
  if (apiKey) {
    try {
      const res = await fetch(`${CLOUDBEDS_API_BASE}/getSources`, { headers: { 'x-api-key': apiKey } });
      const body = await res.json().catch(() => null);
      for (const s of (body?.data ?? [])) {
        const name = (s.sourceName ?? '').toLowerCase();
        if (name.includes('airbnb')) commissionPctBySumber.set('airbnb', Number(s.commission ?? 0));
        else if (name.includes('booking.com')) commissionPctBySumber.set('booking.com', Number(s.commission ?? 0));
        else if (name.includes('agoda')) commissionPctBySumber.set('agoda', Number(s.commission ?? 0));
        else if (name.includes('traveloka')) commissionPctBySumber.set('traveloka', Number(s.commission ?? 0));
        else if (name.includes('tiket')) commissionPctBySumber.set('tiket', Number(s.commission ?? 0));
      }
    } catch { /* Cloudbeds unreachable -- fall through with 0% for OTA sumbers below, never invent a number */ }
  }
  return { commissionPctBySumber, commission_source: apiKey ? 'cloudbeds_live' : 'unavailable_no_api_key' };
}

async function computeOtaBreakdown(periode){
  const [y, mo] = periode.split('-').map(Number);
  const start = `${periode}-01`;
  const end = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);

  const { data: bookings } = await supabase.from('bookings')
    .select('sumber,total_bayar')
    .gte('tgl_checkin', start).lt('tgl_checkin', end)
    .neq('status', 'batal');

  const grossBySumber = new Map();
  for (const b of (bookings ?? [])) {
    const key = b.sumber ?? 'other';
    grossBySumber.set(key, (grossBySumber.get(key) ?? 0) + Number(b.total_bayar ?? 0));
  }

  const { commissionPctBySumber, commission_source } = await getOtaCommissionPctMap();

  const sources = [];
  let total_gross = 0, total_commission = 0;
  for (const [sumber, gross] of grossBySumber) {
    const commission_pct = commissionPctBySumber.get(sumber) ?? 0;
    const commission_amount = gross * (commission_pct / 100);
    total_gross += gross;
    total_commission += commission_amount;
    sources.push({ sumber, gross, commission_pct, commission_amount, net: gross - commission_amount });
  }
  sources.sort((a, b) => b.gross - a.gross);

  return {
    periode, sources, total_gross, total_commission, total_net: total_gross - total_commission,
    commission_source,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// FINANCE DASHBOARD (Loonars Finance)
//
// Cloudbeds' API (verified against what this integration actually pulls,
// see getCloudbedsReservationTotals) exposes only a reservation-level
// grandTotal/subTotal via getReservationsWithRateDetails -- there is no
// separate payment, refund, or settlement/payout endpoint available to
// this key. So:
//   - "Revenue" = bookings.total_bayar (what Cloudbeds/direct booking
//     says the stay costs). There is no itemized room/extras/tax/fee
//     breakdown or discount/refund feed, so gross === net here; this is
//     stated explicitly in every response rather than inventing a split.
//   - "Payment received" vs "outstanding" is inferred from the booking
//     workflow, not a Cloudbeds payment feed: front-desk check-in
//     requires "Tandai Lunas" first (see CURRENT_STATE.md 2026-09-19 --
//     a booking cannot reach status='checkin' unpaid), so
//     status IN (checkin, checkout) = PAID, status IN (terjadwal,
//     menunggu_pembayaran) = UNPAID. This is a real, traceable rule
//     about how this system works, not a guess -- but it is explicitly
//     NOT the same thing as a Cloudbeds/bank payment confirmation, and
//     every response says so.
//   - Settlement/reconciliation is a MANUAL finance workflow
//     (finance_settlements table) since Cloudbeds provides no OTA
//     settlement/payout data. calculateExpectedSettlement() only ever
//     returns confidence:'CONFIGURED' when finance_ota_settlement_config
//     has a real, owner-entered rule for that channel -- otherwise
//     'UNKNOWN', never a guessed date.
//   - "Cash received" only reflects amounts finance staff explicitly
//     mark as received (with a bank reference) through the Settlement
//     workflow below -- never equated with Cloudbeds payment status.
// ═══════════════════════════════════════════════════════════════════════

function normalizedChannel(sumber){
  const s = String(sumber||'').toLowerCase();
  // 'google' = Google Hotel Search, a metasearch referral confirmed live in
  // Cloudbeds' Distribution > Channels (owner screenshot, 20 Sep 2026) --
  // Google never collects guest money, the guest pays the property directly
  // via whichever booking engine the click-through lands on, so this is
  // DIRECT for settlement purposes even though it's a distinct traffic source.
  if(s==='walk-in' || s==='website' || s==='whatsapp' || s==='google') return 'DIRECT';
  if(s==='booking.com') return 'BOOKING_COM';
  if(s==='agoda') return 'AGODA';
  if(s==='airbnb') return 'AIRBNB';
  if(s==='traveloka') return 'TRAVELOKA';
  if(s==='tiket') return 'OTHER_OTA'; // Tiket.com -- distinct company from Traveloka, not a live Cloudbeds channel for this property.
  return 'UNKNOWN'; // includes raw 'cloudbeds' (source not yet resolved to a named OTA) and anything unmapped.
}

/**
 * PAID/UNPAID/CANCELLED.
 *
 * Prefers bookings.cloudbeds_balance -- the REAL amount still owed, as
 * reported by Cloudbeds' own getReservations.balance field (synced by
 * cloudbedsReservationSync.ts) -- over the workflow-status guess. Only
 * falls back to the guess (checkin/checkout = paid) when cloudbeds_balance
 * is null: a non-Cloudbeds booking (direct/walk-in, which has its own
 * local "Tandai Lunas" payment workflow), or a Cloudbeds booking synced
 * before this column existed and not yet re-synced.
 */
function paymentStatusForBooking(b){
  if(b.status==='batal') return 'CANCELLED';
  if(b.cloudbeds_balance != null) return Number(b.cloudbeds_balance) <= 0 ? 'PAID' : 'UNPAID';
  if(b.status==='checkin' || b.status==='checkout') return 'PAID';
  return 'UNPAID';
}

/** Real outstanding amount when Cloudbeds has reported one; otherwise the full stay amount if the workflow-status guess says unpaid. */
function outstandingForBooking(b, amount){
  if(b.cloudbeds_balance != null) return Math.max(0, Number(b.cloudbeds_balance));
  return paymentStatusForBooking(b)==='UNPAID' ? amount : 0;
}

async function getSettlementConfigMap(){
  const {data} = await supabase.from('finance_ota_settlement_config').select('*');
  const map = new Map();
  for(const row of (data||[])) map.set(row.sumber, row);
  return map;
}

/**
 * calculateExpectedSettlement() per the spec: input source/collection
 * method/booking, output {expected_settlement_date, settlement_status,
 * confidence, reason}. Only CONFIGURED when an owner/admin has actually
 * entered a rule for this sumber in finance_ota_settlement_config --
 * never hardcodes "Booking.com = 7 hari" or any other OTA-specific
 * assumption.
 *
 * settlement_basis (owner-configured per channel, default CHECKOUT):
 * most OTAs (Booking.com, Agoda) settle counting from checkout, but
 * Airbnb's own payout policy releases funds ~24h after the guest CHECKS
 * IN -- for a multi-night stay, counting from checkout instead would
 * understate how long the money has actually been outstanding. Never
 * assumed per-OTA; an admin picks CHECKIN or CHECKOUT explicitly when
 * configuring that channel.
 *
 * settlement_schedule (owner-configured per channel, default
 * FIXED_DELAY): Booking.com's real "Payments by Booking.com" schedule
 * (per owner's Extranet screenshot, 20 Sep 2026) is not a fixed N-days
 * delay -- it's a calendar cutoff, paid on the 1st of the month,
 * covering every reservation whose settlement_basis date falls before
 * that payment date. Approximating that as an average day-count would
 * be wrong for most bookings (a checkout on the 2nd and one on the 29th
 * both get paid the same 1st), so MONTHLY_1ST is a distinct, exact rule
 * rather than a guessed number forced into settlement_delay_days.
 */
function calculateExpectedSettlement({ sumber, tgl_checkin, tgl_checkout, configMap }){
  const cfg = configMap.get(sumber);
  const collection_method = cfg?.collection_method ?? 'UNKNOWN';
  if(!cfg){
    return {
      expected_settlement_date: null,
      confidence: 'UNKNOWN',
      reason: `Belum ada aturan settlement yang dikonfigurasi untuk sumber '${sumber}'`,
      collection_method,
    };
  }
  const basis = cfg.settlement_basis === 'CHECKIN' ? 'CHECKIN' : 'CHECKOUT';
  const anchorDate = basis === 'CHECKIN' ? tgl_checkin : tgl_checkout;
  const anchorLabel = basis === 'CHECKIN' ? 'checkin' : 'checkout';
  if(!anchorDate){
    return {
      expected_settlement_date: null,
      confidence: 'UNKNOWN',
      reason: `Booking belum punya tanggal ${anchorLabel}`,
      collection_method,
    };
  }

  if(cfg.settlement_schedule === 'MONTHLY_1ST'){
    // Date.UTC(y, m, 1) directly, NOT setUTCMonth()+setUTCDate() on an
    // existing date -- setUTCMonth() preserves the day-of-month while
    // changing the month, so calling it on e.g. "2026-01-31" overflows
    // into March (Feb only has 28/29 days) before setUTCDate(1) ever
    // runs, silently landing a month late. Constructing the date fresh
    // with day=1 from the start has no day component to overflow.
    const [y, mo] = anchorDate.split('-').map(Number); // mo is 1-based; Date.UTC's month arg is 0-based, so mo alone already means "next month, 0-based".
    const d = new Date(Date.UTC(y, mo, 1));
    const expected_settlement_date = d.toISOString().slice(0,10);
    return {
      expected_settlement_date,
      confidence: 'CONFIGURED',
      reason: `Dibayar tanggal 1 bulan berikutnya setelah ${anchorLabel} (jadwal pembayaran bulanan), sesuai konfigurasi OTA settlement`,
      collection_method,
    };
  }

  if(cfg.settlement_schedule === 'WEEKLY_ON_DAY'){
    if(cfg.settlement_weekday==null){
      return {
        expected_settlement_date: null,
        confidence: 'UNKNOWN',
        reason: `Jadwal mingguan dipilih untuk '${sumber}' tapi hari pembayarannya belum diisi`,
        collection_method,
      };
    }
    const WEEKDAY_NAMES = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const d = new Date(`${anchorDate}T00:00:00Z`);
    const currentWeekday = d.getUTCDay();
    const targetWeekday = Number(cfg.settlement_weekday);
    // Next occurrence STRICTLY after anchorDate, same "before payment date"
    // semantics as MONTHLY_1ST: a reservation checking out ON the payment
    // day itself rolls to the following week's run, not the same day's.
    let diff = (targetWeekday - currentWeekday + 7) % 7;
    if(diff === 0) diff = 7;
    d.setUTCDate(d.getUTCDate() + diff);
    const expected_settlement_date = d.toISOString().slice(0,10);
    return {
      expected_settlement_date,
      confidence: 'CONFIGURED',
      reason: `Dibayar hari ${WEEKDAY_NAMES[targetWeekday]} berikutnya setelah ${anchorLabel} (jadwal pembayaran mingguan), sesuai konfigurasi OTA settlement`,
      collection_method,
    };
  }

  if(cfg.settlement_delay_days==null || cfg.settlement_delay_days===''){
    return {
      expected_settlement_date: null,
      confidence: 'UNKNOWN',
      reason: `Belum ada aturan settlement yang dikonfigurasi untuk sumber '${sumber}'`,
      collection_method,
    };
  }
  const d = new Date(`${anchorDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(cfg.settlement_delay_days));
  const expected_settlement_date = d.toISOString().slice(0,10);
  return {
    expected_settlement_date,
    confidence: 'CONFIGURED',
    reason: `${cfg.settlement_delay_days} hari setelah ${anchorLabel}, sesuai konfigurasi OTA settlement`,
    collection_method,
  };
}

/** Lazily creates a finance_settlements row for any booking that doesn't have one yet. Idempotent (unique booking_id, upsert ignoreDuplicates). */
async function ensureFinanceSettlements(bookings, configMap){
  const candidates = bookings.filter(b => b.status !== 'batal');
  if(!candidates.length) return;
  const rows = candidates.map(b => {
    const calc = calculateExpectedSettlement({ sumber: b.sumber, tgl_checkin: b.tgl_checkin, tgl_checkout: b.tgl_checkout, configMap });
    return {
      booking_id: b.id,
      sumber: b.sumber,
      amount: Number(b.total_bayar ?? b.tarif ?? 0),
      expected_settlement_date: calc.expected_settlement_date,
      settlement_confidence: calc.confidence,
      settlement_status: 'PENDING',
    };
  });
  await supabase.from('finance_settlements').upsert(rows, { onConflict: 'booking_id', ignoreDuplicates: true });

  // Bookings whose expected date has arrived move PENDING -> READY_TO_COLLECT.
  // Never touches PROCESSING/RECEIVED rows -- those are finance's own actions.
  const today = todayWIB();
  await supabase.from('finance_settlements')
    .update({ settlement_status: 'READY_TO_COLLECT', updated_at: new Date().toISOString() })
    .eq('settlement_status', 'PENDING')
    .lte('expected_settlement_date', today)
    .not('expected_settlement_date', 'is', null);
}

async function writeFinanceAudit({ entity_type, entity_id, session, action, old_value, new_value, reason }){
  await supabase.from('finance_audit_log').insert({
    entity_type, entity_id, user_id: session.uid, user_nama: session.email ?? null,
    action, old_value: old_value ?? null, new_value: new_value ?? null, reason: reason ?? null,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// FINANCE SURVIVAL CONTROL CENTER
//
// A SEPARATE analysis engine from computeReport() (the frozen,
// authoritative dividend-payout formula -- see
// docs/revenue-engine/PHASE0-BASELINE.md §2, which deducts a flat 27.5%
// marketing + 25% opex before splitting 70/30). This engine splits
// revenue net of OTA commission directly 70/30, per owner instruction
// (23 Sep 2026, in response to being asked which formula to use):
// "Ya pakai, tp bukan di halaman investor, ya ini hanya ada di halaman
// finance" -- i.e. use this formula, but ONLY on /finance, never
// surfaced to investors, and never used to actually calculate what an
// investor is paid. The two engines will show DIFFERENT numbers for the
// same period by design.
//
// All business parameters (rooms, split %, guarantee, ADR targets,
// payroll, electricity) come from finance_property_config -- nothing
// here is hardcoded per property, so Loonars 2/3 need only a new config
// row, never new code.
// ═══════════════════════════════════════════════════════════════════════

async function getPropertyConfig(property_code){
  const { data } = await supabase.from('finance_property_config').select('*').eq('property_code', property_code).eq('active', true).maybeSingle();
  return data ?? null;
}

function daysInclusive(from, to){
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;
}
function addDaysStr(dateStr, n){
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}

/**
 * Net room revenue for bookings whose tgl_checkin falls in [from,to], net
 * of live Cloudbeds OTA commission (same method computeOtaBreakdown
 * uses -- getOtaCommissionPctMap() is shared, not duplicated). There is
 * no tax field anywhere in this schema, so "net of tax" is genuinely
 * NOT_AVAILABLE -- reported as such (tax_deduction: null), never
 * silently treated as zero.
 */
async function computeNetRevenueForRange(from, to){
  const { data: bookings } = await supabase.from('bookings')
    .select('sumber,total_bayar,tarif,durasi_malam,status')
    .gte('tgl_checkin', from).lte('tgl_checkin', to)
    .neq('status', 'batal');
  const rows = bookings ?? [];
  const { commissionPctBySumber, commission_source } = await getOtaCommissionPctMap();
  let gross = 0, commission = 0, room_nights = 0;
  for(const b of rows){
    const amount = Number(b.total_bayar ?? b.tarif ?? 0);
    const pct = commissionPctBySumber.get(b.sumber) ?? 0;
    gross += amount;
    commission += amount * (pct/100);
    room_nights += Number(b.durasi_malam ?? 0);
  }
  return { gross_revenue: gross, ota_commission: commission, net_revenue: gross - commission, room_nights, booking_count: rows.length, commission_source, tax_deduction: null };
}

/** Occupied/available room-nights from the daily inventory snapshot -- the SAME table /api/admin/revenue-metrics reads, so occupancy never disagrees between the two dashboards. */
async function computeOccupiedRoomNights(from, to){
  const { data } = await supabase.from('villa_daily_inventory_snapshot')
    .select('snapshot_date,unit_status,on_books')
    .gte('snapshot_date', from).lte('snapshot_date', to);
  const rows = data ?? [];
  const availableRoomNights = rows.filter(r=>r.unit_status!=='maintenance').length;
  const occupiedRoomNights = rows.filter(r=>r.on_books || r.unit_status==='occupied').length;
  const daysWithData = new Set(rows.map(r=>r.snapshot_date)).size;
  return { availableRoomNights, occupiedRoomNights, daysWithData };
}

/**
 * Pure scenario calculator. The SAME function backs the What-If
 * calculator, the 5/6/7/8 rooms/night target table, AND (fed with known
 * actuals) computeSurvivalKpis() below -- there is exactly one place
 * this arithmetic exists.
 *
 * Guarantee/MKH cascade is THIS ENGINE'S OWN DERIVATION of the owner's
 * stated worst-case priority (brief, 23 Sep 2026: "1. Operational
 * continuity 2. Investor guarantee 3. OPEX 4. MKH management profit"),
 * not a formula the brief gave directly -- flagged for owner
 * confirmation. Reasoning: net_revenue is fully allocated 70/30 under
 * the normal split, so if the investor's 70% falls short of the
 * guarantee, the only pool that can top it up is MKH's 30% share (OPEX
 * is a separate real cash cost, not part of the split). So MKH's 30%
 * absorbs the guarantee shortfall AND opex before any profit, and can
 * go to zero or negative -- negative meaning Loonars must fund the gap
 * from outside this revenue.
 */
function computeScenario(config, { netAdr, roomsPerNight, days = 30 }){
  const total_rooms = Number(config.total_rooms);
  const available_room_nights = total_rooms * days;
  const occupied_room_nights = Math.min(available_room_nights, roomsPerNight * days);
  const occupancy_pct = available_room_nights > 0 ? (occupied_room_nights / available_room_nights) * 100 : 0;

  const net_revenue = netAdr * occupied_room_nights;
  const investor_entitlement = net_revenue * Number(config.investor_share_pct);
  const mkh_contractual_share = net_revenue * Number(config.mkh_share_pct);

  // Guarantee is a MONTHLY figure; prorated here only so a scenario run
  // for a shorter or longer window than 30 days stays comparable.
  const monthly_guarantee = total_rooms * Number(config.guarantee_per_room) * (days / 30);
  const guarantee_gap = Math.max(0, monthly_guarantee - investor_entitlement);

  const payroll = Number(config.payroll_employee_count) * Number(config.payroll_per_employee) * (days / 30);
  const room_electricity = Number(config.room_electricity_per_night) * occupied_room_nights;
  const opex = payroll + room_electricity;

  const funds_available_for_opex_if_mkh_zero = Math.max(0, mkh_contractual_share - guarantee_gap);
  const mkh_operating_result = mkh_contractual_share - guarantee_gap - opex;
  const mkh_funding_gap = Math.max(0, -mkh_operating_result);

  return {
    days, rooms_per_night: roomsPerNight, net_adr: netAdr,
    available_room_nights, occupied_room_nights, occupancy_pct,
    net_revenue, investor_entitlement, mkh_contractual_share,
    monthly_guarantee, guarantee_gap,
    payroll, room_electricity, opex,
    funds_available_for_opex_if_mkh_zero,
    mkh_operating_result, mkh_funding_gap,
  };
}

/** Additional net revenue needed (over the period) so the contractual split alone covers BOTH the guarantee and OPEX -- the binding constraint is whichever needs more revenue. */
function computeAdditionalRevenueNeeded(config, actualNetRevenue, monthly_guarantee, opex){
  const investorPct = Number(config.investor_share_pct);
  const mkhPct = Number(config.mkh_share_pct);
  const revenueNeededForGuarantee = investorPct > 0 ? monthly_guarantee / investorPct : 0;
  const revenueNeededForOpex = mkhPct > 0 ? opex / mkhPct : 0;
  const required = Math.max(revenueNeededForGuarantee, revenueNeededForOpex);
  return Math.max(0, required - actualNetRevenue);
}

/**
 * Minimum room-nights per (30-day reference) month needed so BOTH the
 * guarantee and OPEX are covered by the contractual split, expressed
 * directly in room-nights (kamar-malam) instead of Rupiah -- per owner
 * feedback (23 Sep 2026): the Rupiah-and-jargon KPI cards are too
 * confusing to hand to staff; a plain "sudah aman di X malam, kurang Y
 * malam" table is what's actually usable day to day.
 *
 * Solved analytically (not iteratively) at target_net_adr:
 *   revenueForGuarantee = guarantee / investor_pct
 *   revenueForOpex solves: revenue*mkh_pct - payroll - electricity*(revenue/adr) = 0
 *     => revenue = payroll / (mkh_pct - electricity/adr)
 *   requiredRevenue = MAX(revenueForGuarantee, revenueForOpex)
 *   requiredRoomNights = requiredRevenue / target_net_adr
 * Cross-checked against computeScenario() at the resulting room-night
 * level before shipping -- guarantee_gap and mkh_funding_gap both land
 * on exactly 0 there, confirming the two formulas agree.
 */
function computeRequiredRoomNightsForSafety(config){
  const investorPct = Number(config.investor_share_pct);
  const mkhPct = Number(config.mkh_share_pct);
  const targetAdr = Number(config.target_net_adr);
  const guarantee = Number(config.total_rooms) * Number(config.guarantee_per_room);
  const payroll = Number(config.payroll_employee_count) * Number(config.payroll_per_employee);
  const electricity = Number(config.room_electricity_per_night);

  const revenueForGuarantee = investorPct > 0 ? guarantee / investorPct : Infinity;
  const denom = mkhPct - (targetAdr > 0 ? electricity / targetAdr : 0);
  const revenueForOpex = denom > 0 ? payroll / denom : Infinity;
  const requiredRevenue = Math.max(revenueForGuarantee, revenueForOpex);
  const requiredRoomNightsPerMonth = targetAdr > 0 && Number.isFinite(requiredRevenue) ? requiredRevenue / targetAdr : null;
  return { requiredRevenue, requiredRoomNightsPerMonth };
}

/** Fixed bands per owner's brief (23 Sep 2026) -- not stored in config since the brief gave exact numbers, not "configurable". One place, not scattered across the UI. */
function roomsPerNightBand(roomsPerNight){
  if(roomsPerNight == null) return { band:'UNKNOWN', label:'Belum ada data', accent:'neutral' };
  if(roomsPerNight < 3) return { band:'RED', label:'Kritis', accent:'ruby' };
  if(roomsPerNight < 5) return { band:'ORANGE', label:'Waspada', accent:'gold' };
  if(roomsPerNight < 6) return { band:'GREEN', label:'Aman', accent:'sage' };
  if(roomsPerNight < 7) return { band:'HEALTHY', label:'Sehat', accent:'sage' };
  if(roomsPerNight < 8) return { band:'STRONG', label:'Kuat', accent:'sage' };
  return { band:'VERY_STRONG', label:'Sangat Kuat', accent:'sage' };
}

function survivalStatus(guarantee_gap, mkh_funding_gap){
  if(guarantee_gap === 0 && mkh_funding_gap === 0) return 'SAFE';
  if(mkh_funding_gap > 0) return 'AT_RISK';
  return 'WATCH';
}

async function computeSurvivalKpis(property_code, from, to){
  const config = await getPropertyConfig(property_code);
  if(!config) return null;

  const today = todayWIB();
  const days = daysInclusive(from, to);
  const total_rooms = Number(config.total_rooms);

  const netRevenueRange = await computeNetRevenueForRange(from, to);
  const occRange = await computeOccupiedRoomNights(from, to);

  const { data: todayRows } = await supabase.from('villa_daily_inventory_snapshot')
    .select('unit_status,on_books').eq('snapshot_date', today);
  const todayOccupied = (todayRows ?? []).filter(r=>r.on_books || r.unit_status==='occupied').length;
  const todayAvailable = (todayRows ?? []).filter(r=>r.unit_status!=='maintenance').length;

  const occ30 = await computeOccupiedRoomNights(addDaysStr(today,-29), today);
  const occupancy_30d_pct = occ30.availableRoomNights>0 ? (occ30.occupiedRoomNights/occ30.availableRoomNights)*100 : null;
  const rooms_per_night_30d = occ30.daysWithData>0 ? occ30.occupiedRoomNights/occ30.daysWithData : null;
  const rooms_per_night_period = days>0 ? occRange.occupiedRoomNights/days : null;

  const net_adr = occRange.occupiedRoomNights>0 ? netRevenueRange.net_revenue/occRange.occupiedRoomNights : null;

  const monthly_guarantee = total_rooms * Number(config.guarantee_per_room);
  const investor_entitlement = netRevenueRange.net_revenue * Number(config.investor_share_pct);
  const mkh_contractual_share = netRevenueRange.net_revenue * Number(config.mkh_share_pct);
  const guarantee_gap = Math.max(0, monthly_guarantee - investor_entitlement);

  const payroll_mtd = Number(config.payroll_employee_count)*Number(config.payroll_per_employee)*(days/30);
  const room_electricity_mtd = Number(config.room_electricity_per_night) * occRange.occupiedRoomNights;
  const opex_mtd = payroll_mtd + room_electricity_mtd;

  const funds_available_for_opex_if_mkh_zero = Math.max(0, mkh_contractual_share - guarantee_gap);
  const mkh_operating_result = mkh_contractual_share - guarantee_gap - opex_mtd;
  const mkh_funding_gap = Math.max(0, -mkh_operating_result);

  const additional_revenue_needed = computeAdditionalRevenueNeeded(config, netRevenueRange.net_revenue, monthly_guarantee, opex_mtd);
  const band = roomsPerNightBand(rooms_per_night_30d ?? rooms_per_night_period);
  const status = survivalStatus(guarantee_gap, mkh_funding_gap);

  // ── Simple, staff-readable version: everything in room-nights (kamar-malam), no Rupiah, no jargon ──
  const { requiredRoomNightsPerMonth } = computeRequiredRoomNightsForSafety(config);
  const requiredRoomsPerNight = requiredRoomNightsPerMonth != null ? requiredRoomNightsPerMonth / 30 : null;

  const monthStr = monthWIB();
  const monthStart = `${monthStr}-01`;
  const [my, mo2] = monthStr.split('-').map(Number);
  const daysInCurrentMonth = new Date(Date.UTC(my, mo2, 0)).getUTCDate();
  const dayOfMonth = Number(today.slice(8,10));
  const occThisMonthSoFar = await computeOccupiedRoomNights(monthStart, today);
  const requiredRoomNightsThisMonth = requiredRoomNightsPerMonth != null ? requiredRoomNightsPerMonth * (daysInCurrentMonth/30) : null;
  const roomNightsStillNeededThisMonth = requiredRoomNightsThisMonth != null ? Math.max(0, requiredRoomNightsThisMonth - occThisMonthSoFar.occupiedRoomNights) : null;
  const daysRemainingInMonth = Math.max(0, daysInCurrentMonth - dayOfMonth);
  const avgRoomsPerNightNeededForRestOfMonth = roomNightsStillNeededThisMonth != null
    ? (daysRemainingInMonth > 0 ? roomNightsStillNeededThisMonth / daysRemainingInMonth : (roomNightsStillNeededThisMonth > 0 ? null : 0))
    : null;

  const simple_target_table = [];
  for(let level = 1; level <= total_rooms; level++){
    const roomNightsAtLevel = level * 30;
    const shortfall = requiredRoomNightsPerMonth != null ? Math.max(0, requiredRoomNightsPerMonth - roomNightsAtLevel) : null;
    simple_target_table.push({
      rooms_per_night: level,
      occupancy_pct: total_rooms > 0 ? (level/total_rooms)*100 : null,
      aman: shortfall != null ? shortfall <= 0 : null,
      kurang_malam_per_bulan: shortfall != null ? Math.ceil(shortfall) : null,
    });
  }

  return {
    property_code, property_name: config.property_name, period: { from, to, days },
    today: {
      date: today, occupied: todayOccupied, available: todayAvailable,
      occupancy_pct: todayAvailable>0 ? (todayOccupied/todayAvailable)*100 : null,
      has_snapshot: (todayRows ?? []).length > 0,
    },
    rolling_30d: { occupancy_pct: occupancy_30d_pct, rooms_per_night: rooms_per_night_30d, days_with_data: occ30.daysWithData },
    rooms_per_night_period,
    rooms_per_night_band: band,
    net_adr,
    net_adr_note: 'Net dari komisi OTA live Cloudbeds; TIDAK termasuk potongan pajak -- tidak ada field pajak di sistem ini (NOT_AVAILABLE).',
    net_revenue_mtd: netRevenueRange.net_revenue,
    gross_revenue_mtd: netRevenueRange.gross_revenue,
    ota_commission_mtd: netRevenueRange.ota_commission,
    commission_source: netRevenueRange.commission_source,
    room_nights_mtd: netRevenueRange.room_nights,
    booking_count_mtd: netRevenueRange.booking_count,
    investor_guarantee: monthly_guarantee,
    investor_entitlement_mtd: investor_entitlement,
    guarantee_gap,
    mkh_contractual_share_mtd: mkh_contractual_share,
    opex_mtd,
    opex_breakdown: { payroll: payroll_mtd, room_electricity: room_electricity_mtd },
    opex_source: 'ASSUMPTION_FROM_CONFIG',
    opex_note: 'Dihitung dari asumsi Konfigurasi Properti (payroll + listrik kamar per malam terisi), bukan dari pencatatan opex aktual -- opex_bulanan (tabel itemized) masih kosong. Ubah asumsi di halaman Konfigurasi Properti kalau ada perubahan jumlah pegawai/tarif listrik.',
    funds_available_for_opex_if_mkh_zero,
    mkh_operating_result, mkh_funding_gap,
    additional_revenue_needed,
    survival_status: status,
    simple: {
      required_rooms_per_night: requiredRoomsPerNight,
      required_room_nights_per_month: requiredRoomNightsPerMonth,
      target_table: simple_target_table,
      this_month: {
        month: monthStr,
        days_in_month: daysInCurrentMonth,
        day_of_month: dayOfMonth,
        days_remaining: daysRemainingInMonth,
        room_nights_so_far: occThisMonthSoFar.occupiedRoomNights,
        room_nights_required: requiredRoomNightsThisMonth,
        room_nights_still_needed: roomNightsStillNeededThisMonth,
        avg_rooms_per_night_needed_for_rest_of_month: avgRoomsPerNightNeededForRestOfMonth,
      },
    },
    config,
  };
}

/**
 * Unit yang boleh dilihat sebuah akun investor.
 *
 * villa_users.unit_id hanya memuat SATU unit, dan itu cukup selama satu akun
 * memang satu unit. Sejak akun bisa memiliki lebih dari satu (Bu Mega, A4 +
 * A5), memakai kolom itu untuk menyaring berarti separuh miliknya hilang dari
 * layarnya sendiri -- tanpa galat, tanpa tanda apa pun.
 */
async function unitIdsForSession(session){
  const {data} = await supabase.from('villa_investor_units').select('unit_id').eq('user_id', session.uid);
  const ids = (data ?? []).map(r => r.unit_id).filter(Boolean);
  if(ids.length) return ids;
  // Akun lama yang belum terpetakan tetap dilayani lewat kolom warisannya.
  return session.unit_id ? [session.unit_id] : [];
}

async function computeDividendList(periode){
  const report = await computeReport(undefined, periode);
  const {data:investors, error} = await supabase.from('villa_users')
    .select('id,nama,hp,unit_nomor,bank_nama,no_rekening,nama_pemilik_rekening')
    .eq('role','owner').eq('is_active',true).order('unit_nomor');
  if(error) throw new Error(error.message);

  // Jumlah unit per akun: akun yang memiliki dua unit menerima dua bagian.
  // Tanpa ini, menggabungkan dua akun jadi satu diam-diam memotong setengah
  // hak pemiliknya.
  const {data:kepemilikan} = await supabase.from('villa_investor_units').select('user_id');
  const jumlahUnit = new Map();
  for(const r of kepemilikan ?? []) jumlahUnit.set(String(r.user_id), (jumlahUnit.get(String(r.user_id)) ?? 0) + 1);

  // Kekhususan per investor: angka pasti yang menggantikan bagi hasil DAN
  // jaminan minimal untuk akun itu saja. Sengaja tidak memengaruhi
  // per_investor_amount maupun pembagi, jadi hitungan investor lain tidak
  // bergeser sedikit pun karenanya.
  const {data:terms} = await supabase.from('villa_investor_terms')
    .select('user_id,pemasukan_tetap,mulai,selesai')
    .lte('mulai', `${periode}-01`).gte('selesai', `${periode}-01`);
  const tetap = new Map((terms ?? []).map(t => [String(t.user_id), Number(t.pemasukan_tetap)]));

  const list = (investors ?? []).map(inv => {
    const nTetap = tetap.get(String(inv.id));
    const unit = jumlahUnit.get(String(inv.id)) ?? 1;
    return {
      ...inv,
      unit_dimiliki: unit,
      pemasukan_tetap: nTetap !== undefined,
      jumlah: nTetap !== undefined ? nTetap : report.per_investor_amount * unit,
      rekening_lengkap: !!(inv.bank_nama && inv.no_rekening),
    };
  });
  return { periode, per_investor_amount: report.per_investor_amount, investor_count: report.investor_count, investors: list };
}

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(!SESSION_SECRET){
    return err('Server misconfigured: VILLA_SESSION_SECRET is not set',503);
  }
  const url=new URL(req.url);
  const path=url.pathname.replace(/^\/villa-api/,'');
  const m=req.method;

  if(path==='/login' && m==='POST'){
    const {email,password}=await req.json();
    if(!email||!password) return err('Email dan password wajib diisi',400);
    const {data:rows,error}=await supabase.rpc('villa_login',{p_email:email,p_password:password});
    const u = Array.isArray(rows)?rows[0]:null;
    if(error||!u) return err('Email atau password salah',401);
    if(!u.is_active) return err('Akun tidak aktif',403);
    await supabase.from('villa_users').update({last_login:new Date().toISOString()}).eq('id',u.id);
    const token = await makeToken({uid:u.id, email, role:u.role, unit_id:u.unit_id, unit_nomor:u.unit_nomor});
    return json({token, user:u});
  }

  if(path==='/public/room-types' && m==='GET'){
    const {data,error} = await supabase.from('villa_room_types')
      .select('code,name,description,min_rate,max_rate').eq('active',true).order('min_rate');
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/public/availability' && m==='GET'){
    const checkin = url.searchParams.get('checkin');
    const checkout = url.searchParams.get('checkout');
    const room_type = url.searchParams.get('room_type');
    if(!checkin || !isValidDateStr(checkin)) return err('checkin wajib diisi (YYYY-MM-DD)');
    if(!checkout || !isValidDateStr(checkout)) return err('checkout wajib diisi (YYYY-MM-DD)');
    if(new Date(checkout) <= new Date(checkin)) return err('checkout harus setelah checkin');

    const {data:units, error:unitsErr} = await supabase.from('units').select('id,room_type_id,tarif_harian');
    if(unitsErr) return err(unitsErr.message);
    const {data:roomTypes} = await supabase.from('villa_room_types').select('id,code,name').eq('active',true);
    const rtById = new Map((roomTypes??[]).map(r=>[r.id,r]));

    const {data:bookings} = await supabase.from('bookings').select('unit_id,tgl_checkin,tgl_checkout').in('status',['terjadwal','checkin']);
    const conflicts = findConflicts(bookings??[], checkin, checkout);
    const nights = Math.max(1, Math.round((new Date(checkout).getTime() - new Date(checkin).getTime())/86400000));

    const byType = new Map();
    for(const u of units??[]){
      const rt = rtById.get(u.room_type_id);
      const code = rt?.code ?? 'unknown';
      if(room_type && code !== room_type) continue;
      if(!byType.has(code)) byType.set(code, {code, name: rt?.name ?? code, total:0, available:0, sampleFreeUnit:null});
      const entry = byType.get(code);
      entry.total++;
      if(!conflicts.has(u.id)){
        entry.available++;
        // Real price actually charged depends on the specific unit assigned
        // at booking time, but every unit within a room type shares the same
        // tarif_harian/villa_rates lookup -- so any one free unit gives the
        // exact price a guest booking this type for these dates will pay.
        if(!entry.sampleFreeUnit) entry.sampleFreeUnit = u;
      }
    }
    const room_types_result = [];
    for(const entry of byType.values()){
      let price_total = null;
      if(entry.sampleFreeUnit){
        price_total = await computeStayTarif(entry.sampleFreeUnit, checkin, nights);
      }
      room_types_result.push({
        code: entry.code, name: entry.name, total: entry.total, available: entry.available,
        nights, price_total, price_per_night_avg: price_total != null ? Math.round(price_total / nights) : null,
      });
    }
    return json({
      checkin, checkout,
      available: room_types_result.some(r=>r.available>0),
      room_types: room_types_result,
    });
  }

  if(path==='/public/payment-info' && m==='GET'){
    // Sengaja pakai key yang sama dengan kasir walk-in (integration_settings
    // 'walkin_qris', diisi lewat halaman Payment Gateway staff) supaya QRIS
    // yang ditampilkan ke tamu booking online SELALU sama dengan yang dipakai
    // di lokasi -- 'public_booking_qris' dulu tidak punya UI admin sama
    // sekali, jadi tidak pernah benar-benar terisi.
    const setting = await getSetting('walkin_qris');
    return json({
      qris_data_url: setting?.data_url ?? null,
      note: setting?.note ?? 'QRIS pembayaran belum tersedia -- silakan hubungi kami di WhatsApp untuk info pembayaran.',
    });
  }

  // Pratinjau promo sebelum memesan, supaya angka yang dilihat tamu di
  // loonars.id sama persis dengan yang akan ditagih -- dihitung di sini,
  // bukan di browser, karena harga tidak boleh punya dua sumber kebenaran.
  // Pratinjau kode menginap gratis untuk form pemesanan loonars.id.
  //
  // Sengaja TIDAK membocorkan apa pun tentang investornya. Kode ini diketik
  // di halaman publik yang bisa dibuka siapa saja, jadi jawaban "berlaku"
  // atau "tidak berlaku" sudah cukup; nama pemilik kode tidak ada urusannya
  // dengan pengunjung yang mengetiknya.
  if(path==='/public/voucher' && m==='GET'){
    const kode = String(url.searchParams.get('code') ?? '').trim().toUpperCase();
    const checkin = url.searchParams.get('checkin') ?? '';
    const checkout = url.searchParams.get('checkout') ?? '';
    if(!kode) return err('Kode wajib diisi');
    const cek = await periksaVoucherInvestor(kode, checkin, checkout);
    if(!cek.ok) return json({berlaku:false, alasan:cek.alasan});

    // Nilai malam gratisnya ikut dihitung kalau tipe unitnya sudah dipilih,
    // supaya ringkasan harga di form menampilkan angka yang sama dengan yang
    // nanti ditagih -- bukan angka yang dikira-kira browser.
    const roomTypeCode = String(url.searchParams.get('room_type') ?? '').trim();
    let hemat = null, total = null, hargaNormalPratinjau = null;
    if(roomTypeCode){
      const {data:rt} = await supabase.from('villa_room_types').select('id').eq('code', roomTypeCode).maybeSingle();
      const {data:unitContoh} = rt
        ? await supabase.from('units').select('id,tarif_harian,room_type_id').eq('room_type_id', rt.id).order('nomor').limit(1).maybeSingle()
        : {data:null};
      if(unitContoh){
        hargaNormalPratinjau = await computeStayTarif(unitContoh, checkin, cek.malam);
        hemat = await computeStayTarif(unitContoh, checkin, 1);
        total = Math.max(0, hargaNormalPratinjau - hemat);
      }
    }

    return json({
      berlaku:true, malam:cek.malam, malam_gratis:1,
      harga_normal:hargaNormalPratinjau, hemat, total,
      keterangan: cek.malam > 1
        ? 'Malam pertama gratis. Malam selanjutnya dibayar seperti biasa.'
        : 'Menginap gratis 1 malam. Tidak ada yang perlu dibayar.',
    });
  }

  if(path==='/public/promo' && m==='GET'){
    const kode = String(url.searchParams.get('code') ?? '').trim().toUpperCase();
    const checkin = url.searchParams.get('checkin') ?? '';
    const checkout = url.searchParams.get('checkout') ?? '';
    const roomTypeCode = String(url.searchParams.get('room_type') ?? '').trim();
    if(!kode) return err('Kode promo wajib diisi');
    if(!isValidDateStr(checkin) || !isValidDateStr(checkout)) return err('Tanggal tidak valid');
    if(new Date(checkout) <= new Date(checkin)) return err('Tanggal checkout harus setelah checkin');

    const nights = Math.max(1, Math.round((new Date(checkout).getTime() - new Date(checkin).getTime())/86400000));
    const {data:promo} = await supabase.from('villa_promos').select('*').eq('kode', kode).maybeSingle();
    if(!promo) return json({berlaku:false, alasan:'Kode promo tidak ditemukan'});

    let roomTypeId = promo.room_type_id ?? null;
    if(roomTypeCode){
      const {data:rt} = await supabase.from('villa_room_types').select('id').eq('code', roomTypeCode).maybeSingle();
      if(!rt) return json({berlaku:false, alasan:'Tipe unit tidak dikenali'});
      roomTypeId = rt.id;
    }
    if(!roomTypeId) return json({berlaku:false, alasan:'Pilih tipe unit dulu untuk melihat harga promo'});

    // Harga normal dihitung dari unit contoh pada tipe itu, jalur yang sama
    // dengan /public/availability, supaya pembanding "hemat" bukan karangan.
    const {data:unitContoh} = await supabase.from('units')
      .select('id,tarif_harian,room_type_id').eq('room_type_id', roomTypeId).limit(1).maybeSingle();
    if(!unitContoh) return json({berlaku:false, alasan:'Tipe unit tidak tersedia'});
    const hargaNormal = await computeStayTarif(unitContoh, checkin, nights);

    const hasil = await hitungHargaPromo(promo, roomTypeId, checkin, checkout, nights, hargaNormal);
    if(!hasil.ok) return json({berlaku:false, alasan:hasil.alasan});
    return json({
      berlaku:true, kode:promo.kode, nama:promo.nama, deskripsi:promo.deskripsi ?? null,
      malam:nights, harga_per_malam:hasil.harga_per_malam, total:hasil.total,
      harga_normal:hasil.harga_normal, hemat:hasil.hemat,
    });
  }

  if(path==='/public/bookings' && m==='POST'){
    const b = await req.json().catch(()=>null);
    if(!b) return err('Body tidak valid');
    const nama = String(b.nama??'').trim();
    const hp = String(b.hp??'').trim();
    const tgl_checkin = b.tgl_checkin;
    const tgl_checkout = b.tgl_checkout;
    const room_type = String(b.room_type??'').trim() || null;
    const catatan = String(b.catatan??'').trim();
    const email = String(b.email??'').trim();
    const promo_code = String(b.promo_code??'').trim().toUpperCase() || null;
    const voucher_code = String(b.voucher_code??'').trim().toUpperCase() || null;

    // Jumlah tamu. Cloudbeds minta adults[] dan children[] per tipe kamar,
    // dan sebelum ini villa-api mengirim angka tetap 1 dewasa 0 anak untuk
    // SETIAP pemesanan web -- bukan karena benar, tapi karena formnya tidak
    // pernah menanyakan (instruksi owner 2026-09-12: "tambahkan pgisian
    // sesuai cloudbeds").
    const adults = Number.isFinite(Number(b.adults)) ? Math.trunc(Number(b.adults)) : 1;
    const children = Number.isFinite(Number(b.children)) ? Math.trunc(Number(b.children)) : 0;

    if(nama.length<2) return err('Nama wajib diisi');
    if(!/^[0-9+][0-9+\-\s]{7,}$/.test(hp)) return err('Nomor WhatsApp tidak valid');
    // Wajib, pilihan owner 2026-09-12. Cloudbeds mewajibkan guestEmail dan
    // sampai sekarang diisi alamat sintetis; sekarang alamat tamu yang asli
    // yang dikirim. Sengaja dicek longgar (ada @ dan titik sesudahnya):
    // validasi email yang ketat menolak alamat sah lebih sering daripada
    // menangkap yang salah, dan yang benar-benar menjaga booking ini tetap
    // nomor WhatsApp di atas.
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Email tidak valid');
    if(adults < 1 || adults > 20) return err('Jumlah dewasa tidak valid');
    if(children < 0 || children > 20) return err('Jumlah anak tidak valid');
    if(!isValidDateStr(tgl_checkin)) return err('Tanggal checkin tidak valid');
    if(!isValidDateStr(tgl_checkout)) return err('Tanggal checkout tidak valid');
    if(new Date(tgl_checkout) <= new Date(tgl_checkin)) return err('Tanggal checkout harus setelah checkin');

    // Voucher investor diperiksa SEBELUM unit dicari: menolak setelah unit
    // terpilih berarti sempat ada baris booking yang dibuat lalu harus
    // dibatalkan, dan itu jalan paling mudah menuju unit yang terkunci oleh
    // pemesanan yang tidak pernah jadi.
    let voucherTerpakai = null;
    if(voucher_code){
      if(promo_code) return err('Kode promo dan kode menginap gratis tidak bisa dipakai bersamaan', 409);
      const cek = await periksaVoucherInvestor(voucher_code, tgl_checkin, tgl_checkout);
      if(!cek.ok) return err(cek.alasan, 409);
      voucherTerpakai = cek;
    }

    let unitsQ = supabase.from('units').select('id,nomor,tarif_harian,room_type_id');
    if(room_type){
      const {data:rt} = await supabase.from('villa_room_types').select('id').eq('code',room_type).maybeSingle();
      if(!rt) return err('Tipe unit tidak dikenali');
      unitsQ = unitsQ.eq('room_type_id', rt.id);
    }
    const {data:candidateUnits, error:unitsErr} = await unitsQ.order('nomor');
    if(unitsErr) return err(unitsErr.message);
    if(!candidateUnits?.length) return err('Tipe unit tidak tersedia', 404);

    const {data:existingBookings} = await supabase.from('bookings')
      .select('unit_id,tgl_checkin,tgl_checkout')
      .in('unit_id', candidateUnits.map(u=>u.id))
      .in('status', ['terjadwal','checkin']);
    const conflicts = findConflicts(existingBookings??[], tgl_checkin, tgl_checkout);
    const freeUnit = candidateUnits.find(u=>!conflicts.has(u.id));
    if(!freeUnit) return err('Maaf, villa sudah penuh untuk tanggal yang dipilih. Silakan pilih tanggal lain atau hubungi kami di WhatsApp.', 409);

    const nights = Math.max(1, Math.round((new Date(tgl_checkout).getTime() - new Date(tgl_checkin).getTime())/86400000));
    // Voucher menggratiskan MALAM PERTAMA saja. Nilainya dihitung dengan
    // fungsi yang sama yang memberi harga seluruh menginap, lalu dikurangkan
    // -- bukan dengan membagi total per malam, karena tarif tiap malam bisa
    // berbeda (akhir pekan, high season). Menginap semalam berarti sisanya
    // nol, dan itu jatuh dengan sendirinya tanpa cabang khusus.
    const hargaNormal = await computeStayTarif(freeUnit, tgl_checkin, nights);
    let nilaiMalamGratis = 0;
    if(voucherTerpakai){
      nilaiMalamGratis = await computeStayTarif(freeUnit, tgl_checkin, 1);
    }
    // Tarif yang belum diatur hanya menggagalkan pemesanan berbayar. Untuk
    // menginap yang seluruhnya gratis tidak ada rupiah yang dipertaruhkan,
    // jadi tidak ada alasan menolaknya.
    const seluruhnyaGratis = !!voucherTerpakai && nights === 1;
    if(!seluruhnyaGratis && hargaNormal<=0) return err('Tarif unit belum diatur, hubungi kami langsung', 409);

    // Promo, kalau tamu membawa kodenya. Harganya dihitung ulang DI SINI --
    // bukan dipercaya dari yang dikirim browser -- oleh fungsi yang sama
    // dengan pratinjaunya, jadi tidak ada celah untuk menitipkan harga
    // sendiri lewat body permintaan.
    let computedTarif = voucherTerpakai ? Math.max(0, hargaNormal - nilaiMalamGratis) : hargaNormal;
    let promoTerpakai = null;
    if(promo_code){
      const {data:promo} = await supabase.from('villa_promos').select('*').eq('kode', promo_code).maybeSingle();
      const hasil = await hitungHargaPromo(promo, freeUnit.room_type_id, tgl_checkin, tgl_checkout, nights, hargaNormal);
      if(!hasil.ok){
        // Promo yang kalah murah dari harga normal bukan kesalahan tamu:
        // pesanannya diteruskan dengan harga normal yang memang lebih baik
        // baginya, bukan ditolak mentah-mentah.
        if(!hasil.tidak_menguntungkan) return err(`Promo tidak bisa dipakai: ${hasil.alasan}`, 409);
      } else {
        computedTarif = hasil.total;
        promoTerpakai = {promo, hasil};
      }
    }

    const {data:g} = await supabase.from('guests').insert({nama, hp, email}).select('id').single();

    // Kode unik pembayaran (owner 2026-09-20): ditambahkan ke total_bayar
    // supaya setiap booking website yang menunggu pembayaran punya nominal
    // PERSIS berbeda dari yang lain. QRIS BTN yang dipakai bersifat statis
    // (satu kode QR yang sama untuk semua transaksi, tidak ada ID transaksi
    // per pemesanan di notifikasi emailnya) -- kalau dua tamu kebetulan
    // pesan tipe unit yang sama di waktu berdekatan, nominalnya akan sama
    // persis dan cron pembaca email (lihat /cron/check-payment-email) tidak
    // bisa tahu email mana untuk siapa. Kode unik ini yang membuat
    // pencocokan otomatis itu selalu tepat satu booking, bukan tebakan.
    // `tarif` TETAP harga asli (tidak dibubuhi) -- yang dibubuhi cuma
    // `total_bayar`, karena itu yang ditagih ke tamu dan yang dicocokkan
    // ke email, sedangkan `tarif` dipakai laporan/rekap harga.
    const kodeUnik = seluruhnyaGratis || computedTarif <= 0 ? 0 : await generateKodeUnikPembayaran();
    const totalDitagih = computedTarif > 0 ? computedTarif + kodeUnik : computedTarif;

    // Status starts as 'menunggu_pembayaran' -- deliberately OUTSIDE the
    // bookings_no_overlap_active exclusion constraint (which only covers
    // 'terjadwal'/'checkin'), so the unit is NOT locked and does not appear
    // in the staff calendar yet. It only becomes a real, unit-locking
    // 'terjadwal' booking once payment is confirmed -- either automatically
    // from the BTN QRIS email (scanPaymentInbox, triggered by the guest's
    // own booking page and by the /cron/check-payment-email safety net) or
    // manually by the owner replying "LUNAS <kode>" on WhatsApp
    // (/bridge/confirm-payment). Guests no longer upload proof of transfer
    // (owner's explicit instruction, 2026-09-21 -- that upload step, and
    // /public/bookings/confirm-payment which handled it, were removed once
    // the email-based auto-confirmation shipped).
    // Menginap gratis langsung 'terjadwal' -- tidak ada yang perlu dibayar,
    // jadi tidak ada alasan menahannya di 'menunggu_pembayaran' lalu
    // membiarkannya dibatalkan mesin sejam kemudian. Kata owner: "dia hanya
    // akan langsung keep di kalender booking".
    const {data:booking, error:bookErr} = await supabase.from('bookings').insert(
      seluruhnyaGratis ? {
        unit_id: freeUnit.id, unit_nomor: freeUnit.nomor, guest_id: g?.id ?? null, guest_nama: nama,
        tipe: 'harian', sumber: 'investor', tgl_checkin, tgl_checkout,
        durasi_malam: nights, checkin_time: '14:00:00', adults, children,
        tarif: 0, total_bayar: 0, status: 'terjadwal',
        voucher_id: voucherTerpakai.voucher.id, is_free_stay: true,
        catatan: `[Menginap gratis investor] Kode ${voucherTerpakai.voucher.kode} atas nama ${voucherTerpakai.pemilik.nama}. Tidak masuk laporan keuangan, dividen, maupun hitungan okupansi.${catatan ? ` -- ${catatan}` : ''}`,
      } : {
        unit_id: freeUnit.id, unit_nomor: freeUnit.nomor, guest_id: g?.id ?? null, guest_nama: nama,
        tipe: 'harian', sumber: voucherTerpakai ? 'investor' : 'website', tgl_checkin, tgl_checkout,
        durasi_malam: nights, checkin_time: '14:00:00', adults, children,
        tarif: computedTarif, total_bayar: totalDitagih, status: 'menunggu_pembayaran',
        // Menginap lebih dari semalam bukan menginap gratis: hanya SATU
        // malamnya yang ditanggung voucher, sisanya dibayar seperti tamu
        // lain. Karena itu is_free_stay tetap false -- malam-malam yang
        // dibayar memang pendapatan sungguhan dan harus ikut terhitung.
        // voucher_id tetap dipasang supaya kodenya tercoret dan tidak bisa
        // dipakai dua kali.
        voucher_id: voucherTerpakai ? voucherTerpakai.voucher.id : null,
        is_free_stay: false,
        catatan: voucherTerpakai
          ? `[Menginap investor] Kode ${voucherTerpakai.voucher.kode} atas nama ${voucherTerpakai.pemilik.nama} -- malam pertama gratis (Rp ${Math.round(nilaiMalamGratis).toLocaleString('id-ID')}), sisanya dibayar.${catatan ? ` -- ${catatan}` : ''}`
          : (catatan ? `[Website] ${catatan}` : '[Website] Booking mandiri dari loonars.id -- menunggu bukti pembayaran QRIS.'),
      }
    ).select().single();
    if(bookErr){
      if(bookErr.code === '23P01') return err('Maaf, unit baru saja dibooking tamu lain. Silakan pilih tanggal/tipe lain.', 409);
      // Unique index bookings_voucher_sekali_pakai. Inilah penjaga
      // sesungguhnya untuk "sekali pakai": dua permintaan kembar dengan kode
      // yang sama sama-sama lolos pemeriksaan di atas, tapi hanya satu yang
      // bisa melewati database.
      if(bookErr.code === '23505' && /voucher/i.test(bookErr.message||'')) return err('Kode ini baru saja dipakai.', 409);
      return err(bookErr.message);
    }

    // Pemakaian promo dicatat setelah booking-nya benar-benar jadi, supaya
    // kuota tidak habis oleh pemesanan yang gagal di exclusion constraint.
    // Harga normalnya ikut disimpan: tanpa itu, pertanyaan "promo ini
    // sebenarnya memotong berapa" tidak akan pernah bisa dijawab.
    if(promoTerpakai){
      await supabase.from('villa_promo_redemptions').insert({
        promo_id: promoTerpakai.promo.id,
        booking_id: booking.id,
        guest_id: g?.id ?? null,
        harga_normal: promoTerpakai.hasil.harga_normal,
        harga_promo: promoTerpakai.hasil.total,
        malam: nights,
      });
      await supabase.from('villa_promos')
        .update({terpakai: Number(promoTerpakai.promo.terpakai ?? 0) + 1, updated_at: new Date().toISOString()})
        .eq('id', promoTerpakai.promo.id);
    }

    // Menginap gratis berhenti di sini: tidak ada kode pembayaran, tidak ada
    // pesan "balas LUNAS", dan unitnya langsung didorong ke Cloudbeds supaya
    // OTA berhenti menjualnya (keputusan owner 12 Sep 2026, setelah risiko
    // tabrakan dengan tamu berbayar dijelaskan).
    if(seluruhnyaGratis){
      await pushBookingToCloudbeds(booking);
      await notif(freeUnit.id, 'all', 'booking', `Menginap gratis investor -- Unit ${freeUnit.nomor}`,
        `${nama} (${hp}) - ${tgl_checkin} s/d ${tgl_checkout} - kode ${voucherTerpakai.voucher.kode} atas nama ${voucherTerpakai.pemilik.nama}. Unit terkunci; tidak masuk pendapatan, dividen, maupun okupansi.`, booking.id);
      const notifyVoucher = await getSetting('villa_notify');
      await sendWa(notifyVoucher?.owner_hp ?? null,
        `Menginap gratis investor\n\n${voucherTerpakai.pemilik.nama}\nKode ${voucherTerpakai.voucher.kode}\nUnit ${freeUnit.nomor}\n${tgl_checkin} s/d ${tgl_checkout} (1 malam)\n\nUnit sudah terkunci di kalender. Tidak dihitung sebagai pendapatan, dividen, atau okupansi.`,
        {booking_id: booking.id, unit_id: freeUnit.id, template_type:'investor_free_stay'});
      return json({
        booking_id: booking.id, unit_nomor: freeUnit.nomor,
        tgl_checkin, tgl_checkout, durasi_malam: nights,
        tarif: 0, total_bayar: 0, status: booking.status,
        menginap_gratis: {kode: voucherTerpakai.voucher.kode, atas_nama: voucherTerpakai.pemilik.nama},
        promo: null,
      }, 201);
    }

    const kode = paymentCode(booking.id);
    await notif(freeUnit.id, 'all', 'booking', `Booking baru dari Website (menunggu pembayaran) -- Unit ${freeUnit.nomor}`,
      `${nama} (${hp}) - ${tgl_checkin} s/d ${tgl_checkout} - Rp ${Math.round(totalDitagih).toLocaleString('id-ID')} -- unit belum terkunci, menunggu konfirmasi pembayaran (kode ${kode})`, booking.id);

    // WA ke owner supaya dia bisa mengunci unit hanya dengan membalas kode
    // ini begitu notifikasi QRIS masuk di HP-nya. Nomornya dari
    // integration_settings.villa_notify.owner_hp -- kalau belum diisi,
    // sendWa() mencatat 'skipped_no_phone' dan booking tetap berjalan
    // normal, jadi fitur ini tidak pernah bisa menggagalkan pemesanan.
    // Nominal yang disebutkan ke owner sudah termasuk kode unik 3 digit di
    // belakangnya (lihat generateKodeUnikPembayaran) -- itu jugalah yang
    // ditampilkan ke tamu, supaya keduanya melihat angka yang sama persis.
    const notifySetting = await getSetting('villa_notify');
    await sendWa(notifySetting?.owner_hp ?? null,
      `Booking baru dari website\n\n${nama} (${hp})\nUnit ${freeUnit.nomor}\n${tgl_checkin} s/d ${tgl_checkout} (${nights} malam)\nTotal (dengan kode unik): Rp ${Math.round(totalDitagih).toLocaleString('id-ID')}${promoTerpakai ? `\nPromo ${promoTerpakai.promo.kode} (normal Rp ${Math.round(promoTerpakai.hasil.harga_normal).toLocaleString('id-ID')})` : ''}${voucherTerpakai ? `\nKode investor ${voucherTerpakai.voucher.kode} (${voucherTerpakai.pemilik.nama}) -- malam pertama gratis Rp ${Math.round(nilaiMalamGratis).toLocaleString('id-ID')}` : ''}\n\nKalau dana sudah masuk, sistem akan mengonfirmasi otomatis lewat email. Kalau belum juga terkonfirmasi, balas:\nLUNAS ${kode}`,
      {booking_id: booking.id, unit_id: freeUnit.id, template_type:'website_booking_awaiting_payment'});

    return json({
      booking_id: booking.id, unit_nomor: freeUnit.nomor,
      tgl_checkin, tgl_checkout, durasi_malam: nights,
      tarif: computedTarif, total_bayar: totalDitagih, kode_unik: kodeUnik, status: booking.status,
      promo: promoTerpakai ? {kode: promoTerpakai.promo.kode, nama: promoTerpakai.promo.nama, harga_normal: promoTerpakai.hasil.harga_normal, hemat: promoTerpakai.hasil.hemat} : null,
      menginap_gratis: voucherTerpakai ? {kode: voucherTerpakai.voucher.kode, malam_gratis: 1, hemat: nilaiMalamGratis} : null,
    }, 201);
  }

  // Tamu menanyakan apakah pembayarannya sudah dikonfirmasi owner. Dipanggil
  // berkala oleh halaman booking di loonars.id supaya tombol Cetak Invoice
  // terbuka sendiri begitu owner membalas WA -- tamu tidak perlu upload
  // bukti transfer apa pun lagi.
  if(path==='/public/bookings/status' && m==='GET'){
    const booking_id = url.searchParams.get('booking_id') ?? '';
    const hp = (url.searchParams.get('hp') ?? '').trim();
    if(!/^[0-9a-f-]{36}$/i.test(booking_id)) return err('booking_id tidak valid');
    if(!hp) return err('Nomor WhatsApp wajib diisi');

    const {data:booking} = await supabase.from('bookings')
      .select('id,guest_id,sumber,status,invoice_no,catatan,created_at').eq('id',booking_id).maybeSingle();
    if(!booking) return err('Booking tidak ditemukan', 404);
    if(booking.sumber !== 'website') return err('Booking ini tidak bisa dicek lewat jalur ini', 403);

    // Nomor WA tamu adalah kuncinya, sama seperti confirm-payment dan
    // invoice: tanpa ini siapa pun yang menebak sebuah uuid bisa mengintip
    // status booking orang lain.
    let guestHp = null;
    if(booking.guest_id){
      const {data:g} = await supabase.from('guests').select('hp').eq('id',booking.guest_id).maybeSingle();
      guestHp = g?.hp ?? null;
    }
    if(!guestHp || guestHp.trim() !== hp) return err('Nomor WhatsApp tidak cocok dengan booking ini', 403);

    // hold_expires_at dikirim supaya halaman tamu bisa menghitung mundur
    // sisa waktunya sendiri, dan cancelled/expired supaya halaman itu berhenti
    // menampilkan QRIS begitu booking-nya tidak berlaku lagi. Sebelum ini
    // halaman tamu hanya mengenal 'confirmed', jadi booking yang sudah
    // dibatalkan tetap tampil sebagai "Selesaikan Pembayaran" selamanya.
    const created = Date.parse(booking.created_at);
    const holdExpiresAt = Number.isFinite(created)
      ? new Date(created + PENDING_PAYMENT_HOLD_MINUTES*60*1000).toISOString()
      : null;

    return json({
      status: booking.status,
      confirmed: booking.status === 'terjadwal',
      cancelled: booking.status === 'batal',
      expired: booking.status === 'batal' && String(booking.catatan ?? '').includes(EXPIRED_HOLD_MARK),
      hold_expires_at: booking.status === 'menunggu_pembayaran' ? holdExpiresAt : null,
      hold_minutes: PENDING_PAYMENT_HOLD_MINUTES,
      invoice_no: booking.invoice_no ?? null,
    });
  }

  // Owner mengonfirmasi dana QRIS sudah masuk, dengan membalas WA
  // "LUNAS <kode>". Dipanggil server-to-server oleh Mkhsistem (penerima WA
  // masuk), memakai shared secret yang sama dengan jembatan lain.
  //
  // Pencocokannya lewat kode yang diturunkan dari booking_id, dan HANYA di
  // antara booking website yang masih menunggu pembayaran -- jadi balasan
  // tidak pernah bisa mengunci booking yang salah, dan kode lama yang sudah
  // dipakai tidak melakukan apa-apa selain melaporkan sudah dikonfirmasi.
  // Pushes any confirmed booking Cloudbeds still doesn't know about.
  //
  // The inline push at confirmation time is the normal path; this is what
  // makes it reliable rather than best-effort. A push can fail for reasons
  // that have nothing to do with the booking -- Cloudbeds down, a network
  // blip, an unmapped room fixed later -- and without a retry that room
  // silently stays on sale on every OTA while a real guest holds it.
  //
  // It also repairs everything booked BEFORE the inline push existed:
  // website bookings were never pushed at all, so Cloudbeds believed those
  // units were empty.
  //
  // Safe to run on a schedule: pushBookingToCloudbeds refuses any booking
  // that already has a cloudbeds_reservation_id, so a room is never
  // reserved twice. Past stays are skipped -- pushing a checkout that has
  // already happened would only create a phantom reservation.
  // Moves an existing Cloudbeds reservation to the room type a booking now
  // has. Needed because the push only ever CREATES: once a reservation
  // exists, changing the unit on our side left Cloudbeds holding the old
  // room type, and the two systems quietly disagreed about which room was
  // sold -- the exact problem the outbound push was built to end.
  //
  // First real case: a guest upgraded from Standard to Sawah View as a
  // free promotion (owner, 2026-09-12). Room moves and upgrades are
  // ordinary hotel work, so this is an endpoint rather than a one-off.
  if(path==='/bridge/resync-booking-room' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi',503);
    const provided = req.headers.get('x-internal-secret') ?? '';
    if(!await secretsMatch(provided, bridge.secret)) return err('Unauthorized',401);

    const b = await req.json().catch(()=>null);
    const booking_id = String(b?.booking_id ?? '').trim();
    if(!/^[0-9a-f-]{36}$/i.test(booking_id)) return err('booking_id tidak valid');

    const {data:booking} = await supabase.from('bookings')
      .select('id,unit_id,unit_nomor,tgl_checkin,tgl_checkout,cloudbeds_reservation_id,adults,children').eq('id',booking_id).maybeSingle();
    if(!booking) return err('Booking tidak ditemukan',404);
    if(!booking.cloudbeds_reservation_id) return json({success:false, reason:'not_pushed_yet'});

    const apiKey = cloudbedsApiKey();
    if(!apiKey) return err('CLOUDBEDS_API_KEY belum dikonfigurasi',503);

    const {data:mapping} = await supabase.from('cloudbeds_room_mapping')
      .select('cloudbeds_room_id').eq('unit_id', booking.unit_id).maybeSingle();
    if(!mapping?.cloudbeds_room_id) return json({success:false, reason:'no_cloudbeds_mapping_for_unit'});

    const roomsRes = await fetch(`${CLOUDBEDS_API_BASE}/getRooms`, {headers:{'x-api-key':apiKey}});
    const roomsBody = await roomsRes.json().catch(()=>null);
    let roomTypeID = null;
    for(const entry of (roomsBody?.data ?? [])){
      const candidates = Array.isArray(entry.rooms) ? entry.rooms : [entry];
      for(const r of candidates){
        if(String(r.roomID) === String(mapping.cloudbeds_room_id)){ roomTypeID = entry.roomTypeID ?? r.roomTypeID ?? null; break; }
      }
      if(roomTypeID) break;
    }
    if(!roomTypeID) return json({success:false, reason:'room_type_not_found_for_mapped_room'});

    // The spec is explicit here in a way PostReservationRequest never was:
    // once `rooms` is sent, roomTypeID, checkinDate, checkoutDate, adults
    // and children are each "Mandatory if rooms are sent". Sending only
    // the room type got "Parameter checkinDate is required"; the rest are
    // included now rather than discovered one rejection at a time.
    const form = new URLSearchParams();
    form.set('reservationID', String(booking.cloudbeds_reservation_id));
    form.set('rooms[0][roomTypeID]', String(roomTypeID));
    form.set('rooms[0][checkinDate]', String(booking.tgl_checkin));
    form.set('rooms[0][checkoutDate]', String(booking.tgl_checkout ?? booking.tgl_checkin));
    // Dari booking-nya, bukan dipatok: memindahkan kamar tidak boleh
    // sekalian menurunkan jumlah tamu di Cloudbeds jadi 1 dewasa 0 anak.
    form.set('rooms[0][adults]', String(Math.max(1, Math.trunc(Number(booking.adults ?? 1)) || 1)));
    form.set('rooms[0][children]', String(Math.max(0, Math.trunc(Number(booking.children ?? 0)) || 0)));
    const propertyId = (Deno.env.get('CLOUDBEDS_PROPERTY_ID') ?? '').trim();
    if(propertyId) form.set('propertyID', propertyId);

    // PUT, not POST. The spec declares this path under `put:` -- every
    // other Cloudbeds call in this file is a POST, and copying that shape
    // here got HTTP 404 {"error":"Unknown method."}, which reads like a
    // missing endpoint rather than a wrong verb.
    const res = await fetch(`${CLOUDBEDS_API_BASE}/putReservation`, {
      method:'PUT',
      headers:{'x-api-key':apiKey,'Content-Type':'application/x-www-form-urlencoded'},
      body: form.toString(),
    });
    const body = await res.json().catch(()=>null);
    const ok = res.ok && body?.success !== false;

    await supabase.from('cloudbeds_events_log').insert({
      reservation_id: String(booking.cloudbeds_reservation_id),
      event_type: 'outbound.reservation.room_changed',
      payload: {booking_id, unit_nomor: booking.unit_nomor, roomTypeID, response: body},
      matched: ok,
      error: ok ? null : (body?.message ?? `HTTP ${res.status}`),
    });

    return json({success: ok, unit_nomor: booking.unit_nomor, roomTypeID,
      reservation_id: booking.cloudbeds_reservation_id, message: body?.message ?? null});
  }

  if(path==='/bridge/push-unsynced-bookings' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi (integration_settings.vercel_bridge.secret)',503);
    const provided = req.headers.get('x-internal-secret') ?? '';
    if(!await secretsMatch(provided, bridge.secret)) return err('Unauthorized',401);

    const today = todayWIB();
    const {data:pending} = await supabase.from('bookings')
      .select('id,unit_id,unit_nomor,guest_id,guest_nama,tgl_checkin,tgl_checkout,status,sumber,cloudbeds_reservation_id,adults,children')
      .is('cloudbeds_reservation_id', null)
      .neq('sumber', 'cloudbeds')
      .in('status', ['terjadwal','checkin'])
      .gte('tgl_checkout', today);

    const pushed = [];
    for(const b of (pending ?? [])){
      await pushBookingToCloudbeds(b);
      const {data:after} = await supabase.from('bookings').select('cloudbeds_reservation_id').eq('id', b.id).maybeSingle();
      pushed.push({
        booking_id: b.id, unit_nomor: b.unit_nomor, guest_nama: b.guest_nama,
        tgl_checkin: b.tgl_checkin, tgl_checkout: b.tgl_checkout,
        cloudbeds_reservation_id: after?.cloudbeds_reservation_id ?? null,
        ok: !!after?.cloudbeds_reservation_id,
      });
    }
    return json({success:true, candidates:(pending ?? []).length, pushed});
  }

  if(path==='/bridge/confirm-payment' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi (integration_settings.vercel_bridge.secret)',503);
    const provided = req.headers.get('x-internal-secret') ?? '';
    if(!await secretsMatch(provided, bridge.secret)) return err('Unauthorized',401);

    const b = await req.json().catch(()=>null);
    const code = String(b?.code ?? '').trim().toUpperCase();
    if(!/^[0-9A-F]{6}$/.test(code)) return json({success:false, reason:'invalid_code'});

    // adults/children ikut dibawa: pushBookingToCloudbeds membacanya dari
    // objek booking ini, jadi kolom yang tidak di-select akan diam-diam
    // jatuh ke default 1 dewasa 0 anak -- persis bug yang sedang diperbaiki.
    const SELECT_COLS = 'id,unit_id,unit_nomor,guest_id,guest_nama,tgl_checkin,tgl_checkout,total_bayar,created_at,status,invoice_no,cloudbeds_reservation_id,catatan,adults,children';

    const {data:pending} = await supabase.from('bookings')
      .select(SELECT_COLS)
      .eq('sumber','website').eq('status','menunggu_pembayaran');
    let booking = (pending ?? []).find(x => paymentCode(x.id) === code) ?? null;

    // Tamu yang membayar di menit ke-59 dan owner yang membalas di menit
    // ke-70 adalah kejadian biasa, bukan kasus langka. Tanpa cabang ini,
    // pembatalan otomatis 1 jam akan menjawab "kode tidak ditemukan" untuk
    // tamu yang uangnya sudah masuk -- persis kegagalan yang paling mahal
    // dari fitur ini. Jadi booking yang dibatalkan MESIN (bukan manusia)
    // masih bisa dihidupkan kembali; yang dibatalkan staf tidak.
    let revived = false;
    if(!booking){
      const {data:cancelled} = await supabase.from('bookings')
        .select(SELECT_COLS)
        .eq('sumber','website').eq('status','batal');
      const expired = (cancelled ?? [])
        .filter(x => String(x.catatan ?? '').includes(EXPIRED_HOLD_MARK))
        .find(x => paymentCode(x.id) === code) ?? null;
      if(expired){ booking = expired; revived = true; }
    }

    if(!booking){
      // Mungkin sudah dikonfirmasi sebelumnya -- balasan ganda dari owner
      // harus aman, bukan error.
      const {data:already} = await supabase.from('bookings')
        .select('id,unit_nomor,guest_nama,invoice_no,status').eq('sumber','website').eq('status','terjadwal');
      const done = (already ?? []).find(x => paymentCode(x.id) === code) ?? null;
      if(done) return json({success:true, already_confirmed:true, unit_nomor:done.unit_nomor, guest_nama:done.guest_nama, invoice_no:done.invoice_no});
      return json({success:false, reason:'not_found'});
    }

    const invoice_no = booking.invoice_no ?? invoiceNoFor(booking);
    const patch = { bukti_pembayaran_at: new Date().toISOString(), invoice_no };

    const {error:lockErr} = await supabase.from('bookings')
      .update({...patch, status:'terjadwal'}).eq('id', booking.id);

    if(lockErr){
      if(lockErr.code !== '23P01') return err(lockErr.message, 500);
      // Unit keburu dikunci booking lain untuk tanggal yang sama. Tamu sudah
      // membayar, jadi pembayarannya tetap dicatat dan invoice tetap terbit;
      // yang tidak dilakukan hanyalah memaksa unitnya masuk kalender.
      await supabase.from('bookings').update(patch).eq('id', booking.id);
      await notif(null, 'all', 'transfer', 'KONFLIK UNIT -- Booking Website perlu dijadwalkan ulang',
        `Booking ${String(booking.id).slice(0,8)} (Unit ${booking.unit_nomor}, ${booking.tgl_checkin} s/d ${booking.tgl_checkout}) sudah dikonfirmasi lunas tapi unit sudah terisi booking lain -- mohon segera hubungi tamu untuk reschedule/unit pengganti.`, booking.id);
      return json({success:false, reason:'unit_conflict', unit_nomor:booking.unit_nomor, guest_nama:booking.guest_nama, invoice_no});
    }

    await notif(null, 'all', 'transfer', `Pembayaran dikonfirmasi -- Unit ${booking.unit_nomor} terkunci`,
      `Booking ${String(booking.id).slice(0,8)} (${booking.tgl_checkin} s/d ${booking.tgl_checkout}) dikonfirmasi lunas oleh owner via WhatsApp, unit sudah masuk kalender.${revived ? ` Booking ini sempat kedaluwarsa lewat ${PENDING_PAYMENT_HOLD_MINUTES} menit dan dihidupkan kembali oleh konfirmasi ini.` : ''}`, booking.id);

    // Tell Cloudbeds the room is sold, so it stops offering it on every
    // OTA (owner 2026-09-12: "agar cloudbeds mngetahui berapa kamar yg ada
    // isi dan kosong"). Website bookings were NEVER pushed before this --
    // pushBookingToCloudbeds was only ever called from the staff
    // POST /bookings route -- so a guest booking on loonars.id left the
    // unit looking empty to Airbnb, Booking.com and Agoda.
    //
    // Deliberately here and not at booking time: until this moment the
    // booking is 'menunggu_pembayaran' and holds nothing, so pushing then
    // would block real OTA inventory on an unpaid hold and leave a junk
    // reservation in Cloudbeds whenever a guest walked away.
    await pushBookingToCloudbeds({...booking, status:'terjadwal'});

    return json({
      success:true, revived, unit_nomor:booking.unit_nomor, guest_nama:booking.guest_nama,
      tgl_checkin:booking.tgl_checkin, tgl_checkout:booking.tgl_checkout,
      total_bayar:booking.total_bayar, invoice_no,
    });
  }

  // ── Jembatan promo untuk AI (Mkhsistem) ────────────────────────────────
  // Owner memilih: AI mengusulkan, owner menyetujui lewat WA. Jadi alurnya
  // sengaja dipecah tiga: cari calon penerima -> ajukan (tersimpan sebagai
  // baris yang menunggu) -> kirim hanya setelah disetujui. Tidak ada satu
  // panggilan pun yang bisa langsung mengirim promo ke tamu.

  // Siapa yang layak dikirimi. Bukan seluruh isi database tamu:
  // hanya yang punya nomor, belum berhenti-langganan, pernah benar-benar
  // menginap, dan tidak baru saja dikirimi promo.
  if(path==='/bridge/promo-candidates' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi',503);
    if(!await secretsMatch(req.headers.get('x-internal-secret') ?? '', bridge.secret)) return err('Unauthorized',401);

    const b = await req.json().catch(()=>({}));
    const jedaHari = Math.max(0, Math.trunc(Number(b?.jeda_hari ?? 30)));
    const batas = Math.min(500, Math.max(1, Math.trunc(Number(b?.limit ?? 200))));
    const ambangJeda = new Date(Date.now() - jedaHari*86400000).toISOString();

    const {data, error} = await supabase.from('villa_guest_directory').select('*');
    if(error) return err(error.message);
    const calon = (data ?? []).filter(r =>
      String(r.hp ?? '').trim().length >= 8 &&
      r.wa_opt_out !== true &&
      Number(r.jumlah_menginap ?? 0) >= 1 &&
      (!r.terakhir_dikirimi_promo || r.terakhir_dikirimi_promo < ambangJeda)
    ).slice(0, batas);

    return json({
      jumlah: calon.length,
      jeda_hari: jedaHari,
      penerima: calon.map(r => ({
        guest_id: r.guest_id, nama: r.nama, hp: r.hp,
        jumlah_menginap: r.jumlah_menginap, terakhir_menginap: r.terakhir_menginap,
      })),
    });
  }

  // Mengajukan kiriman. Ini TIDAK mengirim apa pun -- hanya menyimpan
  // usulannya beserta kode yang harus dibalas owner.
  if(path==='/bridge/promo-propose' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi',503);
    if(!await secretsMatch(req.headers.get('x-internal-secret') ?? '', bridge.secret)) return err('Unauthorized',401);

    const b = await req.json().catch(()=>null);
    const kodePromo = String(b?.promo_kode ?? '').trim().toUpperCase();
    const pesan = String(b?.pesan ?? '').trim();
    const penerima = Array.isArray(b?.penerima) ? b.penerima : [];
    if(!kodePromo) return err('promo_kode wajib diisi');
    if(pesan.length < 10) return err('Isi pesan promo terlalu pendek');
    if(!penerima.length) return json({success:false, reason:'tidak_ada_penerima'});

    const {data:promo} = await supabase.from('villa_promos').select('*').eq('kode', kodePromo).maybeSingle();
    if(!promo) return json({success:false, reason:'promo_tidak_ditemukan'});
    if(promo.aktif !== true) return json({success:false, reason:'promo_tidak_aktif'});

    // Kode konfirmasi 6 heksa, pola yang sama dengan LUNAS supaya owner
    // tidak perlu menghafal dua bentuk balasan yang berbeda.
    let kodeKonfirmasi = '';
    for(let coba=0; coba<5; coba++){
      const kandidat = Array.from(crypto.getRandomValues(new Uint8Array(3))).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
      const {data:bentrok} = await supabase.from('villa_promo_batches').select('id').eq('kode_konfirmasi', kandidat).maybeSingle();
      if(!bentrok){ kodeKonfirmasi = kandidat; break; }
    }
    if(!kodeKonfirmasi) return err('Gagal membuat kode konfirmasi', 500);

    const {data:batch, error} = await supabase.from('villa_promo_batches').insert({
      promo_id: promo.id,
      kode_konfirmasi: kodeKonfirmasi,
      alasan: String(b?.alasan ?? '').trim() || null,
      okupansi_persen: b?.okupansi_persen == null ? null : Number(b.okupansi_persen),
      jumlah_penerima: penerima.length,
      pesan,
      hasil: {penerima},
      status: 'menunggu',
    }).select().single();
    if(error) return err(error.message);

    return json({success:true, batch_id:batch.id, kode_konfirmasi:kodeKonfirmasi, jumlah_penerima:penerima.length, promo:{kode:promo.kode, nama:promo.nama}});
  }

  // Owner membalas "PROMO <kode>". Baru di sinilah daftar penerimanya
  // diserahkan untuk dikirim.
  if(path==='/bridge/promo-approve' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi',503);
    if(!await secretsMatch(req.headers.get('x-internal-secret') ?? '', bridge.secret)) return err('Unauthorized',401);

    const b = await req.json().catch(()=>null);
    const kode = String(b?.kode ?? '').trim().toUpperCase();
    if(!/^[0-9A-F]{6}$/.test(kode)) return json({success:false, reason:'invalid_code'});

    const {data:batch} = await supabase.from('villa_promo_batches').select('*').eq('kode_konfirmasi', kode).maybeSingle();
    if(!batch) return json({success:false, reason:'not_found'});
    if(batch.status === 'terkirim') return json({success:true, already_sent:true, jumlah_penerima:batch.jumlah_penerima});
    if(batch.status === 'ditolak') return json({success:false, reason:'ditolak'});

    // Usulan basi tidak boleh dihidupkan berhari-hari kemudian: alasan yang
    // membuatnya diajukan (okupansi rendah pekan ini) sudah tidak berlaku.
    const umurJam = (Date.now() - Date.parse(batch.created_at)) / 3600000;
    if(umurJam > 48){
      await supabase.from('villa_promo_batches').update({status:'kedaluwarsa'}).eq('id', batch.id);
      return json({success:false, reason:'kedaluwarsa', umur_jam: Math.round(umurJam)});
    }

    const {data:promo} = await supabase.from('villa_promos').select('kode,nama,aktif').eq('id', batch.promo_id).maybeSingle();
    if(promo?.aktif !== true) return json({success:false, reason:'promo_tidak_aktif'});

    await supabase.from('villa_promo_batches').update({status:'disetujui', approved_at:new Date().toISOString()}).eq('id', batch.id);

    // Dikirim DI SINI, bukan dengan menyerahkan daftar nomor tamu ke
    // pemanggil. Mkhsistem tetap jadi jalur keluar WhatsApp-nya (sendWa
    // memanggil jembatannya), tapi daftar kontak tamu tidak pernah
    // meninggalkan villa-api -- tempat data itu memang tinggal.
    //
    // Dibatasi per panggilan supaya tidak ada satu permintaan yang berjalan
    // menit-menitan lalu mati di tengah jalan dengan separuh tamu terkirim
    // dan tidak ada catatan siapa saja. Sisanya dikirim oleh panggilan
    // berikutnya, dan indeks unik (batch_id, guest_id) membuat pengulangan
    // tidak pernah mengirim dua kali ke orang yang sama.
    // ANGKA INI PERNAH 40, DAN ITU TERLALU BANYAK.
    //
    // Pada 13 Sep 2026 nomor WhatsApp villa kena tanda spam lalu terputus
    // lima jam -- padahal promo massal belum pernah sekali pun dinyalakan.
    // Yang membuat nomor diblokir bukan jumlah pesan per bulan, tapi
    // ledakan pesan ke nomor yang belum pernah mengajak bicara duluan.
    // Empat puluh sekaligus persis berbentuk seperti itu. Kalau nomor villa
    // sampai diblokir permanen, yang mati bukan cuma promo: konfirmasi
    // pembayaran, notifikasi booking, dan seluruh balasan LUNAS ikut mati.
    //
    // Karena itu ada DUA batas, bukan satu:
    //  - per panggilan: sedikit saja, sisanya menunggu owner membalas
    //    PROMO lagi -- jeda manusiawi yang tidak bisa ditiru mesin.
    //  - per hari: batas keras lintas SEMUA batch, supaya membalas PROMO
    //    sepuluh kali berturut-turut tetap tidak bisa menembusnya.
    const cfgPromo = await getSetting('villa_promo_auto');
    const angkaAman = (nilai, bawaan, maks) => {
      const n = Math.trunc(Number(nilai));
      return Number.isFinite(n) && n > 0 ? Math.min(n, maks) : bawaan;
    };
    const MAKS_PER_PANGGILAN = angkaAman(cfgPromo?.maks_per_panggilan, 12, 25);
    const MAKS_PER_HARI = angkaAman(cfgPromo?.maks_per_hari, 15, 40);

    const semua = Array.isArray(batch.hasil?.penerima) ? batch.hasil.penerima : [];
    const {data:sudah} = await supabase.from('villa_promo_sends').select('guest_id').eq('batch_id', batch.id);
    const sudahSet = new Set((sudah ?? []).map(r => String(r.guest_id)));
    const antre = semua.filter(r => !sudahSet.has(String(r.guest_id)));

    // Dihitung lintas batch, bukan hanya batch ini -- batas harian yang
    // hanya melihat satu batch bisa ditembus dengan membuat batch baru.
    // Kolomnya sent_at, bukan created_at -- tabel ini tidak punya created_at.
    // Salah nama kolom di sini tidak melempar galat yang terlihat: count
    // kembali null, batasnya terbaca 0 terpakai, dan pengamannya diam-diam
    // mati. Karena itu galatnya diperiksa dan pengiriman DIBATALKAN kalau
    // jumlahnya tidak bisa dipastikan -- pengaman yang tidak bisa menghitung
    // harus menutup, bukan membuka.
    const sejak24Jam = new Date(Date.now() - 24*3600*1000).toISOString();
    const {count:terkirim24Jam, error:galatHitung} = await supabase.from('villa_promo_sends')
      .select('id', {count:'exact', head:true})
      .eq('status','terkirim')
      .gte('sent_at', sejak24Jam);
    if(galatHitung){
      console.error('[promo-approve] jatah harian tidak bisa dihitung', galatHitung.message);
      return json({success:false, reason:'batas_harian_tidak_terbaca', error:galatHitung.message});
    }
    const sisaJatahHarian = Math.max(0, MAKS_PER_HARI - Number(terkirim24Jam ?? 0));
    if(sisaJatahHarian === 0){
      return json({
        success:false, reason:'batas_harian',
        maks_per_hari:MAKS_PER_HARI, terkirim_24_jam:Number(terkirim24Jam ?? 0),
        sisa:antre.length,
      });
    }

    const giliran = antre.slice(0, Math.min(MAKS_PER_PANGGILAN, sisaJatahHarian));

    let terkirim = 0, gagal = 0;
    for(const penerima of giliran){
      const hp = String(penerima?.hp ?? '').trim();
      const guest_id = /^[0-9a-f-]{36}$/i.test(String(penerima?.guest_id ?? '')) ? penerima.guest_id : null;
      if(!hp){
        await supabase.from('villa_promo_sends').insert({batch_id:batch.id, promo_id:batch.promo_id, guest_id, tujuan:null, status:'dilewati', error:'tanpa nomor'});
        continue;
      }
      // Status berhenti-langganan dicek ULANG di detik pengiriman, bukan
      // hanya saat usulan dibuat: tamu bisa saja minta berhenti di antara
      // usulan dan persetujuan owner.
      if(guest_id){
        const {data:mk} = await supabase.from('villa_guest_marketing').select('wa_opt_out').eq('guest_id', guest_id).maybeSingle();
        if(mk?.wa_opt_out === true){
          await supabase.from('villa_promo_sends').insert({batch_id:batch.id, promo_id:batch.promo_id, guest_id, tujuan:hp, status:'dilewati', error:'berhenti langganan'});
          continue;
        }
      }
      const pesan = String(batch.pesan).replace(/\{nama\}/g, String(penerima?.nama ?? 'Bapak/Ibu'));
      // Jeda acak antar pesan. Pengiriman beruntun dengan jarak yang persis
      // sama adalah pola yang paling mudah dikenali sebagai mesin. Sengaja
      // kecil (1,2-2,8 detik) supaya seluruh giliran tetap selesai jauh di
      // bawah batas waktu permintaan -- yang menjaga nomor adalah batas
      // jumlahnya, jeda ini hanya membuat iramanya tidak seragam.
      if(terkirim + gagal > 0) await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random()*1600)));
      const berhasil = await sendWa(hp, pesan, {template_type:'villa_promo'});
      await supabase.from('villa_promo_sends').insert({
        batch_id:batch.id, promo_id:batch.promo_id, guest_id, tujuan:hp,
        status: berhasil ? 'terkirim' : 'gagal',
        error: berhasil ? null : 'jembatan WhatsApp tidak menjawab sukses',
      });
      if(berhasil) terkirim++; else gagal++;
      // Penanda "baru saja dikirimi promo" hanya dipasang kalau pesannya
      // memang terkirim -- kalau tidak, tamu ini akan terkunci dari kiriman
      // berikutnya selama 30 hari karena pesan yang tidak pernah sampai.
      if(guest_id && berhasil){
        await supabase.from('villa_guest_marketing').upsert(
          {guest_id, terakhir_dikirimi_promo:new Date().toISOString(), updated_at:new Date().toISOString()},
          {onConflict:'guest_id'});
      }
    }

    const sisa = Math.max(0, antre.length - giliran.length);
    if(sisa === 0){
      await supabase.from('villa_promo_batches').update({status:'terkirim', sent_at:new Date().toISOString()}).eq('id', batch.id);
    }

    return json({
      success:true, batch_id:batch.id,
      promo:{kode:promo.kode, nama:promo.nama},
      terkirim, gagal, sisa, total_penerima: semua.length,
    });
  }

  // Tamu membalas BERHENTI. Pesan promo menjanjikan ini, jadi ia harus
  // benar-benar bekerja -- janji berhenti-langganan yang tidak berfungsi
  // lebih buruk daripada tidak menjanjikannya sama sekali.
  //
  // Dicocokkan lewat 9 digit terakhir, cara yang sama dengan pencocokan
  // nomor di tempat lain: nomor yang sama bisa tersimpan sebagai 0813...,
  // +62813..., atau 62813....
  if(path==='/bridge/guest-opt-out' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi',503);
    if(!await secretsMatch(req.headers.get('x-internal-secret') ?? '', bridge.secret)) return err('Unauthorized',401);

    const b = await req.json().catch(()=>null);
    const digits = String(b?.hp ?? '').replace(/\D/g,'');
    const suffix = digits.slice(-9);
    if(suffix.length < 9) return json({success:false, reason:'nomor_tidak_valid'});

    const {data:semua} = await supabase.from('guests').select('id,nama,hp').not('hp','is',null);
    const cocok = (semua ?? []).filter(g => String(g.hp ?? '').replace(/\D/g,'').endsWith(suffix));
    if(!cocok.length) return json({success:false, reason:'tamu_tidak_ditemukan'});

    for(const g of cocok){
      await supabase.from('villa_guest_marketing').upsert(
        {guest_id:g.id, wa_opt_out:true, updated_at:new Date().toISOString()},
        {onConflict:'guest_id'});
    }
    return json({success:true, jumlah:cocok.length, nama:cocok[0].nama ?? null});
  }

  // Owner menolak usulan. Tanpa ini, satu-satunya cara menolak adalah
  // mendiamkannya sampai kedaluwarsa 48 jam -- dan usulan yang didiamkan
  // tidak bisa dibedakan dari yang belum terbaca.
  if(path==='/bridge/promo-reject' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi',503);
    if(!await secretsMatch(req.headers.get('x-internal-secret') ?? '', bridge.secret)) return err('Unauthorized',401);
    const b = await req.json().catch(()=>null);
    const kode = String(b?.kode ?? '').trim().toUpperCase();
    if(!/^[0-9A-F]{6}$/.test(kode)) return json({success:false, reason:'invalid_code'});
    const {data:batch} = await supabase.from('villa_promo_batches').select('id,status').eq('kode_konfirmasi', kode).maybeSingle();
    if(!batch) return json({success:false, reason:'not_found'});
    if(batch.status === 'terkirim') return json({success:false, reason:'sudah_terkirim'});
    await supabase.from('villa_promo_batches').update({status:'ditolak'}).eq('id', batch.id);
    return json({success:true});
  }

  // Mencatat hasil pengiriman. Dipisah dari approve supaya pengiriman yang
  // gagal separuh jalan bisa diulang tanpa mengirim ulang ke tamu yang sudah
  // menerima -- indeks unik (batch_id, guest_id) yang menjaganya.
  if(path==='/bridge/promo-sent' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi',503);
    if(!await secretsMatch(req.headers.get('x-internal-secret') ?? '', bridge.secret)) return err('Unauthorized',401);

    const b = await req.json().catch(()=>null);
    const batch_id = String(b?.batch_id ?? '').trim();
    const hasil = Array.isArray(b?.hasil) ? b.hasil : [];
    if(!/^[0-9a-f-]{36}$/i.test(batch_id)) return err('batch_id tidak valid');

    const {data:batch} = await supabase.from('villa_promo_batches').select('*').eq('id', batch_id).maybeSingle();
    if(!batch) return json({success:false, reason:'not_found'});

    let tercatat = 0;
    for(const r of hasil){
      const guest_id = /^[0-9a-f-]{36}$/i.test(String(r?.guest_id ?? '')) ? r.guest_id : null;
      const {error} = await supabase.from('villa_promo_sends').insert({
        batch_id, promo_id: batch.promo_id, guest_id,
        kanal: r?.kanal === 'email' ? 'email' : 'whatsapp',
        tujuan: String(r?.tujuan ?? '').trim() || null,
        status: r?.status === 'gagal' ? 'gagal' : (r?.status === 'dilewati' ? 'dilewati' : 'terkirim'),
        error: String(r?.error ?? '').trim() || null,
      });
      if(!error){
        tercatat++;
        if(guest_id && r?.status !== 'gagal'){
          await supabase.from('villa_guest_marketing').upsert(
            {guest_id, terakhir_dikirimi_promo: new Date().toISOString(), updated_at: new Date().toISOString()},
            {onConflict:'guest_id'});
        }
      }
    }

    await supabase.from('villa_promo_batches')
      .update({status:'terkirim', sent_at:new Date().toISOString()})
      .eq('id', batch_id);
    return json({success:true, tercatat});
  }

  if(path==='/public/bookings/invoice' && m==='GET'){
    const booking_id = url.searchParams.get('booking_id') ?? '';
    const hp = (url.searchParams.get('hp') ?? '').trim();
    if(!/^[0-9a-f-]{36}$/i.test(booking_id)) return err('booking_id tidak valid');
    const {data:booking} = await supabase.from('bookings')
      .select('id,unit_nomor,guest_id,guest_nama,tgl_checkin,tgl_checkout,durasi_malam,tarif,total_bayar,status,invoice_no,bukti_pembayaran_at,created_at')
      .eq('id', booking_id).maybeSingle();
    if(!booking) return err('Booking tidak ditemukan', 404);
    let guestHp = null;
    if(booking.guest_id){
      const {data:g} = await supabase.from('guests').select('hp').eq('id',booking.guest_id).maybeSingle();
      guestHp = g?.hp ?? null;
    }
    if(!hp || !guestHp || guestHp.trim() !== hp) return err('Nomor WhatsApp tidak cocok dengan booking ini', 403);
    if(!booking.invoice_no || !booking.bukti_pembayaran_at) return err('Bukti pembayaran belum diupload untuk booking ini', 409);
    return json({
      invoice_no: booking.invoice_no,
      booking_id: booking.id,
      unit_nomor: booking.unit_nomor,
      guest_nama: booking.guest_nama,
      guest_hp: guestHp,
      tgl_checkin: booking.tgl_checkin,
      tgl_checkout: booking.tgl_checkout,
      durasi_malam: booking.durasi_malam,
      tarif: Number(booking.tarif),
      total_bayar: Number(booking.total_bayar ?? booking.tarif),
      paid_at: booking.bukti_pembayaran_at,
      created_at: booking.created_at,
    });
  }

  if(path==='/me/password' && m==='POST'){
    const session = await requireAuth(req);
    if(!session) return err('Unauthorized',401);
    const {password}=await req.json();
    if(!password || String(password).length<6) return err('Password minimal 6 karakter');
    const {error} = await supabase.rpc('villa_set_password',{p_user_id:session.uid, p_password:password});
    if(error) return err(error.message);
    await supabase.from('villa_users').update({must_change_password:false}).eq('id',session.uid);
    return json({success:true});
  }

  if(path==='/me/investor-profile' && m==='GET'){
    const session = await requireAuth(req);
    if(!session) return err('Unauthorized',401);
    if(session.role!=='owner') return forbidden();
    const {data,error} = await supabase.from('villa_users')
      .select('nama,hp,bank_nama,no_rekening,nama_pemilik_rekening')
      .eq('id',session.uid).single();
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/me/investor-profile' && m==='POST'){
    const session = await requireAuth(req);
    if(!session) return err('Unauthorized',401);
    if(session.role!=='owner') return forbidden();
    if(!session.unit_id) return err('Akun ini tidak terhubung ke unit manapun',400);
    const {nama,hp,bank_nama,no_rekening,nama_pemilik_rekening}=await req.json();
    if(!nama||!hp) return err('Nama dan nomor HP wajib diisi');
    const {data,error} = await supabase.from('investor_profiles').insert({
      unit_id:session.unit_id, unit_nomor:session.unit_nomor, user_id:session.uid, nama, hp,
      bank_nama: bank_nama || null, no_rekening: no_rekening || null, nama_pemilik_rekening: nama_pemilik_rekening || null,
    }).select().single();
    if(error) return err(error.message);
    await supabase.from('villa_users').update({
      nama, hp,
      bank_nama: bank_nama || null, no_rekening: no_rekening || null, nama_pemilik_rekening: nama_pemilik_rekening || null,
    }).eq('id',session.uid);
    return json(data,201);
  }

  if(path==='/bridge/occupancy' && m==='GET'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi (integration_settings.vercel_bridge.secret)',503);
    const provided = req.headers.get('x-internal-secret') ?? '';
    if(!await secretsMatch(provided, bridge.secret)) return err('Unauthorized',401);
    const tanggal = todayWIB();
    const {data:units} = await supabase.from('units').select('status');
    const {data:co} = await supabase.from('bookings').select('id').eq('status','checkin').eq('tgl_checkout',tanggal);
    const {data:ci} = await supabase.from('bookings').select('id').eq('status','terjadwal').eq('tgl_checkin',tanggal);
    const total  = units?.length??0;
    const terisi = units?.filter(u=>u.status==='occupied').length??0;
    return json({
      tanggal,
      total,
      terisi,
      kosong: units?.filter(u=>u.status==='available').length??0,
      kotor:  units?.filter(u=>u.status==='dirty').length??0,
      checkin_hari_ini:  ci?.length??0,
      checkout_hari_ini: co?.length??0,
      okupansi_persen: total>0 ? Math.round(terisi/total*100) : 0,
    });
  }

  // Batalkan booking website yang tidak dibayar dalam 1 jam (instruksi
  // owner 2026-09-12). Dijalankan pg_cron tiap 5 menit, jadi pembatalan
  // paling telat 5 menit setelah jatuh tempo.
  //
  // Statusnya dijadikan 'batal', BUKAN dihapus: barisnya adalah satu-satunya
  // catatan bahwa seseorang pernah mencoba memesan tanggal itu, berguna untuk
  // melihat berapa banyak calon tamu yang lepas. Penghapusan juga akan
  // memutus jalur "LUNAS" telat di bawah.
  // Mendeteksi low season dan MENGUSULKAN promo -- tidak pernah mengirim.
  // Owner memilih: "AI usul, saya setujui via WA".
  //
  // Ambangnya dibaca dari integration_settings.villa_promo_auto supaya bisa
  // diubah tanpa deploy; tanpa pengaturan itu, cron ini tidak melakukan
  // apa-apa (aktif harus disetel true secara sadar). Jadi menambahkan
  // jadwalnya tidak otomatis membuat tamu dikirimi apa pun.
  if(path==='/cron/promo-low-season' && m==='POST'){
    const cron = await getSetting('cron');
    if(!cron.secret) return err('Cron belum dikonfigurasi',503);
    if(!await secretsMatch(req.headers.get('x-cron-secret') ?? '', cron.secret)) return err('Unauthorized',401);

    const cfg = await getSetting('villa_promo_auto');
    if(cfg?.aktif !== true) return json({dilewati:'villa_promo_auto.aktif belum disetel true'});

    // Dua mode, dan bawaannya yang paling aman.
    //
    // 'pantau'  -- hitung dan laporkan saja. Tidak ada usulan yang dibuat,
    //              tidak ada WA ke owner, apalagi ke tamu.
    // 'usul'    -- baru membuat usulan dan mengirim WA ke owner untuk
    //              disetujui.
    //
    // Dipisah karena permintaan owner 2026-09-12: "nyalakan tapi, promonya
    // nti saja, kt mesti dpt data pemesanan dulu". Mesinnya perlu hidup dan
    // mulai mencatat sekarang, tapi promonya menunggu database tamu punya
    // isi yang layak dikirimi -- saat ini baru 7 tamu yang pernah menginap.
    //
    // Bawaannya sengaja 'pantau': kalau suatu hari pengaturannya rusak atau
    // separuh terisi, yang terjadi adalah tidak mengirim apa-apa, bukan
    // mengirim ke seluruh database tamu.
    const mode = String(cfg.mode ?? 'pantau').trim().toLowerCase() === 'usul' ? 'usul' : 'pantau';

    const ambangOkupansi = Number(cfg.ambang_okupansi_persen ?? 40);
    const horizonHari = Math.max(3, Math.trunc(Number(cfg.horizon_hari ?? 14)));
    const jedaHari = Math.max(0, Math.trunc(Number(cfg.jeda_hari ?? 30)));
    const kodePromo = String(cfg.promo_kode ?? '').trim().toUpperCase();
    if(!kodePromo) return json({dilewati:'villa_promo_auto.promo_kode belum diisi'});

    // Satu usulan yang masih menunggu sudah cukup. Menumpuk usulan setiap
    // hari hanya akan membuat owner mengabaikan semuanya.
    //
    // Dua hal yang membuat penjaga ini tidak berbalik melumpuhkan fiturnya:
    //
    // 1. Usulan yang lewat 48 jam dikedaluwarsakan DI SINI. Sebelumnya
    //    kedaluwarsa hanya dihitung saat ada yang mencoba menyetujui, jadi
    //    satu usulan yang didiamkan akan memblokir cron ini selamanya --
    //    fitur mati tanpa satu pun pesan galat.
    // 2. Penjaganya hanya berlaku untuk mode 'usul'. Mode pantau tidak
    //    membuat usulan apa pun, jadi tidak ada alasan pemantauan harian
    //    ikut berhenti gara-gara ada usulan yang menunggu.
    const {data:menunggu} = await supabase.from('villa_promo_batches')
      .select('id,kode_konfirmasi,created_at').eq('status','menunggu').limit(1).maybeSingle();
    if(menunggu){
      const umurJam = (Date.now() - Date.parse(menunggu.created_at)) / 3600000;
      if(umurJam > 48){
        await supabase.from('villa_promo_batches').update({status:'kedaluwarsa'}).eq('id', menunggu.id);
      } else if(mode === 'usul'){
        return json({dilewati:'masih ada usulan yang menunggu persetujuan', kode:menunggu.kode_konfirmasi, mode});
      }
    }

    const {data:promo} = await supabase.from('villa_promos').select('*').eq('kode', kodePromo).maybeSingle();
    if(!promo || promo.aktif !== true) return json({dilewati:`promo ${kodePromo} tidak ada atau tidak aktif`});

    // Okupansi horizon: berapa persen malam-unit yang terisi sampai
    // horizonHari ke depan. Memakai bookings yang benar-benar mengunci unit.
    const hariIni = todayWIB();
    const akhir = todayWIB(new Date(Date.now() + horizonHari*86400000));
    const {data:units} = await supabase.from('units').select('id');
    const totalUnit = (units ?? []).length;
    if(!totalUnit) return json({dilewati:'tidak ada unit'});

    // is_free_stay dikecualikan: malam gratis investor memang mengunci unit,
    // tapi tidak membawa satu rupiah pun. Membiarkannya ikut terhitung akan
    // membuat villa terlihat lebih laku daripada kenyataan berbayarnya --
    // persis di ambang yang dipakai memutuskan perlu-tidaknya promo.
    const {data:bk} = await supabase.from('bookings')
      .select('tgl_checkin,tgl_checkout')
      .in('status',['terjadwal','checkin'])
      .eq('is_free_stay', false)
      .lt('tgl_checkin', akhir).gte('tgl_checkout', hariIni);

    let malamTerisi = 0;
    for(const r of bk ?? []){
      const mulai = new Date(Math.max(Date.parse(`${r.tgl_checkin}T00:00:00Z`), Date.parse(`${hariIni}T00:00:00Z`)));
      const selesai = new Date(Math.min(Date.parse(`${r.tgl_checkout ?? r.tgl_checkin}T00:00:00Z`), Date.parse(`${akhir}T00:00:00Z`)));
      malamTerisi += Math.max(0, Math.round((selesai.getTime() - mulai.getTime())/86400000));
    }
    const kapasitas = totalUnit * horizonHari;
    const okupansi = kapasitas > 0 ? Math.round((malamTerisi / kapasitas) * 1000)/10 : 0;
    if(okupansi >= ambangOkupansi){
      return json({dilewati:'okupansi masih di atas ambang', okupansi_persen:okupansi, ambang:ambangOkupansi, mode});
    }

    // Calon penerima: pernah menginap, punya nomor, belum berhenti
    // langganan, dan tidak baru saja dikirimi promo.
    const ambangJeda = new Date(Date.now() - jedaHari*86400000).toISOString();
    const {data:dir} = await supabase.from('villa_guest_directory').select('*');
    const penerima = (dir ?? []).filter(r =>
      String(r.hp ?? '').trim().length >= 8 &&
      r.wa_opt_out !== true &&
      Number(r.jumlah_menginap ?? 0) >= 1 &&
      (!r.terakhir_dikirimi_promo || r.terakhir_dikirimi_promo < ambangJeda)
    ).slice(0, Math.min(500, Math.max(1, Math.trunc(Number(cfg.maks_penerima ?? 200)))))
     .map(r => ({guest_id:r.guest_id, nama:r.nama, hp:r.hp}));

    if(!penerima.length) return json({dilewati:'tidak ada calon penerima', okupansi_persen:okupansi, mode});

    // Mode pantau berhenti di sini -- setelah semua perhitungan selesai,
    // sebelum apa pun dikirim. Jawabannya tersimpan di net._http_response,
    // jadi rekaman okupansi hariannya tetap bisa dibaca ulang nanti tanpa
    // tabel baru.
    if(mode === 'pantau'){
      return json({
        mode:'pantau', okupansi_persen:okupansi, ambang:ambangOkupansi,
        akan_diusulkan_kalau_mode_usul: true,
        calon_penerima: penerima.length,
        promo: promo.kode,
        catatan: 'mode pantau -- tidak ada usulan dibuat dan tidak ada pesan dikirim',
      });
    }

    // Pesan ke tamu TIDAK boleh menyebut low season, sepi, atau alasan
    // internal apa pun (instruksi owner 2026-09-12: "jgan tulis low season
    // dong kasi sj mereka kode promo"). Memberi tahu tamu bahwa villa
    // sedang kosong adalah undangan untuk menawar, dan membuat harga
    // khususnya terbaca sebagai keputusasaan, bukan penghargaan.
    //
    // Nama internal promo juga sengaja TIDAK ikut dikirim: admin bisa saja
    // menamainya "Promo Low Season" di dashboard, dan nama itu akan bocor
    // ke tamu lewat pesan ini. Yang dikirim hanya kodenya.
    const pesan = String(cfg.template ?? '').trim() ||
      `Halo {nama}, terima kasih pernah menginap di Loonars Private Living.\n\n` +
      `Kami menyiapkan kode khusus untuk Anda: *${promo.kode}*\n\n` +
      `Masukkan kode ini saat memesan di loonars.id untuk mendapatkan harga spesialnya.\n\n` +
      `Balas pesan ini kalau ingin kami bantu memesankan. Kalau tidak ingin menerima info seperti ini lagi, balas BERHENTI.`;

    let kodeKonfirmasi = '';
    for(let coba=0; coba<5; coba++){
      const kandidat = Array.from(crypto.getRandomValues(new Uint8Array(3))).map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
      const {data:bentrok} = await supabase.from('villa_promo_batches').select('id').eq('kode_konfirmasi', kandidat).maybeSingle();
      if(!bentrok){ kodeKonfirmasi = kandidat; break; }
    }
    if(!kodeKonfirmasi) return err('Gagal membuat kode konfirmasi',500);

    const alasan = `Okupansi ${okupansi}% untuk ${horizonHari} hari ke depan, di bawah ambang ${ambangOkupansi}%`;
    const {data:batch, error:batchErr} = await supabase.from('villa_promo_batches').insert({
      promo_id: promo.id, kode_konfirmasi: kodeKonfirmasi, alasan,
      okupansi_persen: okupansi, jumlah_penerima: penerima.length,
      pesan, hasil:{penerima}, status:'menunggu',
    }).select().single();
    if(batchErr) return err(batchErr.message);

    const notifySetting = await getSetting('villa_notify');
    await sendWa(notifySetting?.owner_hp ?? null,
      `Usulan kirim promo\n\n${alasan}.\n\nPromo: ${promo.nama} (${promo.kode})\nPenerima: ${penerima.length} tamu yang pernah menginap\n\nIsi pesannya:\n"${pesan.replace('{nama}','Bapak/Ibu')}"\n\nKalau setuju, balas:\nPROMO ${kodeKonfirmasi}\n\nKalau tidak, balas:\nTOLAK ${kodeKonfirmasi}\n(usulan ini kedaluwarsa sendiri dalam 48 jam)`,
      {template_type:'villa_promo_proposal'});

    return json({diusulkan:true, kode_konfirmasi:kodeKonfirmasi, okupansi_persen:okupansi, jumlah_penerima:penerima.length});
  }

  if(path==='/cron/expire-pending-bookings' && m==='POST'){
    const cron = await getSetting('cron');
    const provided = req.headers.get('x-cron-secret') ?? '';
    if(!cron.secret) return err('Cron belum dikonfigurasi (integration_settings.cron.secret)',503);
    if(!await secretsMatch(provided, cron.secret)) return err('Unauthorized',401);

    const cutoff = new Date(Date.now() - PENDING_PAYMENT_HOLD_MINUTES*60*1000).toISOString();
    const {data:stale} = await supabase.from('bookings')
      .select('id,unit_nomor,guest_nama,tgl_checkin,tgl_checkout,catatan,created_at')
      .eq('sumber','website').eq('status','menunggu_pembayaran').lt('created_at', cutoff);

    const expired = [];
    for(const bk of stale ?? []){
      // Dicek ulang per baris, bukan lewat satu UPDATE massal, supaya sebuah
      // booking yang baru saja dikonfirmasi owner di detik yang sama tidak
      // ikut terbatalkan: .eq('status','menunggu_pembayaran') di bawah
      // membuat update-nya kalah kalau statusnya sudah berubah.
      const catatan = `${bk.catatan ?? ''} ${EXPIRED_HOLD_MARK} ${new Date().toISOString()}`.trim();
      const {data:updated, error:upErr} = await supabase.from('bookings')
        .update({status:'batal', catatan})
        .eq('id', bk.id).eq('status','menunggu_pembayaran')
        .select('id');
      if(upErr || !(updated ?? []).length) continue;
      expired.push({id:bk.id, unit_nomor:bk.unit_nomor, guest_nama:bk.guest_nama});
      await notif(null, 'all', 'booking', `Booking kedaluwarsa -- Unit ${bk.unit_nomor}`,
        `${bk.guest_nama} (${bk.tgl_checkin} s/d ${bk.tgl_checkout}) tidak menyelesaikan pembayaran dalam ${PENDING_PAYMENT_HOLD_MINUTES} menit, booking dibatalkan otomatis.`, bk.id);
    }

    return json({expired: expired.length, bookings: expired});
  }

  if(path==='/cron/cleaning-calls' && m==='POST'){
    const cron = await getSetting('cron');
    const provided = req.headers.get('x-cron-secret') ?? '';
    if(!cron.secret) return err('Cron belum dikonfigurasi (integration_settings.cron.secret)',503);
    if(!await secretsMatch(provided, cron.secret)) return err('Unauthorized',401);

    const now = new Date();
    const windowEnd = new Date(now.getTime());
    const windowStart = new Date(now.getTime() - 20*60*1000);

    const {data:bookings} = await supabase.from('bookings').select('id,unit_id,unit_nomor,guest_nama,tgl_checkin,checkin_time').eq('status','terjadwal');
    const {data:staff} = await supabase.from('villa_staff').select('id,nama,hp').eq('role','cleaning_service').eq('is_active',true);
    let dispatched=0;
    for(const bk of bookings ?? []){
      if(!bk.tgl_checkin) continue;
      const checkinAt = new Date(`${bk.tgl_checkin}T${bk.checkin_time??'14:00:00'}`);
      const dueAt = new Date(checkinAt.getTime() - 3*60*60*1000);
      if(dueAt > windowEnd || dueAt < windowStart) continue;
      const {data:existing} = await supabase.from('cleaning_call_log').select('id').eq('booking_id',bk.id).maybeSingle();
      if(existing) continue;
      const {data:logRow} = await supabase.from('cleaning_call_log').insert({
        booking_id:bk.id, unit_id:bk.unit_id, unit_nomor:bk.unit_nomor, scheduled_at:dueAt.toISOString(), status:'pending',
      }).select().single();
      for(const s of staff ?? []){
        await sendWa(s.hp, `Halo ${s.nama}, tolong siapkan Unit ${bk.unit_nomor} — tamu (${bk.guest_nama}) checkin sekitar 3 jam lagi. Mohon konfirmasi kesiapan.`,
          {booking_id:bk.id, unit_id:bk.unit_id, template_type:'cleaning_call'});
      }
      if(logRow) await supabase.from('cleaning_call_log').update({status:'sent', sent_at:new Date().toISOString()}).eq('id',logRow.id);
      dispatched++;
    }
    return json({success:true, dispatched});
  }

  // Reminder WA to every active investor to fill/confirm their dividend
  // bank account, added 2026-09-10 (owner request). One-time send (11 Sep
  // 2026, 12:05 WIB per vercel.json) -- not a recurring monthly cron, so
  // this endpoint being callable again isn't itself a re-send risk, but
  // don't wire a recurring schedule to it without asking first.
  // Sent to ALL active investors regardless of payment status -- the
  // message text itself explains the eligibility rule (paid off last
  // month -> dividend this month; still paying this month -> dividend on
  // the 25th of the month after), since villa has no record of Loonars'
  // separate unit-purchase payment status to filter on automatically.
  if(path==='/cron/investor-bank-reminder' && m==='POST'){
    const cron = await getSetting('cron');
    const provided = req.headers.get('x-cron-secret') ?? '';
    if(!cron.secret) return err('Cron belum dikonfigurasi (integration_settings.cron.secret)',503);
    if(!await secretsMatch(provided, cron.secret)) return err('Unauthorized',401);

    const {data:investors} = await supabase.from('villa_users')
      .select('nama,hp,bank_nama,no_rekening').eq('role','owner').eq('is_active',true);

    let sent=0;
    for(const inv of investors ?? []){
      const rekeningLengkap = !!(inv.bank_nama && inv.no_rekening);
      const message = `Halo ${inv.nama}, mohon ${rekeningLengkap ? 'konfirmasi/perbarui' : 'lengkapi'} nomor rekening Anda untuk pencairan dividen bulan ini di aplikasi Loonars Private Living (menu Profil).\n\nInfo: dividen bulan ini berlaku untuk investor yang sudah melunasi pembayaran bulan lalu. Investor yang baru melunasi pembayaran bulan ini akan menerima dividen pada tanggal 25 bulan depan.\n\nTerima kasih.`;
      await sendWa(inv.hp, message, {template_type:'investor_bank_reminder'});
      sent++;
    }
    return json({success:true, sent});
  }

  if(path==='/cron/dividend-list' && m==='POST'){
    const cron = await getSetting('cron');
    const provided = req.headers.get('x-cron-secret') ?? '';
    if(!cron.secret) return err('Cron belum dikonfigurasi (integration_settings.cron.secret)',503);
    if(!await secretsMatch(provided, cron.secret)) return err('Unauthorized',401);

    const periode = monthWIB();
    let list;
    try { list = await computeDividendList(periode); } catch(e){ return err(e.message,500); }

    const lines = list.investors.map(inv => {
      const rek = inv.rekening_lengkap
        ? `${inv.bank_nama} ${inv.no_rekening} a.n ${inv.nama_pemilik_rekening || inv.nama}`
        : 'REKENING BELUM DIISI';
      const tanda = inv.pemasukan_tetap ? ' (pemasukan tetap)' : inv.unit_dimiliki > 1 ? ` (${inv.unit_dimiliki} unit)` : '';
      return `• Unit ${inv.unit_nomor} — ${inv.nama}: Rp ${Math.round(inv.jumlah).toLocaleString('id-ID')}${tanda} → ${rek}`;
    }).join('\n');
    const message = `*Daftar Transfer Dividen — Periode ${periode}*\n\nBagian per investor: Rp ${Math.round(list.per_investor_amount).toLocaleString('id-ID')} (${list.investor_count} investor aktif)\n\n${lines || '(belum ada investor aktif)'}\n\nMohon proses transfer dividen bulan ini ke masing-masing rekening di atas.`;

    const {data:admins} = await supabase.from('villa_users').select('hp').eq('role','admin').eq('is_active',true);
    let sent=0;
    for(const a of admins ?? []){
      await sendWa(a.hp, message, {template_type:'dividend_list_monthly'});
      sent++;
    }
    return json({success:true, periode, sent_to_admins:sent, investor_count:list.investor_count});
  }

  if(path==='/cron/sync-mkh-income' && m==='POST'){
    const cron = await getSetting('cron');
    const provided = req.headers.get('x-cron-secret') ?? '';
    if(!cron.secret) return err('Cron belum dikonfigurasi (integration_settings.cron.secret)',503);
    if(!await secretsMatch(provided, cron.secret)) return err('Unauthorized',401);

    let periode = url.searchParams.get('periode');
    if(!periode) periode = prevMonthWIB();

    let report;
    try { report = await computeReport(undefined, periode); } catch(e){ return err(e.message,500); }

    const items = [
      {kategori:'rental',  jumlah: report.gross_revenue},
      {kategori:'cafe',    jumlah: report.walkin_income.cafe},
      {kategori:'spa',     jumlah: report.walkin_income.spa},
      {kategori:'lainnya', jumlah: report.walkin_income.lainnya},
    ];

    const bridge = await getSetting('mkh_finance_bridge');
    if(!bridge.base_url || !bridge.apikey || !bridge.secret){
      return err('Jembatan MKH Property belum dikonfigurasi (integration_settings.mkh_finance_bridge)',503);
    }

    try {
      const r = await fetch(bridge.base_url, {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          apikey: bridge.apikey,
          Authorization: `Bearer ${bridge.apikey}`,
          'x-villa-sync-secret': bridge.secret,
        },
        body: JSON.stringify({p_periode:`${periode}-01`, p_items:items}),
      });
      const result = await r.json().catch(()=>null);
      if(!r.ok) return err((result && (result.message||result.error)) ?? `MKH Property menolak (HTTP ${r.status})`, 502);
      return json({success:true, periode, items, mkh_response:result});
    } catch(e){
      return err(`Gagal menghubungi MKH Property: ${String(e)}`,502);
    }
  }

  // ── Baca notifikasi pembayaran QRIS BTN dari email (kode unik) ─────────
  // QRIS BTN yang dipakai statis: tidak ada payment gateway, tidak ada
  // webhook, dan tidak ada ID transaksi per pemesanan -- satu-satunya
  // sinyal "sudah dibayar" yang tersedia adalah email notifikasi BTN yang
  // masuk ke inbox pemilik. Cron ini membaca inbox itu lewat IMAP setiap
  // beberapa menit, mencocokkan NOMINAL PERSIS (termasuk kode unik 3 digit
  // dari generateKodeUnikPembayaran) ke booking yang sedang
  // 'menunggu_pembayaran', dan kalau cocok TEPAT SATU booking, menguncinya
  // -- meniru persis yang dilakukan owner secara manual lewat WhatsApp
  // "LUNAS <kode>" (lihat /bridge/confirm-payment). Ditambahkan 2026-09-20
  // atas instruksi owner: "tetap qris statis dr btn, pakai kode unik".
  //
  // Sengaja TIDAK mengonfirmasi kalau nominalnya cocok ke LEBIH dari satu
  // booking sekaligus (kode unik kebetulan bentrok -- kejadian yang sangat
  // jarang untuk villa sekecil ini) -- dibiarkan untuk konfirmasi manual
  // owner, karena mengunci unit yang salah jauh lebih mahal daripada
  // membiarkan satu booking menunggu sedikit lebih lama.
  //
  // Kredensial IMAP-nya di integration_settings.payment_email (host, port,
  // user, password, secure, subject_contains) -- pola yang sama dengan
  // secret lain di sistem ini (cron.secret, vercel_bridge.secret). Import
  // library IMAP-nya sengaja dynamic (bukan di atas file) supaya cold
  // start rute lain tidak ikut menanggung biaya memuatnya.
  if(path==='/cron/check-payment-email' && m==='POST'){
    const cron = await getSetting('cron');
    const provided = req.headers.get('x-cron-secret') ?? '';
    if(!cron.secret) return err('Cron belum dikonfigurasi (integration_settings.cron.secret)',503);
    if(!await secretsMatch(provided, cron.secret)) return err('Unauthorized',401);

    const cfg = await getSetting('payment_email');
    if(!cfg.host || !cfg.user || !cfg.password){
      return err('Email pembayaran belum dikonfigurasi (integration_settings.payment_email: host, user, password)',503);
    }

    const hasil = await scanPaymentInbox(cfg);
    if(hasil.gagal) return err(`Gagal membaca email: ${hasil.gagal}`, 502);
    return json({success:true, diperiksa:hasil.diperiksa, dikonfirmasi:hasil.dikonfirmasi, ambigu:hasil.ambigu});
  }

  // Dipanggil dari halaman booking begitu QRIS ditampilkan (dan diulang
  // berkala oleh polling status di sana) supaya tamu tidak perlu menunggu
  // sampai 5 menit giliran cron berikutnya -- lihat CATATAN di atas fungsi
  // scanPaymentInbox soal kenapa email tetap jadi satu-satunya sinyal.
  // Ditambahkan 2026-09-21 karena cron latar belakang tiap 5 menit dianggap
  // terlalu jarang untuk pengalaman tamu (owner minta pemicu dari sisi
  // tamu, bukan cuma jadwal tetap).
  if(path==='/public/bookings/check-payment' && m==='POST'){
    const b = await req.json().catch(()=>null);
    if(!b) return err('Body tidak valid');
    const booking_id = String(b.booking_id??'').trim();
    const hp = String(b.hp??'').trim();
    if(!/^[0-9a-f-]{36}$/i.test(booking_id)) return err('booking_id tidak valid');
    if(!hp) return err('Nomor WhatsApp wajib diisi');

    const {data:booking} = await supabase.from('bookings')
      .select('id,guest_id,sumber,status').eq('id',booking_id).maybeSingle();
    if(!booking) return err('Booking tidak ditemukan', 404);
    if(booking.sumber !== 'website') return err('Booking ini tidak bisa dicek lewat jalur ini', 403);

    let guestHp = null;
    if(booking.guest_id){
      const {data:g} = await supabase.from('guests').select('hp').eq('id',booking.guest_id).maybeSingle();
      guestHp = g?.hp ?? null;
    }
    if(!guestHp || guestHp.trim() !== hp) return err('Nomor WhatsApp tidak cocok dengan booking ini', 403);

    // Sudah lunas/batal duluan (misalnya oleh cron latar belakang atau balasan
    // WA manual owner) -- tidak perlu login IMAP sama sekali.
    if(booking.status !== 'menunggu_pembayaran'){
      return json({success:true, checked:false, confirmed: booking.status === 'terjadwal'});
    }

    const cfg = await getSetting('payment_email');
    if(!cfg.host || !cfg.user || !cfg.password){
      // Belum dikonfigurasi -- diam-diam saja untuk tamu, ini bukan masalah
      // di sisi mereka. Cron latar belakang (kalau menyala) atau owner akan
      // tetap mengonfirmasi manual lewat WA.
      return json({success:true, checked:false, confirmed:false});
    }

    const hasil = await scanPaymentInbox(cfg, {onlyBookingId: booking_id});
    if(hasil.gagal){
      return json({success:true, checked:false, confirmed:false});
    }
    return json({success:true, checked:true, confirmed: hasil.dikonfirmasi.length>0});
  }

  const session = await requireAuth(req);
  if(!session) return err('Unauthorized',401);
  const isAdmin = session.role==='admin';
  const isStaff = session.role==='receptionist' || isAdmin;
  const isOwner = session.role==='owner';
  const isFinance = session.role==='finance' || isAdmin;

  // ── FINANCE DASHBOARD ───────────────────────────────────────────────────
  // See the module comment above calculateExpectedSettlement() for the data
  // model this is built on (Cloudbeds reservation totals + a manual
  // settlement/reconciliation workflow -- no fabricated payment/settlement
  // data). Role: 'finance' or 'admin' can view/reconcile/process/mark
  // received; only 'admin' can write OTA settlement configuration, per the
  // mandate ("OTA settlement configuration hanya OWNER/ADMIN").

  if(path==='/finance/whoami' && m==='GET'){
    if(!isFinance) return forbidden();
    return json({ ok:true, role: session.role });
  }

  function financeDateRange(){
    const to = url.searchParams.get('to') || todayWIB();
    const from = url.searchParams.get('from') || `${monthWIB()}-01`;
    return { from, to };
  }

  if(path==='/finance/summary' && m==='GET'){
    if(!isFinance) return forbidden();
    const { from, to } = financeDateRange();
    const { data: rows, error } = await supabase.from('bookings')
      .select('id,sumber,status,tgl_checkin,tgl_checkout,total_bayar,tarif,cloudbeds_balance')
      .gte('tgl_checkin', from).lte('tgl_checkin', to);
    if(error) return err(error.message);
    const bookings = rows ?? [];
    const configMap = await getSettlementConfigMap();
    await ensureFinanceSettlements(bookings, configMap);

    const active = bookings.filter(b=>b.status!=='batal');
    const cancelled = bookings.length - active.length;
    const amountOf = b => Number(b.total_bayar ?? b.tarif ?? 0);
    const gross_revenue = active.reduce((s,b)=>s+amountOf(b),0);
    const payment_received = active.filter(b=>paymentStatusForBooking(b)==='PAID').reduce((s,b)=>s+amountOf(b),0);
    const outstanding = active.reduce((s,b)=>s+outstandingForBooking(b, amountOf(b)),0);
    const cloudbedsVerifiedCount = active.filter(b=>b.cloudbeds_balance != null).length;

    const activeIds = active.map(b=>b.id);
    let otaReceivable = 0, alertsUnknown = 0, alertsOverdue = 0, alertsDueToday = 0;
    let cashReceivedAmount = 0, cashReceivedCount = 0;
    if(activeIds.length){
      const { data: settlements } = await supabase.from('finance_settlements')
        .select('booking_id,sumber,amount,settlement_status,settlement_confidence,expected_settlement_date,amount_received,received_date')
        .in('booking_id', activeIds);
      const today = todayWIB();
      for(const s of (settlements ?? [])){
        const isOta = normalizedChannel(s.sumber) !== 'DIRECT';
        if(isOta && s.settlement_status !== 'RECEIVED') otaReceivable += Number(s.amount ?? 0);
        if(s.settlement_status !== 'RECEIVED' && s.settlement_confidence==='UNKNOWN') alertsUnknown++;
        if(s.settlement_status !== 'RECEIVED' && s.expected_settlement_date){
          if(s.expected_settlement_date < today) alertsOverdue++;
          else if(s.expected_settlement_date === today) alertsDueToday++;
        }
        if(s.settlement_status==='RECEIVED' && s.received_date && s.received_date>=from && s.received_date<=to){
          cashReceivedAmount += Number(s.amount_received ?? 0);
          cashReceivedCount++;
        }
      }
    }

    const { data: lastEvent } = await supabase.from('cloudbeds_events_log').select('created_at').order('created_at',{ascending:false}).limit(1).maybeSingle();

    const alerts = [];
    if(outstanding>0) alerts.push({ type:'outstanding', level:'warning', message:`Rp ${Math.round(outstanding).toLocaleString('id-ID')} masih outstanding (belum lunas).` });
    if(alertsDueToday>0) alerts.push({ type:'settlement_due', level:'info', message:`${alertsDueToday} settlement diperkirakan cair hari ini.` });
    if(alertsOverdue>0) alerts.push({ type:'overdue', level:'danger', message:`${alertsOverdue} settlement sudah lewat tanggal perkiraan cair dan belum diterima.` });
    if(alertsUnknown>0) alerts.push({ type:'unknown_settlement_rule', level:'warning', message:`${alertsUnknown} transaksi punya aturan settlement yang belum dikonfigurasi (UNKNOWN).` });

    return json({
      period: { from, to },
      gross_revenue, net_revenue: gross_revenue,
      net_revenue_note: 'Sama dengan Gross Revenue -- integrasi Cloudbeds ini hanya membawa total reservasi (grandTotal), tidak ada feed diskon/refund terpisah untuk dikurangkan.',
      payment_received,
      payment_received_note: cloudbedsVerifiedCount>0
        ? `Untuk ${cloudbedsVerifiedCount} dari ${active.length} booking, dihitung dari saldo asli Cloudbeds (getReservations.balance). Sisanya (booking direct/walk-in atau belum tersinkron) memakai status booking (checkin/checkout = lunas, sesuai alur "Tandai Lunas" front desk) sebagai perkiraan.`
        : 'Dihitung dari status booking (checkin/checkout = sudah bayar penuh, sesuai alur "Tandai Lunas" front desk) -- belum ada booking dengan saldo asli Cloudbeds tersinkron pada periode ini. Jalankan "Tarik Reservasi" di Admin > Cloudbeds untuk mengisinya.',
      outstanding,
      ota_receivable: otaReceivable,
      ota_receivable_note: 'Total revenue booking OTA (non-direct) yang statusnya belum RECEIVED di alur settlement manual Finance.',
      cash_received: {
        amount: cashReceivedAmount,
        verified: cashReceivedCount>0,
        count: cashReceivedCount,
        note: cashReceivedCount>0
          ? 'Berdasarkan input manual Finance (Tandai Diterima + referensi bank) pada periode ini.'
          : 'NOT VERIFIED -- belum ada settlement yang ditandai diterima (dengan referensi bank) untuk periode ini.',
      },
      bookings_counted: active.length,
      cloudbeds_balance_verified_count: cloudbedsVerifiedCount,
      cancelled_excluded: cancelled,
      alerts,
      last_cloudbeds_activity: lastEvent?.created_at ?? null,
      data_caveats: [
        'Balance mismatch check (Cloudbeds balance vs calculated) NOT_AVAILABLE -- belum ada perbandingan otomatis antara total kami dan balance Cloudbeds; balance Cloudbeds sekarang dipakai langsung sebagai sumber status bayar/outstanding, bukan dibandingkan.',
        'Refund tracking NOT_AVAILABLE -- tidak ada endpoint refund yang tersinkron dari Cloudbeds ke sistem ini.',
        'Sync run history (jumlah reservasi/transaksi/pembayaran per sync) NOT_AVAILABLE sebagai log tersimpan -- lihat halaman Admin > Cloudbeds untuk menjalankan sync dan melihat ringkasannya secara langsung.',
      ],
    });
  }

  if(path==='/finance/channel-breakdown' && m==='GET'){
    if(!isFinance) return forbidden();
    const { from, to } = financeDateRange();
    const { data: rows, error } = await supabase.from('bookings')
      .select('id,sumber,status,tgl_checkin,tgl_checkout,durasi_malam,total_bayar,tarif,cloudbeds_balance')
      .gte('tgl_checkin', from).lte('tgl_checkin', to).neq('status','batal');
    if(error) return err(error.message);
    const bookings = rows ?? [];
    const configMap = await getSettlementConfigMap();
    await ensureFinanceSettlements(bookings, configMap);
    const { commissionPctBySumber } = await getOtaCommissionPctMap();

    const ids = bookings.map(b=>b.id);
    const settlementByBooking = new Map();
    if(ids.length){
      const { data: settlements } = await supabase.from('finance_settlements').select('*').in('booking_id', ids);
      for(const s of (settlements ?? [])) settlementByBooking.set(s.booking_id, s);
    }

    const bySumber = new Map();
    for(const b of bookings){
      const key = b.sumber ?? 'other';
      const cur = bySumber.get(key) ?? { sumber:key, normalized_channel: normalizedChannel(key), revenue:0, net_revenue:0, payment:0, outstanding:0, ota_receivable:0, settled_count:0, unsettled_count:0, booking_count:0, room_nights:0 };
      const amount = Number(b.total_bayar ?? b.tarif ?? 0);
      const commissionPct = commissionPctBySumber.get(b.sumber) ?? 0;
      const bOutstanding = outstandingForBooking(b, amount);
      cur.revenue += amount;
      cur.net_revenue += amount * (1 - commissionPct/100);
      cur.booking_count++;
      cur.room_nights += Number(b.durasi_malam ?? 0);
      cur.payment += amount - bOutstanding;
      cur.outstanding += bOutstanding;
      const s = settlementByBooking.get(b.id);
      const settled = s?.settlement_status==='RECEIVED';
      if(settled) cur.settled_count++; else cur.unsettled_count++;
      if(cur.normalized_channel!=='DIRECT' && !settled) cur.ota_receivable += amount;
      bySumber.set(key, cur);
    }
    const cfgArr = [...configMap.values()];
    const channels = [...bySumber.values()].map(c=>{
      const cfg = configMap.get(c.sumber);
      return {
        ...c,
        ota_deduction: c.revenue - c.net_revenue,
        avg_net_adr: c.room_nights>0 ? c.net_revenue/c.room_nights : null,
        collection_method: cfg?.collection_method ?? 'UNKNOWN',
        destination_account: cfg?.destination_account_label ?? null,
      };
    }).sort((a,b)=>b.revenue-a.revenue);
    const totals = channels.reduce((acc,c)=>({ revenue:acc.revenue+c.revenue, net_revenue:acc.net_revenue+c.net_revenue, payment:acc.payment+c.payment, outstanding:acc.outstanding+c.outstanding, ota_receivable:acc.ota_receivable+c.ota_receivable }), { revenue:0, net_revenue:0, payment:0, outstanding:0, ota_receivable:0 });
    return json({ period:{from,to}, channels, totals, settlement_configs_count: cfgArr.length });
  }

  if(path==='/finance/bookings' && m==='GET'){
    if(!isFinance) return forbidden();
    const { from, to } = financeDateRange();
    const sumber = url.searchParams.get('sumber');
    const payment_status = url.searchParams.get('payment_status');
    const settlement_status = url.searchParams.get('settlement_status');
    const q = String(url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));

    let query = supabase.from('bookings')
      .select('id,unit_nomor,guest_nama,sumber,status,tgl_checkin,tgl_checkout,durasi_malam,total_bayar,tarif,cloudbeds_balance,cloudbeds_reservation_id,created_at', {count:'exact'})
      .gte('tgl_checkin', from).lte('tgl_checkin', to)
      .order('tgl_checkin',{ascending:false});
    if(sumber) query = query.eq('sumber', sumber);
    if(q) query = query.ilike('guest_nama', `%${q}%`);
    const { data: rows, error, count } = await query.range(offset, offset+limit-1);
    if(error) return err(error.message);
    let bookings = rows ?? [];

    const configMap = await getSettlementConfigMap();
    await ensureFinanceSettlements(bookings.filter(b=>b.status!=='batal'), configMap);
    const ids = bookings.map(b=>b.id);
    const settlementByBooking = new Map();
    if(ids.length){
      const { data: settlements } = await supabase.from('finance_settlements').select('*').in('booking_id', ids);
      for(const s of (settlements ?? [])) settlementByBooking.set(s.booking_id, s);
    }

    let items = bookings.map(b=>{
      const amount = Number(b.total_bayar ?? b.tarif ?? 0);
      const pay = paymentStatusForBooking(b);
      const s = settlementByBooking.get(b.id) ?? null;
      return {
        id: b.id, unit_nomor: b.unit_nomor, guest_nama: b.guest_nama, sumber: b.sumber,
        normalized_channel: normalizedChannel(b.sumber), status: b.status,
        tgl_checkin: b.tgl_checkin, tgl_checkout: b.tgl_checkout, durasi_malam: b.durasi_malam,
        revenue: amount, payment_status: pay, outstanding: outstandingForBooking(b, amount),
        payment_status_source: b.cloudbeds_balance != null ? 'cloudbeds_balance' : 'booking_status_estimate',
        cloudbeds_reservation_id: b.cloudbeds_reservation_id,
        settlement_status: s?.settlement_status ?? null,
        settlement_confidence: s?.settlement_confidence ?? null,
        expected_settlement_date: s?.expected_settlement_date ?? null,
      };
    });
    if(payment_status) items = items.filter(i=>i.payment_status===payment_status);
    if(settlement_status) items = items.filter(i=>i.settlement_status===settlement_status);

    return json({ items, total: count ?? items.length, limit, offset });
  }

  if(path==='/finance/booking' && m==='GET'){
    if(!isFinance) return forbidden();
    const id = url.searchParams.get('id');
    if(!id) return err('id wajib diisi');
    const { data: b, error } = await supabase.from('bookings')
      .select('*, guests(nama,hp,email), units(nomor,blok)')
      .eq('id', id).maybeSingle();
    if(error) return err(error.message);
    if(!b) return err('Booking tidak ditemukan',404);

    const configMap = await getSettlementConfigMap();
    await ensureFinanceSettlements([b], configMap);
    const { data: settlement } = await supabase.from('finance_settlements').select('*').eq('booking_id', id).maybeSingle();
    const cfg = configMap.get(b.sumber) ?? null;
    const { data: auditLog } = settlement
      ? await supabase.from('finance_audit_log').select('*').eq('entity_type','finance_settlement').eq('entity_id', settlement.id).order('created_at',{ascending:false}).limit(20)
      : { data: [] };

    const amount = Number(b.total_bayar ?? b.tarif ?? 0);
    return json({
      reservation: {
        id: b.id, guest_nama: b.guest_nama, guests: b.guests ?? null, sumber: b.sumber,
        normalized_channel: normalizedChannel(b.sumber), tgl_checkin: b.tgl_checkin, tgl_checkout: b.tgl_checkout,
        unit_nomor: b.unit_nomor, units: b.units ?? null, status: b.status, cloudbeds_reservation_id: b.cloudbeds_reservation_id,
      },
      revenue: { room: amount, extras: null, discount: null, tax: null, fee: null, refund: null, net: amount, note: 'Tidak ada breakdown room/extras/tax/fee terpisah dari Cloudbeds untuk API key ini -- hanya total reservasi.' },
      payment: {
        paid: paymentStatusForBooking(b)==='PAID',
        outstanding: outstandingForBooking(b, amount),
        method: 'UNKNOWN',
        payment_date: b.checkin_at ?? null,
        source: b.cloudbeds_balance != null ? 'cloudbeds_balance' : 'booking_status_estimate',
        cloudbeds_balance: b.cloudbeds_balance ?? null,
      },
      settlement: {
        collection_method: cfg?.collection_method ?? 'UNKNOWN',
        expected_settlement_date: settlement?.expected_settlement_date ?? null,
        settlement_confidence: settlement?.settlement_confidence ?? 'UNKNOWN',
        settlement_status: settlement?.settlement_status ?? null,
        settlement_reference: settlement?.settlement_reference ?? null,
        destination_account: cfg?.destination_account_label ?? null,
      },
      bank: {
        amount_received: settlement?.amount_received ?? null,
        received_date: settlement?.received_date ?? null,
        bank_reference: settlement?.bank_reference ?? null,
        reconciliation_status: settlement?.reconciliation_status ?? null,
        variance_amount: settlement?.variance_amount ?? null,
      },
      audit_log: auditLog ?? [],
    });
  }

  if(path==='/finance/ota-settlement-config' && m==='GET'){
    if(!isFinance) return forbidden();
    const { data, error } = await supabase.from('finance_ota_settlement_config').select('*').order('sumber');
    if(error) return err(error.message);
    return json(data ?? []);
  }

  if(path==='/finance/ota-settlement-config' && m==='POST'){
    if(!isAdmin) return forbidden();
    const body = await req.json();
    const sumber = String(body.sumber ?? '').trim();
    if(!sumber) return err('sumber wajib diisi');
    const { data: existing } = await supabase.from('finance_ota_settlement_config').select('*').eq('sumber', sumber).maybeSingle();
    const patch = {
      sumber,
      collection_method: body.collection_method ?? 'UNKNOWN',
      settlement_delay_days: body.settlement_delay_days === '' || body.settlement_delay_days == null ? null : Number(body.settlement_delay_days),
      settlement_basis: body.settlement_basis === 'CHECKIN' ? 'CHECKIN' : 'CHECKOUT',
      settlement_schedule: ['MONTHLY_1ST','WEEKLY_ON_DAY'].includes(body.settlement_schedule) ? body.settlement_schedule : 'FIXED_DELAY',
      settlement_weekday: body.settlement_weekday === '' || body.settlement_weekday == null ? null : Number(body.settlement_weekday),
      destination_account_label: body.destination_account_label ?? null,
      currency: body.currency ?? 'IDR',
      effective_date: body.effective_date || null,
      notes: body.notes ?? null,
      configured_by: session.uid,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase.from('finance_ota_settlement_config').upsert(patch, { onConflict:'sumber' }).select('*').single();
    if(error) return err(error.message);
    await writeFinanceAudit({ entity_type:'finance_ota_settlement_config', entity_id: saved.id, session, action: existing?'update_settlement_config':'create_settlement_config', old_value: existing ?? null, new_value: saved, reason: body.reason ?? null });
    return json(saved);
  }

  if(path==='/finance/ota-settlement-config' && m==='DELETE'){
    if(!isAdmin) return forbidden();
    const sumber = url.searchParams.get('sumber');
    if(!sumber) return err('sumber wajib diisi');
    const { data: existing } = await supabase.from('finance_ota_settlement_config').select('*').eq('sumber', sumber).maybeSingle();
    if(!existing) return err('Konfigurasi tidak ditemukan',404);
    const { error } = await supabase.from('finance_ota_settlement_config').delete().eq('sumber', sumber);
    if(error) return err(error.message);
    await writeFinanceAudit({ entity_type:'finance_ota_settlement_config', entity_id: existing.id, session, action:'delete_settlement_config', old_value: existing, new_value: null });
    return json({ success:true });
  }

  if(path==='/finance/settlements/process' && m==='POST'){
    if(!isFinance) return forbidden();
    const body = await req.json();
    const booking_id = body.booking_id;
    if(!booking_id) return err('booking_id wajib diisi');
    const { data: s } = await supabase.from('finance_settlements').select('*').eq('booking_id', booking_id).maybeSingle();
    if(!s) return err('Settlement belum ada untuk booking ini -- buka detail booking dulu supaya settlement dibuat.',404);
    if(s.settlement_status==='RECEIVED') return err('Settlement ini sudah RECEIVED.',400);
    const patch = { settlement_status:'PROCESSING', settlement_reference: body.settlement_reference ?? null, processed_by: session.uid, processed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data: saved, error } = await supabase.from('finance_settlements').update(patch).eq('id', s.id).select('*').single();
    if(error) return err(error.message);
    await writeFinanceAudit({ entity_type:'finance_settlement', entity_id: s.id, session, action:'process_settlement', old_value: s, new_value: saved, reason: body.reason ?? null });
    return json(saved);
  }

  if(path==='/finance/settlements/receive' && m==='POST'){
    if(!isFinance) return forbidden();
    const body = await req.json();
    const booking_id = body.booking_id;
    if(!booking_id) return err('booking_id wajib diisi');
    if(body.amount_received == null || body.received_date == null) return err('amount_received dan received_date wajib diisi');
    const { data: s } = await supabase.from('finance_settlements').select('*').eq('booking_id', booking_id).maybeSingle();
    if(!s) return err('Settlement belum ada untuk booking ini.',404);
    const amount_received = Number(body.amount_received);
    const variance_amount = amount_received - Number(s.amount);
    const reconciliation_status = variance_amount === 0 ? 'MATCHED' : 'VARIANCE';
    const patch = {
      settlement_status:'RECEIVED', amount_received, received_date: body.received_date,
      bank_reference: body.bank_reference ?? null, notes: body.notes ?? s.notes ?? null,
      reconciliation_status, variance_amount, updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase.from('finance_settlements').update(patch).eq('id', s.id).select('*').single();
    if(error) return err(error.message);
    await writeFinanceAudit({ entity_type:'finance_settlement', entity_id: s.id, session, action:'mark_received', old_value: s, new_value: saved, reason: body.reason ?? null });
    return json(saved);
  }

  if(path==='/finance/audit-log' && m==='GET'){
    if(!isFinance) return forbidden();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    let query = supabase.from('finance_audit_log').select('*').order('created_at',{ascending:false}).limit(limit);
    const entity_type = url.searchParams.get('entity_type');
    if(entity_type) query = query.eq('entity_type', entity_type);
    const { data, error } = await query;
    if(error) return err(error.message);
    return json(data ?? []);
  }

  // ── FINANCE SURVIVAL CONTROL CENTER ─────────────────────────────────────

  if(path==='/finance/property-config' && m==='GET'){
    if(!isFinance) return forbidden();
    const { data, error } = await supabase.from('finance_property_config').select('*').order('property_code');
    if(error) return err(error.message);
    return json(data ?? []);
  }

  if(path==='/finance/property-config' && m==='POST'){
    if(!isAdmin) return forbidden();
    const body = await req.json();
    const property_code = String(body.property_code ?? '').trim();
    if(!property_code) return err('property_code wajib diisi');
    const { data: existing } = await supabase.from('finance_property_config').select('*').eq('property_code', property_code).maybeSingle();
    const NUM_FIELDS = ['total_rooms','investor_share_pct','mkh_share_pct','guarantee_per_room','target_net_adr','conservative_net_adr','room_electricity_per_night','payroll_employee_count','payroll_per_employee'];
    const patch = { property_code, property_name: body.property_name ?? property_code, currency: body.currency ?? 'IDR', active: body.active !== false, notes: body.notes ?? null, updated_by: session.uid, updated_at: new Date().toISOString() };
    for(const f of NUM_FIELDS){ if(body[f] != null && body[f] !== '') patch[f] = Number(body[f]); }
    if(!existing){
      for(const f of NUM_FIELDS){ if(patch[f] == null) return err(`${f} wajib diisi untuk konfigurasi baru`); }
    }
    const { data: saved, error } = await supabase.from('finance_property_config').upsert(patch, { onConflict:'property_code' }).select('*').single();
    if(error) return err(error.message);
    await writeFinanceAudit({ entity_type:'finance_property_config', entity_id: saved.id, session, action: existing?'update_property_config':'create_property_config', old_value: existing ?? null, new_value: saved, reason: body.reason ?? null });
    return json(saved);
  }

  if(path==='/finance/survival' && m==='GET'){
    if(!isFinance) return forbidden();
    const property_code = url.searchParams.get('property') ?? 'loonars-1';
    const { from, to } = financeDateRange();
    const kpis = await computeSurvivalKpis(property_code, from, to);
    if(!kpis) return err(`Konfigurasi properti '${property_code}' belum ada`, 404);
    return json(kpis);
  }

  if(path==='/finance/scenario' && m==='GET'){
    if(!isFinance) return forbidden();
    const property_code = url.searchParams.get('property') ?? 'loonars-1';
    const config = await getPropertyConfig(property_code);
    if(!config) return err(`Konfigurasi properti '${property_code}' belum ada`, 404);

    const netAdr = Number(url.searchParams.get('net_adr') ?? config.target_net_adr);
    const days = Math.max(1, Number(url.searchParams.get('days') ?? 30));

    // Explicit rooms_per_night wins; otherwise derive from an occupancy_pct input.
    let roomsPerNight = url.searchParams.get('rooms_per_night') != null ? Number(url.searchParams.get('rooms_per_night')) : null;
    if(roomsPerNight == null){
      const occupancyPct = Number(url.searchParams.get('occupancy_pct') ?? 0);
      roomsPerNight = (occupancyPct/100) * Number(config.total_rooms);
    }

    const custom = computeScenario(config, { netAdr, roomsPerNight, days });
    const targets = [5,6,7,8].map(r => computeScenario(config, { netAdr: Number(config.target_net_adr), roomsPerNight: r, days: 30 }));
    return json({ property_code, config, custom, targets });
  }

  // ── Database tamu ──────────────────────────────────────────────────────
  // Tujuan owner 2026-09-12: "kt punya database tamu" dari OTA maupun web.
  // Isinya nomor HP dan email orang, jadi admin saja -- resepsionis tidak
  // punya alasan mengunduh seluruh daftar kontak tamu.
  if(path==='/guests/directory' && m==='GET'){
    if(!isAdmin) return forbidden();
    const q = String(url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)));
    let query = supabase.from('villa_guest_directory').select('*');
    if(q){
      const like = `%${q}%`;
      query = query.or(`nama.ilike.${like},hp.ilike.${like},email.ilike.${like}`);
    }
    const {data, error} = await query.order('terakhir_menginap', {ascending:false, nullsFirst:false}).limit(limit);
    if(error) return err(error.message);
    return json(data ?? []);
  }

  // Ringkasan untuk kartu di halaman admin, dihitung di server supaya
  // tidak perlu mengunduh seluruh daftar tamu hanya untuk menghitungnya.
  if(path==='/guests/directory/summary' && m==='GET'){
    if(!isAdmin) return forbidden();
    const {data} = await supabase.from('villa_guest_directory')
      .select('hp,email,wa_opt_out,email_opt_out,jumlah_menginap,sumber_pertama');
    const rows = data ?? [];
    const punya = v => String(v ?? '').trim().length > 0;
    return json({
      total_tamu: rows.length,
      punya_hp: rows.filter(r=>punya(r.hp)).length,
      punya_email: rows.filter(r=>punya(r.email)).length,
      bisa_diwa: rows.filter(r=>punya(r.hp) && r.wa_opt_out !== true).length,
      berhenti_langganan: rows.filter(r=>r.wa_opt_out === true || r.email_opt_out === true).length,
      tamu_berulang: rows.filter(r=>Number(r.jumlah_menginap ?? 0) > 1).length,
      per_sumber: rows.reduce((acc,r)=>{ const k=r.sumber_pertama ?? 'tidak diketahui'; acc[k]=(acc[k]??0)+1; return acc; }, {}),
    });
  }

  // Berhenti-langganan dan catatan. Baris villa_guest_marketing dibuat saat
  // pertama kali disentuh, bukan untuk semua tamu di muka: 96 baris kosong
  // tidak memberi tahu apa pun.
  if(path==='/guests/marketing' && m==='PATCH'){
    if(!isAdmin) return forbidden();
    const b = await req.json().catch(()=>null);
    const guest_id = String(b?.guest_id ?? '').trim();
    if(!/^[0-9a-f-]{36}$/i.test(guest_id)) return err('guest_id tidak valid');
    const patch = {guest_id, updated_at: new Date().toISOString()};
    if(typeof b.wa_opt_out === 'boolean') patch.wa_opt_out = b.wa_opt_out;
    if(typeof b.email_opt_out === 'boolean') patch.email_opt_out = b.email_opt_out;
    if(typeof b.catatan === 'string') patch.catatan = b.catatan.trim() || null;
    const {data, error} = await supabase.from('villa_guest_marketing').upsert(patch, {onConflict:'guest_id'}).select().single();
    if(error) return err(error.message);
    return json(data);
  }

  // Tipe kamar beserta id-nya, untuk halaman admin. /public/room-types
  // sengaja tidak membawa id -- halaman promo butuh id untuk menyimpan
  // room_type_id, dan min_rate untuk menampilkan harga batas bawah yang
  // akan dipakai promo.
  if(path==='/room-types' && m==='GET'){
    if(!isStaff) return forbidden();
    const {data, error} = await supabase.from('villa_room_types')
      .select('id,code,name,min_rate,max_rate,base_rate,active').order('name');
    if(error) return err(error.message);
    return json(data ?? []);
  }

  // ── Promo ──────────────────────────────────────────────────────────────
  if(path==='/promos' && m==='GET'){
    if(!isStaff) return forbidden();
    const {data, error} = await supabase.from('villa_promos').select('*').order('created_at', {ascending:false}).limit(200);
    if(error) return err(error.message);
    return json(data ?? []);
  }

  if(path==='/promos' && m==='POST'){
    if(!isAdmin) return forbidden();
    const b = await req.json().catch(()=>null);
    if(!b) return err('Body tidak valid');
    const kode = String(b.kode ?? '').trim().toUpperCase();
    const nama = String(b.nama ?? '').trim();
    if(!/^[A-Z0-9-]{3,24}$/.test(kode)) return err('Kode promo hanya huruf/angka/strip, 3-24 karakter');
    if(nama.length < 3) return err('Nama promo wajib diisi');
    const mode_harga = b.mode_harga === 'harga_tetap' ? 'harga_tetap' : 'batas_bawah';
    const harga_per_malam = mode_harga === 'harga_tetap' ? Number(b.harga_per_malam ?? 0) : null;
    if(mode_harga === 'harga_tetap' && !(harga_per_malam > 0)) return err('Harga per malam wajib diisi untuk mode harga tetap');

    const {data, error} = await supabase.from('villa_promos').insert({
      kode, nama,
      deskripsi: String(b.deskripsi ?? '').trim() || null,
      mode_harga, harga_per_malam,
      room_type_id: b.room_type_id ?? null,
      pesan_dari: b.pesan_dari ?? null, pesan_sampai: b.pesan_sampai ?? null,
      menginap_dari: b.menginap_dari ?? null, menginap_sampai: b.menginap_sampai ?? null,
      min_malam: Math.max(1, Math.trunc(Number(b.min_malam ?? 1)) || 1),
      kuota: b.kuota == null || b.kuota === '' ? null : Math.max(0, Math.trunc(Number(b.kuota))),
      aktif: b.aktif !== false,
      dibuat_oleh: session.uid ?? null,
    }).select().single();
    if(error){
      if(error.code === '23505') return err('Kode promo itu sudah dipakai', 409);
      return err(error.message);
    }
    return json(data, 201);
  }

  if(path==='/promos' && m==='PATCH'){
    if(!isAdmin) return forbidden();
    const b = await req.json().catch(()=>null);
    const id = String(b?.id ?? '').trim();
    if(!/^[0-9a-f-]{36}$/i.test(id)) return err('id promo tidak valid');
    const patch = {updated_at: new Date().toISOString()};
    for(const k of ['nama','deskripsi','mode_harga','room_type_id','pesan_dari','pesan_sampai','menginap_dari','menginap_sampai','aktif']){
      if(k in b) patch[k] = b[k] === '' ? null : b[k];
    }
    if('harga_per_malam' in b) patch.harga_per_malam = b.harga_per_malam == null || b.harga_per_malam === '' ? null : Number(b.harga_per_malam);
    if('min_malam' in b) patch.min_malam = Math.max(1, Math.trunc(Number(b.min_malam)) || 1);
    if('kuota' in b) patch.kuota = b.kuota == null || b.kuota === '' ? null : Math.max(0, Math.trunc(Number(b.kuota)));
    const {data, error} = await supabase.from('villa_promos').update(patch).eq('id', id).select().single();
    if(error) return err(error.message);
    return json(data);
  }

  // Hasil nyata sebuah promo: berapa kali dipakai, dan berapa yang dilepas.
  // Angka "hemat" ini yang membuat promo bisa dievaluasi, bukan cuma dibuat.
  if(path==='/promos/redemptions' && m==='GET'){
    if(!isStaff) return forbidden();
    const promo_id = String(url.searchParams.get('promo_id') ?? '').trim();
    let q = supabase.from('villa_promo_redemptions').select('*').order('created_at',{ascending:false}).limit(200);
    if(/^[0-9a-f-]{36}$/i.test(promo_id)) q = q.eq('promo_id', promo_id);
    const {data, error} = await q;
    if(error) return err(error.message);
    const rows = data ?? [];
    return json({
      jumlah: rows.length,
      total_harga_normal: rows.reduce((a,r)=>a+Number(r.harga_normal ?? 0),0),
      total_harga_promo: rows.reduce((a,r)=>a+Number(r.harga_promo ?? 0),0),
      redemptions: rows,
    });
  }

  if(path==='/walkin-payments' && m==='GET'){
    if(!isStaff) return forbidden();
    const {data,error} = await supabase.from('walkin_payments').select('*').order('created_at',{ascending:false}).limit(200);
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/walkin-payments' && m==='POST'){
    if(!isStaff) return forbidden();
    const b = await req.json();
    if(!b.guest_nama || !b.kategori || !b.jumlah) return err('guest_nama, kategori, dan jumlah wajib diisi');
    if(!['cafe','spa','lainnya'].includes(b.kategori)) return err('kategori tidak valid');
    if(Number(b.jumlah) <= 0) return err('jumlah harus lebih dari 0');
    const {data,error} = await supabase.from('walkin_payments').insert({
      guest_nama: b.guest_nama, guest_hp: b.guest_hp ?? null, kategori: b.kategori,
      deskripsi: b.deskripsi ?? '', jumlah: b.jumlah, status: 'pending', created_by: session.uid,
    }).select().single();
    if(error) return err(error.message);
    return json(data,201);
  }
  if(path==='/walkin-payments' && m==='PATCH'){
    if(!isStaff) return forbidden();
    const b = await req.json();
    if(!b.id || !b.status) return err('id dan status wajib diisi');
    if(!['pending','lunas','batal'].includes(b.status)) return err('status tidak valid');
    const patch = {status:b.status, paid_at: b.status==='lunas' ? new Date().toISOString() : null};
    const {data,error} = await supabase.from('walkin_payments').update(patch).eq('id',b.id).select().single();
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/walkin-qris' && m==='GET'){
    if(!isStaff) return forbidden();
    const setting = await getSetting('walkin_qris');
    return json({data_url: setting?.data_url ?? null});
  }
  if(path==='/walkin-qris' && m==='POST'){
    if(!isStaff) return forbidden();
    const b = await req.json();
    const {error} = await supabase.from('integration_settings')
      .upsert({key:'walkin_qris', value:{data_url:b.data_url ?? null}, updated_at:new Date().toISOString(), updated_by:session.email});
    if(error) return err(error.message);
    return json({success:true});
  }

  if(path==='/amenities' && m==='GET'){
    if(!isStaff) return forbidden();
    const {data,error} = await supabase.from('amenities').select('*').order('nama');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/amenities' && m==='POST'){
    if(!isAdmin) return forbidden();
    const b = await req.json();
    if(!b.nama) return err('nama wajib diisi');
    const {data,error} = await supabase.from('amenities').insert({
      nama:b.nama, satuan:b.satuan||'pcs', stock:Number(b.stock)||0, stock_minimum:Number(b.stock_minimum)||0,
    }).select().single();
    if(error) return err(error.message);
    return json(data,201);
  }
  if(path==='/amenities' && m==='PATCH'){
    if(!isAdmin) return forbidden();
    const b = await req.json();
    if(!b.id) return err('id wajib diisi');
    const patch = {updated_at:new Date().toISOString()};
    if(b.nama!==undefined) patch.nama = b.nama;
    if(b.satuan!==undefined) patch.satuan = b.satuan;
    if(b.stock_minimum!==undefined) patch.stock_minimum = Number(b.stock_minimum);
    if(b.restock_qty){
      if(Number(b.restock_qty) <= 0) return err('restock_qty harus lebih dari 0');
      const {data:current} = await supabase.from('amenities').select('stock').eq('id',b.id).single();
      patch.stock = (current?.stock ?? 0) + Number(b.restock_qty);
    }
    const {data,error} = await supabase.from('amenities').update(patch).eq('id',b.id).select().single();
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/amenities' && m==='DELETE'){
    if(!isAdmin) return forbidden();
    const id = url.searchParams.get('id');
    if(!id) return err('id wajib diisi');
    const {error} = await supabase.from('amenities').delete().eq('id',id);
    if(error) return err(error.message);
    return json({success:true});
  }

  if(path==='/amenities/kit' && m==='GET'){
    if(!isStaff) return forbidden();
    const {data,error} = await supabase.from('amenity_kit_items').select('*, amenities(nama,satuan,stock)').order('created_at');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/amenities/kit' && m==='POST'){
    if(!isAdmin) return forbidden();
    const b = await req.json();
    if(!b.amenity_id || !b.qty) return err('amenity_id dan qty wajib diisi');
    if(Number(b.qty) <= 0) return err('qty harus lebih dari 0');
    const {data,error} = await supabase.from('amenity_kit_items')
      .upsert({amenity_id:b.amenity_id, qty:Number(b.qty)}, {onConflict:'amenity_id'})
      .select('*, amenities(nama,satuan,stock)').single();
    if(error) return err(error.message);
    return json(data,201);
  }
  if(path==='/amenities/kit' && m==='DELETE'){
    if(!isAdmin) return forbidden();
    const id = url.searchParams.get('id');
    if(!id) return err('id wajib diisi');
    const {error} = await supabase.from('amenity_kit_items').delete().eq('id',id);
    if(error) return err(error.message);
    return json({success:true});
  }

  if(path==='/amenities/usage-log' && m==='GET'){
    if(!isStaff) return forbidden();
    const {data,error} = await supabase.from('amenity_usage_log').select('*').order('created_at',{ascending:false}).limit(50);
    if(error) return err(error.message);
    return json(data);
  }

  if(path.startsWith('/admin/') && !isAdmin) return forbidden();

  if(path==='/admin/settings' && m==='GET'){
    const {data,error} = await supabase.from('integration_settings').select('*');
    if(error) return err(error.message);
    return json((data||[]).map(r=>({key:r.key, updated_at:r.updated_at, updated_by:r.updated_by, value: redact(r.value)})));
  }
  if(path==='/admin/settings' && m==='POST'){
    const b = await req.json();
    if(!b.key) return err('key wajib diisi');
    const {data:existing} = await supabase.from('integration_settings').select('value').eq('key',b.key).maybeSingle();
    const merged = {...(existing?.value??{}), ...(b.value??{})};
    const {data,error} = await supabase.from('integration_settings')
      .upsert({key:b.key, value:merged, updated_at:new Date().toISOString(), updated_by:session.email})
      .select().single();
    if(error) return err(error.message);
    return json({key:data.key, updated_at:data.updated_at, value: redact(data.value)});
  }

  if(path==='/admin/users' && m==='GET'){
    const {data,error} = await supabase.from('villa_users').select('id,nama,email,role,unit_id,unit_nomor,hp,is_active,must_change_password,last_login,created_at').order('created_at',{ascending:false});
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/users' && m==='POST'){
    const b = await req.json();
    if(!b.nama||!b.email||!b.password||!b.role) return err('nama, email, password, role wajib diisi');
    if(String(b.password).length < 8) return err('Password minimal 8 karakter');
    const {data,error} = await supabase.rpc('villa_create_user',{
      p_nama:b.nama, p_email:b.email, p_password:b.password, p_role:b.role,
      p_unit_id:b.unit_id??null, p_unit_nomor:b.unit_nomor??null, p_hp:b.hp??null,
    });
    if(error) return err(error.message);
    const created = Array.isArray(data)?data[0]:data;
    if(b.force_password_change !== false){
      await supabase.from('villa_users').update({must_change_password:true}).eq('id',created.id);
    }
    return json(created, 201);
  }
  if(path==='/admin/users' && m==='PATCH'){
    const b = await req.json();
    if(!b.id) return err('id wajib diisi');
    if(b.new_password){
      if(String(b.new_password).length < 8) return err('Password minimal 8 karakter');
      const {error} = await supabase.rpc('villa_set_password',{p_user_id:b.id, p_password:b.new_password});
      if(error) return err(error.message);
      await supabase.from('villa_users').update({must_change_password:b.force_password_change!==false}).eq('id',b.id);
    }
    if(typeof b.is_active==='boolean'){
      const {error} = await supabase.from('villa_users').update({is_active:b.is_active}).eq('id',b.id);
      if(error) return err(error.message);
    }
    return json({success:true});
  }

  // Toggles a unit's payment-settlement checkbox (units.lunas_pembayaran)
  // from the admin investor list, added 2026-09-10. Deliberately does NOT
  // trigger any WA/notification to the investor -- this is an internal
  // admin-only record, never surfaced to the investor as "you are unpaid"
  // (owner's explicit instruction, to avoid offending them). Any future
  // investor-facing message must stay generic like the existing dividend
  // reminder text, never naming an individual's payment status.
  if(path==='/admin/investors/lunas' && m==='PATCH'){
    const b = await req.json();
    if(!b.unit_id || typeof b.lunas_pembayaran !== 'boolean') return err('unit_id dan lunas_pembayaran wajib diisi');
    const {data,error} = await supabase.from('units').update({lunas_pembayaran:b.lunas_pembayaran}).eq('id',b.unit_id).select('id,nomor,lunas_pembayaran').single();
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/admin/investors' && m==='GET'){
    const {data,error} = await supabase.from('villa_users')
      .select('id,unit_id,unit_nomor,nama,hp,bank_nama,no_rekening,nama_pemilik_rekening,created_at')
      .eq('role','owner').order('unit_nomor');
    if(error) return err(error.message);

    const unitIds = (data ?? []).map(r=>r.unit_id).filter(Boolean);
    const {data:unitsData} = unitIds.length
      ? await supabase.from('units').select('id,lunas_pembayaran').in('id', unitIds)
      : {data: []};
    const lunasByUnitId = new Map((unitsData ?? []).map(u=>[u.id, u.lunas_pembayaran]));
    const enriched = (data ?? []).map(r => ({...r, lunas_pembayaran: lunasByUnitId.get(r.unit_id) ?? true}));
    return json(enriched);
  }

  if(path==='/admin/dividends' && m==='GET'){
    const periode = url.searchParams.get('periode') ?? monthWIB();
    try {
      return json(await computeDividendList(periode));
    } catch(e){ return err(e.message,500); }
  }

  if(path==='/admin/staff' && m==='GET'){
    const {data,error} = await supabase.from('villa_staff').select('*').order('role').order('nama');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/staff' && m==='POST'){
    const b = await req.json();
    if(!b.nama||!b.role) return err('nama dan role wajib diisi');
    const {data,error} = await supabase.from('villa_staff').insert({nama:b.nama, role:b.role, hp:b.hp??null}).select().single();
    if(error) return err(error.message);
    return json(data,201);
  }
  if(path==='/admin/staff' && m==='PATCH'){
    const b = await req.json();
    if(!b.id) return err('id wajib diisi');
    const {data,error} = await supabase.from('villa_staff').update({nama:b.nama, hp:b.hp, is_active:b.is_active}).eq('id',b.id).select().single();
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/staff' && m==='DELETE'){
    const id = url.searchParams.get('id');
    if(!id) return err('id wajib diisi');
    const {error} = await supabase.from('villa_staff').delete().eq('id',id);
    if(error) return err(error.message);
    return json({success:true});
  }

  if(path==='/admin/cloudbeds/mapping' && m==='GET'){
    const {data,error} = await supabase.from('cloudbeds_room_mapping').select('*, units(nomor,blok)').order('created_at',{ascending:false});
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/cloudbeds/mapping' && m==='POST'){
    const b = await req.json();
    if(!b.cloudbeds_room_id||!b.unit_id) return err('cloudbeds_room_id dan unit_id wajib diisi');
    const {data,error} = await supabase.from('cloudbeds_room_mapping')
      .upsert({cloudbeds_room_id:b.cloudbeds_room_id, cloudbeds_room_name:b.cloudbeds_room_name??null, unit_id:b.unit_id}, {onConflict:'cloudbeds_room_id'})
      .select().single();
    if(error) return err(error.message);
    return json(data,201);
  }
  if(path==='/admin/cloudbeds/mapping' && m==='DELETE'){
    const id = url.searchParams.get('id');
    if(!id) return err('id wajib diisi');
    const {error} = await supabase.from('cloudbeds_room_mapping').delete().eq('id',id);
    if(error) return err(error.message);
    return json({success:true});
  }
  if(path==='/admin/cloudbeds/log' && m==='GET'){
    const {data,error} = await supabase.from('cloudbeds_events_log').select('*').order('created_at',{ascending:false}).limit(50);
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/wa/log' && m==='GET'){
    const {data,error} = await supabase.from('wa_messages_log').select('*').order('created_at',{ascending:false}).limit(50);
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/admin/cctv/cameras' && m==='GET'){
    const {data,error} = await supabase.from('cctv_cameras').select('*').order('nama');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/cctv/cameras' && m==='POST'){
    const b = await req.json();
    if(!b.nama || !b.ezviz_serial) return err('nama dan ezviz_serial wajib diisi');
    const {data,error} = await supabase.from('cctv_cameras').insert({
      nama:b.nama, deskripsi:b.deskripsi??null, ezviz_serial:b.ezviz_serial,
      ezviz_channel_no:Number(b.ezviz_channel_no)||1, ezviz_verification_code:b.ezviz_verification_code??null,
      zona:b.zona??null, checkpoint_interval_minutes:Number(b.checkpoint_interval_minutes)||120,
    }).select().single();
    if(error) return err(error.message);
    return json(data,201);
  }
  if(path==='/admin/cctv/cameras' && m==='PATCH'){
    const b = await req.json();
    if(!b.id) return err('id wajib diisi');
    const patch = {updated_at:new Date().toISOString()};
    if(b.nama!==undefined) patch.nama = b.nama;
    if(b.deskripsi!==undefined) patch.deskripsi = b.deskripsi;
    if(b.ezviz_serial!==undefined) patch.ezviz_serial = b.ezviz_serial;
    if(b.ezviz_channel_no!==undefined) patch.ezviz_channel_no = Number(b.ezviz_channel_no)||1;
    if(b.ezviz_verification_code!==undefined) patch.ezviz_verification_code = b.ezviz_verification_code;
    if(b.zona!==undefined) patch.zona = b.zona;
    if(b.checkpoint_interval_minutes!==undefined) patch.checkpoint_interval_minutes = Number(b.checkpoint_interval_minutes)||120;
    if(typeof b.is_active==='boolean') patch.is_active = b.is_active;
    const {data,error} = await supabase.from('cctv_cameras').update(patch).eq('id',b.id).select().single();
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/cctv/cameras' && m==='DELETE'){
    const id = url.searchParams.get('id');
    if(!id) return err('id wajib diisi');
    const {error} = await supabase.from('cctv_cameras').delete().eq('id',id);
    if(error) return err(error.message);
    return json({success:true});
  }

  if(path==='/admin/cctv/checkpoint-log' && m==='GET'){
    const camera_id = url.searchParams.get('camera_id');
    let q = supabase.from('cctv_checkpoint_log').select('*').order('captured_at',{ascending:false}).limit(100);
    if(camera_id) q = q.eq('camera_id', camera_id);
    const {data,error} = await q;
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/admin/cctv/disciplinary-reports' && m==='GET'){
    const status = url.searchParams.get('status');
    let q = supabase.from('cctv_disciplinary_reports').select('*, cctv_cameras(nama,zona)').order('period_start',{ascending:false});
    if(status) q = q.eq('status', status);
    const {data,error} = await q;
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/cctv/disciplinary-reports' && m==='PATCH'){
    const b = await req.json();
    if(!b.id || !b.status) return err('id dan status wajib diisi');
    if(!['confirmed','dismissed'].includes(b.status)) return err('status tidak valid (harus confirmed atau dismissed)');
    const {data,error} = await supabase.from('cctv_disciplinary_reports').update({
      status:b.status, review_note:b.review_note??null, reviewed_by:session.uid, reviewed_at:new Date().toISOString(),
    }).eq('id',b.id).select('*, cctv_cameras(nama,zona)').single();
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/admin/pricing-recommendations' && m==='GET'){
    const status = url.searchParams.get('status');
    let q = supabase.from('villa_pricing_recommendations')
      .select('*, villa_room_types(code,name)')
      .order('target_date', {ascending:true});
    if(status) q = q.eq('status', status);
    const {data,error} = await q;
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/pricing-recommendations' && m==='PATCH'){
    const b = await req.json();
    if(!b.id || !b.status) return err('id dan status wajib diisi');
    if(!['approved','rejected'].includes(b.status)) return err('status tidak valid (harus approved atau rejected)');

    const {data:rec, error:recErr} = await supabase.from('villa_pricing_recommendations')
      .select('*').eq('id', b.id).single();
    if(recErr || !rec) return err('Rekomendasi tidak ditemukan', 404);
    if(rec.status !== 'pending_review') return err('Rekomendasi ini sudah direview', 409);

    if(b.status === 'rejected'){
      const {data,error} = await supabase.from('villa_pricing_recommendations').update({
        status:'rejected', reviewed_by:session.email, reviewed_at:new Date().toISOString(), review_note:b.review_note??null,
      }).eq('id', b.id).select().single();
      if(error) return err(error.message);
      return json(data);
    }

    const {error: rateErr} = await supabase.from('villa_rates').upsert({
      room_type_id: rec.room_type_id, rate_plan_id: null, date: rec.target_date,
      rate: rec.recommended_rate, source: 'rule_engine', reason: b.review_note ?? null, updated_by: session.email,
    }, {onConflict: 'room_type_id,rate_plan_id,date'});
    if(rateErr) return err(rateErr.message);

    const {data,error} = await supabase.from('villa_pricing_recommendations').update({
      status:'executed', reviewed_by:session.email, reviewed_at:new Date().toISOString(),
      review_note:b.review_note??null, executed_at:new Date().toISOString(),
    }).eq('id', b.id).select().single();
    if(error) return err(error.message);
    return json(data);
  }

  // Ringkasan satu hari untuk halaman depan (gaya aplikasi Cloudbeds):
  // okupansi, kedatangan, dan keberangkatan pada TANGGAL yang diminta.
  //
  // Dihitung dari bookings, bukan dari units.status, supaya tanggal mana pun
  // bisa ditanyakan -- bukan hanya hari ini. units.status hanya tahu keadaan
  // sekarang, dan halaman depannya punya tombol maju-mundur tanggal.
  //
  // Terbuka untuk semua peran yang sudah login, termasuk investor: owner
  // memutuskan (14 Sep 2026) investor melihat okupansi villa yang sama
  // dengan admin. Tidak ada data per-unit atau identitas tamu yang keluar
  // dari sini, hanya angka ringkas.
  if(path==='/dashboard/hari-ini' && m==='GET'){
    const tanggal = url.searchParams.get('tanggal') ?? todayWIB();
    if(!isValidDateStr(tanggal)) return err('Tanggal tidak valid');

    const {data:units} = await supabase.from('units').select('id');
    const totalUnit = units?.length ?? 0;

    const {data:bk} = await supabase.from('bookings')
      .select('id,tgl_checkin,tgl_checkout')
      .in('status',['terjadwal','checkin'])
      .lte('tgl_checkin', tanggal).gt('tgl_checkout', tanggal);
    const terisi = bk?.length ?? 0;

    const {data:datang} = await supabase.from('bookings').select('id')
      .in('status',['terjadwal','checkin']).eq('tgl_checkin', tanggal);
    const {data:pergi} = await supabase.from('bookings').select('id')
      .in('status',['terjadwal','checkin','checkout']).eq('tgl_checkout', tanggal);

    return json({
      tanggal,
      total_unit: totalUnit,
      terisi,
      kosong: Math.max(0, totalUnit - terisi),
      kedatangan: datang?.length ?? 0,
      keberangkatan: pergi?.length ?? 0,
      okupansi_persen: totalUnit > 0 ? Math.round(terisi / totalUnit * 100) : 0,
    });
  }

  if(path==='/admin/overview' && m==='GET'){
    const bulan = monthWIB();
    const {data:units} = await supabase.from('units').select('status');
    const {data:txs} = await supabase.from('transactions').select('jumlah,tipe').eq('periode_bulan',bulan).eq('tipe','income');
    const {data:cbUnmatched} = await supabase.from('cloudbeds_events_log').select('id').eq('matched',false);
    const {data:waFailed} = await supabase.from('wa_messages_log').select('id').in('status',['failed','error']);
    const {data:users} = await supabase.from('villa_users').select('id,role,is_active');
    return json({
      total_unit: units?.length??0,
      available: units?.filter(u=>u.status==='available').length??0,
      occupied: units?.filter(u=>u.status==='occupied').length??0,
      gross_revenue_bulan_ini: (txs||[]).reduce((s,t)=>s+Number(t.jumlah),0),
      cloudbeds_belum_dipetakan: cbUnmatched?.length??0,
      wa_gagal_terkirim: waFailed?.length??0,
      total_user: users?.length??0,
      user_aktif: users?.filter(u=>u.is_active).length??0,
    });
  }

  if(path==='/wa/send' && m==='POST'){
    if(!isStaff) return forbidden();
    const b = await req.json();
    if(!b.phone||!b.message) return err('phone dan message wajib diisi');
    await sendWa(b.phone, b.message, {booking_id:b.booking_id??null, unit_id:b.unit_id??null, template_type:b.template_type??'manual'});
    return json({success:true});
  }

  // Dua belas kode milik investor yang sedang login, untuk dashboardnya.
  //
  // Statusnya dihitung di sini, tidak disimpan. "Terpakai" dibaca dari
  // booking yang menunjuk kode itu; "hangus" dari bulan kodenya terhadap
  // bulan berjalan. Dua-duanya tampil tercoret di dashboard, persis seperti
  // yang diminta owner -- tapi dengan sebab yang berbeda, dan investor
  // berhak tahu bedanya.
  if(path==='/investor/vouchers' && m==='GET'){
    if(!isOwner) return forbidden();

    const {data:vouchers} = await supabase.from('villa_investor_vouchers')
      .select('id,kode,periode').eq('user_id', session.uid).order('periode');
    if(!vouchers?.length) return json({vouchers:[], tersedia:0, terpakai:0, hangus:0});

    const {data:terpakaiRows} = await supabase.from('bookings')
      .select('voucher_id,tgl_checkin,unit_nomor,status')
      .in('voucher_id', vouchers.map(v=>v.id));
    const pemakaian = new Map();
    for(const r of terpakaiRows ?? []){
      if(r.status !== 'batal') pemakaian.set(String(r.voucher_id), r);
    }

    const bulanIni = monthWIB();
    let tersedia=0, terpakai=0, hangus=0;
    const hasil = vouchers.map(v => {
      const dipakai = pemakaian.get(String(v.id));
      const bulanKode = String(v.periode).slice(0,7);
      let status;
      if(dipakai){ status='terpakai'; terpakai++; }
      else if(bulanKode < bulanIni){ status='hangus'; hangus++; }
      else { status='tersedia'; tersedia++; }
      return {
        kode: v.kode,
        bulan: bulanKode,
        status,
        dicoret: status !== 'tersedia',
        dipakai_pada: dipakai?.tgl_checkin ?? null,
        unit: dipakai?.unit_nomor ?? null,
      };
    });

    return json({
      vouchers: hasil, tersedia, terpakai, hangus,
      aturan: 'Satu kode menggratiskan satu malam di bulan yang tertera, dan boleh dipakai di unit mana saja yang kosong. Menginap lebih dari semalam tetap boleh -- malam selanjutnya dibayar seperti biasa. Malam gratisnya tidak berlaku Jumat, Sabtu, Minggu, dan tidak berlaku di periode ramai. Kode yang tidak dipakai sampai bulannya lewat akan hangus.',
    });
  }

  if(path==='/units' && m==='GET'){
    const blok=url.searchParams.get('blok');
    const owner_id=url.searchParams.get('owner_id');
    let q=supabase.from('units').select('*');
    if(isOwner){
      const milik = await unitIdsForSession(session);
      q = q.in('id', milik.length ? milik : ['00000000-0000-0000-0000-000000000000']);
    }
    else { if(blok) q=q.eq('blok',blok); if(owner_id) q=q.eq('owner_id',owner_id); }
    const {data,error}=await q.order('nomor');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/units' && m==='PATCH'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    const {data,error}=await supabase.from('units').update({status:b.status,catatan:b.catatan??null}).eq('id',b.unit_id).select().single();
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/summary' && m==='GET'){
    if(isOwner) return forbidden();
    const {data:units}=await supabase.from('units').select('status,owner_id');
    const tgl=todayWIB();
    const {data:hk}=await supabase.from('housekeeping').select('id,status').eq('tgl',tgl);
    const {data:co}=await supabase.from('bookings').select('id').eq('status','checkin').eq('tgl_checkout',tgl);
    const {data:ci}=await supabase.from('bookings').select('id').eq('status','terjadwal').eq('tgl_checkin',tgl);
    const {data:notifs}=await supabase.from('notifications').select('id').eq('is_read_staff',false);
    return json({
      available: units?.filter(u=>u.status==='available').length??0,
      occupied:  units?.filter(u=>u.status==='occupied').length??0,
      dirty:     units?.filter(u=>u.status==='dirty').length??0,
      total:     units?.length??0,
      checkout_today: co?.length??0,
      checkin_today:  ci?.length??0,
      housekeeping_pending: hk?.filter(h=>h.status==='pending').length??0,
      notif_unread: notifs?.length??0,
    });
  }

  if(path==='/bookings' && m==='GET'){
    const status=url.searchParams.get('status');
    let unit_id=url.searchParams.get('unit_id');
    const date_from=url.searchParams.get('date_from');
    const date_to=url.searchParams.get('date_to');
    let milikOwner = null;
    if(isOwner){ milikOwner = await unitIdsForSession(session); unit_id = null; }
    let q=supabase.from('bookings').select('*');
    if(status) q=q.eq('status',status);
    if(milikOwner) q=q.in('unit_id', milikOwner.length ? milikOwner : ['00000000-0000-0000-0000-000000000000']);
    else if(unit_id) q=q.eq('unit_id',unit_id);
    if(date_from || date_to){
      const {data,error}=await q.order('tgl_checkin',{ascending:true});
      if(error) return err(error.message);
      const rows=(data??[]).filter(b=>datesOverlap(b.tgl_checkin, b.tgl_checkout, date_from ?? b.tgl_checkin, date_to ?? null));
      return json(rows);
    }
    const {data,error}=await q.order('created_at',{ascending:false}).limit(50);
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/availability' && m==='GET'){
    if(!isStaff) return forbidden();
    const checkin = url.searchParams.get('checkin');
    const checkout = url.searchParams.get('checkout');
    if(!checkin) return err('checkin wajib diisi');
    if(!isValidDateStr(checkin)) return err('checkin tidak valid');
    if(checkout && !isValidDateStr(checkout)) return err('checkout tidak valid');
    const {data:units} = await supabase.from('units').select('id,nomor,blok,status');
    const {data:bookings} = await supabase.from('bookings').select('unit_id,tgl_checkin,tgl_checkout,guest_nama').in('status',['terjadwal','checkin']);
    const conflicts = findConflicts(bookings??[], checkin, checkout||null);
    return json((units??[]).map(u=>({
      ...u,
      tersedia_untuk_tanggal: !conflicts.has(u.id),
      dibooking_oleh: conflicts.get(u.id)??null,
    })));
  }

  // Perkiraan harga untuk layar kasir/walk-in SEBELUM booking dibuat --
  // memanggil computeStayTarif yang SAMA dengan yang dipakai POST /bookings
  // (staf) dan /public/bookings (loonars.id), supaya angka yang dilihat
  // kasir tidak pernah bisa berbeda dari yang benar-benar ditagih maupun
  // dari yang tamu lihat di loonars.id. Sebelum route ini ada, kasir
  // menghitung sendiri di browser pakai tarif_harian flat -- tidak pernah
  // melihat override villa_rates (harga dinamis mesin AI), sehingga
  // perkiraan di layar kasir bisa beda dari harga yang dipakai loonars.id
  // dan bahkan dari nominal yang akhirnya tercatat di booking yang sama.
  if(path==='/tarif-preview' && m==='GET'){
    if(!isStaff) return forbidden();
    const unit_id = url.searchParams.get('unit_id');
    const tgl_checkin = url.searchParams.get('tgl_checkin');
    const tgl_checkout = url.searchParams.get('tgl_checkout');
    const tipe = url.searchParams.get('tipe');
    if(!unit_id || !tgl_checkin) return err('unit_id dan tgl_checkin wajib diisi');
    if(!isValidDateStr(tgl_checkin)) return err('tgl_checkin tidak valid');
    if(tgl_checkout != null && !isValidDateStr(tgl_checkout)) return err('tgl_checkout tidak valid');
    if(!['harian','bulanan'].includes(tipe)) return err('tipe tidak valid (harus harian atau bulanan)');

    const {data:unit, error:unitErr} = await supabase.from('units')
      .select('tarif_harian,tarif_bulanan,room_type_id').eq('id', unit_id).single();
    if(unitErr || !unit) return err('Unit tidak ditemukan', 404);

    if(tipe === 'bulanan'){
      return json({tarif: Number(unit.tarif_bulanan ?? 0), nights: null});
    }
    const nights = tgl_checkout
      ? Math.max(1, Math.round((new Date(tgl_checkout).getTime() - new Date(tgl_checkin).getTime()) / 86400000))
      : 1;
    const tarif = await computeStayTarif(unit, tgl_checkin, nights);
    return json({tarif, nights});
  }

  if(path==='/bookings' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    if(!b.unit_id || !b.tgl_checkin) return err('unit_id dan tgl_checkin wajib diisi');
    if(!isValidDateStr(b.tgl_checkin)) return err('tgl_checkin tidak valid');
    if(b.tgl_checkout != null && !isValidDateStr(b.tgl_checkout)) return err('tgl_checkout tidak valid');
    if(!['harian','bulanan'].includes(b.tipe)) return err('tipe tidak valid (harus harian atau bulanan)');

    const {data:existing} = await supabase.from('bookings')
      .select('id,guest_nama,tgl_checkin,tgl_checkout')
      .eq('unit_id', b.unit_id)
      .in('status', ['terjadwal','checkin']);
    const conflict = (existing??[]).find(e=>datesOverlap(e.tgl_checkin, e.tgl_checkout, b.tgl_checkin, b.tgl_checkout??null));
    if(conflict){
      return err(`Unit ${b.unit_nomor??''} sudah dibooking ${conflict.guest_nama} (${conflict.tgl_checkin}${conflict.tgl_checkout?' s/d '+conflict.tgl_checkout:' — belum ada tanggal keluar'}) -- bentrok dengan tanggal yang dipilih`, 409);
    }

    const {data:unit, error:unitErr} = await supabase.from('units')
      .select('tarif_harian,tarif_bulanan,room_type_id').eq('id', b.unit_id).single();
    if(unitErr || !unit) return err('Unit tidak ditemukan', 404);

    let computedTarif;
    if(b.tipe === 'bulanan'){
      computedTarif = Number(unit.tarif_bulanan ?? 0);
    } else {
      const nights = b.tgl_checkout
        ? Math.max(1, Math.round((new Date(b.tgl_checkout).getTime() - new Date(b.tgl_checkin).getTime()) / 86400000))
        : 1;
      // Sama persis dengan /public/bookings dan /tarif-preview -- satu
      // fungsi harga, supaya kasir, loonars.id, dan nominal yang tercatat
      // di sini tidak pernah bisa berbeda pendapat (lihat komentar di
      // computeStayTarif).
      computedTarif = await computeStayTarif(unit, b.tgl_checkin, nights);
    }
    if(computedTarif <= 0) return err('Tarif unit belum diatur — hubungi admin', 409);

    let guest_id=b.guest_id??null;
    if(!guest_id && b.guest_nama){
      const {data:g}=await supabase.from('guests').insert({nama:b.guest_nama,hp:b.guest_hp??null,no_ktp:b.guest_ktp??null}).select('id').single();
      guest_id=g?.id??null;
    }
    const {data,error}=await supabase.from('bookings').insert({
      unit_id:b.unit_id, unit_nomor:b.unit_nomor, guest_id, guest_nama:b.guest_nama,
      tipe:b.tipe, sumber:b.sumber??'walk-in', tgl_checkin:b.tgl_checkin,
      tgl_checkout:b.tgl_checkout??null, durasi_malam:b.durasi_malam??null,
      checkin_time:b.checkin_time??'14:00:00',
      tarif:computedTarif, total_bayar:computedTarif, status:'terjadwal',
    }).select().single();
    if(error){
      if(error.code === '23P01') return err(`Unit ${b.unit_nomor??''} sudah dibooking untuk tanggal yang bentrok`, 409);
      return err(error.message);
    }
    await notif(b.unit_id,'all','booking',`Booking baru — Unit ${b.unit_nomor}`,`${b.guest_nama} · ${b.tipe} · ${b.sumber}`,data.id);
    if(data.sumber !== 'cloudbeds'){
      await pushBookingToCloudbeds(data);
    }
    return json(data,201);
  }
  if(path==='/bookings' && m==='PATCH'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    if(!b.id || !b.status) return err('id dan status wajib diisi');
    if(!['terjadwal','checkin','checkout','batal'].includes(b.status)) return err('status tidak valid');
    const {data,error}=await supabase.from('bookings').update({status:b.status}).eq('id',b.id).select().single();
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/checkin' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    if(!b.booking_id) return err('booking_id wajib diisi');

    const {data, error} = await supabase.rpc('villa_commit_checkin', {
      p_booking_id: b.booking_id,
      p_checkin_by: b.checkin_by ?? session.email ?? session.uid,
      p_ktp_photo_path: b.ktp_photo_path ?? null,
      p_signature_data_url: b.signature_data_url ?? null,
    });
    if(error){
      const msg = error.message ?? '';
      if(msg.includes('already_checked_in')) return err('Booking ini sudah check-in', 409);
      if(msg.includes('booking_not_found')) return err('Booking tidak ditemukan', 404);
      if(msg.includes('invalid_booking_status')) return err('Booking tidak dalam status yang bisa di-checkin', 409);
      if(msg.includes('booking_missing_total_bayar')) return err('Booking ini belum punya nominal pembayaran — tidak bisa check-in', 409);
      return err(msg, 500);
    }

    await notif(data.unit_id,'all','checkin',`Check-in — Unit ${data.unit_nomor}`,`${data.guest_nama}`,b.booking_id);

    let guestPhone = b.guest_hp ?? null;
    if(!guestPhone && data.guest_id){
      const {data:g} = await supabase.from('guests').select('hp').eq('id',data.guest_id).single();
      guestPhone = g?.hp ?? null;
    }
    await sendWa(guestPhone,
      `Halo ${data.guest_nama}, selamat datang di Loonars Private Living Unit ${data.unit_nomor}!\nKode PIN pintu Anda: *${data.pin_kode}*\nMohon jaga kerahasiaan kode ini selama menginap. Terima kasih.`,
      {booking_id:b.booking_id, unit_id:data.unit_id, template_type:'pin_checkin'});

    return json({success:true, pin_kode:data.pin_kode});
  }

  if(path==='/checkout' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    if(!b.booking_id) return err('booking_id wajib diisi');

    const {data, error} = await supabase.rpc('villa_commit_checkout', {
      p_booking_id: b.booking_id,
      p_checkout_by: b.checkout_by ?? session.email ?? session.uid,
      p_kondisi: b.kondisi ?? null,
    });
    if(error){
      const msg = error.message ?? '';
      if(msg.includes('already_checked_out')) return err('Booking ini sudah checkout', 409);
      if(msg.includes('booking_not_found')) return err('Booking tidak ditemukan', 404);
      if(msg.includes('invalid_booking_status')) return err('Booking belum check-in, tidak bisa checkout', 409);
      return err(msg, 500);
    }

    await notif(data.unit_id,'all','checkout',`Checkout — Unit ${data.unit_nomor}`,`${data.guest_nama} sudah checkout. Housekeeping dijadwalkan.`,b.booking_id);
    return json({success:true});
  }

  if(path==='/housekeeping' && m==='GET'){
    if(!isStaff) return forbidden();
    const tgl=url.searchParams.get('tgl')??todayWIB();
    const {data,error}=await supabase.from('housekeeping').select('*').eq('tgl',tgl).order('created_at');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/housekeeping/done' && m==='PATCH'){
    if(!isStaff) return forbidden();
    const {task_id,done_by,unit_id}=await req.json();
    if(!task_id) return err('task_id wajib diisi');
    const {data:task} = await supabase.from('housekeeping').select('jenis,unit_id,unit_nomor').eq('id',task_id).maybeSingle();
    await supabase.from('housekeeping').update({status:'done',done_at:new Date().toISOString(),done_by}).eq('id',task_id);

    if(task?.jenis==='amenities'){
      const {data:kit} = await supabase.from('amenity_kit_items').select('amenity_id,qty,amenities(nama,stock)');
      for(const item of kit ?? []){
        const currentStock = item.amenities?.stock ?? 0;
        const newStock = Math.max(0, currentStock - item.qty);
        await supabase.from('amenities').update({stock:newStock, updated_at:new Date().toISOString()}).eq('id',item.amenity_id);
        await supabase.from('amenity_usage_log').insert({
          housekeeping_id:task_id, unit_id:task.unit_id, unit_nomor:task.unit_nomor,
          amenity_id:item.amenity_id, amenity_nama:item.amenities?.nama ?? null, qty:item.qty, created_by:done_by ?? null,
        });
      }
    } else if(unit_id) {
      await supabase.from('units').update({status:'available'}).eq('id',unit_id);
    }
    return json({success:true});
  }

  if(path==='/notifications' && m==='GET'){
    const role=url.searchParams.get('role')??'all';
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = undefined;
    let q=supabase.from('notifications').select('*').in('target_role',[role,'all']).order('created_at',{ascending:false}).limit(30);
    if(unit_id) q=q.or(`unit_id.eq.${unit_id},unit_id.is.null`);
    const {data,error}=await q;
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/notifications/read' && m==='PATCH'){
    const {role}=await req.json();
    const field=role==='owner'?'is_read_owner':role==='admin'?'is_read_admin':'is_read_staff';
    await supabase.from('notifications').update({[field]:true}).eq(field,false);
    return json({success:true});
  }

  if(path==='/transactions' && m==='GET'){
    const bulan=url.searchParams.get('bulan');
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = undefined;
    let q=supabase.from('transactions').select('*').order('created_at',{ascending:false}).limit(100);
    if(bulan) q=q.eq('periode_bulan',bulan);
    if(unit_id) q=q.eq('unit_id',unit_id);
    const {data,error}=await q;
    if(error) return err(error.message);
    return json(data);
  }

  if(path==='/opex' && m==='GET'){
    // Staf/admin saja. Rincian opex per item adalah catatan belanja
    // operasional -- nota, nama vendor, jumlah per pos -- dan itu bukan
    // yang dilihat investor. Bagi investor, opex adalah persentase baku
    // dari omzet sesuai akad (25%), bukan daftar pengeluaran.
    //
    // Halaman /investor/opex memang hanya menampilkan persentase itu, tapi
    // endpoint ini sebelumnya sama sekali tidak menjaga peran: token
    // investor mana pun mendapat 200 dan seluruh isi opex_bulanan.
    // Diverifikasi 14 Sep 2026 dengan token investor sungguhan. Yang
    // menyelamatkan sejauh ini cuma kebetulan -- tabelnya masih kosong.
    // Tampilan yang rapi bukan pengamanan.
    if(!isStaff) return forbidden();
    const bulan=url.searchParams.get('bulan')??monthWIB();
    const {data,error}=await supabase.from('opex_bulanan').select('*').eq('periode',bulan).order('created_at');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/opex' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    const {data,error}=await supabase.from('opex_bulanan').insert({...b,periode:b.periode??monthWIB()}).select().single();
    if(error) return err(error.message);
    return json(data,201);
  }

  if(path==='/report' && m==='GET'){
    const periode=url.searchParams.get('periode')??monthWIB();
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = undefined;
    const laporan = await computeReport(unit_id, periode);

    // Bagian investor yang sedang login, kalau memang investor. Dihitung di
    // server, bukan di halaman: dashboard yang menghitung sendiri "5 juta"
    // atau "satu dari 13" akan terus menampilkan angka itu kepada investor
    // yang skemanya berbeda, dan investorlah yang percaya pada layar.
    if(isOwner){
      const {count:unitDimiliki} = await supabase.from('villa_investor_units')
        .select('unit_id',{count:'exact',head:true}).eq('user_id', session.uid);
      const {data:term} = await supabase.from('villa_investor_terms')
        .select('pemasukan_tetap,mulai,selesai').eq('user_id', session.uid)
        .lte('mulai', `${periode}-01`).gte('selesai', `${periode}-01`).maybeSingle();
      const unit = Math.max(1, Number(unitDimiliki ?? 1));
      laporan.unit_dimiliki = unit;
      laporan.pemasukan_tetap = term ? Number(term.pemasukan_tetap) : null;
      laporan.pemasukan_tetap_sampai = term?.selesai ?? null;
      laporan.bagian_anda = term ? Number(term.pemasukan_tetap) : laporan.per_investor_amount * unit;
      // Jaminan minimal tidak berlaku untuk akun berpemasukan tetap: angkanya
      // sudah pasti, jadi tidak ada yang perlu ditambal.
      if(term){ laporan.jaminan_aktif = false; laporan.jaminan_topup = 0; }
    }
    return json(laporan);
  }

  if(path==='/report/ota-breakdown' && m==='GET'){
    const periode = url.searchParams.get('periode') ?? monthWIB();
    return json(await computeOtaBreakdown(periode));
  }

  return err('Endpoint tidak ditemukan',404);
});
