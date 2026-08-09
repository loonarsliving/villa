export type Role = "owner" | "receptionist" | "admin";

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
}

export interface Booking {
  id: string;
  unit_id: string;
  unit_nomor: string;
  guest_nama: string;
  guest_hp?: string | null;
  tipe: "harian" | "bulanan";
  status: "terjadwal" | "checkin" | "checkout" | "batal";
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
  created_at: string;
  units?: { nomor: string; blok: string };
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
