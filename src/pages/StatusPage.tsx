import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getStatusByEmail } from "../lib/api";
import { computeProjection } from "../lib/queueLogic";
import { formatClock } from "../lib/format";
import { useT, LangToggle } from "../lib/i18n";
import type { ParticipantStatus, StatusResult } from "../lib/types";

export default function StatusPage() {
  const t = useT();
  // The text in the input box.
  const [emailInput, setEmailInput] = useState("");
  // The email we've actually looked up (drives refetch + realtime).
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  function statusLabel(status: ParticipantStatus): string {
    return t(`status.s.${status}`);
  }

  // Fetch status for a given email. Used by the form, the manual Refresh
  // button, and the realtime subscription.
  const fetchStatus = useCallback(
    async (email: string) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const data = await getStatusByEmail(email);
        setResult(data);
        setLastUpdated(Date.now());
      } catch (e) {
        if (e instanceof ApiError) setErrorMsg(t(`error.${e.code}`));
        else setErrorMsg(t("common.wrong"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = emailInput.trim();
    if (!email) return;
    setSubmittedEmail(email);
    void fetchStatus(email);
  }

  function onRefresh() {
    if (submittedEmail) void fetchStatus(submittedEmail);
  }

  // Live updates via POLLING, not realtime. Supabase Free tier caps Realtime at
  // 200 concurrent connections; with ~1000 signed-up users each holding the
  // status page open, websocket subscriptions here would be refused past 200.
  // A 30s poll is plenty: a waiting runner's position only moves when people
  // ahead of them check in/out, and runs take minutes. We only poll while the
  // tab is visible (no point hammering the DB for backgrounded phones), and
  // fetch immediately on regaining focus so a returning user sees fresh data.
  const POLL_INTERVAL_MS = 30_000;
  useEffect(() => {
    if (!submittedEmail) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => void fetchStatus(submittedEmail), POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchStatus(submittedEmail); // refresh immediately on focus
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [submittedEmail, fetchStatus]);

  const found = result?.found === true;
  const me = result?.me;
  const queue = result?.queue;
  const config = result?.config;
  const members = result?.queue_members;

  const projection =
    found && me && config && members
      ? computeProjection(
          members,
          me,
          config.event_start_time,
          config.buffer_seconds,
        )
      : null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-4 flex justify-end">
          <LangToggle />
        </div>
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand">{t("status.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("status.subtitle")}</p>
        </header>

        {/* Lookup form */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
        >
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
            {/* Delay / on-schedule banner */}
            {projection.projectedStartMs !== null &&
              (projection.isDelayed ? (
                <div className="rounded-2xl bg-amber-50 p-6 text-center shadow-sm ring-2 ring-amber-400">
                  <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
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
                <div className="rounded-2xl bg-emerald-50 p-5 text-center shadow-sm ring-1 ring-emerald-200">
                  <p className="text-lg font-semibold text-emerald-800">
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
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    {t("status.assignedMachine")}
                  </dt>
                  <dd className="text-lg font-semibold text-slate-900">
                    {queue.name}
                  </dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    {t("status.originalEta")}
                  </dt>
                  <dd className="text-lg font-semibold text-slate-900">
                    {me.original_estimated_start
                      ? formatClock(Date.parse(me.original_estimated_start))
                      : t("status.setAtStart")}
                  </dd>
                </div>

                {projection.projectedStartMs !== null ? (
                  <>
                    <div>
                      <dt className="text-sm font-medium text-slate-500">
                        {t("status.currentEta")}
                      </dt>
                      <dd className="text-lg font-semibold text-slate-900">
                        {formatClock(projection.projectedStartMs)}
                      </dd>
                    </div>
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
                  </>
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

        <div className="mt-8 text-center">
          <Link to="/" className="text-sm text-brand underline hover:text-brand-dark">
            {t("status.back")}
          </Link>
        </div>
      </div>
    </div>
  );
}
