// PIN gate for the entire /moderator section. On success the PIN is stored in
// sessionStorage and the protected children render. P1-2: validation is against
// the DB (verify_pin RPC) — the moderator_pins table is the single source of
// truth; every other RPC also re-checks the PIN in the DB.
import { useState } from "react";
import { useT } from "../lib/i18n";
import { moderatorVerifyPin } from "../lib/api";
import { getSessionPin, setSessionPin } from "./session";

export default function ModeratorGate({
  children,
}: {
  children: (pin: string) => React.ReactNode;
}) {
  const t = useT();
  const [pin, setPin] = useState<string | null>(() => getSessionPin());
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (pin) return <>{children(pin)}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const candidate = entry.trim();
    if (!candidate) return;
    setChecking(true);
    setError(null);
    try {
      if (await moderatorVerifyPin(candidate)) {
        setSessionPin(candidate);
        setPin(candidate);
      } else {
        setError(t("gate.wrong"));
      }
    } catch {
      setError(t("common.wrong"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200"
      >
        <div>
          <h1 className="text-2xl font-bold text-brand">{t("gate.title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("gate.pin")}</p>
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
          disabled={checking}
          className="w-full rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {checking ? t("gate.checking") : t("gate.enter")}
        </button>
      </form>
    </div>
  );
}
