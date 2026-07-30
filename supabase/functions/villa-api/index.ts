import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Signs session tokens issued at /login. Set VILLA_SESSION_SECRET as a function secret in
// production (Supabase Dashboard > Edge Functions > villa-api > Secrets) to override this default.
const SESSION_SECRET = Deno.env.get('VILLA_SESSION_SECRET') ?? 'a7d25e59ac89b032aa4626c580bfcb6609dfe92b1989a8f94933606f702e3e91';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-villa-token,x-cloudbeds-secret,x-internal-secret','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS' };

function json(d: unknown, s=200){ return new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}}); }
function err(m: string, s=400){ return json({error:m},s); }

// ---------- session tokens (HMAC-signed, not a shared static secret) ----------
type Session = { uid:string; email:string; role:string; unit_id:string|null; unit_nomor:string|null; iat:number; exp:number };

function b64url(bytes: Uint8Array): string {
  let s=''; for(const b of bytes) s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlToBytes(str: string): Uint8Array {
  const s = str.replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SESSION_SECRET), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function makeToken(payload: Omit<Session,'iat'|'exp'>): Promise<string> {
  const full: Session = {...payload, iat: Date.now(), exp: Date.now()+SESSION_TTL_MS};
  const body = b64url(new TextEncoder().encode(JSON.stringify(full)));
  const sig = await hmac(body);
  return `${body}.${sig}`;
}
async function verifyToken(token: string): Promise<Session|null> {
  const parts = token.split('.');
  if(parts.length!==2) return null;
  const [body,sig] = parts;
  const expected = await hmac(body);
  if(expected!==sig) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as Session;
    if(!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
async function requireAuth(req: Request): Promise<Session|null> {
  const token = req.headers.get('x-villa-token');
  if(!token) return null;
  return await verifyToken(token);
}
function forbidden(){ return err('Forbidden untuk role ini',403); }

// ---------- integration settings ----------
async function getSetting(key: string): Promise<Record<string, any>> {
  const {data} = await supabase.from('integration_settings').select('value').eq('key',key).maybeSingle();
  return (data?.value as Record<string,any>) ?? {};
}
function redact(value: Record<string,any>): Record<string,any> {
  const out = {...value};
  for(const k of Object.keys(out)){
    if(/key|secret|token/i.test(k) && typeof out[k]==='string' && out[k].length>4){
      out[k] = out[k].slice(0,2)+'••••'+out[k].slice(-2);
    }
  }
  return out;
}

// ---------- notifications ----------
async function notif(unit_id: string|null, role: string, tipe: string, judul: string, pesan: string, ref_id?: string){
  await supabase.from('notifications').insert({unit_id:unit_id??null,target_role:role,tipe,judul,pesan,ref_id:ref_id??null});
}

// ---------- WhaCenter (via file hub bridge) ----------
// Villa tidak memegang kredensial WhaCenter. Device WhaCenter dimiliki MK Connect
// (Mkhsistem); penghubungnya adalah file hub (filehub-loonars, filemanager.haluoleo.id):
// villa-api → file hub /api/wa/send → MK Connect /api/integrations/whatsapp/bridge-send
// → WhaCenter. Fungsi ini hanya meneruskan permintaan kirim lewat HTTP, diautentikasi
// dengan rahasia bersama yang disimpan di integration_settings.vercel_bridge
// (base_url = URL file hub, secret = kembaran VILLA_BRIDGE_SECRET di Vercel file hub).
async function getVercelBridge(): Promise<{base_url?:string, secret?:string}> {
  return await getSetting('vercel_bridge');
}

// Perbandingan rahasia jembatan tanpa membocorkan isi lewat timing: kedua sisi
// di-hash SHA-256 dulu, baru string hash-nya dibandingkan — perbedaan waktu
// perbandingan hash tidak berkorelasi dengan isi rahasia aslinya.
async function sha256hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function bridgeSecretsMatch(provided: string, expected: string): Promise<boolean> {
  return (await sha256hex(provided.trim())) === (await sha256hex(expected.trim()));
}

async function sendWa(phone: string|null, message: string, meta: {booking_id?:string|null, unit_id?:string|null, template_type:string}){
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
    // Hasil kirim dicatat DI SINI berdasarkan balasan jembatan — file hub meneruskan
    // SendResult dari connector WhaCenter MK Connect apa adanya, jadi satu baris
    // wa_messages_log per percobaan kirim, dengan status sent/failed yang nyata.
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

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  const url=new URL(req.url);
  const path=url.pathname.replace(/^\/villa-api/,'');
  const m=req.method;

  // LOGIN — public
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

  // BRIDGE — dipanggil file hub (bukan browser), auth rahasia jembatan sendiri.
  // Rangkuman okupansi harian untuk halaman "Okupansi Kos" MK Connect:
  // MK Connect → file hub /api/villa/occupancy → endpoint ini. Read-only,
  // hanya angka agregat — tidak ada data tamu/transaksi yang keluar.
  if(path==='/bridge/occupancy' && m==='GET'){
    const bridge = await getVercelBridge();
    if(!bridge.secret) return err('Jembatan belum dikonfigurasi (integration_settings.vercel_bridge.secret)',503);
    const provided = req.headers.get('x-internal-secret') ?? '';
    if(!provided || !(await bridgeSecretsMatch(provided, bridge.secret))) return err('Unauthorized',401);
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

  // Everything below requires a valid signed session token
  const session = await requireAuth(req);
  if(!session) return err('Unauthorized',401);
  const isAdmin = session.role==='admin';
  const isStaff = session.role==='receptionist' || isAdmin;
  const isOwner = session.role==='owner';

  // ---------------- ADMIN ----------------
  if(path.startsWith('/admin/') && !isAdmin) return forbidden();

  if(path==='/admin/settings' && m==='GET'){
    const {data,error} = await supabase.from('integration_settings').select('*');
    if(error) return err(error.message);
    return json((data||[]).map(r=>({key:r.key, updated_at:r.updated_at, updated_by:r.updated_by, value: redact(r.value)})));
  }
  if(path==='/admin/settings' && m==='POST'){
    const b = await req.json();
    if(!b.key) return err('key wajib diisi');
    // Merge server-side so a blank/masked field in the client payload never overwrites the
    // real stored secret — the client only ever sees redacted values via GET /admin/settings.
    const {data:existing} = await supabase.from('integration_settings').select('value').eq('key',b.key).maybeSingle();
    const merged = {...(existing?.value??{}), ...(b.value??{})};
    const {data,error} = await supabase.from('integration_settings')
      .upsert({key:b.key, value:merged, updated_at:new Date().toISOString(), updated_by:session.email})
      .select().single();
    if(error) return err(error.message);
    return json({key:data.key, updated_at:data.updated_at, value: redact(data.value)});
  }

  if(path==='/admin/users' && m==='GET'){
    const {data,error} = await supabase.from('villa_users').select('id,nama,email,role,unit_id,unit_nomor,hp,is_active,last_login,created_at').order('created_at',{ascending:false});
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/admin/users' && m==='POST'){
    const b = await req.json();
    if(!b.nama||!b.email||!b.password||!b.role) return err('nama, email, password, role wajib diisi');
    const {data,error} = await supabase.rpc('villa_create_user',{
      p_nama:b.nama, p_email:b.email, p_password:b.password, p_role:b.role,
      p_unit_id:b.unit_id??null, p_unit_nomor:b.unit_nomor??null, p_hp:b.hp??null,
    });
    if(error) return err(error.message);
    return json(Array.isArray(data)?data[0]:data, 201);
  }
  if(path==='/admin/users' && m==='PATCH'){
    const b = await req.json();
    if(!b.id) return err('id wajib diisi');
    if(b.new_password){
      const {error} = await supabase.rpc('villa_set_password',{p_user_id:b.id, p_password:b.new_password});
      if(error) return err(error.message);
    }
    if(typeof b.is_active==='boolean'){
      const {error} = await supabase.from('villa_users').update({is_active:b.is_active}).eq('id',b.id);
      if(error) return err(error.message);
    }
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
      gross_revenue_bulan_ini: (txs||[]).reduce((s:number,t:any)=>s+Number(t.jumlah),0),
      cloudbeds_belum_dipetakan: cbUnmatched?.length??0,
      wa_gagal_terkirim: waFailed?.length??0,
      total_user: users?.length??0,
      user_aktif: users?.filter(u=>u.is_active).length??0,
    });
  }

  // ---------------- WA manual send (staff/admin) ----------------
  if(path==='/wa/send' && m==='POST'){
    if(!isStaff) return forbidden();
    const b = await req.json();
    if(!b.phone||!b.message) return err('phone dan message wajib diisi');
    await sendWa(b.phone, b.message, {booking_id:b.booking_id??null, unit_id:b.unit_id??null, template_type:b.template_type??'manual'});
    return json({success:true});
  }

  // ---------------- UNITS ----------------
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

  // ---------------- SUMMARY (staff/admin) ----------------
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

  // ---------------- BOOKINGS ----------------
  if(path==='/bookings' && m==='GET'){
    const status=url.searchParams.get('status');
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = session.unit_id;
    let q=supabase.from('bookings').select('*').order('created_at',{ascending:false}).limit(50);
    if(status) q=q.eq('status',status);
    if(unit_id) q=q.eq('unit_id',unit_id);
    const {data,error}=await q;
    if(error) return err(error.message);
    return json(data);
  }
  if(path==='/bookings' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    let guest_id=b.guest_id??null;
    if(!guest_id && b.guest_nama){
      const {data:g}=await supabase.from('guests').insert({nama:b.guest_nama,hp:b.guest_hp??null,no_ktp:b.guest_ktp??null}).select('id').single();
      guest_id=g?.id??null;
    }
    const {data,error}=await supabase.from('bookings').insert({
      unit_id:b.unit_id, unit_nomor:b.unit_nomor, guest_id, guest_nama:b.guest_nama,
      tipe:b.tipe, sumber:b.sumber??'walk-in', tgl_checkin:b.tgl_checkin,
      tgl_checkout:b.tgl_checkout??null, durasi_malam:b.durasi_malam??null,
      tarif:b.tarif, total_bayar:b.total_bayar??null, status:'terjadwal',
    }).select().single();
    if(error) return err(error.message);
    await notif(b.unit_id,'all','booking',`Booking baru — Unit ${b.unit_nomor}`,`${b.guest_nama} · ${b.tipe} · ${b.sumber}`,data.id);
    return json(data,201);
  }

  // ---------------- CHECK-IN ----------------
  if(path==='/checkin' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    const now=new Date().toISOString();
    const pin = String(Math.floor(1000+Math.random()*9000));
    await supabase.from('bookings').update({status:'checkin',checkin_at:now,checkin_by:b.checkin_by,pin_kode:pin}).eq('id',b.booking_id);
    await supabase.from('units').update({status:'occupied'}).eq('id',b.unit_id);
    await supabase.from('transactions').insert({
      unit_id:b.unit_id, booking_id:b.booking_id, tipe:'income', kategori:b.tipe,
      deskripsi:`Check-in ${b.guest_nama} — Unit ${b.unit_nomor}`,
      jumlah:b.total_bayar, periode_bulan:new Date().toISOString().slice(0,7), dicatat_oleh:b.checkin_by,
    });
    await notif(b.unit_id,'all','checkin',`Check-in — Unit ${b.unit_nomor}`,`${b.guest_nama} · ${b.tipe}`,b.booking_id);

    let guestPhone: string|null = b.guest_hp ?? null;
    if(!guestPhone){
      const {data:bk} = await supabase.from('bookings').select('guest_id').eq('id',b.booking_id).single();
      if(bk?.guest_id){
        const {data:g} = await supabase.from('guests').select('hp').eq('id',bk.guest_id).single();
        guestPhone = g?.hp ?? null;
      }
    }
    await sendWa(guestPhone,
      `Halo ${b.guest_nama}, selamat datang di Loonars Private Living Unit ${b.unit_nomor}!\nKode PIN pintu Anda: *${pin}*\nMohon jaga kerahasiaan kode ini selama menginap. Terima kasih.`,
      {booking_id:b.booking_id, unit_id:b.unit_id, template_type:'pin_checkin'});

    return json({success:true, pin_kode:pin});
  }

  // ---------------- CHECK-OUT ----------------
  if(path==='/checkout' && m==='POST'){
    if(!isStaff) return forbidden();
    const b=await req.json();
    const now=new Date().toISOString();
    await supabase.from('bookings').update({status:'checkout',checkout_at:now,checkout_by:b.checkout_by,catatan:b.kondisi}).eq('id',b.booking_id);
    await supabase.from('units').update({status:'dirty'}).eq('id',b.unit_id);
    await supabase.from('housekeeping').insert({unit_id:b.unit_id,unit_nomor:b.unit_nomor,tugas:`Bersihkan unit setelah checkout ${b.guest_nama}`,tgl:new Date().toISOString().split('T')[0]});
    await notif(b.unit_id,'all','checkout',`Checkout — Unit ${b.unit_nomor}`,`${b.guest_nama} sudah checkout. Housekeeping dijadwalkan.`,b.booking_id);
    return json({success:true});
  }

  // ---------------- HOUSEKEEPING ----------------
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
    await supabase.from('housekeeping').update({status:'done',done_at:new Date().toISOString(),done_by}).eq('id',task_id);
    if(unit_id) await supabase.from('units').update({status:'available'}).eq('id',unit_id);
    return json({success:true});
  }

  // ---------------- NOTIFICATIONS ----------------
  if(path==='/notifications' && m==='GET'){
    const role=url.searchParams.get('role')??'all';
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = session.unit_id;
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

  // ---------------- TRANSACTIONS ----------------
  if(path==='/transactions' && m==='GET'){
    const bulan=url.searchParams.get('bulan');
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = session.unit_id;
    let q=supabase.from('transactions').select('*').order('created_at',{ascending:false}).limit(100);
    if(bulan) q=q.eq('periode_bulan',bulan);
    if(unit_id) q=q.eq('unit_id',unit_id);
    const {data,error}=await q;
    if(error) return err(error.message);
    return json(data);
  }

  // ---------------- OPEX ----------------
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

  // ---------------- REPORT per unit ----------------
  if(path==='/report' && m==='GET'){
    const periode=url.searchParams.get('periode')??new Date().toISOString().slice(0,7);
    let unit_id=url.searchParams.get('unit_id');
    if(isOwner) unit_id = session.unit_id;
    let q=supabase.from('transactions').select('tipe,jumlah').eq('periode_bulan',periode).eq('tipe','income');
    if(unit_id) q=q.eq('unit_id',unit_id);
    const {data:txs}=await q;
    const gross=(txs||[]).reduce((s:number,t:any)=>s+Number(t.jumlah),0);
    const {data:opexRows}=await supabase.from('opex_bulanan').select('per_unit').eq('periode',periode);
    const opex_per_unit=(opexRows||[]).reduce((s:number,o:any)=>s+Number(o.per_unit),0);
    const gross_profit=gross-opex_per_unit;
    const owner_amount=gross_profit*0.70;
    const loonars_amount=gross_profit*0.30;
    const jaminan_aktif=owner_amount<5000000;
    const jaminan_topup=jaminan_aktif?5000000-owner_amount:0;
    return json({periode,gross_revenue:gross,opex_per_unit,gross_profit,owner_amount,loonars_amount,jaminan_aktif,jaminan_topup});
  }

  return err('Endpoint tidak ditemukan',404);
});
