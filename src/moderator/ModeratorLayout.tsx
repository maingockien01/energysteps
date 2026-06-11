// Moderator console chrome: top nav between the views + the shared provider.
import { NavLink, Outlet } from "react-router-dom";
import { ModeratorProvider, useModerator } from "./context";
import { clearSessionPin } from "./session";

const tabs = [
  { to: "/moderator", label: "Board", end: true },
  { to: "/moderator/runners", label: "Runners" },
  { to: "/moderator/gifts", label: "Gifts" },
  { to: "/moderator/config", label: "Config" },
  { to: "/moderator/export", label: "Export" },
];

function StatusBar() {
  const { loading, error, reload } = useModerator();
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      {error ? (
        <span className="font-medium text-red-600">{error}</span>
      ) : (
        <span>{loading ? "Loading…" : "Live"}</span>
      )}
      <button onClick={() => void reload()} className="underline hover:text-slate-900">
        Refresh
      </button>
    </div>
  );
}

export default function ModeratorLayout({ pin }: { pin: string }) {
  return (
    <ModeratorProvider pin={pin}>
      <div className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-4">
              <span className="font-bold">EnergySteps · Moderator</span>
              <nav className="flex gap-1">
                {tabs.map((t) => (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    end={t.end}
                    className={({ isActive }) =>
                      `rounded-md px-3 py-1.5 text-sm font-medium ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`
                    }
                  >
                    {t.label}
                  </NavLink>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <StatusBar />
              <button
                onClick={() => {
                  clearSessionPin();
                  window.location.reload();
                }}
                className="text-xs text-slate-500 underline hover:text-slate-900"
              >
                Lock
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          <Outlet />
        </main>
      </div>
    </ModeratorProvider>
  );
}
