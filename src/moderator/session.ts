// Moderator PIN session. The validated PIN is stored in sessionStorage and is
// also passed to every moderator RPC (the DB re-validates it — see ADR-002).
//
// P1-2: the PIN is now validated against the DB (verify_pin RPC) — there is no
// longer a frontend VITE_MODERATOR_PINS allow-list to keep in sync. The
// moderator_pins table is the single source of truth.
const KEY = "energysteps.moderator.pin";

export function getSessionPin(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setSessionPin(pin: string): void {
  sessionStorage.setItem(KEY, pin.trim());
}

export function clearSessionPin(): void {
  sessionStorage.removeItem(KEY);
}
