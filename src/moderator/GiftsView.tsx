// Gift CRUD for the moderator console: list gifts with remaining/total stock,
// create new gifts, edit name + quantities, and delete with confirmation.
import { useState } from "react";
import { useModerator } from "./context";
import {
  ApiError,
  errorMessage,
  moderatorCreateGift,
  moderatorDeleteGift,
  moderatorUpdateGift,
} from "../lib/api";
import type { Gift } from "../lib/types";

// Parse a string as a non-negative integer; returns null if invalid.
function parseNonNegInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default function GiftsView() {
  const { state, pin, reload } = useModerator();

  // Create form.
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit form.
  const [editing, setEditing] = useState<Gift | null>(null);
  const [editName, setEditName] = useState("");
  const [editTotal, setEditTotal] = useState("");
  const [editRemaining, setEditRemaining] = useState("");
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  if (!state) {
    return <div className="text-slate-400">Loading gifts…</div>;
  }

  const { gifts } = state;

  async function create() {
    const name = newName.trim();
    const qty = parseNonNegInt(newQty);
    if (!name) {
      setCreateMsg("Gift name is required.");
      return;
    }
    if (qty === null) {
      setCreateMsg("Quantity must be a non-negative whole number.");
      return;
    }
    setCreating(true);
    setCreateMsg(null);
    try {
      await moderatorCreateGift(pin, name, qty);
      await reload();
      setNewName("");
      setNewQty("");
    } catch (e) {
      if (e instanceof ApiError) setCreateMsg(errorMessage(e.code));
      else setCreateMsg("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(g: Gift) {
    setEditing(g);
    setEditName(g.name);
    setEditTotal(String(g.total_quantity));
    setEditRemaining(String(g.remaining_quantity));
    setEditMsg(null);
  }

  function closeEdit() {
    setEditing(null);
    setEditMsg(null);
  }

  async function saveEdit() {
    if (!editing) return;
    const name = editName.trim();
    const total = parseNonNegInt(editTotal);
    const remaining = parseNonNegInt(editRemaining);
    if (!name) {
      setEditMsg("Gift name is required.");
      return;
    }
    if (total === null || remaining === null) {
      setEditMsg("Quantities must be non-negative whole numbers.");
      return;
    }
    if (remaining > total) {
      setEditMsg("Remaining quantity cannot exceed the total quantity.");
      return;
    }
    setSavingEdit(true);
    setEditMsg(null);
    try {
      await moderatorUpdateGift(pin, editing.id, {
        name,
        total_quantity: total,
        remaining_quantity: remaining,
      });
      await reload();
      setEditing(null);
    } catch (e) {
      if (e instanceof ApiError) setEditMsg(errorMessage(e.code));
      else setEditMsg("Something went wrong. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(g: Gift) {
    if (!window.confirm(`Delete "${g.name}"? This cannot be undone.`)) return;
    setBusyId(g.id);
    try {
      await moderatorDeleteGift(pin, g.id);
      await reload();
      if (editing?.id === g.id) setEditing(null);
    } catch (e) {
      if (e instanceof ApiError) window.alert(errorMessage(e.code));
      else window.alert("Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Create */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-semibold text-slate-900">Add a gift</div>
        {createMsg && (
          <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
            {createMsg}
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Water bottle"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Quantity</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none sm:w-32"
            />
          </label>
          <button
            disabled={creating}
            onClick={() => void create()}
            className="rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add gift"}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {gifts.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No gifts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Gift</th>
                  <th className="px-4 py-3">Remaining / Total</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gifts.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {g.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {g.remaining_quantity} / {g.total_quantity}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={busyId === g.id}
                          onClick={() => openEdit(g)}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          disabled={busyId === g.id}
                          onClick={() => void remove(g)}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
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
            <div className="text-lg font-semibold text-slate-900">Edit gift</div>

            {editMsg && (
              <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
                {editMsg}
              </div>
            )}

            <div className="mt-4 grid gap-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Name</span>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Total quantity
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={editTotal}
                    onChange={(e) => setEditTotal(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Remaining quantity
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={editRemaining}
                    onChange={(e) => setEditRemaining(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                disabled={savingEdit}
                onClick={closeEdit}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={savingEdit}
                onClick={() => void saveEdit()}
                className="rounded-xl bg-slate-900 px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {savingEdit ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
