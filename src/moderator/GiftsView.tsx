// Gift management for the moderator console: a derived "gifts by duration tier"
// eligibility panel (who gets what / slots left), plus gift CRUD — list gifts
// with remaining/total stock, create, edit name + quantities, delete.
import { useState } from "react";
import { useModerator } from "./context";
import {
  ApiError,
  moderatorCreateGift,
  moderatorDeleteGift,
  moderatorUpdateGift,
} from "../lib/api";
import { formatDuration } from "../lib/format";
import { useT } from "../lib/i18n";
import GiftEligibility from "./GiftEligibility";
import type { Gift } from "../lib/types";

// "" (no tier) <-> null; a numeric string <-> that many seconds.
function parseTier(value: string): number | null {
  return value === "" ? null : Number(value);
}

// Parse a string as a non-negative integer; returns null if invalid.
function parseNonNegInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default function GiftsView() {
  const t = useT();
  const { state, pin, reload } = useModerator();

  // Create form.
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newTier, setNewTier] = useState("");
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit form.
  const [editing, setEditing] = useState<Gift | null>(null);
  const [editName, setEditName] = useState("");
  const [editTotal, setEditTotal] = useState("");
  const [editRemaining, setEditRemaining] = useState("");
  const [editTier, setEditTier] = useState("");
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  if (!state) {
    return <div className="text-slate-400">{t("gift.loading")}</div>;
  }

  const { gifts } = state;
  const tiers = [...state.config.allowed_run_durations].sort((a, b) => a - b);
  const tierLabel = (secs: number | null) =>
    secs === null ? t("gift.tierNone") : formatDuration(secs);

  async function create() {
    const name = newName.trim();
    const qty = parseNonNegInt(newQty);
    if (!name) {
      setCreateMsg(t("gift.nameRequired"));
      return;
    }
    if (qty === null) {
      setCreateMsg(t("gift.qtyInvalid"));
      return;
    }
    setCreating(true);
    setCreateMsg(null);
    try {
      await moderatorCreateGift(pin, name, qty, parseTier(newTier));
      await reload();
      setNewName("");
      setNewQty("");
      setNewTier("");
    } catch (e) {
      if (e instanceof ApiError) setCreateMsg(t(`error.${e.code}`));
      else setCreateMsg(t("common.wrong"));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(g: Gift) {
    setEditing(g);
    setEditName(g.name);
    setEditTotal(String(g.total_quantity));
    setEditRemaining(String(g.remaining_quantity));
    setEditTier(g.duration_seconds === null ? "" : String(g.duration_seconds));
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
      setEditMsg(t("gift.nameRequired"));
      return;
    }
    if (total === null || remaining === null) {
      setEditMsg(t("gift.qtyNonNeg"));
      return;
    }
    if (remaining > total) {
      setEditMsg(t("gift.remGtTotal"));
      return;
    }
    setSavingEdit(true);
    setEditMsg(null);
    try {
      await moderatorUpdateGift(pin, editing.id, {
        name,
        total_quantity: total,
        remaining_quantity: remaining,
        duration_seconds: parseTier(editTier),
      });
      await reload();
      setEditing(null);
    } catch (e) {
      if (e instanceof ApiError) setEditMsg(t(`error.${e.code}`));
      else setEditMsg(t("common.wrong"));
    } finally {
      setSavingEdit(false);
    }
  }

  async function remove(g: Gift) {
    if (!window.confirm(t("gift.confirmDelete", { name: g.name }))) return;
    setBusyId(g.id);
    try {
      await moderatorDeleteGift(pin, g.id);
      await reload();
      if (editing?.id === g.id) setEditing(null);
    } catch (e) {
      if (e instanceof ApiError) window.alert(t(`error.${e.code}`));
      else window.alert(t("common.wrong"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Gifts by duration tier (derived, read-only) */}
      <GiftEligibility />

      {/* Create */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-semibold text-slate-900">{t("gift.add")}</div>
        {createMsg && (
          <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
            {createMsg}
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("gift.name")}</span>
            <input
              type="text"
              lang="vi"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("gift.namePlaceholder")}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("gift.qty")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none sm:w-32"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{t("gift.tier")}</span>
            <select
              value={newTier}
              onChange={(e) => setNewTier(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none sm:w-40"
            >
              <option value="">{t("gift.tierNone")}</option>
              {tiers.map((d) => (
                <option key={d} value={d}>
                  {formatDuration(d)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={creating}
            onClick={() => void create()}
            className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {creating ? t("gift.adding") : t("gift.addBtn")}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {gifts.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">{t("gift.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">{t("gift.col.gift")}</th>
                  <th className="px-4 py-3">{t("gift.col.tier")}</th>
                  <th className="px-4 py-3">{t("gift.col.remaining")}</th>
                  <th className="px-4 py-3 text-right">{t("gift.col.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gifts.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {g.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {tierLabel(g.duration_seconds)}
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
                          {t("common.edit")}
                        </button>
                        <button
                          disabled={busyId === g.id}
                          onClick={() => void remove(g)}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-50"
                        >
                          {t("common.delete")}
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
            <div className="text-lg font-semibold text-slate-900">{t("gift.editTitle")}</div>

            {editMsg && (
              <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">
                {editMsg}
              </div>
            )}

            <div className="mt-4 grid gap-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{t("gift.name")}</span>
                <input
                  type="text"
                  lang="vi"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("gift.total")}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={editTotal}
                    onChange={(e) => setEditTotal(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    {t("gift.remaining")}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={editRemaining}
                    onChange={(e) => setEditRemaining(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  {t("gift.tier")}
                </span>
                <select
                  value={editTier}
                  onChange={(e) => setEditTier(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
                >
                  <option value="">{t("gift.tierNone")}</option>
                  {tiers.map((d) => (
                    <option key={d} value={d}>
                      {formatDuration(d)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">{t("gift.tierHint")}</p>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                disabled={savingEdit}
                onClick={closeEdit}
                className="rounded-xl bg-white px-5 py-2.5 font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                disabled={savingEdit}
                onClick={() => void saveEdit()}
                className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
              >
                {savingEdit ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
