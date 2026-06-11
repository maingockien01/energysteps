import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, errorMessage, getStatusByEmail } from "../lib/api";
import { computeProjection } from "../lib/queueLogic";
import { subscribeToChanges } from "../lib/realtime";
import { formatClock, formatClockIso } from "../lib/format";
import type { ParticipantStatus, StatusResult } from "../lib/types";

function statusLabel(status: ParticipantStatus): string {
  switch (status) {
    case "finished":
      return "You've finished — great job!";
    case "skipped":
      return "Your slot was skipped.";
    case "no_show":
      return "Marked as no-show.";
    case "checked_in":
      return "You're checked in — you're up!";
    default:
      return "You're in the queue.";
  }
}

export default function StatusPage() {
  // The text in the input box.
  const [emailInput, setEmailInput] = useState("");
  // The email we've actually looked up (drives refetch + realtime).
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Fetch status for a given email. Used by the form, the manual Refresh
  // button, and the realtime subscription.
  const fetchStatus = useCallback(async (email: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await getStatusByEmail(email);
      setResult(data);
      setLastUpdated(Date.now());
    } catch (e) {
      if (e instanceof ApiError) setErrorMsg(errorMessage(e.code));
      else setErrorMsg("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  // Live updates: only subscribe once an email has been looked up. Re-fetch the
  // stored email whenever anything changes upstream.
  useEffect(() => {
    if (!submittedEmail) return;
    const unsub = subscribeToChanges(() => {
      void fetchStatus(submittedEmail);
    });
    return unsub;
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
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">
            EnergySteps — My status
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Look up your spot in line and your projected check-in time.
          </p>
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
            Email
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="status-email"
              type="email"
              required
              autoComplete="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border-0 px-3 py-2 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-slate-900"
            />
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Looking up…" : "Look up"}
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
            No sign-up found for that email.
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
                    Running behind
                  </p>
                  <p className="mt-2 text-2xl font-bold text-amber-900">
                    Running ~
                    <span className="text-4xl">{projection.delayMinutes}</span>{" "}
                    minutes behind
                  </p>
                  <p className="mt-2 text-base text-amber-800">
                    Your new estimated check-in is{" "}
                    <span className="font-bold">
                      {formatClock(projection.projectedStartMs)}
                    </span>
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl bg-emerald-50 p-5 text-center shadow-sm ring-1 ring-emerald-200">
                  <p className="text-lg font-semibold text-emerald-800">
                    On schedule
                  </p>
                  <p className="mt-1 text-sm text-emerald-700">
                    Estimated check-in at{" "}
                    <span className="font-semibold">
                      {formatClock(projection.projectedStartMs)}
                    </span>
                  </p>
                </div>
              ))}

            {/* Main details card */}
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    Assigned machine
                  </dt>
                  <dd className="text-lg font-semibold text-slate-900">
                    {queue.name}
                  </dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-slate-500">
                    Original estimated start
                  </dt>
                  <dd className="text-lg font-semibold text-slate-900">
                    {me.original_estimated_start
                      ? formatClockIso(me.original_estimated_start)
                      : "Set when the event starts"}
                  </dd>
                </div>

                {projection.projectedStartMs !== null ? (
                  <>
                    <div>
                      <dt className="text-sm font-medium text-slate-500">
                        Current projected start
                      </dt>
                      <dd className="text-lg font-semibold text-slate-900">
                        {formatClock(projection.projectedStartMs)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-slate-500">
                        Position in line
                      </dt>
                      <dd className="text-lg font-semibold text-slate-900">
                        {projection.livePosition}
                        {projection.livePosition === 1 && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Up next
                          </span>
                        )}
                      </dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt className="text-sm font-medium text-slate-500">
                      Status
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
                  ? `Updated ${formatClock(lastUpdated)}`
                  : ""}
              </span>
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="rounded-xl px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 disabled:opacity-50"
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link to="/" className="text-sm text-slate-600 underline hover:text-slate-900">
            ← Back to sign-up
          </Link>
        </div>
      </div>
    </div>
  );
}
