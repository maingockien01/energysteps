import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getStatusByEmail } from "../lib/api";
import { computeProjection } from "../lib/queueLogic";
import { formatClock, formatClockIso, formatDuration } from "../lib/format";
import { useT } from "../lib/i18n";
import { card, statusPillClass } from "../lib/ui";
import { useVisibilityPolling } from "../lib/usePolling";
import {
  type AlertPermission,
  notificationPermission,
  requestNotificationPermission,
  showNotification,
} from "../lib/notify";
import { playChime, unlockAudio } from "../lib/sound";
import { getRecentEmail, setRecentEmail } from "../lib/recentEmail";
import AddToCalendar from "../components/AddToCalendar";
import type { ParticipantStatus, StatusResult } from "../lib/types";

// Notify the runner once they're within this many places of the front.
const NOTIFY_THRESHOLD = 2;
// The narrator switches to the "almost your turn" beat within this many places
// (looser than the notification cue — encouragement, not a phone buzz).
const STORY_ALMOST_AHEAD = 5;

export default function StatusPage() {
  const t = useT();
  // The text in the input box. Prefilled from the last email this device signed
  // up / looked up with, so returning participants don't have to retype it.
  const [emailInput, setEmailInput] = useState(() => getRecentEmail());
  // The email we've actually looked up (drives refetch + realtime).
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // In-tab "get ready" alerts (layer 2). See src/lib/notify.ts for the honest
  // scope: this only fires while the page is alive/foregrounded, NOT to a
  // pocketed phone with the tab suspended.
  const [alertPerm, setAlertPerm] = useState<AlertPermission>(() =>
    notificationPermission(),
  );
  const prevPosRef = useRef<number | null>(null);
  const notifiedReadyRef = useRef(false);
  const notifiedUpNextRef = useRef(false);

  async function enableAlerts() {
    unlockAudio(); // this click is our gesture to permit later chimes
    const perm = await requestNotificationPermission();
    setAlertPerm(perm);
    if (perm === "granted") playChime(1); // confirm it's audible
  }

  function statusLabel(status: ParticipantStatus): string {
    return t(`status.s.${status}`);
  }

  // Monotonic request token. The poll (30s), the on-focus refetch, and the
  // manual Refresh button all call fetchStatus into the SAME setResult, with no
  // guarantee they resolve in the order they were issued. Since this is live
  // queue data, an older in-flight response landing last would clobber fresher
  // state (e.g. show "position 2" after the runner already advanced to "up
  // next"). We stamp each call and only let the latest one write.
  const reqIdRef = useRef(0);

  // Fetch status for a given email. Used by the form, the manual Refresh
  // button, the poll, and the on-focus refetch.
  const fetchStatus = useCallback(
    async (email: string) => {
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setErrorMsg(null);
      try {
        const data = await getStatusByEmail(email);
        if (reqId !== reqIdRef.current) return; // superseded by a newer fetch
        setResult(data);
        setLastUpdated(Date.now());
      } catch (e) {
        if (reqId !== reqIdRef.current) return; // superseded; don't surface a stale error
        if (e instanceof ApiError) setErrorMsg(t(`error.${e.code}`));
        else setErrorMsg(t("common.wrong"));
      } finally {
        // Only the latest request owns the loading flag, so an early-resolving
        // older request can't flip the spinner off while a newer one runs.
        if (reqId === reqIdRef.current) setLoading(false);
      }
    },
    [t],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = emailInput.trim();
    if (!email) return;
    setRecentEmail(email); // remember for next visit (prefill + auto-look-up)
    setSubmittedEmail(email);
    void fetchStatus(email);
  }

  // Auto-look-up on first load if we remember an email — a returning participant
  // lands straight on their status instead of retyping. Runs once on mount.
  useEffect(() => {
    const saved = getRecentEmail().trim();
    if (saved) {
      setSubmittedEmail(saved);
      void fetchStatus(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onRefresh() {
    if (submittedEmail) void fetchStatus(submittedEmail);
  }

  // Collapse back to the lookup form to check a different email.
  function lookupAnother() {
    setResult(null);
    setSubmittedEmail(null);
    setEmailInput("");
  }

  // Live updates via POLLING, not realtime. Supabase Free tier caps Realtime at
  // 200 concurrent connections; with ~1000 signed-up users each holding the
  // status page open, websocket subscriptions here would be refused past 200.
  // A 30s poll is plenty: a waiting runner's position only moves when people
  // ahead of them check in/out, and runs take minutes. The initial fetch is
  // driven by onSubmit, so no `immediate` here.
  const poll = useCallback(() => {
    if (submittedEmail) void fetchStatus(submittedEmail);
  }, [submittedEmail, fetchStatus]);
  useVisibilityPolling(poll, { enabled: !!submittedEmail });

  const found = result?.found === true;
  const me = result?.me;
  const queue = result?.queue;
  const config = result?.config;
  const members = result?.queue_members;
  // Show the full participation list only when this email ran/registered more
  // than once (P—multi-signup). Single sign-ups keep the simpler view.
  const history = result?.history ?? [];
  const showHistory = history.length > 1;

  const projection =
    found && me && config && members
      ? computeProjection(
          members,
          me,
          config.event_start_time,
          config.buffer_seconds,
          config.move_grace_seconds,
        )
      : null;
  const livePosition = projection?.livePosition ?? null;
  const queueName = queue?.name ?? "";

  // Calendar reminder for a still-waiting runner, anchored to their live ETA and
  // spanning the whole turn — an OS reminder that fires with the app closed.
  const calStartMs =
    found && me && me.status !== "finished" && projection && projection.projectedStartMs !== null
      ? projection.projectedStartMs
      : null;
  const calEvent =
    calStartMs !== null && me && queue && config
      ? {
          title: t("cal.title"),
          details: t("cal.details", { url: `${window.location.origin}/status` }),
          location: queue.name,
          startMs: calStartMs,
          endMs: calStartMs + (config.buffer_seconds + me.run_duration_seconds) * 1000,
        }
      : null;

  // Stage-aware "narrator" line — one motivational beat that changes with where
  // the runner is in their journey, escalating as their turn nears. Suppressed
  // when finished (the celebration covers it) or waitlisted (its own message).
  let storyMsg: string | null = null;
  if (found && me && me.status !== "finished" && !me.waitlisted) {
    if (me.status === "checked_in") storyMsg = t("story.running");
    else if (livePosition === 1) storyMsg = t("story.upNext");
    else if (livePosition !== null && livePosition <= STORY_ALMOST_AHEAD)
      storyMsg = t("story.almost", { n: livePosition });
    else if (livePosition !== null) storyMsg = t("story.waiting", { n: livePosition });
  }

  // Reset the per-runner notification state whenever a different email is looked
  // up, so alerts apply to the newly looked-up person.
  useEffect(() => {
    prevPosRef.current = null;
    notifiedReadyRef.current = false;
    notifiedUpNextRef.current = false;
  }, [submittedEmail]);

  // Fire the in-tab cue when the runner's live position CROSSES a threshold.
  // We only act on a transition observed across two readings (prev !== null) —
  // never on the initial lookup, when the user is already looking at the page.
  useEffect(() => {
    if (alertPerm !== "granted" || livePosition === null) return;
    const prev = prevPosRef.current;
    prevPosRef.current = livePosition;

    // Re-arm if the runner moved back out of range (e.g. an edit pushed them
    // down the queue), so a later approach still alerts.
    if (livePosition > NOTIFY_THRESHOLD) notifiedReadyRef.current = false;
    if (livePosition > 1) notifiedUpNextRef.current = false;

    if (prev === null) return;
    if (livePosition === 1 && prev > 1 && !notifiedUpNextRef.current) {
      notifiedUpNextRef.current = true;
      void showNotification(
        t("notify.upNext.title"),
        t("notify.upNext.body", { machine: queueName }),
      );
      playChime(3);
    } else if (
      livePosition <= NOTIFY_THRESHOLD &&
      livePosition > 1 &&
      prev > NOTIFY_THRESHOLD &&
      !notifiedReadyRef.current
    ) {
      notifiedReadyRef.current = true;
      void showNotification(
        t("notify.getReady.title"),
        t("notify.getReady.body", { n: livePosition, machine: queueName }),
      );
      playChime(2);
    }
  }, [livePosition, alertPerm, t, queueName]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand">{t("status.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("status.subtitle")}</p>
        </header>

        {/* Lookup form. Once a status is found it collapses into a slim bar so
            the status itself is the page's focus; "change" reopens the form. */}
        {found ? (
          <div className={`${card} flex items-center justify-between gap-3`}>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">{t("status.viewingAs")}</p>
              <p className="truncate text-sm font-medium text-slate-900">{submittedEmail}</p>
            </div>
            <button
              type="button"
              onClick={lookupAnother}
              className="shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium text-brand ring-1 ring-brand/40 hover:bg-brand/10"
            >
              {t("status.changeEmail")}
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className={card}>
            <label
              htmlFor="status-email"
              className="block text-sm font-medium text-slate-700"
            >
              {t("status.email.label")}
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="status-email"
                type="email"
                required
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@mblife.vn"
                className="w-full rounded-xl border-0 px-3 py-2 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand"
              />
              <button
                type="submit"
                disabled={loading}
                className="shrink-0 rounded-xl bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {loading ? t("status.lookingUp") : t("status.lookup")}
              </button>
            </div>
          </form>
        )}

        {errorMsg && (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {errorMsg}
          </p>
        )}

        {/* Not found */}
        {result && !found && !errorMsg && (
          <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-slate-700 shadow-sm ring-1 ring-slate-200">
            {t("status.notFound")}
          </p>
        )}

        {/* Status card */}
        {found && me && queue && projection && (
          <div className="mt-6 space-y-4">
            {/* Live indicator: reassures the user the page refreshes itself, so
                they don't reflexively hit the Refresh button at the bottom. */}
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              {t("status.autoUpdating")}
            </div>

            {/* Stage-aware narrator line (motivation, escalates with proximity). */}
            {storyMsg && (
              <p className="text-center text-sm font-medium text-brand">{storyMsg}</p>
            )}

            {/* Post-run celebration (P2-1) */}
            {me.status === "finished" && (
              <div
                role="status"
                className="rounded-2xl bg-emerald-50 p-5 text-center shadow-sm ring-1 ring-emerald-300"
              >
                <p className="text-3xl" aria-hidden>
                  🎉
                </p>
                <p className="mt-1 text-xl font-bold text-emerald-900">
                  {t("status.finished.title")}
                </p>
                {me.distance_logged !== null && (
                  <p className="mt-2 text-3xl font-extrabold tabular-nums text-emerald-800">
                    {t("lb.meters", { n: me.distance_logged })}
                  </p>
                )}
                <p className="mt-2 text-sm font-medium text-emerald-800">
                  {t("status.finished.teamImpact")}
                </p>
                {me.gift_name && (
                  <p className="mt-2 text-sm text-emerald-800">
                    🎁 {t("status.finished.gift", { gift: me.gift_name })}
                  </p>
                )}
                <Link
                  to="/leaderboard"
                  className="mt-4 inline-block text-sm font-medium text-emerald-700 underline hover:text-emerald-900"
                >
                  {t("status.finished.leaderboard")}
                </Link>
              </div>
            )}

            {/* Waitlist notice (P0-2) */}
            {me.status !== "finished" && me.waitlisted && (
              <div
                role="status"
                className="rounded-2xl bg-amber-50 p-5 text-center shadow-sm ring-1 ring-amber-300"
              >
                <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
                  <span aria-hidden>⏳ </span>
                  {t("status.waitlist.tag")}
                </p>
                <p className="mt-2 text-sm text-amber-900">{t("status.waitlist.body")}</p>
              </div>
            )}

            {/* Reminder options (alerts + calendar) are merged into one card
                below the details — see "Get reminded". */}

            {/* Delay / on-schedule banner. aria-live so screen readers announce
                a change; ✓/⚠ icons so the state is not conveyed by color alone. */}
            {me.status !== "finished" &&
              projection.projectedStartMs !== null &&
              (projection.isDelayed ? (
                <div
                  role="status"
                  aria-live="assertive"
                  className="rounded-2xl bg-amber-50 p-5 text-center shadow-sm ring-1 ring-amber-300"
                >
                  <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
                    <span aria-hidden>⚠ </span>
                    {t("status.behind.tag")}
                  </p>
                  <p className="mt-2 text-2xl font-bold text-amber-900">
                    {t("status.behind.headline", { n: projection.delayMinutes })}
                  </p>
                  <p className="mt-2 text-base text-amber-800">
                    {t("status.behind.newEta", {
                      time: formatClock(projection.projectedStartMs),
                    })}
                  </p>
                </div>
              ) : (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-2xl bg-emerald-50 p-5 text-center shadow-sm ring-1 ring-emerald-300"
                >
                  <p className="text-lg font-semibold text-emerald-800">
                    <span aria-hidden>✓ </span>
                    {t("status.onSchedule")}
                  </p>
                  <p className="mt-1 text-sm text-emerald-700">
                    {t("status.onSchedule.eta", {
                      time: formatClock(projection.projectedStartMs),
                    })}
                  </p>
                </div>
              ))}

            {/* Main details card */}
            <div className={card}>
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    {t("status.assignedMachine")}
                  </dt>
                  <dd className="text-lg font-semibold text-slate-900">
                    {queue.name}
                  </dd>
                </div>

                {projection.projectedStartMs !== null ? (
                  <div>
                    <dt className="text-sm font-medium text-slate-500">
                      {t("status.position")}
                    </dt>
                    <dd className="text-lg font-semibold text-slate-900">
                      {projection.livePosition}
                      {projection.livePosition === 1 && (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {t("status.upNext")}
                        </span>
                      )}
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt className="text-sm font-medium text-slate-500">
                      {t("status.statusLabel")}
                    </dt>
                    <dd className="text-lg font-semibold text-slate-900">
                      {statusLabel(me.status)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Get reminded — one card for both ways to be alerted before your
                turn: an in-page alert (only while this tab is open) and an
                add-to-calendar reminder (works with the app closed). */}
            {me.status !== "finished" &&
              (calEvent || (livePosition !== null && alertPerm !== "unsupported")) && (
                <div className={card}>
                  <p className="text-sm font-semibold text-slate-900">{t("remind.title")}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{t("remind.subtitle")}</p>
                  <div className="mt-3 divide-y divide-slate-100">
                    {/* Method 1 — in-page alert */}
                    {livePosition !== null && alertPerm !== "unsupported" && (
                      <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">
                            🔔 {t("remind.alertTitle")}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {alertPerm === "denied" ? t("notify.denied") : t("notify.keepOpen")}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {alertPerm === "granted" ? (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              {t("remind.alertEnabled")}
                            </span>
                          ) : alertPerm === "default" ? (
                            <button
                              type="button"
                              onClick={() => void enableAlerts()}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-brand ring-1 ring-brand/40 hover:bg-brand/10"
                            >
                              🔔 {t("remind.alertOn")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                    {/* Method 2 — add to calendar */}
                    {calEvent && (
                      <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">
                            📅 {t("remind.calTitle")}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">{t("remind.calDesc")}</p>
                        </div>
                        <div className="shrink-0">
                          <AddToCalendar event={calEvent} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            {/* Participation history — all results for multi-time runners. */}
            {showHistory && (
              <div className={card}>
                <h2 className="text-sm font-semibold text-slate-900">
                  {t("status.history.title", { n: history.length })}
                </h2>
                <ul className="mt-3 divide-y divide-slate-100">
                  {history.map((h) => (
                    <li key={h.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(
                              h.status,
                            )}`}
                          >
                            {t(`st.${h.status}`)}
                          </span>
                          {h.id === me?.id && (
                            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                              {t("status.history.current")}
                            </span>
                          )}
                        </div>
                        {h.status === "finished" && h.distance_logged !== null && (
                          <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                            {t("lb.meters", { n: h.distance_logged })}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[
                          h.queue_name,
                          formatDuration(h.run_duration_seconds),
                          h.actual_finish
                            ? t("status.history.finishedAt", {
                                time: formatClockIso(h.actual_finish),
                              })
                            : null,
                          h.gift_name
                            ? t("status.finished.gift", { gift: h.gift_name })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Refresh + last-updated */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {lastUpdated !== null
                  ? t("status.updated", { time: formatClock(lastUpdated) })
                  : ""}
              </span>
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="rounded-xl px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 disabled:opacity-50"
              >
                {loading ? t("status.refreshing") : t("common.refresh")}
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-center gap-4 text-center">
          <Link to="/" className="text-sm text-brand underline hover:text-brand-dark">
            {t("status.back")}
          </Link>
          <Link
            to="/leaderboard"
            className="text-sm text-brand underline hover:text-brand-dark"
          >
            {t("nav.leaderboard")}
          </Link>
        </div>
      </div>
    </div>
  );
}
