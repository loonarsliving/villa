/**
 * Halaman Chat untuk tiap peran -- dipakai alamat pendek /chat
 * (src/app/chat/page.tsx). null = peran tanpa menu Chat.
 */
export function tujuanChat(role: string | undefined): string | null {
  if (role === "manager") return "/manager/chat";
  if (role === "receptionist" || role === "admin") return "/front-desk/chat";
  return null;
}
