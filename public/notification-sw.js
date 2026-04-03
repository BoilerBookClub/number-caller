self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
      const matchingClient = clients.find((client) => {
        try {
          return new URL(client.url).pathname === new URL(notificationUrl, self.location.origin).pathname;
        } catch {
          return false;
        }
      });

      const existingClient = matchingClient || clients[0];

      if (existingClient) {
        return existingClient.focus();
      }

      return self.clients.openWindow(notificationUrl);
    }),
  );
});