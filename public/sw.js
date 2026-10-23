// Loonars Private Living -- service worker KHUSUS Web Push (owner
// 2026-10-23: notifikasi chat tamu ke manager). Tidak ada cache / offline
// di sini. Tugasnya hanya: menampilkan notifikasi saat aplikasi tertutup,
// memasang angka belum-dibaca di ikon (iPhone layar utama iOS 16.4+ /
// PWA terpasang), dan membuka chat yang tepat saat notifikasi diketuk.
// Isi notifikasi dikirim oleh src/lib/webPush.ts.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Loonars Private Living", body: event.data.text() };
  }

  const title = payload.title || "Loonars Private Living";
  const link = payload.link || "/";

  const badgeUpdate =
    typeof payload.badge === "number" && self.navigator && "setAppBadge" in self.navigator
      ? (payload.badge > 0 ? self.navigator.setAppBadge(payload.badge) : self.navigator.clearAppBadge()).catch(() => {})
      : Promise.resolve();

  event.waitUntil(
    Promise.all([
      badgeUpdate,
      self.registration.showNotification(title, {
        body: payload.body || "",
        icon: "/icon/192",
        badge: "/icon/192",
        tag: payload.tag || undefined,
        renotify: Boolean(payload.tag),
        timestamp: payload.timestamp || Date.now(),
        data: { link },
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";

  event.waitUntil(
    (async () => {
      const targetUrl = new URL(link, self.registration.scope).href;
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(targetUrl).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
