import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getPublicConfig, getPublicGifts, signUp } from "../lib/api";
import { formatClockIso, formatDuration } from "../lib/format";
import { useT } from "../lib/i18n";
import { DOMAINS } from "../lib/domains";
import {
  type AlertPermission,
  notificationPermission,
  requestNotificationPermission,
} from "../lib/notify";
import { unlockAudio } from "../lib/sound";
import type { Gift, SignUpResult } from "../lib/types";

interface PublicConfig {
  allowed_run_durations: number[];
  event_start_time: string | null;
  buffer_seconds: number;
}

// Email must be a valid address ending in @mblife.vn (case-insensitive).
const MBLIFE_EMAIL_RE = /^[^\s@]+@mblife\.vn$/i;

export default function SignUpPage() {
  const t = useT();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loadError, setLoadError] = useState(false);

  // Form state. `domain` is shown as "Domain / Khối/Phòng" but is still stored
  // server-side under the existing `department` key (no data/CSV break).
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
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
        const [cfg, giftList] = await Promise.all([
          getPublicConfig(),
          getPublicGifts().catch(() => [] as Gift[]), // nudge is optional; don't block sign-up
        ]);
        if (!active) return;
        setConfig({
          allowed_run_durations: cfg.allowed_run_durations,
          event_start_time: cfg.event_start_time,
          buffer_seconds: cfg.buffer_seconds,
        });
        setGifts(giftList);
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
    setDomain("");
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

    if (!MBLIFE_EMAIL_RE.test(email.trim())) {
      setEmailError(t("signup.email.mblife"));
      return;
    }
    if (durationSeconds === null) {
      setFormError(t("signup.duration.choose"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await signUp({
        name: name.trim(),
        department: domain.trim(), // internal key stays `department`
        email: email.trim(),
        run_duration_seconds: durationSeconds,
      });
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        const msg = t(`error.${err.code}`);
        if (err.code === "EMAIL_TAKEN" || err.code === "INVALID_EMAIL_DOMAIN") {
          setEmailError(msg);
        } else {
          setFormError(msg);
        }
      } else {
        setFormError(t("common.wrong"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-8 text-center">
          <img
            src="/AMZ_Time_2026.webp"
            alt=""
            aria-hidden
            className="mx-auto mb-4 h-40 w-auto drop-shadow-sm"
          />
          <h1 className="text-2xl font-bold tracking-tight text-brand">
            {t("signup.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-500">{t("signup.subtitle")}</p>
        </header>

        {loadError ? (
          <ErrorCard onRetry={() => window.location.reload()} />
        ) : config === null ? (
          <LoadingCard />
        ) : result ? (
          <ConfirmationCard result={result} gifts={gifts} onAgain={resetForm} />
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
          >
            <div className="space-y-4">
              <Field label={t("signup.name.label")}>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder={t("signup.name.placeholder")}
                />
              </Field>

              <Field label={t("signup.domain.label")}>
                <select
                  required
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className={inputClass}
                >
                  <option value="" disabled>
                    {t("signup.domain.placeholder")}
                  </option>
                  {DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("signup.email.label")} error={emailError}>
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
                  placeholder={t("signup.email.placeholder")}
                />
              </Field>

              <Field label={t("signup.duration.label")}>
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
              className="mt-6 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? t("signup.submitting") : t("signup.submit")}
            </button>

            <p className="mt-4 flex justify-center gap-4 text-center text-sm text-slate-500">
              <Link to="/status" className="font-medium text-brand underline hover:text-brand-dark">
                {t("signup.checkStatus")}
              </Link>
              <Link
                to="/leaderboard"
                className="font-medium text-brand underline hover:text-brand-dark"
              >
                {t("nav.leaderboard")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "block w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand";

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
  const t = useT();
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-3 text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand" />
        <span className="text-sm">{t("signup.loading")}</span>
      </div>
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-700">{t("signup.loadError")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
      >
        {t("signup.retry")}
      </button>
    </div>
  );
}

function ConfirmationCard({
  result,
  gifts,
  onAgain,
}: {
  result: SignUpResult;
  gifts: Gift[];
  onAgain: () => void;
}) {
  const t = useT();
  const [alertPerm, setAlertPerm] = useState<AlertPermission>(() =>
    notificationPermission(),
  );

  async function enableAlerts() {
    unlockAudio(); // gesture: permit later chimes on the status page
    setAlertPerm(await requestNotificationPermission());
  }

  // Gift message on the confirmation screen — always present, one of three cases
  // (PM feedback item 12). The gift for this run is whichever gift is mapped to
  // the runner's duration tier (gifts.duration_seconds — the single source of
  // truth, same mapping the check-out auto-suggest uses). tier_signup_count is a
  // rough proxy for eventual finishers — sign-ups still in the running (it
  // excludes no-shows and skips, who never finish).
  //
  //   1. Tier gift mapped, in stock, AND a slot is still expected for this runner
  //      → show the real remaining count.
  //   2. Tier gift exhausted by earlier sign-ups, out of stock, or none mapped
  //      → motivational message (don't promise a gift we can't deliver).
  //   3. This email already received its one gift on a prior run
  //      → motivational message (one gift per person, ever).
  const tierGift = gifts.find(
    (g) => g.duration_seconds === result.participant.run_duration_seconds,
  );
  // remaining = quota minus everyone signed up in the tier so far (this runner
  // included), capped by live stock so we never over-promise.
  const expectedRemaining =
    tierGift && Number.isFinite(result.tier_signup_count)
      ? Math.min(
          tierGift.total_quantity - result.tier_signup_count,
          tierGift.remaining_quantity,
        )
      : 0;
  let giftNudge: string;
  if (result.already_awarded === true) {
    giftNudge = t("confirm.giftAlready"); // case 3
  } else if (tierGift && tierGift.remaining_quantity > 0 && expectedRemaining > 0) {
    giftNudge = t("confirm.giftRemaining", { n: expectedRemaining, gift: tierGift.name }); // case 1
  } else {
    giftNudge = t("confirm.giftGone"); // case 2 (incl. no tier gift configured)
  }

  const start = result.estimated_start;
  let windowText: string | null = null;
  if (start) {
    const endMs = Date.parse(start) + result.buffer_seconds * 1000;
    windowText = `${formatClockIso(start)} – ${formatClockIso(new Date(endMs).toISOString())}`;
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200">
        {t("confirm.done")}
      </div>

      {result.waitlisted && (
        <div className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-300">
          <p className="font-semibold">
            <span aria-hidden>⏳ </span>
            {t("confirm.waitlist.title")}
          </p>
          <p className="mt-1">{t("confirm.waitlist.body")}</p>
        </div>
      )}

      <p className="text-sm text-slate-600">{t("confirm.machineLabel")}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-brand">
        {result.queue.name}
      </p>
      <p className="mt-1 text-xs text-slate-500">{t("confirm.machineNote")}</p>

      <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <p className="text-sm font-medium text-slate-700">{t("confirm.windowLabel")}</p>
        {windowText ? (
          <p className="mt-1 text-lg font-semibold text-slate-900">{windowText}</p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">{t("confirm.noWindow")}</p>
        )}
      </div>

      {giftNudge && (
        <p className="mt-5 rounded-xl bg-brand/5 px-4 py-3 text-sm font-medium text-brand ring-1 ring-brand/20">
          {giftNudge}
        </p>
      )}

      <p className="mt-5 text-sm text-slate-600">
        {t("confirm.statusHint")
          .split("{link}")
          .flatMap((seg, i) =>
            i === 0
              ? [seg]
              : [
                  <Link
                    key="link"
                    to="/status"
                    className="font-medium text-brand underline hover:text-brand-dark"
                  >
                    {t("confirm.statusPage")}
                  </Link>,
                  seg,
                ],
          )}
      </p>

      {alertPerm !== "unsupported" &&
        (alertPerm === "granted" ? (
          <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            {t("confirm.alertsOn")}
          </p>
        ) : alertPerm === "default" ? (
          <button
            type="button"
            onClick={() => void enableAlerts()}
            className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            {t("confirm.alertsCta")}
          </button>
        ) : null)}

      <button
        type="button"
        onClick={onAgain}
        className="mt-3 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
      >
        {t("confirm.again")}
      </button>
    </div>
  );
}
