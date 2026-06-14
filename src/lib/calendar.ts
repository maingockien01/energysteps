// Add-to-calendar helpers. Times are absolute instants (epoch ms); we emit them
// as UTC so the user's calendar shows the correct local moment regardless of
// their device timezone. Two outputs so we cover both contexts: a Google
// Calendar link (Chrome / Android) and a downloadable .ics (Apple / Outlook /
// desktop), since participants use both phones and laptops.

export interface CalEvent {
  title: string;
  details?: string;
  location?: string;
  startMs: number;
  endMs: number;
}

// epoch ms -> "YYYYMMDDTHHMMSSZ"
function toUtcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function googleCalendarUrl(e: CalEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${toUtcStamp(e.startMs)}/${toUtcStamp(e.endMs)}`,
  });
  if (e.details) params.set("details", e.details);
  if (e.location) params.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Microsoft 365 (work/school) "add event" deep link — matches @mblife.vn
// corporate accounts. startdt/enddt are ISO instants; Outlook renders them in
// the user's own timezone. (Personal Outlook.com accounts can use the .ics.)
export function outlookCalendarUrl(e: CalEvent): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: e.title,
    startdt: new Date(e.startMs).toISOString(),
    enddt: new Date(e.endMs).toISOString(),
  });
  if (e.details) params.set("body", e.details);
  if (e.location) params.set("location", e.location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// Escape per RFC 5545 text rules.
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function icsContent(e: CalEvent): string {
  // Stable UID from the start instant — fine for a one-off reminder, and avoids
  // needing a random/now source.
  const uid = `energysteps-${e.startMs}@mblife.vn`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EnergySteps//VI//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(e.startMs)}`,
    `DTSTART:${toUtcStamp(e.startMs)}`,
    `DTEND:${toUtcStamp(e.endMs)}`,
    `SUMMARY:${icsEscape(e.title)}`,
  ];
  if (e.details) lines.push(`DESCRIPTION:${icsEscape(e.details)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  lines.push(
    // A display reminder 10 minutes before the slot.
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:EnergySteps",
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.join("\r\n");
}

export function downloadIcs(e: CalEvent, filename = "energysteps.ics"): void {
  const blob = new Blob([icsContent(e)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
