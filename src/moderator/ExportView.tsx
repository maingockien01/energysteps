// CSV export of all participants for the event.
import { useModerator } from "./context";
import type { Participant } from "../lib/types";

const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";

const HEADERS = [
  "Name",
  "Department",
  "Email",
  "Machine",
  "Run Duration (seconds)",
  "Original Estimate",
  "Actual Start",
  "Actual Finish",
  "Distance",
  "Gift",
  "Status",
];

// CSV-escape a single field: wrap in quotes and double any internal quotes.
function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function ExportView() {
  const { state } = useModerator();

  if (!state) {
    return <div className="text-slate-400">Loading…</div>;
  }

  const participants = state.participants;
  const queueName = new Map(state.queues.map((q) => [q.id, q.name]));
  const giftName = new Map(state.gifts.map((g) => [g.id, g.name]));

  function row(p: Participant): string {
    const fields = [
      p.name,
      p.department,
      p.email,
      queueName.get(p.assigned_queue_id) ?? "",
      String(p.run_duration_seconds),
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
    const lines = [HEADERS.map(escapeCsv).join(","), ...participants.map(row)];
    const csv = lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
        <h2 className="text-lg font-semibold text-slate-900">Export</h2>
        <p className="mt-1 text-sm text-slate-600">
          Download all participant records as a CSV file.
        </p>
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-semibold">{participants.length}</span>{" "}
          {participants.length === 1 ? "participant" : "participants"} will be exported.
        </p>
        <button
          type="button"
          onClick={download}
          disabled={participants.length === 0}
          className="mt-4 rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download CSV
        </button>
      </section>
    </div>
  );
}
