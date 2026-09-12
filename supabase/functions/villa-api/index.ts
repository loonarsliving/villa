import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { timingSafeEqual } from 'node:crypto';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

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

function invoiceNoFor(booking){
  const d = new Date(booking.created_at);
  const ymd = d.toISOString().slice(0,10).replace(/-/g,'');
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
    let sourceNames = null;
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
      const rows = Array.isArray(sourcesBody?.data) ? sourcesBody.data : (sourcesBody?.data ? [sourcesBody.data] : []);

      // Preferred: an active, non-third-party source -- that is the
      // property's own direct/website booking source. Then progressively
      // looser fallbacks, so a bookable source is found even if Cloudbeds
      // words these fields differently than expected.
      const direct = rows.find(x => falsy(x.isThirdParty) && truthy(x.status))
        ?? rows.find(x => falsy(x.isThirdParty))
        ?? rows.find(x => truthy(x.status) && /website|direct|walk|phone|front\s*desk/i.test(String(x.sourceName ?? '')));
      sourceID = direct?.sourceID ?? null;

      // Kept for the failure log: without seeing what Cloudbeds actually
      // returned, "no source resolved" is undiagnosable.
      sourceNames = rows.map(x => ({id: x.sourceID, name: x.sourceName, isThirdParty: x.isThirdParty, status: x.status})).slice(0, 25);
    }
    if(!sourceID){
      await logOutbound(false, {
        error: 'no_direct_source_id_resolved -- set integration_settings.cloudbeds_outbound.source_id manually',
        sources_seen: sourceNames,
      });
      return;
    }

    const nama = (booking.guest_nama ?? 'Tamu Villa').trim();
    const spaceIdx = nama.indexOf(' ');
    const guestFirstName = spaceIdx === -1 ? nama : nama.slice(0, spaceIdx);
    const guestLastName = spaceIdx === -1 ? nama : nama.slice(spaceIdx + 1);
    const guestCountry = sourceSetting?.guest_country_default ?? 'ID';

    const form = new URLSearchParams();
    form.set('sourceID', sourceID);
    form.set('thirdPartyIdentifier', String(booking.id));
    form.set('startDate', booking.tgl_checkin);
    form.set('endDate', booking.tgl_checkout ?? booking.tgl_checkin);
    form.set('guestFirstName', guestFirstName);
    form.set('guestLastName', guestLastName || guestFirstName);
    form.set('guestCountry', guestCountry);
    form.set('rooms[0][roomTypeID]', String(roomTypeID));
    form.set('rooms[0][roomID]', String(mapping.cloudbeds_room_id));
    form.set('rooms[0][quantity]', '1');
    form.set('adults[0][roomTypeID]', String(roomTypeID));
    form.set('adults[0][quantity]', '1');
    form.set('paymentMethod', 'cash');
    form.set('sendEmailConfirmation', 'false');

    const res = await fetch(`${CLOUDBEDS_API_BASE}/postReservation`, {
      method: 'POST',
      headers: {'x-api-key': apiKey, 'Content-Type': 'application/x-www-form-urlencoded'},
      body: form.toString(),
    });
    const body = await res.json().catch(()=>null);
    if(!res.ok || body?.success === false){
      await logOutbound(false, {error: `postReservation_failed: ${body?.message ?? res.status}`, response: body});
      return;
    }

    await supabase.from('bookings').update({cloudbeds_reservation_id: body.reservationID}).eq('id', booking.id);
    await logOutbound(true, {cloudbeds_reservation_id: body.reservationID});
  } catch(e) {
    await logOutbound(false, {error: e instanceof Error ? e.message : String(e)});
  }
}

async function sendWa(phone, message, meta){
  if(!phone){
    await supabase.from('wa_messages_log').insert({...meta, phone:null, message, status:'skipped_no_phone'});
    return;
  }
  const bridge = await getVercelBridge();
  if(!bridge.base_url || !bridge.secret){
    await supabase.from('wa_messages_log').insert({...meta, phone, message, status:'skipped_not_configured'});
    return;
  }
  try {
    const r = await fetch(`${bridge.base_url.replace(/\/+$/,'')}/api/wa/send`, {
      method:'POST',
      headers:{'Content-Type':'application/json','x-internal-secret':bridge.secret},
      body: JSON.stringify({phone, message, ...meta}),
    });
    const result = await r.json().catch(()=>null);
    await supabase.from('wa_messages_log').insert({
      ...meta, phone, message,
      status: (r.ok && result?.success) ? 'sent' : 'failed',
      response: result ?? {http_status:r.status},
    });
  } catch(e){
    await supabase.from('wa_messages_log').insert({...meta, phone, message, status:'error', response:{error:String(e)}});
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

async function countActiveInvestors(){
  const {count} = await supabase.from('villa_users').select('id',{count:'exact',head:true}).eq('role','owner').eq('is_active',true);
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
        else if (name.includes('tiket')) commissionPctBySumber.set('tiket', Number(s.commission ?? 0));
      }
    } catch { /* Cloudbeds unreachable -- fall through with 0% for OTA sumbers below, never invent a number */ }
  }

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
    commission_source: apiKey ? 'cloudbeds_live' : 'unavailable_no_api_key',
  };
}

async function computeDividendList(periode){
  const report = await computeReport(undefined, periode);
  const {data:investors, error} = await supabase.from('villa_users')
    .select('id,nama,hp,unit_nomor,bank_nama,no_rekening,nama_pemilik_rekening')
    .eq('role','owner').eq('is_active',true).order('unit_nomor');
  if(error) throw new Error(error.message);
  const list = (investors ?? []).map(inv => ({
    ...inv,
    jumlah: report.per_investor_amount,
    rekening_lengkap: !!(inv.bank_nama && inv.no_rekening),
  }));
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

  if(path==='/public/bookings' && m==='POST'){
    const b = await req.json().catch(()=>null);
    if(!b) return err('Body tidak valid');
    const nama = String(b.nama??'').trim();
    const hp = String(b.hp??'').trim();
    const tgl_checkin = b.tgl_checkin;
    const tgl_checkout = b.tgl_checkout;
    const room_type = String(b.room_type??'').trim() || null;
    const catatan = String(b.catatan??'').trim();

    if(nama.length<2) return err('Nama wajib diisi');
    if(!/^[0-9+][0-9+\-\s]{7,}$/.test(hp)) return err('Nomor WhatsApp tidak valid');
    if(!isValidDateStr(tgl_checkin)) return err('Tanggal checkin tidak valid');
    if(!isValidDateStr(tgl_checkout)) return err('Tanggal checkout tidak valid');
    if(new Date(tgl_checkout) <= new Date(tgl_checkin)) return err('Tanggal checkout harus setelah checkin');

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
    const computedTarif = await computeStayTarif(freeUnit, tgl_checkin, nights);
    if(computedTarif<=0) return err('Tarif unit belum diatur, hubungi kami langsung', 409);

    const {data:g} = await supabase.from('guests').insert({nama, hp}).select('id').single();

    // Status starts as 'menunggu_pembayaran' -- deliberately OUTSIDE the
    // bookings_no_overlap_active exclusion constraint (which only covers
    // 'terjadwal'/'checkin'), so the unit is NOT locked and does not appear
    // in the staff calendar yet. It only becomes a real, unit-locking
    // 'terjadwal' booking once the guest uploads proof of transfer via
    // /public/bookings/confirm-payment (owner's explicit instruction,
    // 2026-09-11 -- booking used to lock the unit immediately on submit).
    const {data:booking, error:bookErr} = await supabase.from('bookings').insert({
      unit_id: freeUnit.id, unit_nomor: freeUnit.nomor, guest_id: g?.id ?? null, guest_nama: nama,
      tipe: 'harian', sumber: 'website', tgl_checkin, tgl_checkout,
      durasi_malam: nights, checkin_time: '14:00:00',
      tarif: computedTarif, total_bayar: computedTarif, status: 'menunggu_pembayaran',
      catatan: catatan ? `[Website] ${catatan}` : '[Website] Booking mandiri dari loonars.id -- menunggu bukti pembayaran QRIS.',
    }).select().single();
    if(bookErr){
      if(bookErr.code === '23P01') return err('Maaf, unit baru saja dibooking tamu lain. Silakan pilih tanggal/tipe lain.', 409);
      return err(bookErr.message);
    }

    const kode = paymentCode(booking.id);
    await notif(freeUnit.id, 'all', 'booking', `Booking baru dari Website (menunggu pembayaran) -- Unit ${freeUnit.nomor}`,
      `${nama} (${hp}) - ${tgl_checkin} s/d ${tgl_checkout} - Rp ${Math.round(computedTarif).toLocaleString('id-ID')} -- unit belum terkunci, menunggu konfirmasi pembayaran (kode ${kode})`, booking.id);

    // WA ke owner supaya dia bisa mengunci unit hanya dengan membalas kode
    // ini begitu notifikasi QRIS masuk di HP-nya. Nomornya dari
    // integration_settings.villa_notify.owner_hp -- kalau belum diisi,
    // sendWa() mencatat 'skipped_no_phone' dan booking tetap berjalan
    // normal, jadi fitur ini tidak pernah bisa menggagalkan pemesanan.
    const notifySetting = await getSetting('villa_notify');
    await sendWa(notifySetting?.owner_hp ?? null,
      `Booking baru dari website\n\n${nama} (${hp})\nUnit ${freeUnit.nomor}\n${tgl_checkin} s/d ${tgl_checkout} (${nights} malam)\nTotal: Rp ${Math.round(computedTarif).toLocaleString('id-ID')}\n\nKalau dana sudah masuk, balas:\nLUNAS ${kode}`,
      {booking_id: booking.id, unit_id: freeUnit.id, template_type:'website_booking_awaiting_payment'});

    return json({
      booking_id: booking.id, unit_nomor: freeUnit.nomor,
      tgl_checkin, tgl_checkout, durasi_malam: nights,
      tarif: computedTarif, total_bayar: computedTarif, status: booking.status,
    }, 201);
  }

  // Konfirmasi pembayaran (upload bukti transfer) dari tamu di public booking
  // site. QRIS pembayaran tetap statis (tidak ada verifikasi otomatis via
  // payment gateway) -- tamu dianggap sudah bayar begitu mereka mengupload
  // bukti transfer di sini, lalu tombol "Cetak Invoice" di frontend terbuka.
  // Cocokkan booking_id + hp supaya orang lain tidak bisa mengisi bukti untuk
  // booking milik tamu lain.
  //
  // Ini juga titik di mana booking benar-benar "mengunci" unit: status
  // berubah dari 'menunggu_pembayaran' -> 'terjadwal' di sini, BUKAN saat
  // booking pertama kali dibuat (owner's explicit instruction, 2026-09-11).
  // Karena exclusion constraint bookings_no_overlap_active hanya berlaku
  // untuk status 'terjadwal'/'checkin', UPDATE status ini otomatis gagal
  // (23P01) kalau ternyata unit sudah keburu dikunci booking lain untuk
  // tanggal yang sama -- jadi tidak perlu app-level conflict re-check
  // terpisah yang rawan race condition, Postgres yang menjaminnya.
  if(path==='/public/bookings/confirm-payment' && m==='POST'){
    const b = await req.json().catch(()=>null);
    if(!b) return err('Body tidak valid');
    const booking_id = String(b.booking_id??'').trim();
    const hp = String(b.hp??'').trim();
    const dataUrl = String(b.dataUrl??'');
    if(!/^[0-9a-f-]{36}$/i.test(booking_id)) return err('booking_id tidak valid');
    if(!hp) return err('Nomor WhatsApp wajib diisi');
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if(!match) return err('Bukti transfer harus berupa gambar (JPG/PNG)');
    const [, ext, base64] = match;
    let bytes;
    try{ bytes = Uint8Array.from(atob(base64), c=>c.charCodeAt(0)); } catch { return err('Bukti transfer tidak valid'); }
    if(bytes.length > 8*1024*1024) return err('Bukti transfer terlalu besar (maks 8MB)');

    const {data:booking} = await supabase.from('bookings').select('id,guest_id,sumber,invoice_no,created_at,status,unit_id,unit_nomor,guest_nama,cloudbeds_reservation_id,tgl_checkin,tgl_checkout').eq('id',booking_id).maybeSingle();
    if(!booking) return err('Booking tidak ditemukan', 404);
    if(booking.sumber !== 'website') return err('Booking ini tidak bisa dikonfirmasi lewat jalur ini', 403);
    let guestHp = null;
    if(booking.guest_id){
      const {data:g} = await supabase.from('guests').select('hp').eq('id',booking.guest_id).maybeSingle();
      guestHp = g?.hp ?? null;
    }
    if(!guestHp || guestHp.trim() !== hp) return err('Nomor WhatsApp tidak cocok dengan booking ini', 403);

    const path = `bukti-bayar/${booking_id}-${Date.now()}.${ext}`;
    const {error:upErr} = await supabase.storage.from('guest-documents').upload(path, bytes, {contentType:`image/${ext}`, upsert:false});
    if(upErr) return err(upErr.message, 500);

    let invoice_no = booking.invoice_no;
    if(!invoice_no){
      const d = new Date(booking.created_at);
      const ymd = d.toISOString().slice(0,10).replace(/-/g,'');
      invoice_no = `INV-LV-${ymd}-${booking_id.slice(0,8).toUpperCase()}`;
    }

    const shouldLockUnit = booking.status === 'menunggu_pembayaran';
    const basePatch = { bukti_pembayaran_path: path, bukti_pembayaran_at: new Date().toISOString(), invoice_no };
    let unitLocked = booking.status === 'terjadwal';

    if(shouldLockUnit){
      const {error:lockErr} = await supabase.from('bookings').update({...basePatch, status:'terjadwal'}).eq('id', booking_id);
      if(lockErr && lockErr.code !== '23P01') return err(lockErr.message, 500);
      unitLocked = !lockErr;
    }
    if(!unitLocked){
      // Unit sudah dikunci booking lain untuk tanggal yang sama duluan --
      // tetap simpan bukti pembayarannya (tamu sudah bayar) dan tetap
      // terbitkan invoice, tapi status booking dibiarkan 'menunggu_pembayaran'
      // (tidak masuk kalender) sampai staff menjadwalkan ulang secara manual.
      const {error:saveErr} = await supabase.from('bookings').update(basePatch).eq('id', booking_id);
      if(saveErr) return err(saveErr.message, 500);
      await notif(null, 'all', 'transfer', `KONFLIK UNIT -- Booking Website perlu dijadwalkan ulang`,
        `Booking ${booking_id.slice(0,8)} (Unit ${booking.unit_nomor}, ${booking.tgl_checkin} s/d ${booking.tgl_checkout}) sudah bayar tapi unit sudah terisi booking lain -- mohon segera hubungi tamu untuk reschedule/unit pengganti.`, booking_id);
      return json({success:true, invoice_no});
    }

    await notif(null, 'all', 'transfer', `Pembayaran dikonfirmasi -- Unit ${booking.unit_nomor} terkunci`,
      `Booking ${booking_id.slice(0,8)} (${booking.tgl_checkin} s/d ${booking.tgl_checkout}) sudah upload bukti transfer, unit sudah masuk kalender.`, booking_id);

    // Same reason as the WhatsApp confirmation path above.
    await pushBookingToCloudbeds({...booking, id: booking_id, status:'terjadwal'});

    return json({success:true, invoice_no});
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
      .select('id,guest_id,sumber,status,invoice_no').eq('id',booking_id).maybeSingle();
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

    return json({
      status: booking.status,
      confirmed: booking.status === 'terjadwal',
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
  if(path==='/bridge/push-unsynced-bookings' && m==='POST'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi (integration_settings.vercel_bridge.secret)',503);
    const provided = req.headers.get('x-internal-secret') ?? '';
    if(!await secretsMatch(provided, bridge.secret)) return err('Unauthorized',401);

    const today = new Date().toISOString().slice(0,10);
    const {data:pending} = await supabase.from('bookings')
      .select('id,unit_id,unit_nomor,guest_nama,tgl_checkin,tgl_checkout,status,sumber,cloudbeds_reservation_id')
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

    const {data:pending} = await supabase.from('bookings')
      .select('id,unit_id,unit_nomor,guest_id,guest_nama,tgl_checkin,tgl_checkout,total_bayar,created_at,status,invoice_no,cloudbeds_reservation_id')
      .eq('sumber','website').eq('status','menunggu_pembayaran');
    const booking = (pending ?? []).find(x => paymentCode(x.id) === code) ?? null;

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
      `Booking ${String(booking.id).slice(0,8)} (${booking.tgl_checkin} s/d ${booking.tgl_checkout}) dikonfirmasi lunas oleh owner via WhatsApp, unit sudah masuk kalender.`, booking.id);

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
      success:true, unit_nomor:booking.unit_nomor, guest_nama:booking.guest_nama,
      tgl_checkin:booking.tgl_checkin, tgl_checkout:booking.tgl_checkout,
      total_bayar:booking.total_bayar, invoice_no,
    });
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
    const tanggal = new Date().toISOString().split('T')[0];
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
  // 2026, 13:05 WITA per vercel.json) -- not a recurring monthly cron, so
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

    const periode = new Date().toISOString().slice(0,7);
    let list;
    try { list = await computeDividendList(periode); } catch(e){ return err(e.message,500); }

    const lines = list.investors.map(inv => {
      const rek = inv.rekening_lengkap
        ? `${inv.bank_nama} ${inv.no_rekening} a.n ${inv.nama_pemilik_rekening || inv.nama}`
        : 'REKENING BELUM DIISI';
      return `• Unit ${inv.unit_nomor} — ${inv.nama}: Rp ${Math.round(inv.jumlah).toLocaleString('id-ID')} → ${rek}`;
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
    if(!periode){
      const now = new Date();
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-1, 1));
      periode = prev.toISOString().slice(0,7);
    }

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

  const session = await requireAuth(req);
  if(!session) return err('Unauthorized',401);
  const isAdmin = session.role==='admin';
  const isStaff = session.role==='receptionist' || isAdmin;
  const isOwner = session.role==='owner';

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
    const periode = url.searchParams.get('periode') ?? new Date().toISOString().slice(0,7);
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

  if(path==='/admin/overview' && m==='GET'){
    const bulan = new Date().toISOString().slice(0,7);
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

  if(path==='/units' && m==='GET'){
    const blok=url.searchParams.get('blok');
    const owner_id=url.searchParams.get('owner_id');
    let q=supabase.from('units').select('*');
    if(isOwner) q=q.eq('id', session.unit_id ?? '00000000-0000-0000-0000-000000000000');
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
    const tgl=new Date().toISOString().split('T')[0];
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
    if(isOwner) unit_id = session.unit_id;
    let q=supabase.from('bookings').select('*');
    if(status) q=q.eq('status',status);
    if(unit_id) q=q.eq('unit_id',unit_id);
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
      const flatTarif = Number(unit.tarif_harian ?? 0);

      let plannedByDate = new Map();
      if(unit.room_type_id){
        const nightDates = [];
        for(let i=0;i<nights;i++){
          const d = new Date(`${b.tgl_checkin}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate()+i);
          nightDates.push(d.toISOString().slice(0,10));
        }
        const {data:plannedRates} = await supabase.from('villa_rates')
          .select('date,rate')
          .eq('room_type_id', unit.room_type_id)
          .in('date', nightDates);
        for(const r of (plannedRates??[])) plannedByDate.set(r.date, Number(r.rate));
      }

      if(plannedByDate.size > 0){
        computedTarif = 0;
        for(let i=0;i<nights;i++){
          const d = new Date(`${b.tgl_checkin}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate()+i);
          const dateStr = d.toISOString().slice(0,10);
          computedTarif += plannedByDate.has(dateStr) ? plannedByDate.get(dateStr) : flatTarif;
        }
      } else {
        computedTarif = flatTarif * nights;
      }
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
    const tgl=url.searchParams.get('tgl')??new Date().toISOString().split('T')[0];
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
    const bulan=url.searchParams.get('bulan')??new Date().toISOString().slice(0,7);
    const {data,error}=await supabase.from('opex_bulanan').select('*').eq('periode',bulan).order('created_at');
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/opex' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    const {data,error}=await supabase.from('opex_bulanan').insert({...b,periode:b.periode??new Date().toISOString().slice(0,7)}).select().single();
    if(error) return err(error.message);
    return json(data,201);
  }

  if(path==='/report' && m==='GET'){
    const periode=url.searchParams.get('periode')??new Date().toISOString().slice(0,7);
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = undefined;
    return json(await computeReport(unit_id, periode));
  }

  if(path==='/report/ota-breakdown' && m==='GET'){
    const periode = url.searchParams.get('periode') ?? new Date().toISOString().slice(0,7);
    return json(await computeOtaBreakdown(periode));
  }

  return err('Endpoint tidak ditemukan',404);
});
