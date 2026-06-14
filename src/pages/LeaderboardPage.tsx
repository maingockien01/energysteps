// Public leaderboard (P1-5). Individuals (de-identified to a friendly handle by
// the server) ranked by distance, plus department totals. Like the status page
// it POLLS while visible (not Realtime) to stay under the Free-tier websocket
// cap — see StatusPage.tsx for the rationale.
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../lib/api";
import { DOMAINS } from "../lib/domains";
import { formatClock } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { card } from "../lib/ui";
import { useVisibilityPolling } from "../lib/usePolling";
import type { DepartmentTotal, LeaderboardEntry, LeaderboardResult } from "../lib/types";

function medal(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`;
}

// Rough walking steps per km — turns the collective km total into the big,
// on-brand "steps" number. Approximate by design (labelled with ≈).
const STEPS_PER_KM = 1300;

// Approx road distance (km) from Hà Nội — turns the collective total into a
// relatable "how far we've walked together" journey down the country. Place
// names are proper nouns (shown as-is in both languages).
const JOURNEY: { km: number; place: string }[] = [
  { km: 90, place: "Ninh Bình" },
  { km: 150, place: "Thanh Hóa" },
  { km: 290, place: "Vinh (Nghệ An)" },
  { km: 350, place: "Hà Tĩnh" },
  { km: 490, place: "Đồng Hới (Quảng Bình)" },
  { km: 660, place: "Huế" },
  { km: 760, place: "Đà Nẵng" },
  { km: 880, place: "Quảng Ngãi" },
  { km: 1050, place: "Quy Nhơn (Bình Định)" },
  { km: 1280, place: "Nha Trang (Khánh Hòa)" },
  { km: 1500, place: "Phan Thiết (Bình Thuận)" },
  { km: 1710, place: "TP. Hồ Chí Minh" },
];

export default function LeaderboardPage() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // Which collective measurement the hero shows (one at a time; tap/select to
  // switch). Participation is shown in every variant, separately.
  const [metric, setMetric] = useState<"distance" | "steps" | "journey">("distance");

  const fetchBoard = useCallback(async () => {
    try {
      setData(await getLeaderboard());
      setLastUpdated(Date.now());
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

  // Company-wide total — a collective hero that celebrates everyone (on-theme:
  // "walk to recharge"), and gives 0-km departments a stake in the headline.
  const totalDistance = departments.reduce((a, d) => a + d.total_distance, 0);

  // Top contributors per department: recognition is kept (handles), but
  // organized under each department so individual effort reads as team
  // contribution. Ranked by raw distance — which IS each person's contribution
  // to the department total (durations mix here on purpose; the total mixes them
  // too). Replaces the old duration-tier individual ranking (a deliberate
  // team-first trade-off: short-duration runners no longer get a separate
  // podium).
  const TOP_CONTRIBUTORS = 5;
  const byDept = new Map<string, LeaderboardEntry[]>();
  for (const e of individuals) {
    const list = byDept.get(e.department) ?? [];
    list.push(e);
    byDept.set(e.department, list);
  }
  // Top contributors per department, looked up when a department row is expanded.
  const topByDept = new Map<string, LeaderboardEntry[]>(
    departments.map((d) => [
      d.department,
      (byDept.get(d.department) ?? [])
        .slice()
        .sort((a, b) => b.distance - a.distance)
        .slice(0, TOP_CONTRIBUTORS),
    ]),
  );

  // Department progress bars — each bar relative to the leading department.
  const maxDeptDistance = departments.reduce((m, d) => Math.max(m, d.total_distance), 0);

  // Whole-company effort. Steps make the total feel big and on-brand; the
  // journey turns abstract km into a relatable Hà Nội → province distance;
  // participation breadth (finishers + departments on the board) shows reach,
  // not just distance.
  const steps = Math.round(totalDistance * STEPS_PER_KM);
  const stepsText = steps.toLocaleString(lang === "vi" ? "vi-VN" : "en-US");
  const journey = [...JOURNEY].reverse().find((j) => totalDistance >= j.km) ?? null;
  const totalFinishers = departments.reduce((a, d) => a + d.finishers, 0);
  const deptsOnBoard = departments.filter((d) => d.finishers > 0).length;

  // Metric switcher: one collective measurement at a time. Journey only offered
  // once the total clears the first milestone. Fall back to distance if the
  // selected metric isn't currently available.
  const availableMetrics: ("distance" | "steps" | "journey")[] = journey
    ? ["distance", "steps", "journey"]
    : ["distance", "steps"];
  const activeMetric = availableMetrics.includes(metric) ? metric : "distance";
  const bigValue =
    activeMetric === "steps"
      ? t("lb.steps", { n: stepsText })
      : activeMetric === "journey" && journey
        ? t("lb.journey", { place: journey.place })
        : t("lb.meters", { n: totalDistance });

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand">{t("lb.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("lb.subtitle")}</p>
          {lastUpdated !== null && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              {t("status.updated", { time: formatClock(lastUpdated) })}
            </div>
          )}
        </header>

        {loading && !data ? (
          <div className={`${card} text-slate-400`}>{t("common.loading")}</div>
        ) : (
          <div className="space-y-6">
            {/* Collective hero — one measurement at a time (tap the value to
                cycle, or pick from the chips); participation is always shown. */}
            {totalDistance > 0 && (
              <section className="rounded-2xl bg-brand p-5 text-center text-white shadow-sm">
                <div className="mb-3 flex flex-wrap justify-center gap-2">
                  {availableMetrics.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMetric(m)}
                      aria-pressed={activeMetric === m}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                        activeMetric === m
                          ? "bg-white text-brand"
                          : "bg-white/15 text-white hover:bg-white/25"
                      }`}
                    >
                      {t(`lb.metric.${m}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const i = availableMetrics.indexOf(activeMetric);
                    setMetric(availableMetrics[(i + 1) % availableMetrics.length]);
                  }}
                  className="block w-full"
                  aria-label={t("lb.metricNext")}
                >
                  <div className="text-3xl font-extrabold tabular-nums">{bigValue}</div>
                  <div className="mt-1 text-sm font-medium text-white/90">
                    {t("lb.collective")}
                  </div>
                </button>
                <div className="mt-3 border-t border-white/20 pt-3 text-sm text-white/90">
                  {t("lb.participation", {
                    n: totalFinishers,
                    d: deptsOnBoard,
                    total: departments.length,
                  })}
                </div>
              </section>
            )}
            {/* The one headline board. Every department shows (0 km if none
                finished yet); tap a department to reveal its top contributors. */}
            <section className={`${card} ring-2 ring-brand/30`}>
              <h2 className="text-xl font-bold text-brand">{t("lb.departments")}</h2>
              {totalFinishers > 0 && (
                <p className="mt-1 text-xs text-slate-400">{t("lb.tapHint")}</p>
              )}
              <ol className="mt-4 divide-y divide-slate-100">
                {departments.map((d, i) => {
                  const top = topByDept.get(d.department) ?? [];
                  const row = (
                    <>
                      <div className="flex items-center justify-between gap-3">
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
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-base font-bold tabular-nums text-slate-900">
                            {t("lb.meters", { n: d.total_distance })}
                          </span>
                          {top.length > 0 && (
                            <span
                              aria-hidden
                              className="text-slate-400 transition group-open:rotate-180"
                            >
                              ▾
                            </span>
                          )}
                        </div>
                      </div>
                      {maxDeptDistance > 0 && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{ width: `${(d.total_distance / maxDeptDistance) * 100}%` }}
                          />
                        </div>
                      )}
                    </>
                  );
                  return (
                    <li key={d.department}>
                      {top.length > 0 ? (
                        <details className="group">
                          <summary className="cursor-pointer list-none py-3 [&::-webkit-details-marker]:hidden">
                            {row}
                          </summary>
                          <ol className="space-y-1 pb-3 pl-11">
                            {top.map((e, j) => (
                              <li
                                key={`${d.department}-${e.display_name}-${j}`}
                                className="flex items-center justify-between py-1.5"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="w-6 text-center text-xs font-semibold text-slate-400">
                                    {medal(j + 1)}
                                  </span>
                                  <span className="text-sm font-medium text-slate-900">
                                    {e.display_name}
                                  </span>
                                </div>
                                <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                                  {t("lb.meters", { n: e.distance })}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </details>
                      ) : (
                        <div className="py-3">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
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
