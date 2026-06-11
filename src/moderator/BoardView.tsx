// Event organizer board — the main live ops console. Shows every queue as a
// selectable tab; for the selected queue it drives the checkout-anchored slot
// timer (computeSlotTimer) with a ticking `now`, renders the current head by
// phase, and exposes check-in / check-out / skip controls plus an upcoming list.
import { useEffect, useMemo, useState } from "react";
import { useModerator } from "./context";
import { computeSlotTimer } from "../lib/queueLogic";
import {
  ApiError,
  moderatorCheckIn,
  moderatorCheckOut,
  moderatorSkip,
} from "../lib/api";
import {
  formatClockIso,
  formatCountdown,
  formatDuration,
} from "../lib/format";
import { useT } from "../lib/i18n";
import type { Participant, Queue } from "../lib/types";

const DONE = new Set(["finished", "skipped", "no_show"]);

function statusPillClass(status: string): string {
  switch (status) {
    case "checked_in":
      return "bg-emerald-100 text-emerald-800";
    case "finished":
      return "bg-slate-200 text-slate-700";
    case "skipped":
    case "no_show":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export default function BoardView() {
  const t = useT();
  const { state, pin, reload } = useModerator();

  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [distanceInput, setDistanceInput] = useState("");
  const [giftInput, setGiftInput] = useState("");

  // Ticking clock for the countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Default the selected queue to the first one once state arrives, and keep a
  // valid selection if queues change.
  useEffect(() => {
    if (!state) return;
    const exists = state.queues.some((q) => q.id === selectedQueueId);
    if (!exists) {
      setSelectedQueueId(state.queues[0]?.id ?? null);
    }
  }, [state, selectedQueueId]);

  // Per-queue participant lists (sorted by position), for tabs + selected view.
  const byQueue = useMemo(() => {
    const map = new Map<string, Participant[]>();
    if (!state) return map;
    for (const q of state.queues) {
      const list = state.participants
        .filter((p) => p.assigned_queue_id === q.id)
        .sort((a, b) => a.position_in_queue - b.position_in_queue);
      map.set(q.id, list);
    }
    return map;
  }, [state]);

  if (!state) {
    return <div className="text-slate-400">{t("board.loading")}</div>;
  }

  const { config, queues, gifts } = state;

  if (queues.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 text-slate-600">
        {t("board.noQueues")}
      </div>
    );
  }

  const selectedQueue: Queue =
    queues.find((q) => q.id === selectedQueueId) ?? queues[0];
  const queueParticipants = byQueue.get(selectedQueue.id) ?? [];

  const timer = computeSlotTimer(
    queueParticipants,
    config.event_start_time,
    config.buffer_seconds,
  );
  const head = timer.head as Participant | null;

  // Upcoming = not-finished runners after the head, in order. Done runners are
  // shown collapsed below.
  const activeList = queueParticipants.filter((p) => !DONE.has(p.status));
  const upcoming = activeList.slice(1);
  const doneList = queueParticipants.filter((p) => DONE.has(p.status));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      if (e instanceof ApiError) setMsg(t(`error.${e.code}`));
      else setMsg(t("common.wrong"));
    } finally {
      setBusy(false);
    }
  }

  function onCheckIn() {
    if (!head) return;
    void run(() => moderatorCheckIn(pin, head.id));
  }

  function openCheckout() {
    setDistanceInput("");
    setGiftInput("");
    setCheckoutOpen(true);
  }

  function confirmCheckout() {
    if (!head) return;
    const trimmed = distanceInput.trim();
    const distance = trimmed === "" ? null : Number(trimmed);
    if (distance !== null && Number.isNaN(distance)) {
      setMsg(t("board.distanceNaN"));
      return;
    }
    const giftId = giftInput === "" ? null : giftInput;
    setCheckoutOpen(false);
    void run(() => moderatorCheckOut(pin, head.id, distance, giftId));
  }

  function onSkip(status: "no_show" | "skipped") {
    if (!head) return;
    if (
      !window.confirm(
        t("board.confirmSkip", { verb: t(`board.verb.${status}`), name: head.name }),
      )
    ) {
      return;
    }
    void run(() => moderatorSkip(pin, head.id, status));
  }

  // Countdown targets per phase.
  const checkInRemaining =
    timer.checkInDeadlineMs !== null ? (timer.checkInDeadlineMs - now) / 1000 : 0;
  const runRemaining =
    timer.slotEndMs !== null ? (timer.slotEndMs - now) / 1000 : 0;
  const checkInElapsed = checkInRemaining < 0;
  const runElapsed = runRemaining < 0;

  // Derived display states (see queueLogic for the auto-roll rationale).
  const inCheckinWindow = timer.phase === "awaiting_checkin" && !checkInElapsed;
  const autoRunning = timer.phase === "awaiting_checkin" && checkInElapsed;
  const showRun = autoRunning || timer.phase === "running";

  const availableGifts = gifts.filter((g) => g.remaining_quantity > 0);

  return (
    <div className="space-y-6">
      {/* Queue tabs */}
      <div className="flex flex-wrap gap-2">
        {queues.map((q) => {
          const list = byQueue.get(q.id) ?? [];
          const qTimer = computeSlotTimer(
            list,
            config.event_start_time,
            config.buffer_seconds,
          );
          const qHead = qTimer.head as Participant | null;
          const active = q.id === selectedQueue.id;
          return (
            <button
              key={q.id}
              onClick={() => setSelectedQueueId(q.id)}
              className={`min-w-[10rem] rounded-2xl px-4 py-3 text-left shadow-sm ring-1 transition ${
                active
                  ? "bg-brand text-white ring-brand"
                  : "bg-white text-slate-700 ring-slate-200 hover:ring-brand/50"
              }`}
            >
              <div className="text-sm font-semibold">{q.name}</div>
              <div
                className={`mt-0.5 truncate text-xs ${
                  active ? "text-white/80" : "text-slate-500"
                }`}
              >
                {qTimer.phase === "queue_complete"
                  ? t("board.complete")
                  : qHead
                    ? `${qHead.name} · ${t(`st.${qHead.status}`)}`
                    : "—"}
              </div>
            </button>
          );
        })}
      </div>

      {msg && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
          {msg}
        </div>
      )}

      {/* Head / current slot */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        {timer.phase === "no_start_time" && (
          <p className="text-slate-600">{t("board.noStartTime")}</p>
        )}

        {timer.phase === "queue_complete" && (
          <p className="text-lg font-semibold text-emerald-700">
            {t("board.queueComplete")}
          </p>
        )}

        {inCheckinWindow && head && (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t("board.awaitingCheckin", { n: head.position_in_queue })}
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{head.name}</div>
              <div className="text-sm text-slate-600">
                {head.department} · {formatDuration(head.run_duration_seconds)}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-amber-600">
                {t("board.checkinWindow")}
              </div>
              <div className="font-mono text-6xl font-bold tabular-nums text-amber-600">
                {formatCountdown(checkInRemaining)}
              </div>
              <div className="text-sm text-slate-500">{t("board.autoStartNote")}</div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                disabled={busy}
                onClick={onCheckIn}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("board.checkIn")}
              </button>
              <button
                disabled={busy}
                onClick={() => onSkip("no_show")}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-50"
              >
                {t("board.noShow")}
              </button>
              <button
                disabled={busy}
                onClick={() => onSkip("skipped")}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("board.skip")}
              </button>
            </div>
          </div>
        )}

        {showRun && head && (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">
                {autoRunning ? t("board.runningAuto") : t("board.running")} ·{" "}
                {t("board.position", { n: head.position_in_queue })}
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{head.name}</div>
              <div className="text-sm text-slate-600">
                {head.department} · {formatDuration(head.run_duration_seconds)}
                {timer.phase === "running" && (
                  <> · {t("board.startedAt", { time: formatClockIso(head.actual_start) })}</>
                )}
              </div>
              {autoRunning && (
                <div className="mt-1 text-sm font-medium text-amber-600">
                  {t("board.autoRunningNote")}
                </div>
              )}
            </div>

            <div>
              <div
                className={`text-xs font-medium uppercase tracking-wide ${
                  runElapsed ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {t("board.runRemaining")}
              </div>
              <div
                className={`font-mono text-6xl font-bold tabular-nums ${
                  runElapsed ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {runElapsed ? "0:00" : formatCountdown(runRemaining)}
              </div>
              {runElapsed && (
                <div className="text-sm font-medium text-red-600">
                  {t("board.slotElapsed")}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                disabled={busy}
                onClick={openCheckout}
                className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
              >
                {t("board.checkOut")}
              </button>
              <button
                disabled={busy}
                onClick={() => onSkip("skipped")}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("board.skip")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Check-out panel */}
      {checkoutOpen && head && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-300">
          <div className="text-lg font-semibold text-slate-900">
            {t("board.checkOutTitle", { name: head.name })}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                {t("board.distance")}
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={distanceInput}
                onChange={(e) => setDistanceInput(e.target.value)}
                placeholder="e.g. 1500"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("board.gift")}</span>
              <select
                value={giftInput}
                onChange={(e) => setGiftInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              >
                <option value="">{t("board.noGift")}</option>
                {availableGifts.map((g) => (
                  <option key={g.id} value={g.id}>
                    {t("board.giftLeft", { name: g.name, n: g.remaining_quantity })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={confirmCheckout}
              className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {t("board.confirmCheckout")}
            </button>
            <button
              disabled={busy}
              onClick={() => setCheckoutOpen(false)}
              className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-semibold text-slate-900">{t("board.upNext")}</div>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{t("board.noMore")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {upcoming.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-sm font-semibold text-slate-400">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.department} · {formatDuration(p.run_duration_seconds)}
                    </div>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(
                    p.status,
                  )}`}
                >
                  {t(`st.${p.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Done (collapsed) */}
      {doneList.length > 0 && (
        <details className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            {t("board.doneCollapsed", { n: doneList.length })}
          </summary>
          <ul className="mt-3 divide-y divide-slate-100">
            {doneList.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div className="text-sm text-slate-700">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-slate-400"> · {p.department}</span>
                  {p.status === "finished" && p.distance_logged !== null && (
                    <span className="text-slate-400">
                      {" "}
                      · {t("board.logged", { n: p.distance_logged })}
                    </span>
                  )}
                  {p.status === "finished" && (
                    <span className="text-slate-400">
                      {" "}
                      · {t("board.out", { time: formatClockIso(p.actual_finish) })}
                    </span>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(
                    p.status,
                  )}`}
                >
                  {t(`st.${p.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
