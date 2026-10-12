// GODAC V2 — web push service worker (Module 8). Scope is the whole
// origin (registered at "/", see lib/push/client.ts) so a push shows
// regardless of which page the tab was last on.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "GODAC", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "GODAC";
  const options = {
    body: data.body || "",
    icon: "/brand/app-icon-192.png",
    badge: "/brand/app-icon-192.png",
    data: { url: data.url || "/dashboard" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focuses an already-open GODAC tab rather than always opening a new
// one — a driver likely already has the app open in the background.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
