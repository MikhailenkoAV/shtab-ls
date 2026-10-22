const scopeUrl = new URL("./", self.location.href);
const prefix = `shtab-ls-shell:${scopeUrl.pathname}:`;
let cacheName;
async function activeCache() {
  if (cacheName) return cacheName;
  const names = await caches.keys();
  return names.find((name) => name.startsWith(prefix));
}
self.addEventListener("install", (event) => event.waitUntil((async () => {
  const response = await fetch(new URL("offline-assets.json", scopeUrl), { cache: "no-store" });
  if (!response.ok) throw new Error("Offline manifest unavailable");
  const manifest = await response.json();
  cacheName = prefix + manifest.version;
  const cache = await caches.open(cacheName);
  await cache.addAll(manifest.assets.map((asset) => new Request(new URL(asset, scopeUrl), { cache: "reload" })));
  await self.skipWaiting();
})()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const current = await activeCache();
  if (current) await Promise.all((await caches.keys()).filter((name) => name !== current && (name.startsWith(prefix) || name.startsWith("shtab-ls-"))).map((name) => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener("fetch", (event) => {
  const request = event.request, url = new URL(request.url);
  // Never cache API responses, credentials, imported files, or private workspace data.
  if (request.method !== "GET" || url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;
  const navigation = request.mode === "navigate";
  const staticAsset = url.pathname.startsWith(new URL("_next/static/", scopeUrl).pathname) || /\.(?:png|ico|webmanifest|svg)$/.test(url.pathname);
  if (!navigation && !staticAsset) return;
  event.respondWith((async () => {
    const name = await activeCache();
    if (!name) return fetch(request);
    const cache = await caches.open(name);
    if (navigation) {
      try { return await fetch(request); }
      catch { return await cache.match(new URL("index.html", scopeUrl)) || Response.error(); }
    }
    return await cache.match(request) || fetch(request);
  })());
});
