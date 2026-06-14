// Split "Add to calendar" button: Outlook is the default action (matches the
// @mblife.vn M365 tenant); a caret reveals the other options (Google, .ics).
// Used on the sign-up confirmation and the status page.
import { useEffect, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import {
  downloadIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalEvent,
} from "../lib/calendar";

export default function AddToCalendar({ event }: { event: CalEvent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape (same pattern as the moderator More menu).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-brand/10 hover:text-brand";

  return (
    <div className="relative inline-flex" ref={ref}>
      {/* Default action: Outlook */}
      <a
        href={outlookCalendarUrl(event)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-l-xl bg-white px-3 py-2 text-sm font-semibold text-brand ring-1 ring-brand/40 hover:bg-brand/10"
      >
        {t("cal.outlookBtn")}
      </a>
      {/* Other options */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("cal.moreOptions")}
        className="inline-flex items-center rounded-r-xl bg-white px-2 py-2 text-sm font-semibold text-brand ring-1 ring-inset ring-brand/40 hover:bg-brand/10"
      >
        <span aria-hidden className="text-[0.625rem]">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 min-w-[12rem] overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200"
        >
          <a
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            {t("cal.googleBtn")}
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              downloadIcs(event);
              setOpen(false);
            }}
            className={itemClass}
          >
            {t("cal.icsBtn")}
          </button>
        </div>
      )}
    </div>
  );
}
