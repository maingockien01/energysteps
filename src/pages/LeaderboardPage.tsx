// Public leaderboard (P1-5). Individuals (de-identified to a friendly handle by
// the server) ranked by distance, plus department totals. Like the status page
// it POLLS while visible (not Realtime) to stay under the Free-tier websocket
// cap — see StatusPage.tsx for the rationale.
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../lib/api";
import { DOMAINS } from "../lib/domains";
import { formatDuration } from "../lib/format";
import { useT } from "../lib/i18n";
import { card } from "../lib/ui";
import { useVisibilityPolling } from "../lib/usePolling";
import type { DepartmentTotal, LeaderboardEntry, LeaderboardResult } from "../lib/types";

function medal(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`;
}

export default function LeaderboardPage() {
  const t = useT();
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBoard = useCallback(async () => {
    try {
      setData(await getLeaderboard());
    } catch {
      // leave previous data; transient errors self-heal on the next poll
    } finally {
      setLoading(false);
    }
  }, []);

  useVisibilityPolling(fetchBoard, { immediate: true });

  const individuals = data?.individuals ?? [];

  // Department standings are the headline of the board. Show EVERY department —
  // the configured domains plus any others people signed up under — defaulting
  // to 0 when no one in that department has finished yet. Ranked by total
  // distance, then alphabetically so the zero-rows stay in a stable order.
  const deptByName = new Map((data?.departments ?? []).map((d) => [d.department, d]));
  const departments: DepartmentTotal[] = [
    ...new Set([...DOMAINS, ...deptByName.keys()]),
  ]
    .map(
      (name) =>
        deptByName.get(name) ?? { department: name, total_distance: 0, finishers: 0 },
    )
    .sort(
      (a, b) =>
        b.total_distance - a.total_distance || a.department.localeCompare(b.department),
    );

  // Categorize individuals by chosen run duration (ascending) — distance is only
  // comparable within the same run length. Each tier is already distance-sorted
  // by the RPC.
  const tiers = new Map<number, LeaderboardEntry[]>();
  for (const e of individuals) {
    const list = tiers.get(e.duration) ?? [];
    list.push(e);
    tiers.set(e.duration, list);
  }
  const tierDurations = [...tiers.keys()].sort((a, b) => a - b);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand">{t("lb.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("lb.subtitle")}</p>
        </header>

        {loading && !data ? (
          <div className={`${card} text-slate-400`}>{t("common.loading")}</div>
        ) : (
          <div className="space-y-6">
            {/* Departments — the headline ranking. Every department shows, 0 if
                no one has finished yet. */}
            <section className={`${card} ring-2 ring-brand/30`}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-bold text-brand">{t("lb.departments")}</h2>
                <span className="text-xs text-slate-400">{t("lb.deptHint")}</span>
              </div>
              <ol className="mt-4 divide-y divide-slate-100">
                {departments.map((d, i) => (
                  <li
                    key={d.department}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-center text-base font-bold text-slate-500">
                        {medal(i + 1)}
                      </span>
                      <div>
                        <div className="text-base font-semibold text-slate-900">
                          {d.department}
                        </div>
                        <div className="text-xs text-slate-500">
                          {t("lb.finishers", { n: d.finishers })}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-base font-bold tabular-nums text-slate-900">
                      {t("lb.meters", { n: d.total_distance })}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            {/* Individuals, categorized by run duration */}
            <h2 className="px-1 pt-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t("lb.individuals")}
            </h2>
            {tierDurations.length === 0 ? (
              <div className={`${card} text-slate-600`}>{t("lb.empty")}</div>
            ) : (
              tierDurations.map((dur) => (
                <section key={dur} className={card}>
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-semibold text-brand">
                      {t("lb.category", { d: formatDuration(dur) })}
                    </h3>
                    <span className="text-xs text-slate-400">
                      {t("lb.finishers", { n: tiers.get(dur)!.length })}
                    </span>
                  </div>
                  <ol className="mt-3 divide-y divide-slate-100">
                    {tiers.get(dur)!.map((e, i) => (
                      <li
                        key={`${dur}-${e.display_name}-${i}`}
                        className="flex items-center justify-between py-2.5"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-8 text-center text-sm font-semibold text-slate-500">
                            {medal(i + 1)}
                          </span>
                          <div>
                            <div className="text-sm font-medium text-slate-900">
                              {e.display_name}
                            </div>
                            <div className="text-xs text-slate-500">{e.department}</div>
                          </div>
                        </div>
                        <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                          {t("lb.meters", { n: e.distance })}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ))
            )}
          </div>
        )}

        <div className="mt-8 text-center">
          <Link to="/" className="text-sm text-brand underline hover:text-brand-dark">
            {t("status.back")}
          </Link>
        </div>
      </div>
    </div>
  );
}
