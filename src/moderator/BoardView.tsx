// Event organizer board — the main live ops console. Shows every queue as a
// selectable tab; for the selected queue it drives the checkout-anchored slot
// timer (computeSlotTimer) with a ticking `now`, renders the current head by
// phase, and exposes check-in / check-out / skip controls plus an upcoming list.
import { useEffect, useMemo, useRef, useState } from "react";
import { useModerator } from "./context";
import { computeSlotTimer } from "../lib/queueLogic";
import {
  ApiError,
  moderatorCheckIn,
  moderatorCheckOut,
  moderatorMoveParticipant,
  moderatorSkip,
  moderatorSuggestGift,
  moderatorUndoCheckIn,
  moderatorUndoCheckOut,
} from "../lib/api";
import {
  formatClockIso,
  formatCountdown,
  formatDuration,
} from "../lib/format";
import { useT } from "../lib/i18n";
import { playChime, unlockAudio } from "../lib/sound";
import { statusPillClass } from "../lib/ui";
import type { Participant, Queue } from "../lib/types";

const DONE = new Set(["finished", "skipped", "no_show"]);

// How long the "Undo" affordance stays available after a check-in / check-out.
const UNDO_WINDOW_MS = 60_000;
const STATION_KEY = "energysteps.station";

type LastAction = {
  id: string;
  kind: "check_in" | "check_out";
  name: string;
  at: number;
};

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
  // Gift is a required decision at check-out: the moderator must either pick a
  // gift OR explicitly tick "no gift". `skipGift` is that explicit opt-out.
  const [skipGift, setSkipGift] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  // True once the moderator touches the gift controls during a check-out, so the
  // async backend gift suggestion can't overwrite their manual choice.
  const giftTouchedRef = useRef(false);
  const [station, setStation] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STATION_KEY);
    } catch {
      return null;
    }
  });

  // Ticking clock for the countdowns.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Default the selected queue once state arrives — preferring the moderator's
  // chosen station (P1-4) — and keep a valid selection if queues change.
  useEffect(() => {
    if (!state) return;
    const exists = state.queues.some((q) => q.id === selectedQueueId);
    if (!exists) {
      const stationValid = station && state.queues.some((q) => q.id === station);
      setSelectedQueueId(stationValid ? station : (state.queues[0]?.id ?? null));
    }
  }, [state, selectedQueueId, station]);

  // Per-station preference: persist + jump to that machine.
  function chooseStation(qid: string | null) {
    setStation(qid);
    try {
      if (qid) localStorage.setItem(STATION_KEY, qid);
      else localStorage.removeItem(STATION_KEY);
    } catch {
      // ignore (privacy mode)
    }
    if (qid) setSelectedQueueId(qid);
  }

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
    config.move_grace_seconds,
  );
  const head = timer.head as Participant | null;

  // Upcoming = not-finished runners after the head, in order. Done runners are
  // shown collapsed below.
  const activeList = queueParticipants.filter((p) => !DONE.has(p.status));
  const upcoming = activeList.slice(1);
  const doneList = queueParticipants.filter((p) => DONE.has(p.status));

  // Free machines = queues with no active (signed_up / checked_in) runner. A
  // waiting runner can be moved onto one of these to rebalance load (PM item 14).
  const freeQueues = queues.filter(
    (q) => !(byQueue.get(q.id) ?? []).some((p) => !DONE.has(p.status)),
  );

  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError) setMsg(t(`error.${e.code}`));
      else setMsg(t("common.wrong"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onCheckIn() {
    if (!head) return;
    const h = head;
    void run(() => moderatorCheckIn(pin, h.id)).then((ok) => {
      if (ok) setLastAction({ id: h.id, kind: "check_in", name: h.name, at: Date.now() });
    });
  }

  function openCheckout() {
    if (!head) return;
    const h = head;
    setDistanceInput("");
    setGiftInput("");
    giftTouchedRef.current = false;
    // If this email already received a gift, pre-set the explicit opt-out so the
    // moderator can only check out without one.
    setSkipGift(alreadyAwarded);
    setCheckoutOpen(true);
    // Backend-driven auto-select: ask the server for the in-stock gift mapped to
    // this runner's duration (authoritative stock; null if none/already awarded)
    // and pre-fill the dropdown. The moderator can still change or clear it.
    if (!alreadyAwarded) {
      void moderatorSuggestGift(pin, h.id)
        .then((s) => {
          // Don't overwrite a choice the moderator already made, and ignore a
          // gift that's no longer in stock or a panel that moved on.
          if (
            !giftTouchedRef.current &&
            s.gift_id &&
            availableGifts.some((g) => g.id === s.gift_id)
          ) {
            setGiftInput(s.gift_id);
            setSkipGift(false);
          }
        })
        .catch(() => {
          // Suggestion is best-effort; leave the dropdown unset on error.
        });
    }
  }

  function confirmCheckout() {
    if (!head) return;
    const h = head;
    const trimmed = distanceInput.trim();
    if (trimmed === "") {
      setMsg(t("board.distanceRequired"));
      return;
    }
    const distance = Number(trimmed);
    if (!Number.isFinite(distance) || distance < 0) {
      setMsg(t("board.distanceNaN"));
      return;
    }
    // Soft sanity guard: a distance far beyond what's physically possible in the
    // run window is almost certainly a typo (e.g. 9999) that would skew the
    // leaderboard. Warn and require an explicit confirm, but allow an override.
    const softMaxKm = Math.max(5, (h.run_duration_seconds / 60) * 2);
    if (distance > softMaxKm && !window.confirm(t("board.distanceSanity", { n: distance }))) {
      return;
    }
    // Gift is a required decision: a gift must be selected, or "no gift" ticked.
    if (!skipGift && giftInput === "") {
      setMsg(t("board.giftRequired"));
      return;
    }
    const giftId = skipGift ? null : giftInput;
    setCheckoutOpen(false);
    void run(() => moderatorCheckOut(pin, h.id, distance, giftId)).then((ok) => {
      if (ok) setLastAction({ id: h.id, kind: "check_out", name: h.name, at: Date.now() });
    });
  }

  function undoLast() {
    if (!lastAction) return;
    const { id, kind } = lastAction;
    setLastAction(null);
    void run(() =>
      kind === "check_in"
        ? moderatorUndoCheckIn(pin, id)
        : moderatorUndoCheckOut(pin, id),
    );
  }

  function onMove(p: Participant, targetQueueId: string) {
    const target = queues.find((q) => q.id === targetQueueId);
    setLastAction(null); // a move isn't undoable from the bar
    void run(() => moderatorMoveParticipant(pin, p.id, targetQueueId)).then((ok) => {
      if (ok && target) setMsg(t("board.moved", { name: p.name, machine: target.name }));
    });
  }

  // Move control: shown only for waiting (signed_up) runners when at least one
  // machine is currently free. Picking a machine moves the runner there.
  function renderMove(p: Participant) {
    if (p.status !== "signed_up" || freeQueues.length === 0) return null;
    return (
      <select
        disabled={busy}
        value=""
        onChange={(e) => {
          if (e.target.value) onMove(p, e.target.value);
        }}
        aria-label={t("board.moveTo")}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-brand focus:outline-none disabled:opacity-50"
      >
        <option value="">{t("board.moveTo")}</option>
        {freeQueues.map((q) => (
          <option key={q.id} value={q.id}>
            {q.name}
          </option>
        ))}
      </select>
    );
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
    setLastAction(null); // skip/no-show isn't undoable from the bar
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

  // One gift per email (across ALL their participations): has any OTHER
  // registration for this runner's email already received a gift?
  const headEmail = head?.email.trim().toLowerCase();
  const alreadyAwarded =
    !!headEmail &&
    state.participants.some(
      (p) =>
        p.id !== head?.id &&
        p.gift_id !== null &&
        p.email.trim().toLowerCase() === headEmail,
    );

  // Layer-1 "Call next" cue: the runners who should physically head to this
  // machine now. While awaiting a check-in that's the head + on-deck; while a
  // runner is on the machine it's the next two waiting. Purely a moderator-side
  // attention aid (sound + big names to read over the PA) — no data is changed.
  const callList = (showRun ? upcoming : activeList).slice(0, 2);

  function openCall() {
    unlockAudio();
    playChime(3);
    setCallOpen(true);
  }

  // P1-1 — idle-machine visibility. For every machine, figure out whether its
  // slot clock is burning with nobody checked in ("wasted"), and how big its
  // backlog is. We surface this so a moderator can hustle the missing runner —
  // we never move anyone between machines (the no-rebalancing invariant holds).
  const queueStats = queues.map((q) => {
    const list = byQueue.get(q.id) ?? [];
    const tmr = computeSlotTimer(
      list,
      config.event_start_time,
      config.buffer_seconds,
      config.move_grace_seconds,
    );
    const active = list.filter((p) => !DONE.has(p.status));
    const wasted =
      tmr.phase === "awaiting_checkin" &&
      tmr.checkInDeadlineMs !== null &&
      now > tmr.checkInDeadlineMs;
    return {
      q,
      waiting: active.length,
      complete: tmr.phase === "queue_complete",
      wasted,
      wastedSec: wasted && tmr.checkInDeadlineMs ? (now - tmr.checkInDeadlineMs) / 1000 : 0,
      headName: (tmr.head as Participant | null)?.name ?? null,
    };
  });
  const anyWaitingElsewhere = queueStats.some((s) => !s.complete && s.waiting > 0);
  const wastedQueues = queueStats.filter((s) => s.wasted);
  const idleComplete = queueStats.filter((s) => s.complete);
  const showIdleAlert =
    wastedQueues.length > 0 || (idleComplete.length > 0 && anyWaitingElsewhere);

  const undoVisible = lastAction !== null && now - lastAction.at < UNDO_WINDOW_MS;

  return (
    <div className="space-y-6">
      {/* Per-station selector (P1-4) */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-600">{t("board.station")}</span>
        <select
          value={station ?? ""}
          onChange={(e) => chooseStation(e.target.value === "" ? null : e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 focus:border-brand focus:outline-none"
        >
          <option value="">{t("board.stationAll")}</option>
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
        {station && (
          <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
            {t("board.stationActive", {
              machine: queues.find((q) => q.id === station)?.name ?? "",
            })}
          </span>
        )}
      </div>

      {/* Idle-machine alert (P1-1) — visibility only, never a move */}
      {showIdleAlert && (
        <div
          role="status"
          className="rounded-2xl bg-amber-50 p-4 shadow-sm ring-1 ring-amber-300"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <span aria-hidden>⚠</span> {t("board.idleTitle")}
          </div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {wastedQueues.map((s) => (
              <li key={s.q.id}>
                {t("board.idleWasted", {
                  machine: s.q.name,
                  name: s.headName ?? "—",
                  time: formatCountdown(s.wastedSec),
                })}
              </li>
            ))}
            {anyWaitingElsewhere &&
              idleComplete.map((s) => (
                <li key={s.q.id}>{t("board.idleComplete", { machine: s.q.name })}</li>
              ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700">{t("board.idleHint")}</p>
        </div>
      )}

      {/* Undo bar (P1-3) */}
      {undoVisible && lastAction && (
        <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white">
          <span>
            {t(
              lastAction.kind === "check_in" ? "board.undidCheckInMsg" : "board.undidCheckOutMsg",
              { name: lastAction.name },
            )}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={undoLast}
            className="rounded-lg bg-white px-3 py-1 font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
          >
            {t("board.undo")}
          </button>
        </div>
      )}

      {/* Queue tabs */}
      <div className="flex flex-wrap gap-2">
        {queues.map((q) => {
          const list = byQueue.get(q.id) ?? [];
          const qTimer = computeSlotTimer(
            list,
            config.event_start_time,
            config.buffer_seconds,
            config.move_grace_seconds,
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
        {callList.length > 0 && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={openCall}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
            >
              {t("board.callNext")}
            </button>
          </div>
        )}

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

            {/* Primary action stays prominent; the queue-advancing actions
                (no-show / skip) are smaller and pushed to the right so they
                aren't mis-tapped under time pressure. */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={busy}
                onClick={onCheckIn}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("board.checkIn")}
              </button>
              {renderMove(head)}
              <div className="flex gap-2 sm:ml-auto">
                <button
                  disabled={busy}
                  onClick={() => onSkip("no_show")}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-50"
                >
                  {t("board.noShow")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => onSkip("skipped")}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("board.skip")}
                </button>
              </div>
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

            <div className="flex flex-wrap items-center gap-3">
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
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50 sm:ml-auto"
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
                placeholder="vd: 2.5"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{t("board.gift")}</span>
              <select
                value={giftInput}
                disabled={skipGift}
                onChange={(e) => {
                  giftTouchedRef.current = true;
                  setGiftInput(e.target.value);
                  if (e.target.value !== "") setSkipGift(false);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value="" disabled>
                  {t("board.giftPlaceholder")}
                </option>
                {availableGifts.map((g) => (
                  <option key={g.id} value={g.id}>
                    {t("board.giftLeft", { name: g.name, n: g.remaining_quantity })}
                  </option>
                ))}
              </select>
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={skipGift}
                  disabled={alreadyAwarded}
                  onChange={(e) => {
                    giftTouchedRef.current = true;
                    setSkipGift(e.target.checked);
                    if (e.target.checked) setGiftInput("");
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                />
                {t("board.skipGift")}
              </label>
            </label>
          </div>

          {alreadyAwarded && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              {t("board.alreadyAwarded")}
            </p>
          )}
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
                <div className="flex items-center gap-2">
                  {renderMove(p)}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(
                      p.status,
                    )}`}
                  >
                    {t(`st.${p.status}`)}
                  </span>
                </div>
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

      {/* Call-next overlay: big names + chime, for reading over the PA. */}
      {callOpen && callList.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl">
            <div className="text-sm font-semibold uppercase tracking-wide text-amber-600">
              {t("board.callTitle")}
            </div>
            <div className="mt-1 text-lg font-medium text-slate-500">
              {selectedQueue.name}
            </div>
            <ul className="mt-6 space-y-5">
              {callList.map((p, i) => (
                <li key={p.id}>
                  <div className="text-4xl font-extrabold tracking-tight text-slate-900">
                    {p.name}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {p.department} · {formatDuration(p.run_duration_seconds)} ·{" "}
                    <span
                      className={
                        i === 0
                          ? "font-semibold text-amber-600"
                          : "text-slate-500"
                      }
                    >
                      {i === 0 ? t("board.callNow") : t("board.callOnDeck")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-base text-slate-600">
              {t("board.callInstruction", { machine: selectedQueue.name })}
            </p>
            <div className="mt-8 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => playChime(3)}
                className="rounded-xl bg-amber-500 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-amber-600"
              >
                {t("board.callRingAgain")}
              </button>
              <button
                type="button"
                onClick={() => setCallOpen(false)}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                {t("board.callDone")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
