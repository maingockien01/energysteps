// Pace-based completion forecast: "at the rate runners are actually finishing,
// when does the last one finish, and will that beat the event end time?"
//
// We use OBSERVED throughput (finishers since the event started), not the
// planned slot projection, because the decision-relevant question on the day is
// whether the real pace — including delays and no-shows — clears everyone in
// time. This is deliberately a rough estimate: it assumes the current overall
// finish rate holds, so it gets optimistic in the idle tail as machines empty
// (no rebalancing). Label it as an estimate wherever it's shown.
import type { ModeratorState } from "./types";

export type ForecastStatus = "no_start" | "gathering" | "done" | "ready";

export interface PaceForecast {
  status: ForecastStatus;
  remaining: number; // runners still signed_up or checked_in
  projectedEndMs: number | null; // when the last runner is projected to finish
  endMs: number | null; // configured event end (null if unset)
  willOverrun: boolean; // projectedEnd beyond endMs
  overByMin: number; // minutes past the end time (0 if on track / no end)
  atRiskCount: number; // est. runners who won't fit before the end (0 if on track / no end)
  ratePerMin: number; // observed finishers per minute (all machines combined)
}

export function computePaceForecast(state: ModeratorState, nowMs: number): PaceForecast {
  const ps = state.participants;
  const cfg = state.config;
  const startedMs = cfg.started_at ? Date.parse(cfg.started_at) : NaN;
  const endMs = cfg.event_end_time ? Date.parse(cfg.event_end_time) : null;
  const remaining = ps.filter(
    (p) => p.status === "signed_up" || p.status === "checked_in",
  ).length;
  const finishedCount = ps.filter((p) => p.status === "finished").length;

  const base = {
    remaining,
    projectedEndMs: null as number | null,
    endMs,
    willOverrun: false,
    overByMin: 0,
    atRiskCount: 0,
    ratePerMin: 0,
  };

  if (!cfg.started_at || Number.isNaN(startedMs)) return { ...base, status: "no_start" };
  if (remaining === 0) return { ...base, status: "done" };

  // Need a few finishers AND a minute on the clock before the rate is meaningful.
  const elapsedMin = (nowMs - startedMs) / 60000;
  const minSample = Math.max(3, state.queues.length);
  if (finishedCount < minSample || elapsedMin < 1) return { ...base, status: "gathering" };

  const ratePerMin = finishedCount / elapsedMin;
  if (ratePerMin <= 0) return { ...base, status: "gathering" };

  const projectedEndMs = nowMs + (remaining / ratePerMin) * 60000;
  let willOverrun = false;
  let overByMin = 0;
  let atRiskCount = 0;
  if (endMs !== null) {
    willOverrun = projectedEndMs > endMs;
    overByMin = Math.max(0, Math.round((projectedEndMs - endMs) / 60000));
    const fitMin = Math.max(0, (endMs - nowMs) / 60000);
    const canFinish = Math.floor(ratePerMin * fitMin);
    atRiskCount = Math.max(0, remaining - canFinish);
  }

  return {
    status: "ready",
    remaining,
    projectedEndMs,
    endMs,
    willOverrun,
    overByMin,
    atRiskCount,
    ratePerMin,
  };
}
