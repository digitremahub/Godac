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

// Ressources statiques de l'application (JS, CSS, polices de /_next/static) :
// le nom de chaque fichier change à chaque version (empreinte dans le nom),
// donc le garder en cache est sans risque et accélère /livreur sur un réseau
// mobile faible. Les pages, l'API et tout le reste passent directement par le
// réseau : pas de mode hors ligne complet (hors périmètre).
const CACHE_STATIQUE = "godac-statique-v1";

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n.startsWith("godac-statique-") && n !== CACHE_STATIQUE).map((n) => caches.delete(n)))),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) return;
  event.respondWith(
    caches.open(CACHE_STATIQUE).then(async (cache) => {
      const enCache = await cache.match(req);
      if (enCache) return enCache;
      const reponse = await fetch(req);
      if (reponse.ok) cache.put(req, reponse.clone()).catch(() => undefined);
      return reponse;
    }),
  );
});
