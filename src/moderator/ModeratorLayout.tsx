// Moderator console chrome: top nav between the views + the shared provider.
import { NavLink, Outlet } from "react-router-dom";
import { ModeratorProvider, useModerator } from "./context";
import { useT } from "../lib/i18n";
import { clearSessionPin } from "./session";

// `labelKey` is an i18n key; the route paths are kept stable (e.g. /runners) so
// existing bookmarks keep working even though the tab now reads "Registration".
const tabs = [
  { to: "/moderator", labelKey: "mod.tab.board", end: true },
  { to: "/moderator/dashboard", labelKey: "mod.tab.dashboard" },
  { to: "/moderator/runners", labelKey: "mod.tab.registration" },
  { to: "/moderator/gifts", labelKey: "mod.tab.gifts" },
  { to: "/moderator/config", labelKey: "mod.tab.config" },
  { to: "/moderator/export", labelKey: "mod.tab.export" },
];

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
            <nav className="flex gap-1">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm font-medium ${
                      isActive
                        ? "bg-brand text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`
                  }
                >
                  {t(tab.labelKey)}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <StatusBar />
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
