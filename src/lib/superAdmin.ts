export const SUPER_ADMIN_EMAIL = "loonarsliving@gmail.com";

const VERIFIED_KEY = "villa_pg_verified_email";

export function isSuperAdminEmail(email: string): boolean {
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
}

export function getVerifiedFlag(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(VERIFIED_KEY) === "1";
}

export function setVerifiedFlag() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(VERIFIED_KEY, "1");
}

export function clearVerifiedFlag() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(VERIFIED_KEY);
}
