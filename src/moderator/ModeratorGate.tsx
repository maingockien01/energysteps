// PIN gate for the entire /moderator section. On success the PIN is stored in
// sessionStorage and the protected children render. Validation is client-side
// against VITE_MODERATOR_PINS (UX gate); every RPC re-checks the PIN in the DB.
import { useState } from "react";
import { getSessionPin, isValidPin, setSessionPin } from "./session";

export default function ModeratorGate({
  children,
}: {
  children: (pin: string) => React.ReactNode;
}) {
  const [pin, setPin] = useState<string | null>(() => getSessionPin());
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (pin) return <>{children(pin)}</>;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isValidPin(entry)) {
      setSessionPin(entry);
      setPin(entry.trim());
      setError(null);
    } else {
      setError("Incorrect PIN.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
      >
        <div>
          <h1 className="text-2xl font-bold">Moderator access</h1>
          <p className="mt-1 text-sm text-slate-500">Enter the event PIN to continue.</p>
        </div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          placeholder="PIN"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-lg outline-none focus:border-slate-900"
        />
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-slate-900 py-2.5 font-semibold text-white hover:bg-slate-700"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
