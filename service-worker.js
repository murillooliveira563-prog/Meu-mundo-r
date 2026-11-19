"use strict";

const CACHE_NAME = "meu-mundo-r-v11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./supabase-config.js",
  "./vendor/supabase.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name.startsWith("meu-mundo-r-") && name !== CACHE_NAME).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
      }
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});

self.addEventListener("push", event => {
  const raw = event.data ? event.data.text() : "";
  let payload = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") payload = parsed;
    } catch {
      payload = { body: raw };
    }
  }
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : "Meu Mundo R";
  const body = typeof payload.body === "string" ? payload.body : "Você recebeu um novo aviso.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: new URL("./icons/icon-192.png", self.registration.scope).href,
    badge: new URL("./icons/icon-192.png", self.registration.scope).href,
    data: { url: typeof payload.url === "string" ? payload.url : "./" }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    const target = new URL(typeof event.notification.data?.url === "string" ? event.notification.data.url : "./", scope);
    if (target.origin !== scope.origin || !target.pathname.startsWith(scope.pathname)) {
      target.href = scope.href;
    }
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appWindow = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    });
    if (appWindow) {
      const targetWindow = appWindow.url === target.href ? appWindow : await appWindow.navigate(target.href);
      return (targetWindow || appWindow).focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
