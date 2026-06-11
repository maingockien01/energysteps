import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, errorMessage, getPublicConfig, signUp } from "../lib/api";
import { formatClockIso, formatDuration } from "../lib/format";
import type { SignUpResult } from "../lib/types";

interface PublicConfig {
  allowed_run_durations: number[];
  event_start_time: string | null;
  buffer_seconds: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUpPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [email, setEmail] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [result, setResult] = useState<SignUpResult | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await getPublicConfig();
        if (!active) return;
        setConfig({
          allowed_run_durations: cfg.allowed_run_durations,
          event_start_time: cfg.event_start_time,
          buffer_seconds: cfg.buffer_seconds,
        });
        setDurationSeconds(cfg.allowed_run_durations[0] ?? null);
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function resetForm() {
    setName("");
    setDepartment("");
    setEmail("");
    setDurationSeconds(config?.allowed_run_durations[0] ?? null);
    setFormError(null);
    setEmailError(null);
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setEmailError(null);

    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    if (durationSeconds === null) {
      setFormError("Please choose a run duration.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await signUp({
        name: name.trim(),
        department: department.trim(),
        email: email.trim(),
        run_duration_seconds: durationSeconds,
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = errorMessage(err.code);
        if (err.code === "EMAIL_TAKEN") {
          setEmailError(msg);
        } else {
          setFormError(msg);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            EnergySteps — Sign up to run
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Reserve your spot, pick a run length, and we&rsquo;ll assign you a machine.
          </p>
        </header>

        {loadError ? (
          <ErrorCard onRetry={() => window.location.reload()} />
        ) : config === null ? (
          <LoadingCard />
        ) : result ? (
          <ConfirmationCard result={result} onAgain={resetForm} />
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
          >
            <div className="space-y-4">
              <Field label="Name">
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="Your name"
                />
              </Field>

              <Field label="Department">
                <input
                  type="text"
                  required
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className={inputClass}
                  placeholder="Your team or department"
                />
              </Field>

              <Field label="Email" error={emailError}>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  aria-invalid={emailError ? true : undefined}
                  className={emailError ? inputClassError : inputClass}
                  placeholder="you@example.com"
                />
              </Field>

              <Field label="Run duration">
                <select
                  required
                  value={durationSeconds ?? ""}
                  onChange={(e) => setDurationSeconds(Number(e.target.value))}
                  className={inputClass}
                >
                  {config.allowed_run_durations.map((secs) => (
                    <option key={secs} value={secs}>
                      {formatDuration(secs)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {formError && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing up…" : "Sign up"}
            </button>

            <p className="mt-4 text-center text-sm text-slate-500">
              <Link to="/status" className="font-medium text-slate-700 underline hover:text-slate-900">
                Check my status
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "block w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-slate-900";

const inputClassError =
  "block w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-red-400 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-red-500";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-red-600">{error}</span>}
    </label>
  );
}

function LoadingCard() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-3 text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
        <span className="text-sm">Loading sign-up form…</span>
      </div>
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-700">
        We couldn&rsquo;t load the sign-up form right now. Please try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        Retry
      </button>
    </div>
  );
}

function ConfirmationCard({
  result,
  onAgain,
}: {
  result: SignUpResult;
  onAgain: () => void;
}) {
  const start = result.estimated_start;
  let windowText: string | null = null;
  if (start) {
    const endMs = Date.parse(start) + result.buffer_seconds * 1000;
    windowText = `${formatClockIso(start)} – ${formatClockIso(new Date(endMs).toISOString())}`;
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
        You&rsquo;re signed up!
      </div>

      <p className="text-sm text-slate-600">Your assigned machine:</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
        {result.queue.name}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        This machine is yours for the event — it won&rsquo;t change.
      </p>

      <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <p className="text-sm font-medium text-slate-700">Estimated check-in window</p>
        {windowText ? (
          <p className="mt-1 text-lg font-semibold text-slate-900">{windowText}</p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Your estimated time will be available once the organizer sets the event
            start time — check the status page later.
          </p>
        )}
      </div>

      <p className="mt-5 text-sm text-slate-600">
        You can return anytime to look up your status by email on the{" "}
        <Link to="/status" className="font-medium text-slate-700 underline hover:text-slate-900">
          status page
        </Link>
        .
      </p>

      <button
        type="button"
        onClick={onAgain}
        className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        Sign up someone else
      </button>
    </div>
  );
}
