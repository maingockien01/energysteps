// Event configuration: edit config fields, save, view status, and start the event.
import { useEffect, useState } from "react";
import { ApiError, errorMessage, moderatorStartEvent, moderatorUpdateConfig } from "../lib/api";
import {
  formatClockIso,
  formatDateTime,
  formatDuration,
  fromDatetimeLocal,
  toDatetimeLocal,
} from "../lib/format";
import { useModerator } from "./context";

const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";
const label = "block text-sm font-medium text-slate-700";
const input =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900";

export default function ConfigView() {
  const { state, pin, reload } = useModerator();

  // Form fields (local copies of config).
  const [startLocal, setStartLocal] = useState("");
  const [bufferSeconds, setBufferSeconds] = useState(0);
  const [durations, setDurations] = useState<number[]>([]);
  const [queueCount, setQueueCount] = useState(1);
  const [newDurationMin, setNewDurationMin] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Live Vietnam clock so the moderator can set the start time correctly.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Seed the form from config whenever it (re)loads.
  const config = state?.config ?? null;
  useEffect(() => {
    if (!config) return;
    setStartLocal(toDatetimeLocal(config.event_start_time));
    setBufferSeconds(config.buffer_seconds);
    setDurations([...config.allowed_run_durations].sort((a, b) => a - b));
    setQueueCount(config.queue_count);
  }, [config]);

  if (!state) {
    return <div className="text-slate-400">Loading…</div>;
  }

  const eventStarted = state.config.event_started;

  function addDuration() {
    const minutes = Number(newDurationMin);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const seconds = Math.round(minutes * 60);
    setDurations((prev) =>
      prev.includes(seconds) ? prev : [...prev, seconds].sort((a, b) => a - b),
    );
    setNewDurationMin("");
  }

  function removeDuration(seconds: number) {
    setDurations((prev) => prev.filter((d) => d !== seconds));
  }

  async function handleSave() {
    setSaveMsg(null);
    setQueueMsg(null);
    if (durations.length === 0) {
      setSaveMsg("Add at least one run duration.");
      return;
    }
    setSaving(true);
    try {
      await moderatorUpdateConfig(pin, {
        event_start_time: fromDatetimeLocal(startLocal),
        buffer_seconds: bufferSeconds,
        allowed_run_durations: durations,
        queue_count: queueCount,
      });
      setSaveMsg("Saved.");
      await reload();
    } catch (e) {
      if (e instanceof ApiError) {
        const text = errorMessage(e.code);
        if (e.code === "QUEUE_COUNT_HAS_SIGNUPS" || e.code === "QUEUE_COUNT_LOCKED") {
          setQueueMsg(text);
        } else {
          setSaveMsg(text);
        }
      } else {
        setSaveMsg("Something went wrong. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleStart() {
    setStartMsg(null);
    const ok = window.confirm(
      "This captures everyone's estimated times and locks the machine count. Continue?",
    );
    if (!ok) return;
    setStarting(true);
    try {
      await moderatorStartEvent(pin);
      await reload();
    } catch (e) {
      if (e instanceof ApiError) {
        setStartMsg(errorMessage(e.code));
      } else {
        setStartMsg("Something went wrong. Please try again.");
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Event status */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-slate-900">Event status</h2>
        {eventStarted ? (
          <p className="mt-2 text-sm text-slate-700">
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              Started
            </span>{" "}
            at {formatClockIso(state.config.started_at)}
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-700">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              Not started
            </span>
          </p>
        )}
      </section>

      {/* Configuration form */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-slate-900">Configuration</h2>

        {/* Live current time so the start time can be set correctly. */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-slate-900 px-4 py-3 text-white">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
            Current time (Vietnam · UTC+7)
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {formatDateTime(nowMs)}
          </span>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="event_start_time">
              Event start time <span className="font-normal text-slate-400">(Vietnam time)</span>
            </label>
            <input
              id="event_start_time"
              type="datetime-local"
              className={input}
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
            {state.config.event_start_time && (
              <p className="mt-1 text-xs text-slate-500">
                Saved start: {formatDateTime(Date.parse(state.config.event_start_time))}
              </p>
            )}
          </div>

          <div>
            <label className={label} htmlFor="buffer_seconds">
              Buffer (seconds)
            </label>
            <input
              id="buffer_seconds"
              type="number"
              min={0}
              className={input}
              value={bufferSeconds}
              onChange={(e) => setBufferSeconds(Number(e.target.value))}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={label}>Allowed run durations</label>
            <p className="mt-0.5 text-xs text-slate-500">
              Add new durations in minutes. At least one is required.
            </p>
            {durations.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">No durations yet — add at least one.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {durations.map((d) => (
                  <li
                    key={d}
                    className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800"
                  >
                    <span>{formatDuration(d)}</span>
                    <button
                      type="button"
                      onClick={() => removeDuration(d)}
                      className="text-slate-500 hover:text-red-600"
                      aria-label={`Remove ${formatDuration(d)}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-end gap-2">
              <div>
                <label className={label} htmlFor="new_duration">
                  New duration (minutes)
                </label>
                <input
                  id="new_duration"
                  type="number"
                  min={0}
                  step="any"
                  className={`${input} w-40`}
                  value={newDurationMin}
                  onChange={(e) => setNewDurationMin(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDuration();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                onClick={addDuration}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="queue_count">
              Number of machines
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="queue_count"
                type="number"
                min={1}
                className={input}
                value={queueCount}
                onChange={(e) => setQueueCount(Number(e.target.value))}
                disabled={eventStarted}
                readOnly={eventStarted}
              />
              {eventStarted && (
                <span className="whitespace-nowrap rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                  Locked (event started)
                </span>
              )}
            </div>
            {queueMsg && <p className="mt-1 text-sm text-red-600">{queueMsg}</p>}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMsg && <span className="text-sm text-slate-600">{saveMsg}</span>}
        </div>
      </section>

      {/* Start event */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-slate-900">Start event</h2>
        <p className="mt-1 text-sm text-slate-600">
          Starting captures each participant's immutable original estimated start time and locks
          the machine count. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={eventStarted || state.config.event_start_time === null || starting}
          className="mt-4 rounded-xl bg-emerald-600 px-8 py-3 text-base font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {eventStarted ? "Event started" : starting ? "Starting…" : "Start event"}
        </button>
        {state.config.event_start_time === null && !eventStarted && (
          <p className="mt-2 text-sm text-amber-700">
            Set and save an event start time before starting.
          </p>
        )}
        {startMsg && <p className="mt-2 text-sm text-red-600">{startMsg}</p>}
      </section>
    </div>
  );
}
