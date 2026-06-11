// Minimal service worker for EnergySteps in-tab notifications (layer 2).
//
// It holds NO push subscription and does NOT run in the background to poll the
// queue. Its only jobs are:
//   1. To exist, so the page can call registration.showNotification() — Android
//      Chrome forbids the `new Notification()` constructor and requires this.
//   2. To focus (or open) the status tab when a notification is tapped.
//
// Background "buzz a pocketed phone" delivery would require a Web Push
// subscription + a server-side sender; that is deliberately out of scope here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/status");
        return undefined;
      }),
  );
});
