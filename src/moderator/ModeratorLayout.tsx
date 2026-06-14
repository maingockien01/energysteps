// Moderator console chrome: top nav between the views + the shared provider.
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ModeratorProvider, useModerator } from "./context";
import { LangToggle, useT } from "../lib/i18n";
import { clearSessionPin } from "./session";

// `labelKey` is an i18n key; route paths are kept stable (e.g. /runners) so
// existing bookmarks keep working even though the tab now reads "Registration".
//
// The nav is split so it doesn't crowd: the during-event working set stays
// inline, while setup / end-of-event screens fold into a "More" menu. Guide and
// Lock live on the right.
const primaryTabs = [
  { to: "/moderator", labelKey: "mod.tab.board", end: true },
  { to: "/moderator/dashboard", labelKey: "mod.tab.dashboard" },
  { to: "/moderator/runners", labelKey: "mod.tab.registration" },
  { to: "/moderator/gifts", labelKey: "mod.tab.gifts" },
];

const moreTabs = [
  { to: "/moderator/config", labelKey: "mod.tab.config" },
  { to: "/moderator/export", labelKey: "mod.tab.export" },
];

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
  }`;

function StatusBar() {
  const t = useT();
  const { loading, error, reload } = useModerator();
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      {error ? (
        <span className="font-medium text-red-600">{error}</span>
      ) : (
        <span>{loading ? t("common.loading") : t("mod.live")}</span>
      )}
      <button onClick={() => void reload()} className="underline hover:text-brand">
        {t("common.refresh")}
      </button>
    </div>
  );
}

// Overflow menu for the less-frequent (setup / export) screens.
function MoreMenu() {
  const t = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const containsActive = moreTabs.some((tab) => location.pathname === tab.to);

  // Close on outside click or Escape.
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

  // Close after navigating to one of the items.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium ${
          containsActive || open
            ? "bg-brand text-white"
            : "text-slate-600 hover:bg-slate-100"
        }`}
      >
        {t("mod.tab.more")}
        <span aria-hidden className="text-[0.625rem]">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200"
        >
          {moreTabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              role="menuitem"
              className={({ isActive }) =>
                `block px-3 py-2 text-sm ${
                  isActive
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-slate-700 hover:bg-slate-100"
                }`
              }
            >
              {t(tab.labelKey)}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ModeratorLayout({ pin }: { pin: string }) {
  return (
    <ModeratorProvider pin={pin}>
      <ModeratorChrome />
    </ModeratorProvider>
  );
}

function ModeratorChrome() {
  const t = useT();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="font-bold text-brand">{t("mod.title")}</span>
            <nav className="flex items-center gap-1">
              {primaryTabs.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.end} className={tabClass}>
                  {t(tab.labelKey)}
                </NavLink>
              ))}
              <MoreMenu />
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <StatusBar />
            <LangToggle />
            <NavLink
              to="/moderator/guide"
              className={({ isActive }) =>
                `rounded-full px-3 py-1 text-sm font-medium ring-1 transition ${
                  isActive
                    ? "bg-brand text-white ring-brand"
                    : "text-brand ring-brand/40 hover:bg-brand/10"
                }`
              }
              title={t("mod.tab.guide")}
            >
              ❓ {t("mod.tab.guide")}
            </NavLink>
            <button
              onClick={() => {
                clearSessionPin();
                window.location.reload();
              }}
              className="text-xs text-slate-500 underline hover:text-brand"
            >
              {t("mod.lock")}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
