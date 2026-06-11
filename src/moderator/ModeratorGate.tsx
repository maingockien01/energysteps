// PIN gate for the entire /moderator section. On success the PIN is stored in
// sessionStorage and the protected children render. Validation is client-side
// against VITE_MODERATOR_PINS (UX gate); every RPC re-checks the PIN in the DB.
import { useState } from "react";
import { useT, LangToggle } from "../lib/i18n";
import { getSessionPin, isValidPin, setSessionPin } from "./session";

export default function ModeratorGate({
  children,
}: {
  children: (pin: string) => React.ReactNode;
}) {
  const t = useT();
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
      setError(t("gate.wrong"));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand">{t("gate.title")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("gate.pin")}</p>
          </div>
          <LangToggle />
        </div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          placeholder={t("gate.pin")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-lg outline-none focus:border-brand"
        />
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark"
        >
          {t("gate.enter")}
        </button>
      </form>
    </div>
  );
}
