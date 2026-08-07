self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith("shtab-ls-")).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()),
));
