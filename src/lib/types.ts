export type Role = "owner" | "receptionist" | "admin" | "finance";

export interface SessionUser {
  id: string;
  nama: string;
  role: Role;
  unit_id: string | null;
  unit_nomor: string | null;
  is_active: boolean;
  must_change_password?: boolean;
}

export interface Unit {
  id: string;
  nomor: string;
  blok: "A" | "B" | "C";
  status: "available" | "occupied" | "checkout" | "dirty" | "maintenance";
  owner_id: string | null;
  owner_nama: string | null;
  owner_hp: string | null;
  catatan: string | null;
  tarif_harian: number;
  tarif_bulanan: number;
}

export interface UnitAvailability {
  id: string;
  nomor: string;
  blok: "A" | "B" | "C";
  status: Unit["status"];
  tersedia_untuk_tanggal: boolean;
  dibooking_oleh: string | null;
}

export interface Booking {
  id: string;
  unit_id: string;
  unit_nomor: string;
  guest_nama: string;
  guest_hp?: string | null;
  tipe: "harian" | "bulanan";
  status: "terjadwal" | "checkin" | "checkout" | "batal" | "menunggu_pembayaran";
  sumber: string;
  tgl_checkin: string;
  tgl_checkout: string | null;
  tarif: number;
  total_bayar: number | null;
  created_at: string;
  pin_kode?: string | null;
}

export interface Transaction {
  id: string;
  unit_id: string | null;
  booking_id: string | null;
  tipe: "income" | "opex" | "transfer_owner" | "jaminan";
  kategori: string | null;
  deskripsi: string;
  jumlah: number;
  periode_bulan: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  unit_id: string | null;
  target_role: "all" | "owner" | "receptionist";
  tipe: string;
  judul: string;
  pesan: string;
  is_read_owner: boolean;
  is_read_staff: boolean;
  is_read_admin?: boolean;
  created_at: string;
}

export interface HousekeepingTask {
  id: string;
  unit_id: string | null;
  unit_nomor: string | null;
  tugas: string;
  status: "pending" | "done";
  tgl: string;
  jenis: "bersih" | "amenities";
}

export interface AmenityItem {
  id: string;
  nama: string;
  satuan: string;
  stock: number;
  stock_minimum: number;
  updated_at: string;
}

export interface AmenityKitItem {
  id: string;
  amenity_id: string;
  qty: number;
  amenities?: { nama: string; satuan: string; stock: number } | null;
}

export interface CctvCamera {
  id: string;
  nama: string;
  zona: "satpam" | "resepsionis" | null;
  deskripsi: string | null;
  ezviz_serial: string;
  ezviz_channel_no: number;
  ezviz_verification_code: string | null;
  checkpoint_interval_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CctvCheckpointLog {
  id: string;
  camera_id: string;
  captured_at: string;
  status: "ok" | "capture_failed" | "ai_failed";
  person_detected: boolean | null;
  snapshot_url: string | null;
  ai_summary: string | null;
  error_detail: string | null;
  created_at: string;
}

export interface CctvDisciplinaryReport {
  id: string;
  camera_id: string;
  period_start: string;
  period_end: string;
  total_checkpoints: number;
  total_present: number;
  total_absent: number;
  absence_details: { captured_at: string; ai_summary: string | null }[];
  status: "pending_review" | "confirmed" | "dismissed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  generated_at: string;
  cctv_cameras?: { nama: string; zona: string | null } | null;
}

export interface AmenityUsageLog {
  id: string;
  unit_id: string | null;
  unit_nomor: string | null;
  amenity_id: string | null;
  amenity_nama: string | null;
  qty: number;
  created_at: string;
  created_by: string | null;
}

export interface Report {
  periode: string;
  gross_revenue: number;
  opex_per_unit: number;
  opex_pct?: number;
  marketing_pct: number;
  marketing_amount: number;
  gross_profit: number;
  net: number;
  owner_amount: number;
  loonars_amount: number;
  pengelola_amount: number;
  jaminan_aktif: boolean;
  jaminan_topup: number;
  walkin_income?: { cafe: number; spa: number; lainnya: number; total: number };
  investor_count?: number;
  per_investor_amount?: number;
  /** Diisi hanya kalau yang memanggil adalah investor. Lihat /report di villa-api. */
  unit_dimiliki?: number;
  /** Angka pasti tiap bulan untuk investor berskema khusus; null untuk bagi hasil biasa. */
  pemasukan_tetap?: number | null;
  pemasukan_tetap_sampai?: string | null;
  /** Yang benar-benar diterima investor ini bulan ini, sudah memperhitungkan jumlah unit dan skema khususnya. */
  bagian_anda?: number;
}

export interface OtaBreakdownSource {
  sumber: string;
  gross: number;
  commission_pct: number;
  commission_amount: number;
  net: number;
}
export interface OtaBreakdown {
  periode: string;
  sources: OtaBreakdownSource[];
  total_gross: number;
  total_commission: number;
  total_net: number;
  commission_source: "cloudbeds_live" | "unavailable_no_api_key";
}

export interface Summary {
  available: number;
  occupied: number;
  dirty: number;
  total: number;
  checkout_today: number;
  checkin_today: number;
  housekeeping_pending: number;
  notif_unread: number;
}

export interface AdminOverview {
  total_unit: number;
  available: number;
  occupied: number;
  gross_revenue_bulan_ini: number;
  cloudbeds_belum_dipetakan: number;
  wa_gagal_terkirim: number;
  total_user: number;
  user_aktif: number;
}

export interface VillaUserRow {
  id: string;
  nama: string;
  email: string;
  role: Role;
  unit_id: string | null;
  unit_nomor: string | null;
  hp: string | null;
  is_active: boolean;
  must_change_password: boolean;
  last_login: string | null;
  created_at: string;
}

export interface InvestorProfile {
  id: string;
  unit_id: string;
  unit_nomor: string;
  user_id: string;
  nama: string;
  hp: string;
  bank_nama?: string | null;
  no_rekening?: string | null;
  nama_pemilik_rekening?: string | null;
  created_at: string;
  units?: { nomor: string; blok: string };
  lunas_pembayaran?: boolean;
}

export interface MyInvestorProfile {
  nama: string;
  hp: string;
  bank_nama: string | null;
  no_rekening: string | null;
  nama_pemilik_rekening: string | null;
}

export interface DividendListRow {
  id: string;
  nama: string;
  hp: string | null;
  unit_nomor: string | null;
  bank_nama: string | null;
  no_rekening: string | null;
  nama_pemilik_rekening: string | null;
  jumlah: number;
  rekening_lengkap: boolean;
}

export interface DividendList {
  periode: string;
  per_investor_amount: number;
  investor_count: number;
  investors: DividendListRow[];
}

export interface StaffMember {
  id: string;
  nama: string;
  role: "security" | "cleaning_service" | "guest_greeter";
  hp: string | null;
  is_active: boolean;
}

export interface WaLogRow {
  id: string;
  phone: string | null;
  template_type: string | null;
  message: string | null;
  status: string | null;
  created_at: string;
}

export interface IntegrationSetting {
  key: string;
  updated_at: string;
  updated_by: string | null;
  value: Record<string, unknown>;
}

export interface CloudbedsMapping {
  id: string;
  cloudbeds_room_id: string;
  cloudbeds_room_name: string | null;
  unit_id: string;
  units?: { nomor: string; blok: string };
}

export interface CloudbedsLogRow {
  id: string;
  reservation_id: string | null;
  event_type: string;
  matched: boolean;
  created_at: string;
}

// ── Finance dashboard ───────────────────────────────────────────────────

export type NormalizedChannel = "DIRECT" | "BOOKING_COM" | "AGODA" | "AIRBNB" | "OTHER_OTA" | "UNKNOWN";
export type CollectionMethod = "DIRECT_PAYMENT" | "OTA_COLLECT" | "VCC" | "PAY_AT_PROPERTY" | "PAYMENT_GATEWAY" | "UNKNOWN";
export type SettlementStatus = "PENDING" | "READY_TO_COLLECT" | "PROCESSING" | "RECEIVED";
export type SettlementConfidence = "CONFIGURED" | "UNKNOWN";
export type ReconciliationStatus = "MATCHED" | "VARIANCE";
export type PaymentStatus = "PAID" | "UNPAID" | "CANCELLED";

export interface FinanceAlert {
  type: string;
  level: "info" | "warning" | "danger";
  message: string;
}

export interface FinanceSummary {
  period: { from: string; to: string };
  gross_revenue: number;
  net_revenue: number;
  net_revenue_note: string;
  payment_received: number;
  payment_received_note: string;
  outstanding: number;
  ota_receivable: number;
  ota_receivable_note: string;
  cash_received: { amount: number; verified: boolean; count: number; note: string };
  bookings_counted: number;
  cloudbeds_balance_verified_count: number;
  cancelled_excluded: number;
  alerts: FinanceAlert[];
  last_cloudbeds_activity: string | null;
  data_caveats: string[];
}

export interface FinanceChannelRow {
  sumber: string;
  normalized_channel: NormalizedChannel;
  revenue: number;
  payment: number;
  outstanding: number;
  ota_receivable: number;
  settled_count: number;
  unsettled_count: number;
  booking_count: number;
  collection_method: CollectionMethod;
  destination_account: string | null;
}

export interface FinanceChannelBreakdown {
  period: { from: string; to: string };
  channels: FinanceChannelRow[];
  totals: { revenue: number; payment: number; outstanding: number; ota_receivable: number };
  settlement_configs_count: number;
}

export interface FinanceBookingRow {
  id: string;
  unit_nomor: string;
  guest_nama: string;
  sumber: string;
  normalized_channel: NormalizedChannel;
  status: string;
  tgl_checkin: string;
  tgl_checkout: string | null;
  durasi_malam: number | null;
  revenue: number;
  payment_status: PaymentStatus;
  outstanding: number;
  /** "cloudbeds_balance" = angka asli dari Cloudbeds; "booking_status_estimate" = perkiraan dari status booking. */
  payment_status_source: "cloudbeds_balance" | "booking_status_estimate";
  cloudbeds_reservation_id: string | null;
  settlement_status: SettlementStatus | null;
  settlement_confidence: SettlementConfidence | null;
  expected_settlement_date: string | null;
}

export interface FinanceBookingList {
  items: FinanceBookingRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface FinanceBookingDetail {
  reservation: {
    id: string;
    guest_nama: string;
    guests: { nama: string; hp: string | null; email: string | null } | null;
    sumber: string;
    normalized_channel: NormalizedChannel;
    tgl_checkin: string;
    tgl_checkout: string | null;
    unit_nomor: string;
    units: { nomor: string; blok: string } | null;
    status: string;
    cloudbeds_reservation_id: string | null;
  };
  revenue: { room: number; extras: null; discount: null; tax: null; fee: null; refund: null; net: number; note: string };
  payment: {
    paid: boolean;
    outstanding: number;
    method: string;
    payment_date: string | null;
    source: "cloudbeds_balance" | "booking_status_estimate";
    cloudbeds_balance: number | null;
  };
  settlement: {
    collection_method: CollectionMethod;
    expected_settlement_date: string | null;
    settlement_confidence: SettlementConfidence | null;
    settlement_status: SettlementStatus | null;
    settlement_reference: string | null;
    destination_account: string | null;
  };
  bank: {
    amount_received: number | null;
    received_date: string | null;
    bank_reference: string | null;
    reconciliation_status: ReconciliationStatus | null;
    variance_amount: number | null;
  };
  audit_log: FinanceAuditLogRow[];
}

export type SettlementBasis = "CHECKIN" | "CHECKOUT";

export interface FinanceOtaSettlementConfig {
  id: string;
  sumber: string;
  collection_method: CollectionMethod;
  settlement_delay_days: number | null;
  /** Tanggal mana yang jadi acuan settlement_delay_days: CHECKIN (mis. Airbnb, dana dirilis ~24 jam setelah tamu checkin) atau CHECKOUT (mis. Booking.com/Agoda). */
  settlement_basis: SettlementBasis;
  destination_account_label: string | null;
  currency: string;
  effective_date: string | null;
  notes: string | null;
  configured_by: string | null;
  updated_at: string;
}

export interface FinanceAuditLogRow {
  id: string;
  entity_type: string;
  entity_id: string;
  user_id: string | null;
  user_nama: string | null;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export type WalkinKategori = "cafe" | "spa" | "lainnya";
export type WalkinStatus = "pending" | "lunas" | "batal";

export interface WalkinPayment {
  id: string;
  guest_nama: string;
  guest_hp: string | null;
  kategori: WalkinKategori;
  deskripsi: string;
  jumlah: number;
  status: WalkinStatus;
  created_at: string;
  paid_at: string | null;
}
