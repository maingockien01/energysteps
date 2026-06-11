// Event organizer board — the main live ops console. Shows every queue as a
// selectable tab; for the selected queue it drives the checkout-anchored slot
// timer (computeSlotTimer) with a ticking `now`, renders the current head by
// phase, and exposes check-in / check-out / skip controls plus an upcoming list.
import { useEffect, useMemo, useState } from "react";
import { useModerator } from "./context";
import { computeSlotTimer } from "../lib/queueLogic";
import {
  ApiError,
  errorMessage,
  moderatorCheckIn,
  moderatorCheckOut,
  moderatorSkip,
} from "../lib/api";
import {
  formatClockIso,
  formatCountdown,
  formatDuration,
} from "../lib/format";
import type { Participant, Queue } from "../lib/types";

const DONE = new Set(["finished", "skipped", "no_show"]);

function statusLabel(status: string): string {
  switch (status) {
    case "signed_up":
      return "Signed up";
    case "checked_in":
      return "Running";
    case "finished":
      return "Finished";
    case "skipped":
      return "Skipped";
    case "no_show":
      return "No-show";
    default:
      return status;
  }
}

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
    return <div className="text-slate-400">Loading board…</div>;
  }

  const { config, queues, gifts } = state;

  if (queues.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 text-slate-600">
        No queues configured yet. Set the number of machines in the Config tab.
      </div>
    );
  }

  const selectedQueue: Queue | undefined =
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
      if (e instanceof ApiError) setMsg(errorMessage(e.code));
      else setMsg("Something went wrong. Please try again.");
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
      setMsg("Distance must be a number, or leave it blank.");
      return;
    }
    const giftId = giftInput === "" ? null : giftInput;
    setCheckoutOpen(false);
    void run(() => moderatorCheckOut(pin, head.id, distance, giftId));
  }

  function onSkip(status: "no_show" | "skipped") {
    if (!head) return;
    const verb = status === "no_show" ? "mark as a no-show" : "skip";
    if (!window.confirm(`Are you sure you want to ${verb} ${head.name}? This advances the queue.`)) {
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

  // Derived display states. When the check-in window elapses, the slot clock is
  // already running (it's anchored to the previous runner's checkout, NOT to
  // check-in — see queueLogic), so we AUTO-roll into the run countdown without
  // needing a manual check-in. In that auto-running state we do NOT offer
  // "Check in" so a moderator can't trigger a late/overlapping check-in.
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
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-400"
              }`}
            >
              <div className="text-sm font-semibold">{q.name}</div>
              <div
                className={`mt-0.5 truncate text-xs ${
                  active ? "text-slate-300" : "text-slate-500"
                }`}
              >
                {qTimer.phase === "queue_complete"
                  ? "Complete"
                  : qHead
                    ? `${qHead.name} · ${statusLabel(qHead.status)}`
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
          <p className="text-slate-600">
            Set an event start time and Start the event in the Config tab.
          </p>
        )}

        {timer.phase === "queue_complete" && (
          <p className="text-lg font-semibold text-emerald-700">
            ✅ Queue complete — all runners done.
          </p>
        )}

        {inCheckinWindow && head && (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Awaiting check-in · position {head.position_in_queue}
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{head.name}</div>
              <div className="text-sm text-slate-600">
                {head.department} · {formatDuration(head.run_duration_seconds)} run
              </div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-amber-600">
                Check-in window
              </div>
              <div className="font-mono text-6xl font-bold tabular-nums text-amber-600">
                {formatCountdown(checkInRemaining)}
              </div>
              <div className="text-sm text-slate-500">
                Run time starts automatically when this reaches 0:00.
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                disabled={busy}
                onClick={onCheckIn}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                Check in
              </button>
              <button
                disabled={busy}
                onClick={() => onSkip("no_show")}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-50"
              >
                No-show
              </button>
              <button
                disabled={busy}
                onClick={() => onSkip("skipped")}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {showRun && head && (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-600">
                {autoRunning ? "Running (auto-started)" : "Running"} · position{" "}
                {head.position_in_queue}
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{head.name}</div>
              <div className="text-sm text-slate-600">
                {head.department} · {formatDuration(head.run_duration_seconds)} run
                {timer.phase === "running" && <> · started {formatClockIso(head.actual_start)}</>}
              </div>
              {autoRunning && (
                <div className="mt-1 text-sm font-medium text-amber-600">
                  Check-in window ended — the slot clock is running. Check them out when done.
                </div>
              )}
            </div>

            <div>
              <div
                className={`text-xs font-medium uppercase tracking-wide ${
                  runElapsed ? "text-red-600" : "text-emerald-600"
                }`}
              >
                Run time remaining
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
                  Slot time elapsed — check them out to advance the queue.
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                disabled={busy}
                onClick={openCheckout}
                className="rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                Check out
              </button>
              <button
                disabled={busy}
                onClick={() => onSkip("skipped")}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Check-out panel */}
      {checkoutOpen && head && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-300">
          <div className="text-lg font-semibold text-slate-900">
            Check out {head.name}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Distance logged (optional)
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={distanceInput}
                onChange={(e) => setDistanceInput(e.target.value)}
                placeholder="e.g. 1500"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Gift</span>
              <select
                value={giftInput}
                onChange={(e) => setGiftInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
              >
                <option value="">No gift</option>
                {availableGifts.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.remaining_quantity} left)
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={confirmCheckout}
              className="rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              Confirm check-out
            </button>
            <button
              disabled={busy}
              onClick={() => setCheckoutOpen(false)}
              className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-semibold text-slate-900">Up next</div>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No more runners in line.</p>
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
                  {statusLabel(p.status)}
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
            Finished &amp; skipped ({doneList.length})
          </summary>
          <ul className="mt-3 divide-y divide-slate-100">
            {doneList.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div className="text-sm text-slate-700">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-slate-400">
                    {" "}
                    · {p.department}
                  </span>
                  {p.status === "finished" && p.distance_logged !== null && (
                    <span className="text-slate-400"> · {p.distance_logged} logged</span>
                  )}
                  {p.status === "finished" && (
                    <span className="text-slate-400">
                      {" "}
                      · out {formatClockIso(p.actual_finish)}
                    </span>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(
                    p.status,
                  )}`}
                >
                  {statusLabel(p.status)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
