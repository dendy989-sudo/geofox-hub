// Notifications are requested by the open Finance page. This worker does not
// cache private pages, fetch finance records, or subscribe to background push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const finance = windows.find(client => new URL(client.url).pathname === "/finance");
    if (finance) { await finance.navigate("/finance#reminders"); return finance.focus(); }
    return self.clients.openWindow("/finance#reminders");
  })());
});
