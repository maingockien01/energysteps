// Event configuration: edit config fields, save, view status, and start the event.
import { useEffect, useState } from "react";
import {
  ApiError,
  moderatorRenameQueue,
  moderatorResetEvent,
  moderatorStartEvent,
  moderatorUpdateConfig,
} from "../lib/api";
import {
  formatClockIso,
  formatDateTime,
  formatDuration,
  fromDatetimeLocal,
  toDatetimeLocal,
} from "../lib/format";
import { useT } from "../lib/i18n";
import { useModerator } from "./context";
import { card } from "../lib/ui";

const label = "block text-sm font-medium text-slate-700";
const input =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

// Suggested machine names for MB Life — steadfast / companionship / energy /
// wellbeing / aspiration. Tap one to fill the next still-unnamed machine.
const SUGGESTED_MACHINE_NAMES = ["Vững Bước", "Đồng Hành", "Bứt Phá", "An Khang", "Vươn Xa"];

export default function ConfigView() {
  const t = useT();
  const { state, pin, reload } = useModerator();

  // Form fields (local copies of config).
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [bufferSeconds, setBufferSeconds] = useState(0);
  const [moveGraceSeconds, setMoveGraceSeconds] = useState(0);
  const [durations, setDurations] = useState<number[]>([]);
  const [queueCount, setQueueCount] = useState(1);
  const [newDurationMin, setNewDurationMin] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Editable machine names (id -> name). Re-seeded only when the set of machines
  // changes (a count change), so a live reload doesn't clobber in-progress edits.
  const [machineNames, setMachineNames] = useState<Record<string, string>>({});
  const [savingNames, setSavingNames] = useState(false);
  const [namesMsg, setNamesMsg] = useState<string | null>(null);
  const queueKey = state?.queues.map((q) => q.id).join(",") ?? "";
  useEffect(() => {
    if (!state) return;
    setMachineNames(Object.fromEntries(state.queues.map((q) => [q.id, q.name])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey]);

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
    setEndLocal(toDatetimeLocal(config.event_end_time));
    setBufferSeconds(config.buffer_seconds);
    setMoveGraceSeconds(config.move_grace_seconds);
    setDurations([...config.allowed_run_durations].sort((a, b) => a - b));
    setQueueCount(config.queue_count);
  }, [config]);

  if (!state) {
    return <div className="text-slate-400">{t("cfg.loading")}</div>;
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
      setSaveMsg(t("cfg.addDurationOne"));
      return;
    }
    setSaving(true);
    try {
      await moderatorUpdateConfig(pin, {
        event_start_time: fromDatetimeLocal(startLocal),
        event_end_time: fromDatetimeLocal(endLocal),
        // Clamp to >= 0: a negative buffer/grace would corrupt the slot timer.
        buffer_seconds: Math.max(0, Math.round(bufferSeconds)),
        allowed_run_durations: durations,
        queue_count: queueCount,
        move_grace_seconds: Math.max(0, Math.round(moveGraceSeconds)),
      });
      setSaveMsg(t("common.saved"));
      await reload();
    } catch (e) {
      if (e instanceof ApiError) {
        const text = t(`error.${e.code}`);
        if (e.code === "QUEUE_COUNT_HAS_SIGNUPS" || e.code === "QUEUE_COUNT_LOCKED") {
          setQueueMsg(text);
        } else {
          setSaveMsg(text);
        }
      } else {
        setSaveMsg(t("common.wrong"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetMsg(null);
    const ok = window.confirm(t("cfg.resetConfirm"));
    if (!ok) return;
    setResetting(true);
    try {
      await moderatorResetEvent(pin);
      await reload();
      setResetMsg(t("cfg.resetDone"));
    } catch (e) {
      setResetMsg(e instanceof ApiError ? t(`error.${e.code}`) : t("common.wrong"));
    } finally {
      setResetting(false);
    }
  }

  async function handleStart() {
    setStartMsg(null);
    const ok = window.confirm(t("cfg.startConfirm"));
    if (!ok) return;
    setStarting(true);
    try {
      await moderatorStartEvent(pin);
      await reload();
    } catch (e) {
      if (e instanceof ApiError) {
        setStartMsg(t(`error.${e.code}`));
      } else {
        setStartMsg(t("common.wrong"));
      }
    } finally {
      setStarting(false);
    }
  }

  async function saveMachineNames() {
    if (!state) return;
    setSavingNames(true);
    setNamesMsg(null);
    try {
      const changed = state.queues.filter((q) => {
        const v = (machineNames[q.id] ?? "").trim();
        return v !== "" && v !== q.name;
      });
      for (const q of changed) {
        await moderatorRenameQueue(pin, q.id, machineNames[q.id].trim());
      }
      await reload();
      setNamesMsg(t("common.saved"));
    } catch (e) {
      setNamesMsg(e instanceof ApiError ? t(`error.${e.code}`) : t("common.wrong"));
    } finally {
      setSavingNames(false);
    }
  }

  // Fill the first still-default ("Machine N" / empty) machine with a suggestion.
  function applySuggestion(name: string) {
    if (!state) return;
    const isDefault = (v: string) => {
      const s = v.trim();
      return s === "" || /^Machine \d+$/i.test(s);
    };
    const target = state.queues.find((q) => isDefault(machineNames[q.id] ?? ""));
    if (target) setMachineNames((m) => ({ ...m, [target.id]: name }));
  }

  return (
    <div className="space-y-6">
      {/* Event status */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("cfg.statusTitle")}</h2>
        {eventStarted ? (
          <p className="mt-2 text-sm text-slate-700">
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              {t("cfg.started")}
            </span>{" "}
            {t("cfg.startedAt", { time: formatClockIso(state.config.started_at) })}
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-700">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {t("cfg.notStarted")}
            </span>
          </p>
        )}
      </section>

      {/* Capacity readout (P0-2) */}
      {(() => {
        const ps = state.participants;
        const waitlisted = ps.filter((p) => p.waitlisted).length;
        const promised = ps.length - waitlisted;
        return (
          <section className={card}>
            <h2 className="text-lg font-semibold text-brand">{t("cfg.capacityTitle")}</h2>
            <div className="mt-3 flex flex-wrap gap-6">
              <div>
                <div className="text-2xl font-bold tabular-nums text-emerald-700">{promised}</div>
                <div className="text-xs text-slate-500">{t("cfg.capPromised")}</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums text-amber-700">{waitlisted}</div>
                <div className="text-xs text-slate-500">{t("cfg.capWaitlisted")}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {state.config.event_end_time
                ? t("cfg.capWindowSet")
                : t("cfg.capNoEnd")}
            </p>
          </section>
        );
      })()}

      {/* Configuration form */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("cfg.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("cfg.intro")}</p>

        {/* Live current time so the start time can be set correctly. */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-slate-900 px-4 py-3 text-white">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-300">
            {t("cfg.currentTime")}
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {formatDateTime(nowMs)}
          </span>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="event_start_time">
              {t("cfg.startTime")}{" "}
              <span className="font-normal text-slate-400">{t("cfg.vnTime")}</span>
            </label>
            <input
              id="event_start_time"
              type="datetime-local"
              className={input}
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">{t("cfg.startTimeHint")}</p>
            {state.config.event_start_time && (
              <p className="mt-1 text-xs text-slate-500">
                {t("cfg.savedStart", {
                  time: formatDateTime(Date.parse(state.config.event_start_time)),
                })}
              </p>
            )}
          </div>

          <div>
            <label className={label} htmlFor="event_end_time">
              {t("cfg.endTime")}{" "}
              <span className="font-normal text-slate-400">{t("cfg.vnTime")}</span>
            </label>
            <input
              id="event_end_time"
              type="datetime-local"
              className={input}
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">{t("cfg.endHint")}</p>
          </div>

          <div>
            <label className={label} htmlFor="buffer_seconds">
              {t("cfg.buffer")}
            </label>
            <input
              id="buffer_seconds"
              type="number"
              min={0}
              className={input}
              value={bufferSeconds}
              onChange={(e) => setBufferSeconds(Number(e.target.value))}
            />
            {bufferSeconds > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                = {formatDuration(Math.max(0, Math.round(bufferSeconds)))}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">{t("cfg.bufferHint")}</p>
          </div>

          <div>
            <label className={label} htmlFor="move_grace_seconds">
              {t("cfg.moveGrace")}
            </label>
            <input
              id="move_grace_seconds"
              type="number"
              min={0}
              className={input}
              value={moveGraceSeconds}
              onChange={(e) => setMoveGraceSeconds(Number(e.target.value))}
            />
            {moveGraceSeconds > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                = {formatDuration(Math.max(0, Math.round(moveGraceSeconds)))}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">{t("cfg.moveGraceHint")}</p>
          </div>

          <div className="sm:col-span-2">
            <label className={label}>{t("cfg.durations")}</label>
            <p className="mt-0.5 text-xs text-slate-500">{t("cfg.durationsHint")}</p>
            {durations.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">{t("cfg.noDurations")}</p>
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
                      aria-label={t("cfg.removeDuration", { d: formatDuration(d) })}
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
                  {t("cfg.newDuration")}
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
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                {t("common.add")}
              </button>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="queue_count">
              {t("cfg.machines")}
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
                  {t("cfg.machinesLocked")}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">{t("cfg.machinesHint")}</p>
            {queueMsg && <p className="mt-1 text-sm text-red-600">{queueMsg}</p>}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {saveMsg && <span className="text-sm text-slate-600">{saveMsg}</span>}
        </div>
      </section>

      {/* Machine names — give each machine a fun custom name. */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("cfg.machineNamesTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("cfg.machineNamesHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">
            {t("cfg.machineNameSuggest")}
          </span>
          {SUGGESTED_MACHINE_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applySuggestion(name)}
              className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand hover:text-white"
            >
              {name}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {state.queues.map((q, i) => (
            <div key={q.id} className="flex items-center gap-3">
              <span className="w-6 shrink-0 text-center text-sm font-semibold text-slate-400">
                {i + 1}
              </span>
              <input
                type="text"
                lang="vi"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={40}
                value={machineNames[q.id] ?? ""}
                onChange={(e) =>
                  setMachineNames((m) => ({ ...m, [q.id]: e.target.value }))
                }
                placeholder={t("cfg.machineNamePlaceholder")}
                className={input}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveMachineNames()}
            disabled={savingNames}
            className="rounded-md bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {savingNames ? t("common.saving") : t("cfg.machineNamesSave")}
          </button>
          {namesMsg && <span className="text-sm text-slate-600">{namesMsg}</span>}
        </div>
      </section>

      {/* Start event */}
      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("cfg.startTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("cfg.startDesc")}</p>
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={eventStarted || state.config.event_start_time === null || starting}
          className="mt-4 rounded-xl bg-emerald-600 px-8 py-3 text-base font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {eventStarted
            ? t("cfg.startedBtn")
            : starting
              ? t("cfg.startingBtn")
              : t("cfg.startBtn")}
        </button>
        {state.config.event_start_time === null && !eventStarted && (
          <p className="mt-2 text-sm text-amber-700">{t("cfg.needStart")}</p>
        )}
        {startMsg && <p className="mt-2 text-sm text-red-600">{startMsg}</p>}
      </section>

      {/* Danger zone: restart event data */}
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-red-200">
        <h2 className="text-lg font-semibold text-red-700">{t("cfg.danger")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("cfg.dangerDesc")}</p>
        <button
          type="button"
          onClick={() => void handleReset()}
          disabled={resetting}
          className="mt-4 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resetting ? t("cfg.resetting") : t("cfg.resetBtn")}
        </button>
        {resetMsg && <p className="mt-2 text-sm text-slate-700">{resetMsg}</p>}
      </section>
    </div>
  );
}
