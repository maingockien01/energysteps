// Moderator PIN session. The validated PIN is stored in sessionStorage and is
// also passed to every moderator RPC (the DB re-validates it — see ADR-002).
const KEY = "energysteps.moderator.pin";

// Parse the comma-separated allow-list from the env var.
export function validPins(): string[] {
  const raw = (import.meta.env.VITE_MODERATOR_PINS as string | undefined) ?? "";
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

// True if the entered PIN matches ANY configured PIN.
export function isValidPin(pin: string): boolean {
  return validPins().includes(pin.trim());
}

export function getSessionPin(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setSessionPin(pin: string): void {
  sessionStorage.setItem(KEY, pin.trim());
}

export function clearSessionPin(): void {
  sessionStorage.removeItem(KEY);
}
