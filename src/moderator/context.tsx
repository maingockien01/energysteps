// Shared moderator state: loads the full console state via the PIN-gated RPC,
// re-fetches on Realtime change broadcasts, and exposes it + the PIN + a manual
// reload to every moderator view through the useModerator() hook.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { moderatorGetState } from "../lib/api";
import { subscribeToChanges } from "../lib/realtime";
import type { ModeratorState } from "../lib/types";

interface ModeratorContextValue {
  pin: string;
  state: ModeratorState | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<ModeratorContextValue | null>(null);

export function useModerator(): ModeratorContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useModerator must be used within ModeratorProvider");
  return v;
}

export function ModeratorProvider({
  pin,
  children,
}: {
  pin: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ModeratorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const s = await moderatorGetState(pin);
      setState(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [pin]);

  useEffect(() => {
    void reload();
    const unsub = subscribeToChanges(() => {
      void reload();
    });
    return unsub;
  }, [reload]);

  return (
    <Ctx.Provider value={{ pin, state, loading, error, reload }}>{children}</Ctx.Provider>
  );
}
