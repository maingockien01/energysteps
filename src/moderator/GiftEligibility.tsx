// Derived "gifts by duration tier" panel (spec B.5). Read-only: for each tier
// (2/3/5 min) it ranks the FINISHERS of that tier by finish time and marks the
// first N as gift recipients, where N is the matching gift's total quantity.
// It does NOT write anything — the actual gift hand-out stays manual at
// check-out. "Completion" = status 'finished' (with an actual_finish time).
import { useModerator } from "./context";
import { formatDateTimeNumericIso, formatDuration } from "../lib/format";
import { GIFT_TIERS } from "../lib/gifts";
import { useT } from "../lib/i18n";
import type { Participant } from "../lib/types";

export default function GiftEligibility() {
  const t = useT();
  const { state } = useModerator();
  if (!state) return null;

  // Match a tier's gift by name (case-insensitive) to read its live total.
  const giftByName = new Map(
    state.gifts.map((g) => [g.name.trim().toLowerCase(), g]),
  );

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold text-brand">{t("elig.title")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("elig.subtitle", { n: "N" })}</p>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {GIFT_TIERS.map((tier) => {
          const gift = giftByName.get(tier.giftName.trim().toLowerCase());
          const total = gift?.total_quantity ?? tier.quantity;

          // Finishers in this tier, ranked by finish time (earliest first).
          const finishers: Participant[] = state.participants
            .filter(
              (p) =>
                p.run_duration_seconds === tier.seconds &&
                p.status === "finished" &&
                p.actual_finish !== null,
            )
            .sort(
              (a, b) =>
                Date.parse(a.actual_finish as string) -
                Date.parse(b.actual_finish as string),
            );

          const awarded = Math.min(finishers.length, total);
          const left = Math.max(total - awarded, 0);

          return (
            <div
              key={tier.seconds}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-slate-900">
                  {t("elig.tier", { d: formatDuration(tier.seconds) })}
                </div>
                <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
                  {t("elig.giftFor", { gift: tier.giftName })}
                </span>
              </div>

              <div className="mt-1 text-xs text-slate-500">
                {t("elig.slots", { taken: awarded, total, left })}
              </div>

              {!gift && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {t("elig.noTierGift", { gift: tier.giftName })}
                </div>
              )}

              {finishers.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  {t("elig.noFinishers")}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {finishers.map((p, i) => {
                    const isAwarded = i < total;
                    return (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-5 text-xs font-semibold text-slate-400">
                              {i + 1}
                            </span>
                            <span className="truncate text-sm font-medium text-slate-900">
                              {p.name}
                            </span>
                          </div>
                          <div className="ml-7 text-xs text-slate-500">
                            {t("elig.finishedAt")}:{" "}
                            {formatDateTimeNumericIso(p.actual_finish)}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            isAwarded
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {isAwarded ? t("elig.awarded") : t("elig.waitlist")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
