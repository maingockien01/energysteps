// Searchable Amazer (registration) management. Filter participants by
// name/email, view their assigned machine (read-only) and details including
// registration time, and edit name/domain/email/run duration via an inline
// modal. There is intentionally NO control to reassign a runner's machine/queue.
import { useMemo, useState } from "react";
import { useModerator } from "./context";
import { ApiError, moderatorUpdateParticipant } from "../lib/api";
import { formatDateTimeNumericIso, formatDuration } from "../lib/format";
import { useT } from "../lib/i18n";
import { matchesVN } from "../lib/text";
import { statusPillClass } from "../lib/ui";
import type { Participant } from "../lib/types";

export default function RunnersView() {
  const t = useT();
  const { state, pin, reload } = useModerator();

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Participant | null>(null);

  // Edit-form fields.
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [duration, setDuration] = useState<number>(0);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const queueName = useMemo(() => {
    const map = new Map<string, string>();
    if (state) for (const q of state.queues) map.set(q.id, q.name);
    return map;
  }, [state]);

  const filtered = useMemo(() => {
    if (!state) return [];
    const q = query.trim();
    // Most-recent registrations first.
    const list = [...state.participants].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    if (q === "") return list;
    // Accent-insensitive so "nguyen" matches "Nguyễn" (Vietnamese input).
    return list.filter((p) => matchesVN(p.name, q) || matchesVN(p.email, q));
  }, [state, query]);

  if (!state) {
    return <div className="text-slate-400">{t("reg.loading")}</div>;
  }

  const allowedDurations = state.config.allowed_run_durations;

  function openEdit(p: Participant) {
    setEditing(p);
    setName(p.name);
    setDomain(p.department);
    setEmail(p.email);
    setDuration(p.run_duration_seconds);
    setMsg(null);
  }

  function closeEdit() {
    setEditing(null);
    setMsg(null);
  }

  async function save() {
    if (!editing) return;
    const trimmedName = name.trim();
    const trimmedDomain = domain.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedDomain || !trimmedEmail) {
      setMsg(t("reg.required"));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await moderatorUpdateParticipant(pin, editing.id, {
        name: trimmedName,
        department: trimmedDomain,
        email: trimmedEmail,
        run_duration_seconds: duration,
      });
      await reload();
      setEditing(null);
    } catch (e) {
      if (e instanceof ApiError) setMsg(t(`error.${e.code}`));
      else setMsg(t("common.wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            {t("reg.search.label")}
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("reg.search.placeholder")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
          />
        </label>
        <div className="mt-2 text-xs text-slate-500">
          {t("reg.count", { shown: filtered.length, total: state.participants.length })}
        </div>
      </div>

      {/* Amazer list */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            {state.participants.length === 0 ? t("reg.empty") : t("reg.noMatch")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">{t("reg.col.name")}</th>
                  <th className="px-4 py-3">{t("reg.col.domain")}</th>
                  <th className="px-4 py-3">{t("reg.col.email")}</th>
                  <th className="px-4 py-3">{t("reg.col.machine")}</th>
                  <th className="px-4 py-3">{t("reg.col.duration")}</th>
                  <th className="px-4 py-3">{t("reg.col.regTime")}</th>
                  <th className="px-4 py-3">{t("reg.col.status")}</th>
                  <th className="px-4 py-3 text-right">{t("reg.col.edit")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {p.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.department}</td>
                    <td className="px-4 py-3 text-slate-600">{p.email}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {queueName.get(p.assigned_queue_id) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDuration(p.run_duration_seconds)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDateTimeNumericIso(p.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(
                          p.status,
                        )}`}
                      >
                        {t(`st.${p.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(p)}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                      >
                        {t("common.edit")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-12 w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
            <div className="text-lg font-semibold text-slate-900">
              {t("reg.editTitle")}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {t("reg.machineFixed", {
                machine: queueName.get(editing.assigned_queue_id) ?? "—",
              })}
            </div>

            {msg && (
              <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
                {msg}
              </div>
            )}

            <div className="mt-4 grid gap-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("reg.col.name")}
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("reg.col.domain")}
                </span>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("reg.col.email")}
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("signup.duration.label")}
                </span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                >
                  {/* Keep the current value selectable even if no longer in the
                      allowed list, so the select never silently mutates it. */}
                  {!allowedDurations.includes(duration) && (
                    <option value={duration}>
                      {t("reg.current", { d: formatDuration(duration) })}
                    </option>
                  )}
                  {allowedDurations.map((d) => (
                    <option key={d} value={d}>
                      {formatDuration(d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                disabled={busy}
                onClick={closeEdit}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                disabled={busy}
                onClick={() => void save()}
                className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
              >
                {busy ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
