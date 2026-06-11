// Searchable runner management. Filter participants by name/email, view their
// assigned machine (read-only) and details, and edit name/department/email/run
// duration via an inline modal. There is intentionally NO control to reassign a
// runner's machine/queue.
import { useMemo, useState } from "react";
import { useModerator } from "./context";
import { ApiError, errorMessage, moderatorUpdateParticipant } from "../lib/api";
import { formatDuration } from "../lib/format";
import type { Participant } from "../lib/types";

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

export default function RunnersView() {
  const { state, pin, reload } = useModerator();

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Participant | null>(null);

  // Edit-form fields.
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
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
    const q = query.trim().toLowerCase();
    const list = [...state.participants].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (q === "") return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    );
  }, [state, query]);

  if (!state) {
    return <div className="text-slate-400">Loading runners…</div>;
  }

  const allowedDurations = state.config.allowed_run_durations;

  function openEdit(p: Participant) {
    setEditing(p);
    setName(p.name);
    setDepartment(p.department);
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
    const trimmedDept = department.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedDept || !trimmedEmail) {
      setMsg("Name, department and email are required.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await moderatorUpdateParticipant(pin, editing.id, {
        name: trimmedName,
        department: trimmedDept,
        email: trimmedEmail,
        run_duration_seconds: duration,
      });
      await reload();
      setEditing(null);
    } catch (e) {
      if (e instanceof ApiError) setMsg(errorMessage(e.code));
      else setMsg("Something went wrong. Please try again.");
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
            Search runners
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or email…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
          />
        </label>
        <div className="mt-2 text-xs text-slate-500">
          {filtered.length} of {state.participants.length} runners
        </div>
      </div>

      {/* Runner list */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            {state.participants.length === 0
              ? "No runners have signed up yet."
              : "No runners match your search."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Machine</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Edit</th>
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
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(
                          p.status,
                        )}`}
                      >
                        {statusLabel(p.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(p)}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
                      >
                        Edit
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
              Edit runner
            </div>
            <div className="mt-1 text-sm text-slate-500">
              Machine: {queueName.get(editing.assigned_queue_id) ?? "—"}{" "}
              (cannot be changed)
            </div>

            {msg && (
              <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
                {msg}
              </div>
            )}

            <div className="mt-4 grid gap-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Department
                </span>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Run duration
                </span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
                >
                  {/* Keep the current value selectable even if no longer in the
                      allowed list, so the select never silently mutates it. */}
                  {!allowedDurations.includes(duration) && (
                    <option value={duration}>
                      {formatDuration(duration)} (current)
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
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => void save()}
                className="rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
