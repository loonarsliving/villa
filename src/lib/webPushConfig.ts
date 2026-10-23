/**
 * Web Push aplikasi villa (owner 2026-10-23: notifikasi chat tamu ke
 * manager/Rebecca, "seperti chat refund di Mkhsistem").
 *
 * Kunci PUBLIK VAPID memang publik (dikirim ke setiap browser saat
 * berlangganan). Pasangan kunci privatnya HANYA ada di env Vercel
 * `VILLA_VAPID_PRIVATE_KEY` -- jangan pernah ditulis ke repo.
 */
export const VILLA_VAPID_PUBLIC_KEY = "BKFRuQ-LnAWGXB3UTrnCHCE_60m3wWmI8jL3shcpxGQnjNjbtV98mObRAg2aJRkF5DfMNNfUYm1EsGBJcY_v4iU";

/**
 * Peran yang menerima notifikasi chat tamu. Owner memilih "Rebecca saja"
 * (2026-10-23) -- resepsionis tidak, admin juga tidak (admin bisa membuka
 * /manager tapi tidak ikut berlangganan).
 */
export const PERAN_NOTIF_CHAT_TAMU = "manager";
