// CSV export of all participants for the event. Encoded UTF-8 with a BOM so
// Excel renders Vietnamese characters correctly.
import { useModerator } from "./context";
import { formatDateTimeNumericIso } from "../lib/format";
import { useT } from "../lib/i18n";
import { card } from "../lib/ui";
import type { Participant } from "../lib/types";

// UTF-8 byte-order mark — makes Excel open Vietnamese CSV without mojibake.
const BOM = "﻿";

// CSV-escape a single field: wrap in quotes and double any internal quotes.
// Also neutralize spreadsheet formula injection — a value starting with =, +,
// -, @, tab or CR can be executed as a formula when Excel/Sheets opens the file
// (name/department/email are free text). Prefix those with a single quote.
function escapeCsv(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export default function ExportView() {
  const t = useT();
  const { state } = useModerator();

  if (!state) {
    return <div className="text-slate-400">{t("common.loading")}</div>;
  }

  const participants = state.participants;
  const queueName = new Map(state.queues.map((q) => [q.id, q.name]));
  const giftName = new Map(state.gifts.map((g) => [g.id, g.name]));

  const headers = [
    t("csv.name"),
    t("csv.domain"),
    t("csv.email"),
    t("csv.machine"),
    t("csv.duration"),
    t("csv.regTime"),
    t("csv.originalEst"),
    t("csv.actualStart"),
    t("csv.actualFinish"),
    t("csv.distance"),
    t("csv.gift"),
    t("csv.status"),
  ];

  function row(p: Participant): string {
    const fields = [
      p.name,
      p.department,
      p.email,
      queueName.get(p.assigned_queue_id) ?? "",
      String(p.run_duration_seconds),
      formatDateTimeNumericIso(p.created_at),
      p.original_estimated_start ?? "",
      p.actual_start ?? "",
      p.actual_finish ?? "",
      p.distance_logged === null ? "" : String(p.distance_logged),
      p.gift_id === null ? "" : giftName.get(p.gift_id) ?? "",
      p.status,
    ];
    return fields.map(escapeCsv).join(",");
  }

  function download() {
    const lines = [headers.map(escapeCsv).join(","), ...participants.map(row)];
    const csv = lines.join("\r\n");
    // Prepend a UTF-8 BOM (﻿) so Excel detects the encoding correctly and
    // renders Vietnamese diacritics instead of mojibake.
    const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "energysteps-export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="text-lg font-semibold text-brand">{t("exp.title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("exp.desc")}</p>
        <p className="mt-3 text-sm text-slate-700">
          {t("exp.count", { n: participants.length })}
        </p>
        <button
          type="button"
          onClick={download}
          disabled={participants.length === 0}
          className="mt-4 rounded-md bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("exp.download")}
        </button>
      </section>
    </div>
  );
}
