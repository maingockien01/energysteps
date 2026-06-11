// Small formatting helpers shared across pages.
//
// All wall-clock times are pinned to VIETNAM time (Asia/Ho_Chi_Minh, UTC+7, no
// DST) so every participant and moderator sees the same event time regardless
// of their device's timezone. 24-hour format avoids AM/PM confusion.

export const EVENT_TZ = "Asia/Ho_Chi_Minh";
const VN_OFFSET_MINUTES = 7 * 60; // Vietnam has no daylight saving — fixed +07:00

// "HH:MM" in Vietnam time.
export function formatClock(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: EVENT_TZ,
  });
}

// "HH:MM" from an ISO string.
export function formatClockIso(iso: string | null): string {
  if (!iso) return "—";
  return formatClock(Date.parse(iso));
}

// Full date + time in Vietnam, e.g. "Thu, 11 Jun 2026, 14:30:05".
export function formatDateTime(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: EVENT_TZ,
  });
}

// Numeric date+time in Vietnam, "DD/MM/YYYY HH:mm:ss" (registration timestamp).
export function formatDateTimeNumeric(ms: number | null): string {
  if (ms === null) return "—";
  // en-GB with a 2-digit setup yields DD/MM/YYYY, HH:mm:ss; drop the comma.
  return new Date(ms)
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: EVENT_TZ,
    })
    .replace(",", "");
}

// Same as above but accepts an ISO string.
export function formatDateTimeNumericIso(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "—" : formatDateTimeNumeric(ms);
}

// A run duration in seconds -> "10 phút" / "1 phút 30 giây" (Vietnamese-only UI).
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0 && s > 0) return `${m} phút ${s} giây`;
  if (m > 0) return `${m} phút`;
  return `${s} giây`;
}

// Signed seconds -> "M:SS" countdown clock. Negative clamps to 0:00.
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ISO datetime -> value for <input type="datetime-local">, expressed as
// VIETNAM wall-clock time (so the moderator types/reads Vietnam time no matter
// what timezone their device is in).
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + VN_OFFSET_MINUTES * 60000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

// <input type="datetime-local"> value (interpreted as VIETNAM time) -> ISO.
export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const wall = value.slice(0, 16); // YYYY-MM-DDTHH:mm
  const d = new Date(`${wall}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
