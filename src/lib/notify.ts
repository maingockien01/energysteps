// In-tab "get ready" notification cue (layer 2). See docs/PRODUCT_IMPROVEMENTS.md
// (P0-1) for the product rationale and the full layering plan.
//
// HONEST SCOPE / LIMITATIONS — read before extending:
//  - This fires the system notification ONLY while the page's JS is running:
//    i.e. while the status page is foregrounded (it polls every 30s only while
//    visible) or at the instant the user brings it back to the foreground (the
//    poll re-fetches immediately on focus). It CANNOT wake a pocketed phone
//    whose tab is suspended — that needs Web Push (a push subscription + a
//    server-side sender), which is deliberately deferred (layer 3).
//  - Android Chrome forbids `new Notification()` and requires a registered
//    service worker's showNotification(); we register a minimal SW (public/sw.js)
//    and prefer reg.showNotification(), falling back to the constructor on
//    desktop browsers that allow it.
//  - iOS Safari only exposes Notifications inside an installed PWA; in a normal
//    Safari tab the API is absent and every call here safely no-ops.

let regPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export type AlertPermission = NotificationPermission | "unsupported";

export function notificationPermission(): AlertPermission {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

// Register the minimal notification service worker once (best-effort). Called at
// app boot; required so showNotification() works on Android Chrome.
export function initNotifications(): void {
  if (regPromise) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    regPromise = Promise.resolve(null);
    return;
  }
  regPromise = navigator.serviceWorker.register("/sw.js").catch(() => null);
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!regPromise) initNotifications();
  try {
    return (await regPromise) ?? null;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<AlertPermission> {
  if (!notificationsSupported()) return "unsupported";
  initNotifications();
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

// Show a notification now (best-effort). No-ops unless permission is granted.
export async function showNotification(title: string, body: string): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  const options: NotificationOptions = { body, tag: "energysteps-status" };
  // Prefer the service-worker path (required on Android Chrome).
  const reg = await getRegistration();
  if (reg) {
    try {
      await reg.showNotification(title, options);
      return;
    } catch {
      // fall through to the constructor on browsers that allow it
    }
  }
  try {
    new Notification(title, options);
  } catch {
    // no-op: browser disallows direct construction and we have no SW
  }
}
