// Organizer dashboard (P2-2). Live event metrics derived from the shared
// moderator state — participation, completion, no-show rate, machine
// utilization, distance, gift burn-down — plus a recent moderator-activity feed
// (P1-4 audit log). No new participant data; all figures come from `state`.
import { useEffect, useState } from "react";
import { useModerator } from "./context";
import { moderatorGetActionLog } from "../lib/api";
import { formatClockIso } from "../lib/format";
import { useT } from "../lib/i18n";
import { card } from "../lib/ui";
import type { ActionLogEntry } from "../lib/types";

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

// Full class strings (Tailwind can't see dynamically-interpolated class names).
const TONE: Record<string, string> = {
  slate: "text-slate-700",
  emerald: "text-emerald-700",
  red: "text-red-700",
  amber: "text-amber-700",
};

function Stat({ value, label, tone = "slate" }: { value: string; label: string; tone?: string }) {
  return (
    <div className={card}>
      <div className={`text-3xl font-bold tabular-nums ${TONE[tone] ?? TONE.slate}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default function DashboardView() {
  const t = useT();
  const { state, pin } = useModerator();
  const [log, setLog] = useState<ActionLogEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await moderatorGetActionLog(pin, 30);
        if (active) setLog(rows);
      } catch {
        if (active) setLog([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [pin, state]); // re-pull when state changes (a mutation just happened)

  if (!state) {
    return <div className="text-slate-400">{t("common.loading")}</div>;
  }

  const ps = state.participants;
  const total = ps.length;
  const finished = ps.filter((p) => p.status === "finished");
  const noShow = ps.filter((p) => p.status === "no_show" || p.status === "skipped").length;
  const running = ps.filter((p) => p.status === "checked_in").length;
  const waitlisted = ps.filter((p) => p.waitlisted).length;

  const distances = finished
    .map((p) => p.distance_logged)
    .filter((d): d is number => d !== null);
  const totalDistance = distances.reduce((a, b) => a + b, 0);
  const avgDistance = distances.length ? Math.round(totalDistance / distances.length) : 0;
  const maxDistance = distances.length ? Math.max(...distances) : 0;

  // Machine utilization: summed run time of finished runners vs. machine-time
  // available since the event started. Approximate but honest (only counts
  // completed runs); shown only once the event has started.
  let utilization: string = "—";
  if (state.config.started_at) {
    const runMs = finished.reduce((acc, p) => {
      if (p.actual_start && p.actual_finish) {
        return acc + (Date.parse(p.actual_finish) - Date.parse(p.actual_start));
      }
      return acc;
    }, 0);
    const availMs = (Date.now() - Date.parse(state.config.started_at)) * state.queues.length;
    utilization = pct(runMs, availMs);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat value={String(total)} label={t("dash.signups")} tone="slate" />
          <Stat value={pct(finished.length, total)} label={t("dash.completion")} tone="emerald" />
          <Stat value={pct(noShow, total)} label={t("dash.noShow")} tone="red" />
          <Stat value={String(running)} label={t("dash.running")} tone="emerald" />
          <Stat value={String(waitlisted)} label={t("dash.waitlisted")} tone="amber" />
          <Stat value={utilization} label={t("dash.utilization")} tone="slate" />
        </div>
        <p className="mt-2 text-xs text-slate-400">{t("dash.utilizationHint")}</p>
      </div>

      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("dash.distanceTitle")}</h2>
        <div className="mt-3 flex flex-wrap gap-8">
          <div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">
              {t("lb.meters", { n: totalDistance })}
            </div>
            <div className="text-xs text-slate-500">{t("dash.distTotal")}</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">
              {t("lb.meters", { n: avgDistance })}
            </div>
            <div className="text-xs text-slate-500">{t("dash.distAvg")}</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">
              {t("lb.meters", { n: maxDistance })}
            </div>
            <div className="text-xs text-slate-500">{t("dash.distMax")}</div>
          </div>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("dash.giftsTitle")}</h2>
        <ul className="mt-3 space-y-2">
          {state.gifts.map((g) => {
            const used = g.total_quantity - g.remaining_quantity;
            return (
              <li key={g.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-800">{g.name}</span>
                  <span className="tabular-nums text-slate-600">
                    {t("dash.giftUsed", { used, total: g.total_quantity })}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: g.total_quantity ? `${(used / g.total_quantity) * 100}%` : "0%" }}
                  />
                </div>
              </li>
            );
          })}
          {state.gifts.length === 0 && (
            <li className="text-sm text-slate-500">{t("gift.none")}</li>
          )}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("dash.activityTitle")}</h2>
        {log === null ? (
          <p className="mt-2 text-sm text-slate-400">{t("common.loading")}</p>
        ) : log.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t("dash.activityEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {log.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-800">
                  <span className="font-medium">{t(`dash.action.${e.action}`)}</span>
                  {e.participant_name ? ` · ${e.participant_name}` : ""}
                </span>
                <span className="text-xs text-slate-400">
                  {e.pin_label ? `${e.pin_label} · ` : ""}
                  {formatClockIso(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
