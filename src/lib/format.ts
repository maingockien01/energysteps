// Small formatting helpers shared across pages.

// "HH:MM" in the viewer's local time.
export function formatClock(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// "HH:MM" from an ISO string.
export function formatClockIso(iso: string | null): string {
  if (!iso) return "—";
  return formatClock(Date.parse(iso));
}

// A run duration in seconds -> "10 min" / "1 min 30 s".
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) return `${m} min ${s} s`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

// Signed seconds -> "M:SS" countdown clock. Negative clamps to 0:00.
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ISO datetime -> value for <input type="datetime-local"> in LOCAL time.
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// <input type="datetime-local"> value (local) -> ISO string.
export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
