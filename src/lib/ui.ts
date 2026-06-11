// Shared Tailwind presentation helpers (class strings + status→class mapping)
// reused across pages and moderator views, so the look stays consistent and a
// design tweak is a one-line change here rather than an edit per file.

// Standard white "card" surface used for panels across the app.
export const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200";

// Participant status -> pill colours (shared by the board and runners views).
export function statusPillClass(status: string): string {
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
